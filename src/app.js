'use strict';

const { ConsoleCommandCenter } = require('./command-center');
const { DiscordCommandPoller } = require('./discord-poller');
const { Notifier } = require('./notifier');
const { SteamBot } = require('./steam-bot');
const { delay } = require('./utils');

class BoosterApp {
    constructor(config, accounts) {
        this.config = config;
        this.accounts = accounts;
        this.notifier = new Notifier(config);
        this.commandCenter = new ConsoleCommandCenter(this.notifier, {
            onStatus: async () => {
                this.printStatusReport(false);
            },
            onShutdown: async (source) => {
                await this.shutdown(source, 0);
            }
        });
        this.discordPoller = new DiscordCommandPoller(config, this.notifier, this.commandCenter, {
            onHelp: async () => this.buildDiscordHelp(),
            onPending: async () => this.buildPendingReport(),
            onStatus: async () => this.buildStatusReport()
        });
        this.bots = new Map();
        this.reportInterval = null;
        this.shuttingDown = false;
        this.exitCode = 0;
    }

    async start() {
        this.installProcessHandlers();
        this.commandCenter.start();

        this.notifier.info('System', `Starting booster for ${this.accounts.length} account(s).`, { important: true });

        await this.discordPoller.start();

        for (const account of this.accounts) {
            if (this.shuttingDown) {
                return;
            }

            const bot = new SteamBot(account, this.config, this.notifier, this.commandCenter);
            this.bots.set(account.username.toLowerCase(), bot);
            bot.start();

            if (this.config.startup_delay_ms > 0) {
                await delay(this.config.startup_delay_ms);
            }
        }

        this.startReporting();
    }

    installProcessHandlers() {
        process.on('SIGINT', () => {
            void this.shutdown('SIGINT', 0);
        });

        process.on('SIGTERM', () => {
            void this.shutdown('SIGTERM', 0);
        });

        process.on('uncaughtException', (error) => {
            const details = error?.stack || error?.message || String(error);
            this.notifier.error('System', `Uncaught exception:\n${details}`, { important: true });
            void this.shutdown('uncaughtException', 1);
        });

        process.on('unhandledRejection', (reason) => {
            const details = reason instanceof Error ? reason.stack || reason.message : String(reason);
            this.notifier.error('System', `Unhandled rejection:\n${details}`, { important: true });
            void this.shutdown('unhandledRejection', 1);
        });
    }

    startReporting() {
        if (this.config.report_interval_ms <= 0) {
            this.notifier.info('Report', 'Periodic reporting is disabled.');
            return;
        }

        this.reportInterval = setInterval(() => {
            this.printStatusReport(true);
        }, this.config.report_interval_ms);

        if (typeof this.reportInterval.unref === 'function') {
            this.reportInterval.unref();
        }
    }

    buildStatusReport() {
        const lines = [`Hour Boost Report (${new Date().toLocaleString()})`];

        for (const bot of this.bots.values()) {
            lines.push(bot.getStatusLine());
        }

        if (this.commandCenter.hasPendingRequests()) {
            lines.push('');
            lines.push(this.buildPendingReport());
        }

        return lines.join('\n');
    }

    buildPendingReport() {
        const pending = this.commandCenter.getPendingRequests();

        if (pending.length === 0) {
            return 'Pending Steam Guard requests: none';
        }

        const lines = ['Pending Steam Guard requests:'];

        for (const entry of pending) {
            lines.push(`- ${entry.username} (${entry.domain || 'mobile/email'})`);
        }

        return lines.join('\n');
    }

    buildDiscordHelp() {
        return [
            'Discord commands:',
            '!help',
            '!status',
            '!pending',
            '!code <username> <steam_guard_code>'
        ].join('\n');
    }

    printStatusReport(important) {
        this.notifier.info('Report', this.buildStatusReport(), { important });
    }

    async shutdown(source, exitCode) {
        if (this.shuttingDown) {
            this.exitCode = Math.max(this.exitCode, exitCode);
            return;
        }

        this.shuttingDown = true;
        this.exitCode = exitCode;

        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }

        this.discordPoller.stop();
        this.commandCenter.stop();
        this.notifier.warn('System', `Shutting down after ${source}.`, { important: true });

        for (const bot of this.bots.values()) {
            bot.stop({ permanent: true });
        }

        await this.notifier.flush();
        process.exit(this.exitCode);
    }
}

module.exports = { BoosterApp };
