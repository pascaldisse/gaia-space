export type FetchLike = typeof fetch;
export type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; from?: { username?: string; first_name?: string } };
};

type TelegramResponse<T> = { ok: boolean; result?: T; parameters?: { retry_after?: number }; description?: string };

export class TelegramApi {
  constructor(private readonly token: string, private readonly request: FetchLike = fetch, private readonly sleep = (ms: number) => Bun.sleep(ms)) {}

  async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    for (;;) {
      const response = await this.request(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json() as TelegramResponse<T>;
      if (response.status === 429 || payload.parameters?.retry_after) {
        await this.sleep((payload.parameters?.retry_after ?? 1) * 1_000);
        continue;
      }
      if (!response.ok || !payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
      return payload.result as T;
    }
  }

  getUpdates(offset: number): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
  }

  sendMessage(chatId: string, text: string): Promise<unknown> {
    return this.call("sendMessage", { chat_id: chatId, text });
  }
}
