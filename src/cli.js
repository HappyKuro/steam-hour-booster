'use strict';

const { loadAccounts, loadConfig } = require('./config');
const { formatTimestamp } = require('./utils');

function printHelp() {
    console.log([
        'Steam Hour Booster',
        '',
        'Commands:',
        '  start     Start the booster (default)',
        '  validate  Validate config.json and accounts.txt without logging in',
        '  help      Show this help message'
    ].join('\n'));
}

function validateProject() {
    const config = loadConfig();
    const { accounts, warnings } = loadAccounts();

    console.log([
        `[${formatTimestamp()}] Validation successful`,
        `Accounts: ${accounts.length}`,
        `Games: ${config.games_list.join(', ')}`,
        `Discord relay enabled: ${config.discord_bot_token && config.discord_channel_id ? 'yes' : 'no'}`,
        `Telegram relay enabled: ${config.telegram_bot_token && config.telegram_chat_id ? 'yes' : 'no'}`
    ].join('\n'));

    for (const warning of warnings) {
        console.warn(`[${formatTimestamp()}] Warning: ${warning}`);
    }
}

async function startProject() {
    const config = loadConfig();
    const { accounts, warnings } = loadAccounts();
    const { BoosterApp } = require('./app');
    const app = new BoosterApp(config, accounts);

    for (const warning of warnings) {
        app.notifier.warn('Accounts', warning, { relay: false });
    }

    await app.start();
}

async function main() {
    const command = (process.argv[2] || 'start').toLowerCase();

    if (command === 'help' || command === '--help' || command === '-h') {
        printHelp();
        return;
    }

    if (command === 'validate' || command === 'check') {
        validateProject();
        return;
    }

    if (command === 'start') {
        await startProject();
        return;
    }

    throw new Error(`Unknown command "${command}". Run "node index.js help" for usage.`);
}

module.exports = {
    main,
    printHelp,
    validateProject
};
