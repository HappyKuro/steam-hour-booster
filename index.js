const SteamUser = require('steam-user');
const readline = require('readline');
const fs = require('fs');
const https = require('https');

// --- CONFIGURATION ---

// 1. The list of Game AppIDs to boost for ALL accounts.
const GAMES_LIST = [730, 440, 570]; 

// 2. Choose Status: Online, Busy, Away, Invisible, or Offline
// Options: SteamUser.EPersonaState.Online, .Busy, .Away, .Snooze, .Invisible, .Offline
const ACCOUNT_STATUS = SteamUser.EPersonaState.Online;

// 3. Rich Presence: Custom text that appears next to your name in the friend list
// Note: This only works for certain games that support 'steam_display' strings.
const RICH_PRESENCE_TEXT = "Idling for hours...";

// 4. How often to show the hour report in the console (in minutes)
const REPORT_INTERVAL_MINUTES = 60;

// 5. Discord Webhook URL (Leave empty "" to disable)
const DISCORD_WEBHOOK_URL = "";

// 6. Telegram Bot Configuration (Leave empty "" to disable)
const TELEGRAM_BOT_TOKEN = ""; // Get from @BotFather
const TELEGRAM_CHAT_ID = "";   // Your personal Chat ID

const accounts = [];
const stats = {}; // Track start times for hour counting

// --- HELPER FUNCTIONS ---

/**
 * Sends a message to a Discord Webhook
 * @param {string} content - The message text
 */
function sendDiscordNotification(content) {
    if (!DISCORD_WEBHOOK_URL) return;

    const data = JSON.stringify({
        content: content,
        username: "Steam Booster Bot"
    });

    const url = new URL(DISCORD_WEBHOOK_URL);
    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
        },
    };

    const req = https.request(options);
    req.on('error', (error) => {
        console.error(`[Discord] Webhook Error: ${error.message}`);
    });
    req.write(data);
    req.end();
}

/**
 * Sends a message to a Telegram Bot
 * @param {string} content - The message text
 */
function sendTelegramNotification(content) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    // Remove markdown symbols that might break Telegram's default parsing if not handled
    const cleanContent = content.replace(/\*\*/g, '').replace(/•/g, '-');
    
    const data = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: cleanContent
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
        },
    };

    const req = https.request(options);
    req.on('error', (error) => {
        console.error(`[Telegram] Bot Error: ${error.message}`);
    });
    req.write(data);
    req.end();
}

/**
 * Helper to send to all configured platforms
 * @param {string} content 
 */
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
                        games: GAMES_LIST, 
                        personaState: ACCOUNT_STATUS
                    });
                }
            }
        });
    } else {
        console.error("[System] Error: accounts.txt not found! Please create it.");
        process.exit(1);
    }
} catch (err) {
    console.error(`[System] Error reading accounts.txt: ${err.message}`);
    process.exit(1);
}

// --- LOGIC ---

if (accounts.length === 0) {
    console.error("[System] No valid accounts found in accounts.txt.");
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const clients = []; 

// Function to print and send the current progress
function printProgress() {
    let reportText = `\n--- Hour Boost Report (${new Date().toLocaleTimeString()}) ---\n`;
    let notifyText = `**Hour Boost Report (${new Date().toLocaleTimeString()})**\n`;
    let activeCount = 0;
    
    for (const username in stats) {
        if (stats[username].startTime) {
            const elapsedMs = Date.now() - stats[username].startTime;
            const hours = (elapsedMs / (1000 * 60 * 60)).toFixed(2);
            const line = `[${username}] Boosted this session: ${hours} hours`;
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

// Set up periodic reporting
setInterval(printProgress, REPORT_INTERVAL_MINUTES * 60 * 1000);

async function startBoosters() {
    console.log(`[System] Starting Steam Hour Booster for ${accounts.length} accounts...`);
    broadcastNotification(`🚀 **System Started**: Boosting ${accounts.length} accounts.`);

    for (const account of accounts) {
        await loginAccount(account);
    }

    console.log("\n[System] All accounts processed. The script is running in the background.");
    console.log(`[System] A progress report will be shown every ${REPORT_INTERVAL_MINUTES} minutes.`);
    console.log("[System] Press Ctrl+C to stop.");
    
    printProgress();
}

function loginAccount(account) {
    return new Promise((resolve) => {
        console.log(`\n--- Processing: ${account.username} ---`);
        
        const client = new SteamUser();
        clients.push(client); 
        
        const logOnOptions = {
            accountName: account.username,
            password: account.password
        };

        const timeout = setTimeout(() => {
             console.log(`[${account.username}] Login timed out. Moving to next account.`);
             broadcastNotification(`⚠️ **Timeout**: ${account.username} failed to log in within 2 minutes.`);
             resolve(); 
        }, 120000); 

        client.logOn(logOnOptions);

        client.on('loggedOn', () => {
            clearTimeout(timeout);
            console.log(`[${account.username}] Successfully logged on.`);
            broadcastNotification(`✅ **Logged In**: ${account.username} is now idling.`);
            
            // Record start time for statistics
            stats[account.username] = { startTime: Date.now() };

            // Set User Status
            client.setPersona(account.personaState);

            // Start Idling Games
            client.gamesPlayed(account.games);

            // Set Rich Presence
            // 'steam_display' is the standard key for custom status text
            client.richPresence(account.games[0], { "steam_display": RICH_PRESENCE_TEXT });

            resolve();
        });

        client.on('steamGuard', (domain, callback) => {
            console.log(`[${account.username}] Steam Guard Code required! Email domain: ${domain}`);
            broadcastNotification(`🔑 **Steam Guard**: ${account.username} needs a code (Email: ${domain}).`);
            
            rl.question(`Code for ${account.username}: `, (code) => {
                callback(code.trim());
            });
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            console.error(`[${account.username}] Error: ${err.message}`);
            broadcastNotification(`❌ **Error** [${account.username}]: ${err.message}`);
            
            if (err.message.includes("RateLimitExceeded")) {
                setTimeout(() => client.logOn(logOnOptions), 30 * 60 * 1000);
            }
            resolve();
        });

        client.on('disconnected', (eresult, msg) => {
            if (stats[account.username]) stats[account.username].startTime = null;
            console.log(`[${account.username}] Disconnected: ${msg}. Reconnecting...`);
            broadcastNotification(`📴 **Disconnected**: ${account.username} (${msg}).`);
        });
    });
}

startBoosters();