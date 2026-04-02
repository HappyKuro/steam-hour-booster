'use strict';

const SteamUser = require('steam-user');

const { buildMachineName } = require('./config');
const { buildSteamErrorLabel, safeString } = require('./utils');

const MAX_INVALID_PASSWORD_RETRIES = 2;

class SteamBot {
    constructor(account, config, notifier, commandCenter) {
        this.account = account;
        this.config = config;
        this.notifier = notifier;
        this.commandCenter = commandCenter;

        this.client = null;
        this.profileName = account.username;
        this.state = 'idle';
        this.startedAt = null;
        this.pendingReconnectAt = null;
        this.reconnectTimer = null;
        this.loginTimeout = null;
        this.guardCallback = null;
        this.invalidPasswordRetries = 0;
        this.permanentlyStopped = false;
        this.richPresenceWarningShown = false;
    }

    get username() {
        return this.account.username;
    }

    get logScope() {
        return this.username;
    }

    start() {
        if (this.permanentlyStopped) {
            return;
        }

        this.pendingReconnectAt = null;
        this.clearReconnectTimer();
        this.clearLoginTimeout();
        this.commandCenter.clearGuardRequest(this.username);
        this.destroyClient();

        this.state = 'connecting';
        this.client = new SteamUser({ autoRelogin: false });
        this.bindClientEvents();

        const machineName = buildMachineName(this.config.machine_name);
        this.notifier.info(this.logScope, `Connecting to Steam with machine name ${machineName}...`);

        try {
            this.client.logOn({
                accountName: this.account.username,
                password: this.account.password,
                machineName
            });
        } catch (error) {
            this.notifier.error(this.logScope, `Failed to start login: ${error.message}`, { important: true });
            this.scheduleReconnect(30000, 'recovering from startup failure');
            return;
        }

        this.loginTimeout = setTimeout(() => {
            this.notifier.warn(this.logScope, 'Login timed out. Restarting the session.', { important: true });
            this.scheduleReconnect(5000, 'retrying timed-out login');
        }, this.config.login_timeout_ms);
    }

    stop({ permanent = true } = {}) {
        this.permanentlyStopped = permanent;
        this.state = permanent ? 'stopped' : 'idle';
        this.startedAt = null;
        this.pendingReconnectAt = null;
        this.guardCallback = null;

        this.clearReconnectTimer();
        this.clearLoginTimeout();
        this.commandCenter.clearGuardRequest(this.username);
        this.destroyClient();
    }

    bindClientEvents() {
        this.client.on('loggedOn', () => this.onLoggedOn());
        this.client.on('accountInfo', (name) => this.onAccountInfo(name));
        this.client.on('steamGuard', (domain, callback, lastCodeWrong) => this.onSteamGuard(domain, callback, lastCodeWrong));
        this.client.on('error', (error) => this.onError(error));
        this.client.on('disconnected', (eresult, msg) => this.onDisconnected(eresult, msg));
        this.client.on('playingState', (blocked, appid) => this.onPlayingState(blocked, appid));
    }

    onLoggedOn() {
        this.clearLoginTimeout();
        this.invalidPasswordRetries = 0;
        this.startedAt = Date.now();
        this.pendingReconnectAt = null;
        this.state = 'boosting';

        this.notifier.info(this.logScope, 'Logged in successfully.');

        try {
            this.client.setPersona(this.config.account_status);
        } catch (error) {
            this.notifier.warn(this.logScope, `Could not set persona state: ${error.message}`);
        }

        try {
            this.client.gamesPlayed(this.config.games_list);
            this.notifier.info(this.logScope, `Now idling AppIDs: ${this.config.games_list.join(', ')}`, { important: true });
        } catch (error) {
            this.notifier.warn(this.logScope, `Could not set games played: ${error.message}`, { important: true });
        }

        this.applyRichPresence();
    }

    onAccountInfo(name) {
        if (typeof name === 'string' && name.trim()) {
            this.profileName = name.trim();
            return;
        }

        if (typeof this.client?.accountInfo?.name === 'string' && this.client.accountInfo.name.trim()) {
            this.profileName = this.client.accountInfo.name.trim();
        }
    }

    onSteamGuard(domain, callback, lastCodeWrong) {
        this.clearLoginTimeout();
        this.state = 'awaiting_guard';
        this.guardCallback = callback;

        const domainLabel = domain || 'mobile/email';
        const extraGuidance = lastCodeWrong
            ? 'The last code was rejected. Wait for a fresh code before retrying.'
            : 'Waiting for a Steam Guard code.';

        this.notifier.warn(this.logScope, `${extraGuidance}\nSource: ${domainLabel}`, { important: true });
        this.commandCenter.registerGuardRequest(this.username, domainLabel, (code, source) => {
            this.submitSteamGuardCode(code, source);
        });
    }

    submitSteamGuardCode(code, source) {
        const callback = this.guardCallback;
        this.guardCallback = null;
        this.commandCenter.clearGuardRequest(this.username);

        if (!callback) {
            this.notifier.warn(this.logScope, `Ignored ${source} code because no Steam Guard request is pending.`);
            return;
        }

        this.notifier.info(this.logScope, `Submitting Steam Guard code from ${source}.`);
        this.state = 'connecting';
        callback(code);
    }

