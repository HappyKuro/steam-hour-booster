const SteamUser = require('steam-user');
const readline = require('readline');
const fs = require('fs');

// --- CONFIGURATION ---

// EDIT THIS: The list of Game AppIDs to boost for ALL accounts.
// 730 = CS2, 440 = TF2, 570 = Dota 2
const GAMES_LIST = [730, 440, 570]; 

const accounts = [];

// Read accounts.txt
try {
    if (fs.existsSync('accounts.txt')) {
        const data = fs.readFileSync('accounts.txt', 'utf8');
        const lines = data.split(/\r?\n/);

        lines.forEach((line) => {
            // Skip empty lines or comments
            if (!line.trim() || line.trim().startsWith('#')) return;

            // Format: username:password
            const parts = line.split(':');
            
            if (parts.length >= 2) {
                const username = parts[0].trim();
                // Handle passwords that might contain colons by joining the rest
                const password = parts.slice(1).join(':').trim();

                if (username && password) {
                    accounts.push({
                        username: username,
                        password: password,
                        // We use the global GAMES_LIST for everyone
                        games: GAMES_LIST, 
                        personaState: SteamUser.EPersonaState.Online
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

async function startBoosters() {
    console.log(`[System] Starting Steam Hour Booster for ${accounts.length} accounts...`);
    console.log(`[System] Boosting AppIDs: ${GAMES_LIST.join(', ')}`);

    for (const account of accounts) {
        await loginAccount(account);
    }

    console.log("\n[System] All accounts processed. The script is running in the background.");
    console.log("[System] Press Ctrl+C to stop.");
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

        // 2 minute timeout in case login hangs
        const timeout = setTimeout(() => {
             console.log(`[${account.username}] Login timed out. Moving to next account.`);
             resolve(); 
        }, 120000); 

        client.logOn(logOnOptions);

        client.on('loggedOn', () => {
            clearTimeout(timeout);
            console.log(`[${account.username}] Successfully logged on.`);
            client.setPersona(account.personaState);
            client.gamesPlayed(account.games);
            console.log(`[${account.username}] Idling started.`);
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
            // Resolve to move to next account even if this one failed
            resolve();
        });

        client.on('disconnected', (eresult, msg) => {
            console.log(`[${account.username}] Disconnected: ${msg}. Reconnecting...`);
        });
    });
}

startBoosters();