import { readConfig } from "./config.ts";
import { TelegramBridge } from "./bridge.ts";

const config = readConfig();
const bridge = new TelegramBridge(config);
await bridge.start();
console.log(`Telegram bridge connected: Space channel ${config.channelId}`);
for (;;) {
  await bridge.pollOnce();
  await Bun.sleep(config.pollIntervalMs);
}
