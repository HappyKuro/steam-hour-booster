'use strict';

const fs = require('fs');
const path = require('path');

const { safeBoolean, safeInteger, safeString } = require('./utils');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const ACCOUNTS_PATH = path.join(ROOT_DIR, 'accounts.txt');

const DEFAULT_CONFIG = {
    games_list: [440],
    account_status: 1,
    rich_presence_enabled: true,
    rich_presence_message: 'Idling for hours...',
    report_interval_minutes: 60,
    startup_delay_seconds: 7,
    login_timeout_seconds: 60,
    remote_command_poll_interval_seconds: 5,
    machine_name: 'SteamHourBooster',
    discord_bot_token: '',
    discord_channel_id: '',
    telegram_bot_token: '',
    telegram_chat_id: ''
};

const PERSONA_STATE_MIN = 0;
const PERSONA_STATE_MAX = 7;
const RANDOM_MACHINE_NAME_TOKENS = new Set([
    'auto',
    'random',
    'random_windows',
    'desktop-random',
    'windows-random'
]);

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing required file: ${path.basename(filePath)}`);
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse ${path.basename(filePath)}: ${error.message}`);
    }
}

function normalizeGamesList(value) {
    if (!Array.isArray(value)) {
        return DEFAULT_CONFIG.games_list.slice();
    }

    const normalized = value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0);

    return normalized.length > 0 ? normalized : DEFAULT_CONFIG.games_list.slice();
}

function generateWindowsMachineName() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';

    for (let index = 0; index < 7; index += 1) {
        const randomIndex = Math.floor(Math.random() * alphabet.length);
        suffix += alphabet[randomIndex];
    }

    return `DESKTOP-${suffix}`;
}

function resolveMachineName(value) {
    const normalized = safeString(value, DEFAULT_CONFIG.machine_name);

    if (!normalized) {
        return DEFAULT_CONFIG.machine_name;
    }

    if (RANDOM_MACHINE_NAME_TOKENS.has(normalized.toLowerCase())) {
        return 'random';
    }

    return normalized;
}

function buildMachineName(value) {
    const normalized = safeString(value, DEFAULT_CONFIG.machine_name);

    if (!normalized || RANDOM_MACHINE_NAME_TOKENS.has(normalized.toLowerCase())) {
        return generateWindowsMachineName();
    }

    return normalized;
}

function loadConfig() {
    const rawConfig = readJsonFile(CONFIG_PATH);
    const config = {
        games_list: normalizeGamesList(rawConfig.games_list),
        account_status: safeInteger(
            rawConfig.account_status,
            DEFAULT_CONFIG.account_status,
            { min: PERSONA_STATE_MIN, max: PERSONA_STATE_MAX }
        ),
        rich_presence_enabled: safeBoolean(rawConfig.rich_presence_enabled, DEFAULT_CONFIG.rich_presence_enabled),
        rich_presence_message: safeString(rawConfig.rich_presence_message, DEFAULT_CONFIG.rich_presence_message),
        report_interval_minutes: safeInteger(
            rawConfig.report_interval_minutes,
            DEFAULT_CONFIG.report_interval_minutes,
            { min: 0, max: 24 * 60 }
        ),
        startup_delay_seconds: safeInteger(
            rawConfig.startup_delay_seconds,
            DEFAULT_CONFIG.startup_delay_seconds,
            { min: 0, max: 300 }
        ),
        login_timeout_seconds: safeInteger(
            rawConfig.login_timeout_seconds,
            DEFAULT_CONFIG.login_timeout_seconds,
            { min: 15, max: 300 }
        ),
        remote_command_poll_interval_seconds: safeInteger(
            rawConfig.remote_command_poll_interval_seconds,
            DEFAULT_CONFIG.remote_command_poll_interval_seconds,
            { min: 3, max: 300 }
        ),
        machine_name: resolveMachineName(rawConfig.machine_name),
        discord_bot_token: safeString(process.env.DISCORD_BOT_TOKEN, safeString(rawConfig.discord_bot_token)),
        discord_channel_id: safeString(process.env.DISCORD_CHANNEL_ID, safeString(rawConfig.discord_channel_id)),
        telegram_bot_token: safeString(process.env.TELEGRAM_BOT_TOKEN, safeString(rawConfig.telegram_bot_token)),
        telegram_chat_id: safeString(process.env.TELEGRAM_CHAT_ID, safeString(rawConfig.telegram_chat_id))
    };

    if (config.games_list.length === 0) {
        throw new Error('config.json must contain at least one numeric AppID in games_list');
    }

    return {
        ...config,
        startup_delay_ms: config.startup_delay_seconds * 1000,
        login_timeout_ms: config.login_timeout_seconds * 1000,
        report_interval_ms: config.report_interval_minutes * 60 * 1000,
        remote_command_poll_interval_ms: config.remote_command_poll_interval_seconds * 1000
    };
}

function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        throw new Error('accounts.txt not found');
    }

    const accounts = [];
    const warnings = [];
    const seenUsernames = new Set();
    const fileContents = fs.readFileSync(ACCOUNTS_PATH, 'utf8');

    fileContents.split(/\r?\n/).forEach((rawLine, index) => {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) {
            return;
        }

        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
            warnings.push(`Skipping malformed account entry on line ${index + 1}`);
            return;
        }

        const username = line.slice(0, separatorIndex).trim();
        const password = line.slice(separatorIndex + 1).trim();
        const normalizedUsername = username.toLowerCase();

        if (!username || !password) {
            warnings.push(`Skipping empty account entry on line ${index + 1}`);
            return;
        }

        if (seenUsernames.has(normalizedUsername)) {
            warnings.push(`Skipping duplicate username "${username}" on line ${index + 1}`);
            return;
        }

        seenUsernames.add(normalizedUsername);
        accounts.push({ username, password });
    });

    if (accounts.length === 0) {
        throw new Error('No valid accounts were found in accounts.txt');
    }

    return { accounts, warnings };
}

module.exports = {
    ACCOUNTS_PATH,
    CONFIG_PATH,
    DEFAULT_CONFIG,
    ROOT_DIR,
    buildMachineName,
    loadAccounts,
    loadConfig
};
