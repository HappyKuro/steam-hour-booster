const SteamUser = require('steam-user');
const readline = require('readline');
const fs = require('fs');
const https = require('https');

// --- CONFIGURATION LOADING ---
let config;
try {
    if (fs.existsSync('config.json')) {
        config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    } else {
        console.error("❌ [System] Error: config.json not found!");
        process.exit(1);
    }
} catch (err) {
    console.error(`❌ [System] Error parsing config.json: ${err.message}`);
    process.exit(1);
}

// Global interface for console input
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Registry to track all active bot instances
const activeBots = new Map();

// --- NOTIFICATION SERVICE ---
class Notifier {
    static broadcast(message, isImportant = false) {
        // 1. Print to Console
        console.log(message);

        // 2. Send to Discord Bot (Logs)
        if (config.discord_bot_token && config.discord_channel_id) {
            this.sendToDiscordChannel(message);
        }

        // 3. Send to Telegram (Important events only)
        if (isImportant && config.telegram_bot_token && config.telegram_chat_id) {
            this.sendToTelegram(message);
        }
    }

    static sendToDiscordChannel(content) {
        const cleanContent = content.replace(/\x1b\[[0-9;]*m/g, ""); // Remove terminal colors
        
        const data = JSON.stringify({
            content: cleanContent
        });
        
        const url = `https://discord.com/api/v10/channels/${config.discord_channel_id}/messages`;
        
        this.httpRequest(url, 'POST', data, { 
            'Content-Type': 'application/json',
            'Authorization': `Bot ${config.discord_bot_token}`
        });
    }

    static sendToTelegram(content) {
        const cleanContent = content.replace(/\*\*/g, '').replace(/•/g, '-');
        const data = JSON.stringify({ chat_id: config.telegram_chat_id, text: cleanContent });
        const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;
        this.httpRequest(url, 'POST', data, { 'Content-Type': 'application/json' });
    }

    static httpRequest(urlStr, method, data, headers = {}) {
        try {
            const url = new URL(urlStr);
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: method,
                headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
            };
            const req = https.request(options);
            req.on('error', () => {}); // Silent fail
            req.write(data);
            req.end();
        } catch (e) {}
    }
}

// --- DISCORD REMOTE INPUT POLLER ---
// Checks for !code commands in the configured Discord channel
async function pollDiscordInput() {
    if (!config.discord_bot_token || !config.discord_channel_id) return;

    const options = {
        hostname: 'discord.com',
        path: `/api/v10/channels/${config.discord_channel_id}/messages?limit=1`,
        method: 'GET',
        headers: { 'Authorization': `Bot ${config.discord_bot_token}` },
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const messages = JSON.parse(data);
                if (messages.length > 0) {
                    const msg = messages[0];
                    // Syntax: !code <username> <code>
                    if (msg.content.startsWith('!code ')) {
                        const parts = msg.content.split(' ');
                        const targetUser = parts[1];
                        const code = parts[2];

                        // Find the specific bot instance waiting for a code
                        if (targetUser && code && activeBots.has(targetUser)) {
                            const bot = activeBots.get(targetUser);
                            bot.submitSteamGuardCode(code, "Remote Discord");
                        }
                    }
                }
            } catch (e) {}
        });
    });
    req.on('error', () => {});
    req.end();
}

// --- MAIN BOT CLASS ---
class SteamBot {
    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.client = new SteamUser();
        this.startTime = null;
        this.profileName = null;
        this.guardCallback = null; // Function to call when we get a code
        this.reconnectTimer = null;

