const SteamUser = require('steam-user');
const readline = require('readline');
const fs = require('fs');
const https = require('https');

// --- LOAD CONFIGURATION ---
let config;
try {
    if (fs.existsSync('config.json')) {
        config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    } else {
        console.error("[System] Error: config.json not found!");
        process.exit(1);
    }
} catch (err) {
    console.error(`[System] Error parsing config.json: ${err.message}`);
    process.exit(1);
}

const accounts = [];
const stats = {}; 
const clients = [];

// --- LOGGING & NOTIFICATIONS ---

function broadcastToDiscord(content) {
    if (!config.discord_webhook_url) return;
    const cleanContent = content.replace(/\x1b\[[0-9;]*m/g, "");
    const data = JSON.stringify({ content: cleanContent, username: "Steam Booster Logs" });
    try {
        const url = new URL(config.discord_webhook_url);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        };
        const req = https.request(options);
        req.on('error', () => {}); 
        req.write(data);
        req.end();
    } catch (e) {}
}

function broadcastToTelegram(content) {
    if (!config.telegram_bot_token || !config.telegram_chat_id) return;
    const cleanContent = content.replace(/\*\*/g, '').replace(/•/g, '-');
    const data = JSON.stringify({ chat_id: config.telegram_chat_id, text: cleanContent });
    try {
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${config.telegram_bot_token}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        };
        const req = https.request(options);
        req.write(data);
        req.end();
    } catch (e) {}
}

function log(message, isImportant = false) {
    console.log(message);
    broadcastToDiscord(message);
    if (isImportant) broadcastToTelegram(message);
}

// --- FILE LOADING ---

try {
    if (fs.existsSync('accounts.txt')) {
        const data = fs.readFileSync('accounts.txt', 'utf8');
        data.split(/\r?\n/).forEach((line) => {
            if (!line.trim() || line.trim().startsWith('#')) return;
            const [username, ...passParts] = line.split(':');
            const password = passParts.join(':');
            if (username && password) {
                accounts.push({ username: username.trim(), password: password.trim() });
            }
        });
    } else {
        log("[System] Error: accounts.txt not found!", true);
        process.exit(1);
    }
} catch (err) {
    log(`[System] Error reading accounts: ${err.message}`, true);
    process.exit(1);
}

if (accounts.length === 0) {
    log("[System] No valid accounts found.", true);
    process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- CORE LOGIC ---

function printProgress() {
    let reportText = `--- Hour Boost Report (${new Date().toLocaleTimeString()}) ---\n`;
    let activeCount = 0;
    for (const username in stats) {
        if (stats[username].startTime) {
            const hours = ((Date.now() - stats[username].startTime) / (1000 * 60 * 60)).toFixed(2);
            const name = stats[username].profileName || username;
            reportText += `• [${name}] Boosted: ${hours} hours\n`;
            activeCount++;
        }
    }
    if (activeCount === 0) reportText += "No accounts active.\n";
    log(reportText + "-------------------------------------------", true);
}

setInterval(printProgress, config.report_interval_minutes * 60 * 1000);

async function startBoosters() {
    const count = accounts.length;
    log(`🚀 [System] Starting Booster: boosting ${count} account${count === 1 ? '' : 's'}...`, true);

    for (const account of accounts) {
        loginAccount(account);
        // Delay to avoid Steam Rate Limits
        await new Promise(r => setTimeout(r, 5000));
    }
}

function loginAccount(account) {
    log(`[${account.username}] Initializing connection...`);
    
    const client = new SteamUser();
    clients.push(client); 
    
    // Some versions of Steam-User require a machine name to trigger certain events
    const logOnOptions = {
        accountName: account.username,
        password: account.password,
        machineName: "SteamHourBooster"
    };

    client.logOn(logOnOptions);

    client.on('accountInfo', (name) => {
        if (stats[account.username]) stats[account.username].profileName = name;
    });

    client.on('loggedOn', () => {
        log(`✅ [${account.username}] Logged in successfully.`);
        stats[account.username] = { startTime: Date.now(), profileName: null };
        
        client.setPersona(config.account_status);
        client.gamesPlayed(config.games_list);
        
        if (config.rich_presence_enabled && config.games_list.length > 0) {
            if (typeof client.setPresence === 'function') {
                client.setPresence(config.games_list[0], { "steam_display": config.rich_presence_message });
            }
        }

        setTimeout(() => {
            const displayName = stats[account.username].profileName || account.username;
            log(`🎮 [${displayName}] is now boosting hours.`, true);
        }, 3000);
    });

    client.on('steamGuard', (domain, callback) => {
        const guardMsg = `🔑 [${account.username}] STEAM GUARD REQUIRED! (Domain: ${domain || 'Mobile App'})`;
        log(guardMsg, true);
        
        // Pause automated logs for a moment so the prompt is visible
        rl.question(`👉 Enter code for ${account.username}: `, (code) => {
            callback(code.trim());
        });
    });

    client.on('error', (err) => {
        log(`❌ [${account.username}] Error: ${err.message}`, true);
        if (err.message.includes("RateLimitExceeded")) {
            log(`[${account.username}] Rate limit hit. Retrying in 30m...`);
            setTimeout(() => client.logOn(logOnOptions), 30 * 60 * 1000);
        }
    });

    client.on('disconnected', (eresult, msg) => {
        if (stats[account.username]) stats[account.username].startTime = null;
        log(`📴 [${account.username}] Disconnected: ${msg}`);
    });
}

startBoosters();