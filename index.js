const SteamUser = require('steam-user');
const readline = require('readline');
const fs = require('fs');

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

const accounts = [];
const stats = {}; // Track start times for hour counting

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

// Function to print the current progress
function printProgress() {
    console.log(`\n--- Hour Boost Report (${new Date().toLocaleTimeString()}) ---`);
    let activeCount = 0;
    
    for (const username in stats) {
        if (stats[username].startTime) {
            const elapsedMs = Date.now() - stats[username].startTime;
            const hours = (elapsedMs / (1000 * 60 * 60)).toFixed(2);
            console.log(`[${username}] Boosted this session: ${hours} hours`);
            activeCount++;
        }
    }
    
    if (activeCount === 0) console.log("No accounts currently active.");
    console.log("-------------------------------------------\n");
}

// Set up periodic reporting
setInterval(printProgress, REPORT_INTERVAL_MINUTES * 60 * 1000);

async function startBoosters() {
    console.log(`[System] Starting Steam Hour Booster for ${accounts.length} accounts...`);
    console.log(`[System] Boosting AppIDs: ${GAMES_LIST.join(', ')}`);

    for (const account of accounts) {
        await loginAccount(account);
    }

    console.log("\n[System] All accounts processed. The script is running in the background.");
    console.log(`[System] A progress report will be shown every ${REPORT_INTERVAL_MINUTES} minutes.`);
    console.log("[System] Press Ctrl+C to stop.");
    
    // Initial report after everyone is logged in
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
             resolve(); 
        }, 120000); 

        client.logOn(logOnOptions);

        client.on('loggedOn', () => {
            clearTimeout(timeout);
            console.log(`[${account.username}] Successfully logged on.`);
            
            // Record start time for statistics
            stats[account.username] = { startTime: Date.now() };
            
            // Set User Status
            client.setPersona(account.personaState);
            
            // Start Idling Games
            client.gamesPlayed(account.games);

            // Set Rich Presence
            // 'steam_display' is the standard key for custom status text
            client.richPresence(account.games[0], { "steam_display": RICH_PRESENCE_TEXT });

            console.log(`[${account.username}] Idling started with Rich Presence: "${RICH_PRESENCE_TEXT}"`);
            resolve();
        });

        client.on('steamGuard', (domain, callback) => {
            console.log(`[${account.username}] Steam Guard Code required! Email domain: ${domain}`);
            console.log(`[${account.username}] Please check your email and enter the code below:`);
            
            rl.question(`Code for ${account.username}: `, (code) => {
                callback(code.trim());
            });
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            console.error(`[${account.username}] Error: ${err.message}`);
            if (err.message.includes("RateLimitExceeded")) {
                console.log(`[${account.username}] Rate limit hit. Will retry in background in 30 mins.`);
                setTimeout(() => client.logOn(logOnOptions), 30 * 60 * 1000);
            }
            resolve();
        });

        client.on('disconnected', (eresult, msg) => {
            // When disconnected, we stop counting until reconnected
            if (stats[account.username]) stats[account.username].startTime = null;
            console.log(`[${account.username}] Disconnected: ${msg}. Reconnecting...`);
        });
    });
}

startBoosters();