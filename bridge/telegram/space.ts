import type { FetchLike } from "./telegram.ts";

export type SpaceMessage = { id: string; channel_id: string; author_id: string | null; text: string; created_at: number; edited_at: number | null; thread_of: string | null; archived: boolean };
type CommandResponse<T> = { ok: boolean; value?: T; error?: string };

export class SpaceApi {
  private cookie = "";
  constructor(private readonly baseUrl: string, private readonly username: string, private readonly password: string, private readonly request: FetchLike = fetch) {}

  async login(): Promise<void> {
    const response = await this.request(`${this.baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!response.ok) throw new Error(`Space login failed: ${response.status}`);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Space login failed: no session cookie");
    this.cookie = cookie;
  }

  private async command<T>(name: string, body: Record<string, unknown>): Promise<T> {
    if (!this.cookie) throw new Error("Space API not logged in");
    const response = await this.request(`${this.baseUrl}/api/cmd/${name}`, {
      method: "POST", headers: { "content-type": "application/json", cookie: this.cookie }, body: JSON.stringify(body),
    });
    const payload = await response.json() as CommandResponse<T>;
    if (!response.ok || !payload.ok) throw new Error(`Space ${name} failed: ${payload.error ?? response.status}`);
    return payload.value as T;
  }

  listMessages(channelId: string): Promise<SpaceMessage[]> {
    return this.command("list_messages", { channel_id: channelId });
  }

  createMessage(channelId: string, text: string): Promise<SpaceMessage> {
    return this.command("create_message", { message: { id: crypto.randomUUID(), channel_id: channelId, author_id: null, text, created_at: Math.floor(Date.now() / 1_000), edited_at: null, thread_of: null, archived: false } });
  }
}
