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

// --- HELPER FUNCTIONS ---

function sendDiscordNotification(content) {
    if (!config.discord_webhook_url) return;
    const data = JSON.stringify({ content: content, username: "Steam Booster Bot" });
    try {
        const url = new URL(config.discord_webhook_url);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        };
        const req = https.request(options);
        req.on('error', (error) => console.error(`[Discord] Webhook Error: ${error.message}`));
        req.write(data);
        req.end();
    } catch (e) { console.error(`[Discord] Invalid Webhook URL`); }
}

function sendTelegramNotification(content) {
    if (!config.telegram_bot_token || !config.telegram_chat_id) return;
    const cleanContent = content.replace(/\*\*/g, '').replace(/•/g, '-');
    const data = JSON.stringify({ chat_id: config.telegram_chat_id, text: cleanContent });
    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${config.telegram_bot_token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(options);
    req.on('error', (error) => console.error(`[Telegram] Bot Error: ${error.message}`));
    req.write(data);
    req.end();
}

function broadcastNotification(content) {
    sendDiscordNotification(content);
    sendTelegramNotification(content);
}

// Read accounts.txt
try {
    if (fs.existsSync('accounts.txt')) {
        const data = fs.readFileSync('accounts.txt', 'utf8');
        const lines = data.split(/\r?\n/);
        lines.forEach((line) => {
            if (!line.trim() || line.trim().startsWith('#')) return;
            const parts = line.split(':');
            if (parts.length >= 2) {
                const username = parts[0].trim();
                const password = parts.slice(1).join(':').trim();
                if (username && password) {
                    accounts.push({
                        username: username,
                        password: password,
                        games: config.games_list, 
                        personaState: config.account_status
                    });
                }
            }
        });
    } else {
        console.error("[System] Error: accounts.txt not found!");
        process.exit(1);
    }
} catch (err) {
    console.error(`[System] Error reading accounts.txt: ${err.message}`);
    process.exit(1);
}

if (accounts.length === 0) {
    console.error("[System] No valid accounts found in accounts.txt.");
    process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const clients = []; 

function printProgress() {
    let reportText = `\n--- Hour Boost Report (${new Date().toLocaleTimeString()}) ---\n`;
    let notifyText = `**Hour Boost Report (${new Date().toLocaleTimeString()})**\n`;
    let activeCount = 0;
    for (const username in stats) {
        if (stats[username].startTime) {
            const elapsedMs = Date.now() - stats[username].startTime;
            const hours = (elapsedMs / (1000 * 60 * 60)).toFixed(2);
            const displayName = stats[username].profileName || username;
            const line = `[${displayName}] Boosted this session: ${hours} hours`;
            reportText += line + "\n";
            notifyText += "• " + line + "\n";
            activeCount++;
        }
    }
    if (activeCount === 0) {
        reportText += "No accounts currently active.\n";
        notifyText += "No accounts currently active.\n";
    }
    reportText += "-------------------------------------------\n";
    console.log(reportText);
    broadcastNotification(notifyText);
}

setInterval(printProgress, config.report_interval_minutes * 60 * 1000);

async function startBoosters() {
    const count = accounts.length;
    const boostMsg = count === 1 ? "boosting 1 account" : `boosting ${count} accounts`;
    console.log(`[System] Starting Steam Hour Booster: ${boostMsg}...`);
    broadcastNotification(`🚀 **System Started**: ${boostMsg}.`);

    // We process accounts in parallel or with a shorter delay to prevent "stuck" states
    for (const account of accounts) {
        loginAccount(account);
        // Small delay between starting logins to avoid triggering Steam rate limits
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log("\n[System] Login requests sent. Monitoring connections...");
}

function loginAccount(account) {
    console.log(`[${account.username}] Attempting login...`);
    
    const client = new SteamUser();
    clients.push(client); 
    
    const logOnOptions = {
        accountName: account.username,
        password: account.password
    };

    client.logOn(logOnOptions);

    client.on('accountInfo', (name) => {
        if (stats[account.username]) {
            stats[account.username].profileName = name;
        }
    });

    client.on('loggedOn', () => {
        console.log(`[${account.username}] Successfully logged on.`);
        stats[account.username] = { startTime: Date.now(), profileName: null };
        client.setPersona(account.personaState);
        client.gamesPlayed(account.games);
        
        if (config.rich_presence_enabled && account.games && account.games.length > 0) {
            if (typeof client.setPresence === 'function') {
                client.setPresence(account.games[0], { "steam_display": config.rich_presence_message });
            }
        }

        setTimeout(() => {
            const displayName = stats[account.username].profileName || account.username;
            broadcastNotification(`✅ **Logged In**: ${displayName} is now idling.`);
        }, 5000);
    });

    client.on('steamGuard', (domain, callback) => {
        console.log(`[${account.username}] Steam Guard Code required! (Email: ${domain})`);
        broadcastNotification(`🔑 **Steam Guard**: ${account.username} needs a code.`);
        rl.question(`Code for ${account.username}: `, (code) => {
            callback(code.trim());
        });
    });

    client.on('error', (err) => {
        console.error(`[${account.username}] Login Error: ${err.message}`);
        broadcastNotification(`❌ **Error** [${account.username}]: ${err.message}`);
        
        if (err.message.includes("RateLimitExceeded")) {
            console.log(`[${account.username}] Waiting 30 mins to retry due to rate limit...`);
            setTimeout(() => client.logOn(logOnOptions), 30 * 60 * 1000);
        }
    });

    client.on('disconnected', (eresult, msg) => {
        const displayName = (stats[account.username] && stats[account.username].profileName) || account.username;
        if (stats[account.username]) stats[account.username].startTime = null;
        console.log(`[${displayName}] Disconnected: ${msg}.`);
    });
}

startBoosters();