'use strict';

function formatTimestamp(date = new Date()) {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeMultiline(message) {
    return String(message ?? '')
        .replace(/\r\n/g, '\n')
        .trimEnd();
}

function truncate(value, maxLength) {
    const input = String(value ?? '');

    if (input.length <= maxLength) {
        return input;
    }

    return `${input.slice(0, Math.max(0, maxLength - 3))}...`;
}

function safeInteger(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        return fallback;
    }

    return parsed;
}

function safeString(value, fallback = '') {
    if (typeof value !== 'string') {
        return fallback;
    }

    return value.trim();
}

function safeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    return fallback;
}

function compareSnowflakes(left, right) {
    try {
        const leftId = BigInt(left);
        const rightId = BigInt(right);
        return leftId > rightId ? 1 : leftId < rightId ? -1 : 0;
    } catch {
        return String(left).localeCompare(String(right));
    }
}

function buildSteamErrorLabel(error, resultEnum) {
    const parts = [];

    if (typeof error?.message === 'string' && error.message.trim()) {
        parts.push(error.message.trim());
    }

    if (typeof error?.eresult !== 'undefined' && resultEnum?.[error.eresult]) {
        parts.push(`EResult=${resultEnum[error.eresult]}`);
    }

    return parts.join(' | ') || 'Unknown Steam error';
}

module.exports = {
    buildSteamErrorLabel,
    compareSnowflakes,
    delay,
    formatTimestamp,
    safeBoolean,
    safeInteger,
    safeString,
    sanitizeMultiline,
    truncate
};
