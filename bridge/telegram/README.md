# Telegram bridge

Run: `TELEGRAM_BOT_TOKEN=... SPACE_PASSWORD=... SPACE_CHANNEL_ID=... bun bridge/telegram/index.ts`

Config → `TELEGRAM_BOT_TOKEN` required · `SPACE_PASSWORD` required · `SPACE_CHANNEL_ID` required · `SPACE_SERVER_URL` default `http://127.0.0.1:8090` · `SPACE_USERNAME` default `admin` · `TELEGRAM_POLL_INTERVAL_MS` default `1500` · `TELEGRAM_STATE_PATH` default `bridge/telegram/state.json`.

`/start` persists Telegram chat→Space-channel mapping. Incoming Telegram content is authored into Space as `[Telegram] …`; that marker and persisted message IDs suppress echo. Outbound Space messages fan out to all mapped Telegram chats. First startup snapshots current Space history, so it is not replayed.
