# Steam Hour Booster

A cleaner Node.js version of a multi-account Steam hour booster.

## What Changed

- The app now uses a modular `src/` layout instead of one large root script.
- There is a `validate` command so you can check local setup without logging into Steam.
- Steam Guard handling, reporting, reconnects, and remote Discord code polling are separated into focused modules.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create local runtime files:

- Rename `config.example.json` to `config.json`
- Rename `accounts.example.txt` to `accounts.txt`

3. Fill in your real values.

## Commands

```bash
npm start
npm run validate
npm run help
```

`npm run validate` only checks that your config and accounts files are readable and valid. It does not log into Steam.

## File Formats

### `accounts.txt`

One account per line:

```txt
username:password
```

Lines starting with `#` are ignored.

### `config.json`

- `games_list`: array of AppIDs to idle
- `account_status`: Steam persona state number
- `rich_presence_enabled`: enable rich presence upload logic
- `rich_presence_message`: free text for `setPresence`, or a localization key if `uploadRichPresence` is used
- `report_interval_minutes`: how often status reports are emitted
- `startup_delay_seconds`: delay between account startups
- `login_timeout_seconds`: login watchdog timeout
- `remote_command_poll_interval_seconds`: Discord polling interval
- `machine_name`: custom machine name sent on login, or `random` to generate a fresh Windows-style `DESKTOP-XXXXXXX` value on every login attempt
- `discord_bot_token`: optional Discord bot token for log relaying and `!code` polling
- `discord_channel_id`: optional Discord channel ID
- `telegram_bot_token`: optional Telegram bot token for important relays
- `telegram_chat_id`: optional Telegram chat ID

## Environment Overrides

If set, these environment variables override the matching values in `config.json`:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNEL_ID`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Console Commands

While the app is running:

- `status`
- `pending`
- `code <username> <steam_guard_code>`
- `help`
- `quit`

## Discord Commands

If `discord_bot_token` and `discord_channel_id` are configured, the bot also watches the configured channel for:

- `!help`
- `!status`
- `!pending`
- `!code <username> <steam_guard_code>`

Remote shutdown is intentionally not exposed as a Discord command.

## Project Layout

```txt
index.js
src/
  app.js
  cli.js
  command-center.js
  config.js
  discord-poller.js
  http.js
  notifier.js
  steam-bot.js
  utils.js
```

## Notes

- Local runtime files are ignored by `.gitignore` so secrets are less likely to be committed by mistake.
- If Discord or Telegram credentials are blank, those integrations stay disabled.
