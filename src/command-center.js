'use strict';

const readline = require('readline');

class ConsoleCommandCenter {
    constructor(notifier, handlers) {
        this.notifier = notifier;
        this.handlers = handlers;
        this.pendingGuardRequests = new Map();
        this.readline = null;
    }

    start() {
        if (this.readline) {
            return;
        }

        this.readline = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        this.readline.on('line', (line) => {
            void this.handleInput(line);
        });

        this.notifier.info(
            'Console',
            'Commands: status, pending, code <username> <steam_guard_code>, help, quit',
            { relay: false }
        );
    }

    stop() {
        if (!this.readline) {
            return;
        }

        this.readline.removeAllListeners();
        this.readline.close();
        this.readline = null;
    }

    registerGuardRequest(username, domain, submit) {
        this.pendingGuardRequests.set(username.toLowerCase(), {
            username,
            domain,
            submit,
            requestedAt: Date.now()
        });

        this.notifier.warn(
            username,
            [
                `Steam Guard required (${domain || 'mobile/email'}).`,
                `Use: code ${username} YOUR_CODE`,
                'If this is the only pending request, you can also paste the code directly.'
            ].join('\n'),
            { important: true }
        );
    }

    clearGuardRequest(username) {
        this.pendingGuardRequests.delete(username.toLowerCase());
    }

    submitGuardCode(username, code, source) {
        const entry = this.pendingGuardRequests.get(username.toLowerCase());

        if (!entry) {
            return false;
        }

        const trimmedCode = String(code ?? '').trim();
        if (!trimmedCode) {
            return false;
        }

        this.pendingGuardRequests.delete(username.toLowerCase());
        entry.submit(trimmedCode, source);
        return true;
    }

    hasPendingRequests() {
        return this.pendingGuardRequests.size > 0;
    }

    getPendingRequests() {
        return Array.from(this.pendingGuardRequests.values())
            .sort((left, right) => left.requestedAt - right.requestedAt);
    }

    async handleInput(line) {
        const trimmed = String(line ?? '').trim();

        if (!trimmed) {
            return;
        }

        const parts = trimmed.split(/\s+/);
        const command = parts.shift().toLowerCase();

        if (command === 'help') {
            this.notifier.info(
                'Console',
                [
                    'Available commands:',
                    'status  -> print the current account summary',
                    'pending -> list pending Steam Guard requests',
                    'code <username> <code> -> submit a Steam Guard code',
                    'quit    -> log off all accounts and exit'
                ].join('\n'),
                { relay: false }
            );
            return;
        }

        if (command === 'status') {
            await this.handlers.onStatus();
            return;
        }

        if (command === 'pending') {
            const pending = this.getPendingRequests();

            if (pending.length === 0) {
                this.notifier.info('Console', 'No pending Steam Guard requests.', { relay: false });
                return;
            }

            const message = pending
                .map((entry) => `${entry.username} (${entry.domain || 'mobile/email'})`)
                .join('\n');

            this.notifier.info('Console', `Pending Steam Guard requests:\n${message}`, { relay: false });
            return;
        }

        if (command === 'code') {
            const username = parts.shift();
            const code = parts.join(' ');

            if (!username || !code) {
                this.notifier.warn('Console', 'Usage: code <username> <steam_guard_code>', { relay: false });
                return;
            }

            const accepted = this.submitGuardCode(username, code, 'Console');

            if (!accepted) {
                this.notifier.warn('Console', `No pending Steam Guard request for "${username}".`, { relay: false });
            }

            return;
        }

        if (command === 'quit' || command === 'exit' || command === 'stop') {
            await this.handlers.onShutdown('console command');
            return;
        }

        if (!trimmed.includes(' ') && this.pendingGuardRequests.size === 1) {
            const [pendingRequest] = this.pendingGuardRequests.values();
            const accepted = this.submitGuardCode(pendingRequest.username, trimmed, 'Console');

            if (!accepted) {
                this.notifier.warn('Console', 'That code could not be submitted.', { relay: false });
            }

            return;
        }

        this.notifier.warn('Console', 'Unknown command. Use `help` for the available commands.', { relay: false });
    }
}

module.exports = { ConsoleCommandCenter };