    onError(error) {
        this.clearLoginTimeout();
        this.startedAt = null;
        this.commandCenter.clearGuardRequest(this.username);

        const label = buildSteamErrorLabel(error, SteamUser.EResult);
        this.notifier.error(this.logScope, label, { important: true });

        if (/InvalidPassword/i.test(label)) {
            if (this.invalidPasswordRetries < MAX_INVALID_PASSWORD_RETRIES) {
                this.invalidPasswordRetries += 1;
                this.scheduleReconnect(10000, `retrying password failure (${this.invalidPasswordRetries}/${MAX_INVALID_PASSWORD_RETRIES})`);
            } else {
                this.state = 'halted';
                this.permanentlyStopped = true;
                this.notifier.error(
                    this.logScope,
                    'Stopping this account after repeated password failures. Check accounts.txt and use the Steam login name.',
                    { important: true }
                );
            }

            return;
        }

        if (/RateLimitExceeded/i.test(label)) {
            this.scheduleReconnect(30 * 60 * 1000, 'cooling down after rate limit');
            return;
        }

        if (/LogonSessionReplaced|LoggedInElsewhere/i.test(label)) {
            this.scheduleReconnect(5 * 60 * 1000, 'waiting after session replacement');
            return;
        }

        if (/timed out|NoConnection|ServiceUnavailable|ConnectFailed|TryAnotherCM/i.test(label)) {
            this.scheduleReconnect(30000, 'recovering from connection issue');
            return;
        }

        if (/AccessDenied|AccountDisabled|ParentalControlRestricted/i.test(label)) {
            this.state = 'halted';
            this.permanentlyStopped = true;
            return;
        }

        this.scheduleReconnect(2 * 60 * 1000, 'retrying after unexpected Steam error');
    }

    onDisconnected(_eresult, msg) {
        this.clearLoginTimeout();
        this.startedAt = null;
        this.commandCenter.clearGuardRequest(this.username);

        if (this.permanentlyStopped) {
            return;
        }

        const reason = safeString(msg, 'connection closed');
        this.notifier.warn(this.logScope, `Disconnected: ${reason}`);

        if (/LoggedInElsewhere|LogonSessionReplaced/i.test(reason)) {
            this.scheduleReconnect(5 * 60 * 1000, 'waiting after remote login');
            return;
        }

        if (/NoConnection|timed out|ServiceUnavailable|connection closed/i.test(reason)) {
            this.scheduleReconnect(30000, 'reconnecting after disconnect');
        }
    }

    onPlayingState(blocked, appid) {
        if (!blocked) {
            return;
        }

        this.notifier.warn(
            this.logScope,
            `Steam reports this account is blocked from playing AppID ${appid || 'unknown'} on this session.`,
            { important: true }
        );
    }

    applyRichPresence() {
        if (!this.config.rich_presence_enabled || this.config.games_list.length === 0) {
            return;
        }

        const primaryAppId = this.config.games_list[0];
        const richPresencePayload = {
            steam_display: this.config.rich_presence_message
        };

        try {
            if (typeof this.client.setPresence === 'function') {
                this.client.setPresence(primaryAppId, richPresencePayload);
                return;
            }

            if (typeof this.client.uploadRichPresence === 'function') {
                if (!this.config.rich_presence_message.startsWith('#')) {
                    if (!this.richPresenceWarningShown) {
                        this.richPresenceWarningShown = true;
                        this.notifier.warn(
                            this.logScope,
                            'Rich presence was skipped because uploadRichPresence expects a localization key (for example "#Some_Game_Key"), not free text.'
                        );
                    }

                    return;
                }

                this.client.uploadRichPresence(primaryAppId, richPresencePayload);
            }
        } catch (error) {
            this.notifier.warn(this.logScope, `Could not apply rich presence: ${error.message}`);
        }
    }

    scheduleReconnect(delayMs, reason) {
        if (this.permanentlyStopped) {
            return;
        }

        this.clearReconnectTimer();
        this.pendingReconnectAt = Date.now() + delayMs;
        this.state = 'reconnecting';

        const seconds = Math.round(delayMs / 1000);
        this.notifier.warn(this.logScope, `${reason}. Reconnecting in ${seconds}s.`, { important: delayMs >= 30000 });

        this.reconnectTimer = setTimeout(() => {
            this.start();
        }, delayMs);
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    clearLoginTimeout() {
        if (this.loginTimeout) {
            clearTimeout(this.loginTimeout);
            this.loginTimeout = null;
        }
    }

    destroyClient() {
        if (!this.client) {
            return;
        }

        this.client.removeAllListeners();

        try {
            this.client.logOff();
        } catch {
            // Ignore logoff failures while cleaning up.
        }

        this.client = null;
    }

    getStatusLine() {
        const label = this.profileName || this.username;

        if (this.state === 'boosting' && this.startedAt) {
            const hours = ((Date.now() - this.startedAt) / (1000 * 60 * 60)).toFixed(2);
            return `- ${label}: boosting for ${hours} hours`;
        }

        if (this.state === 'awaiting_guard') {
            return `- ${label}: waiting for Steam Guard`;
        }

        if (this.state === 'reconnecting' && this.pendingReconnectAt) {
            const seconds = Math.max(0, Math.ceil((this.pendingReconnectAt - Date.now()) / 1000));
            return `- ${label}: reconnecting in ${seconds}s`;
        }

        return `- ${label}: ${this.state}`;
    }
}

module.exports = { SteamBot };
