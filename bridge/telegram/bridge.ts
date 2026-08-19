import type { BridgeConfig } from "./config.ts";
import { loadState, remember, saveState, type BridgeState } from "./state.ts";
import { SpaceApi, type SpaceMessage } from "./space.ts";
import { TelegramApi, type TelegramUpdate } from "./telegram.ts";

const TELEGRAM_PREFIX = "[Telegram] ";

export class TelegramBridge {
  private state!: BridgeState;
  constructor(private readonly config: BridgeConfig, private readonly telegram = new TelegramApi(config.telegramToken), private readonly space = new SpaceApi(config.spaceServerUrl, config.spaceUsername, config.spacePassword)) {}

  async start(): Promise<void> {
    this.state = await loadState(this.config.statePath);
    await this.space.login();
    await this.primeOutbound();
  }

  private async persist(): Promise<void> { await saveState(this.config.statePath, this.state); }

  private async primeOutbound(): Promise<void> {
    if (this.state.outboundPrimed) return;
    const messages = await this.space.listMessages(this.config.channelId);
    this.state.forwardedSpaceMessageIds = messages.map((message) => message.id).slice(-2_000);
    this.state.outboundPrimed = true;
    await this.persist();
  }

  async pollOnce(): Promise<void> {
    const updates = await this.telegram.getUpdates(this.state.lastUpdateId + 1);
    for (const update of updates) await this.acceptUpdate(update);
    await this.syncOutbound();
  }

  private async acceptUpdate(update: TelegramUpdate): Promise<void> {
    this.state.lastUpdateId = Math.max(this.state.lastUpdateId, update.update_id);
    const message = update.message;
    const text = message?.text?.trim();
    if (!message || !text) return this.persist();
    const chatId = String(message.chat.id);
    if (text === "/start" || text.startsWith("/start ")) {
      this.state.chats[chatId] = { channelId: this.config.channelId };
      await this.persist();
      await this.telegram.sendMessage(chatId, "GAIA Space bridge connected.");
      return;
    }
    if (!this.state.chats[chatId]) return this.persist();
    const sender = message.from?.username || message.from?.first_name || `chat ${chatId}`;
    const created = await this.space.createMessage(this.config.channelId, `${TELEGRAM_PREFIX}${sender}: ${text}`);
    this.state.inboundSpaceMessageIds = remember(this.state.inboundSpaceMessageIds, created.id);
    await this.persist();
  }

  async syncOutbound(): Promise<void> {
    const destinations = Object.entries(this.state.chats).filter(([, mapping]) => mapping.channelId === this.config.channelId).map(([chatId]) => chatId);
    const messages = await this.space.listMessages(this.config.channelId);
    for (const message of messages) {
      if (this.isAlreadyHandled(message) || destinations.length === 0) continue;
      for (const chatId of destinations) await this.telegram.sendMessage(chatId, message.text);
      this.state.forwardedSpaceMessageIds = remember(this.state.forwardedSpaceMessageIds, message.id);
      await this.persist();
    }
  }

  private isAlreadyHandled(message: SpaceMessage): boolean {
    return message.text.startsWith(TELEGRAM_PREFIX) || this.state.inboundSpaceMessageIds.includes(message.id) || this.state.forwardedSpaceMessageIds.includes(message.id);
  }
}