        this.initializeEvents();
    }

    initializeEvents() {
        this.client.on('loggedOn', () => this.onLoggedOn());
        this.client.on('accountInfo', (name) => { this.profileName = name; });
        this.client.on('steamGuard', (domain, callback) => this.onSteamGuard(domain, callback));
        this.client.on('webLogOn', () => Notifier.broadcast(`[${this.username}] Steam Guard code accepted.`));
        this.client.on('error', (err) => this.onError(err));
        this.client.on('disconnected', (eresult, msg) => this.onDisconnected(msg));
    }

    login() {
        Notifier.broadcast(`[${this.username}] Initializing connection...`);
        const logOnOptions = {
            accountName: this.username,
            password: this.password,
            machineName: "SteamHourBooster"
        };
        this.client.logOn(logOnOptions);
    }

    onLoggedOn() {
        Notifier.broadcast(`✅ [${this.username}] Logged in successfully.`);
        this.startTime = Date.now();
        
        // 1. Set Status
        this.client.setPersona(config.account_status);
        
        // 2. Play Games
        this.client.gamesPlayed(config.games_list);

        // 3. Set Rich Presence (if enabled)
        if (config.rich_presence_enabled && config.games_list.length > 0) {
            if (typeof this.client.setPresence === 'function') {
                this.client.setPresence(config.games_list[0], { "steam_display": config.rich_presence_message });
            }
        }

        setTimeout(() => {
            const name = this.profileName || this.username;
            Notifier.broadcast(`🎮 [${name}] is now boosting hours.`, true);
        }, 3000);
    }

    onSteamGuard(domain, callback) {
        const msg = `🔑 [${this.username}] STEAM GUARD REQUIRED! (Domain: ${domain || 'Mobile/Email'})\n` +
                    `   Reply via Terminal or Discord: \`!code ${this.username} YOUR_CODE\``;
        Notifier.broadcast(msg, true);
        
        // Save the callback so we can use it later (via terminal OR discord)
        this.guardCallback = callback;

        // Prompt in terminal
        rl.question(`👉 Enter code for ${this.username}: `, (code) => {
            this.submitSteamGuardCode(code.trim(), "Terminal");
        });
    }

    submitSteamGuardCode(code, source) {
        if (this.guardCallback) {
            Notifier.broadcast(`[${this.username}] Submitting code from ${source}...`);
            this.guardCallback(code);
            this.guardCallback = null; // Clear it so we don't submit twice
        }
    }

    onError(err) {
        Notifier.broadcast(`❌ [${this.username}] Error: ${err.message}`, true);
        
        if (err.message.includes("RateLimitExceeded")) {
            Notifier.broadcast(`[${this.username}] Rate limit hit. Retrying in 30m...`);
            this.scheduleReconnect(30 * 60 * 1000);
        } else if (err.message.includes("timed out") || err.message.includes("NoConnection") || err.message.includes("ServiceUnavailable")) {
            Notifier.broadcast(`[${this.username}] Connection issue. Retrying in 30s...`, true);
            this.scheduleReconnect(30000);
        } else {
            // Stop stats for fatal errors
            this.startTime = null;
        }
    }

    onDisconnected(msg) {
        this.startTime = null;
        Notifier.broadcast(`📴 [${this.username}] Disconnected: ${msg}`);

        if (msg.includes("LoggedInElsewhere")) {
            Notifier.broadcast(`⚠️ [${this.username}] Account logged in elsewhere. Reconnecting in 5 minutes...`, true);
            // Wait 5 minutes to avoid fighting with the user who just logged in
            this.scheduleReconnect(5 * 60 * 1000);
        } else if (msg.includes("NoConnection") || msg.includes("timed out") || msg.includes("ServiceUnavailable")) {
            Notifier.broadcast(`[${this.username}] Network error. Auto-reconnecting in 30s...`, true);
            this.scheduleReconnect(30000);
        }
    }

    scheduleReconnect(delay) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
            Notifier.broadcast(`[${this.username}] Reconnecting now...`);
            this.login();
        }, delay);
    }

    getReport() {
        if (!this.startTime) return null;
        const hours = ((Date.now() - this.startTime) / (1000 * 60 * 60)).toFixed(2);
        return `• [${this.profileName || this.username}] Boosted: ${hours} hours`;
    }
}

// --- INITIALIZATION FLOW ---

function loadAccounts() {
    const loaded = [];
    try {
        if (fs.existsSync('accounts.txt')) {
            const data = fs.readFileSync('accounts.txt', 'utf8');
            data.split(/\r?\n/).forEach((line) => {
                if (!line.trim() || line.trim().startsWith('#')) return;
                const [user, ...passParts] = line.split(':');
                const pass = passParts.join(':');
                if (user && pass) {
                    loaded.push({ username: user.trim(), password: pass.trim() });
                }
            });
        }
    } catch (e) {
        Notifier.broadcast(`❌ Error loading accounts: ${e.message}`, true);
        process.exit(1);
    }
    return loaded;
}

// --- GLOBAL REPORT LOOP ---
function startReportingLoop() {
    setInterval(() => {
        let report = `--- Hour Boost Report (${new Date().toLocaleTimeString()}) ---\n`;
        let count = 0;

        activeBots.forEach(bot => {
            const line = bot.getReport();
            if (line) {
                report += line + "\n";
                count++;
            }
        });

        if (count === 0) report += "No accounts currently active.\n";
        report += "-------------------------------------------";
        Notifier.broadcast(report, true);
    }, config.report_interval_minutes * 60 * 1000);
}

// --- STARTUP ---
(async () => {
    const accountList = loadAccounts();
    if (accountList.length === 0) {
        Notifier.broadcast("❌ No accounts found in accounts.txt", true);
        process.exit(1);
    }

    Notifier.broadcast(`🚀 [System] Starting Booster for ${accountList.length} accounts...`, true);

    // Start Discord polling if configured
    if (config.discord_bot_token && config.discord_channel_id) {
        setInterval(pollDiscordInput, 5000);
    }

    // Launch bots sequentially with a delay
    for (const acc of accountList) {
        const bot = new SteamBot(acc.username, acc.password);
        activeBots.set(acc.username, bot); // Register instance
        bot.login();
        
        // Wait 7 seconds before starting next one to prevent rate limits
        await new Promise(r => setTimeout(r, 7000));
    }

    startReportingLoop();
})();