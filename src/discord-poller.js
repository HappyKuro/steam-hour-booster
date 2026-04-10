'use strict';

const { createRequest } = require('./http');
const { compareSnowflakes, delay, safeString, truncate } = require('./utils');

class DiscordCommandPoller {
    constructor(config, notifier, commandCenter, handlers = {}) {
        this.config = config;
        this.notifier = notifier;
        this.commandCenter = commandCenter;
        this.handlers = handlers;
        this.interval = null;
        this.lastSeenMessageId = null;
        this.isPolling = false;
        this.lastErrorKey = null;
        this.failureCount = 0;
        this.transientFailureCount = 0;
    }

    get enabled() {
        return Boolean(this.config.discord_bot_token && this.config.discord_channel_id);
    }

    async start() {
        if (!this.enabled || this.interval) {
            return;
        }

        try {
            const latestMessages = await this.fetchMessages(1);

            if (latestMessages[0]?.id) {
                this.lastSeenMessageId = latestMessages[0].id;
            }

            this.notifier.info('Discord', 'Remote code polling enabled.');
        } catch (error) {
            this.recordPollError(error);
        }

        this.interval = setInterval(() => {
            void this.pollOnce();
        }, this.config.remote_command_poll_interval_ms);

        if (typeof this.interval.unref === 'function') {
            this.interval.unref();
        }
    }

    stop() {
        if (!this.interval) {
            return;
        }

        clearInterval(this.interval);
        this.interval = null;
    }

    async pollOnce() {
        if (!this.enabled || this.isPolling) {
            return;
        }

        this.isPolling = true;

        try {
            const messages = await this.fetchMessagesWithRetry(10);
            const unseenMessages = messages
                .filter((message) => !this.lastSeenMessageId || compareSnowflakes(message.id, this.lastSeenMessageId) > 0)
                .sort((left, right) => compareSnowflakes(left.id, right.id));

            for (const message of unseenMessages) {
                this.lastSeenMessageId = message.id;
                await this.handleMessage(message);
            }

            this.lastErrorKey = null;
            this.failureCount = 0;
            this.transientFailureCount = 0;
        } catch (error) {
            this.recordPollError(error);
        } finally {
            this.isPolling = false;
        }
    }

    async fetchMessagesWithRetry(limit) {
        try {
            return await this.fetchMessages(limit);
        } catch (error) {
            if (!this.isTransientDiscordError(error)) {
                throw error;
            }

            await delay(2000);
            return this.fetchMessages(limit);
        }
    }

    async fetchMessages(limit) {
        const response = await createRequest({
            url: `https://discord.com/api/v10/channels/${this.config.discord_channel_id}/messages?limit=${limit}`,
            headers: {
                Authorization: `Bot ${this.config.discord_bot_token}`
            }
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`Discord returned ${response.statusCode}: ${truncate(response.body, 200)}`);
        }

        let parsed;

        try {
            parsed = JSON.parse(response.body);
        } catch (error) {
            throw new Error(`Discord returned malformed JSON: ${error.message}`);
        }

        if (!Array.isArray(parsed)) {
            throw new Error('Discord did not return a message list');
        }

        return parsed;
    }

    isTransientDiscordError(error) {
        const message = String(error?.message || error);

        return /Discord returned (429|502|503|504)/i.test(message)
            || /upstream connect error/i.test(message)
            || /connection termination/i.test(message)
            || /ECONNRESET/i.test(message)
            || /ETIMEDOUT/i.test(message)
            || /socket hang up/i.test(message)
            || /Request timed out/i.test(message);
    }

    async handleMessage(message) {
        if (message?.author?.bot) {
            return;
        }

        const content = safeString(message?.content);
        if (!content.startsWith('!')) {
            return;
        }

        const [rawCommand, ...args] = content.split(/\s+/);
        const command = rawCommand.toLowerCase();

        if (command === '!help') {
            await this.reply(this.handlers.onHelp ? await this.handlers.onHelp() : 'No Discord help is configured.');
            return;
        }

        if (command === '!status') {
            await this.reply(this.handlers.onStatus ? await this.handlers.onStatus() : 'Status reporting is unavailable.');
            return;
        }

        if (command === '!pending') {
            await this.reply(this.handlers.onPending ? await this.handlers.onPending() : 'Pending request reporting is unavailable.');
            return;
        }

        if (command !== '!code') {
            await this.reply('Unknown command. Use !help.');
            return;
        }

        const username = args.shift();
        const code = args.join(' ');

        if (!username || !code) {
            await this.reply('Usage: !code <username> <steam_guard_code>');
            return;
        }

        const accepted = this.commandCenter.submitGuardCode(username, code, 'Discord');

        if (accepted) {
            this.notifier.info('Discord', `Accepted remote Steam Guard code for ${username}.`, { relay: false });
            await this.reply(`Accepted Steam Guard code for ${username}.`);
            return;
        }

        await this.reply(`No pending Steam Guard request for "${username}".`);
    }

    async reply(content) {
        const payload = JSON.stringify({
            content: truncate(content, 1900)
        });

        const response = await createRequest({
            url: `https://discord.com/api/v10/channels/${this.config.discord_channel_id}/messages`,
            method: 'POST',
            headers: {
                Authorization: `Bot ${this.config.discord_bot_token}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            body: payload
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`Discord reply failed with ${response.statusCode}: ${truncate(response.body, 200)}`);
        }
    }

    recordPollError(error) {
        const key = error instanceof Error ? error.message : String(error);
        const transient = this.isTransientDiscordError(error);

        this.failureCount += 1;

        if (transient) {
            this.transientFailureCount += 1;

            if (this.lastErrorKey !== key || this.transientFailureCount === 1 || this.transientFailureCount % 10 === 0) {
                this.notifier.warn(
                    'Discord',
                    `Discord command polling hit a temporary upstream issue and will keep retrying: ${key}`
                );
            }
        } else if (this.lastErrorKey !== key || this.failureCount === 1 || this.failureCount % 12 === 0) {
            this.notifier.warn('Discord', `Remote code polling failed: ${key}`);
        }

        this.lastErrorKey = key;
    }
}

module.exports = { DiscordCommandPoller };
