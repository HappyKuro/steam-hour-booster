'use strict';

const { createRequest } = require('./http');
const { formatTimestamp, sanitizeMultiline, truncate } = require('./utils');

class Notifier {
    constructor(config) {
        this.config = config;
        this.deliveryChain = Promise.resolve();
    }

    info(scope, message, options = {}) {
        this.write('INFO', scope, message, options);
    }

    warn(scope, message, options = {}) {
        this.write('WARN', scope, message, options);
    }

    error(scope, message, options = {}) {
        this.write('ERROR', scope, message, options);
    }

    write(level, scope, message, options = {}) {
        const normalized = sanitizeMultiline(message);
        const lines = normalized.split('\n');
        const prefix = `[${formatTimestamp()}] [${level}] [${scope}]`;
        const rendered = lines.map((line) => `${prefix} ${line}`).join('\n');

        console.log(rendered);

        if (options.relay !== false) {
            this.enqueueDelivery(rendered, Boolean(options.important));
        }
    }

    enqueueDelivery(message, important) {
        this.deliveryChain = this.deliveryChain
            .then(async () => {
                if (this.config.discord_bot_token && this.config.discord_channel_id) {
                    await this.sendDiscordMessage(message);
                }

                if (important && this.config.telegram_bot_token && this.config.telegram_chat_id) {
                    await this.sendTelegramMessage(message);
                }
            })
            .catch((error) => {
                this.logTransportError(error);
            });
    }

    async sendDiscordMessage(message) {
        const payload = JSON.stringify({
            content: truncate(message, 1900)
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
            throw new Error(`Discord returned ${response.statusCode}: ${truncate(response.body, 200)}`);
        }
    }

    async sendTelegramMessage(message) {
        const payload = JSON.stringify({
            chat_id: this.config.telegram_chat_id,
            text: truncate(message, 4000)
        });

        const response = await createRequest({
            url: `https://api.telegram.org/bot${this.config.telegram_bot_token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            body: payload
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(`Telegram returned ${response.statusCode}: ${truncate(response.body, 200)}`);
        }
    }

    logTransportError(error) {
        const message = error instanceof Error ? error.message : String(error);
        const rendered = `[${formatTimestamp()}] [WARN] [Notifier] Remote delivery failed: ${message}`;
        console.error(rendered);
    }

    async flush() {
        try {
            await this.deliveryChain;
        } catch {
            // Delivery errors are already logged as warnings.
        }
    }
}

module.exports = { Notifier };
