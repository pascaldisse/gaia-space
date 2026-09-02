export type FetchLike = typeof fetch;
type CommandResponse<T> = { ok: boolean; value?: T; error?: string };
export type SpaceMessage = { id: string; channel_id: string; text: string };

export class SpacePostError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class SpaceApi {
  private cookie = "";
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: { token?: string; username?: string; password?: string },
    private readonly request: FetchLike = fetch,
  ) {}

  async login(): Promise<void> {
    if (this.credentials.token) return;
    const response = await this.request(`${this.baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: this.credentials.username, password: this.credentials.password }),
    });
    if (!response.ok) throw new Error(`Space login failed: ${response.status}`);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Space login failed: no session cookie");
    this.cookie = cookie;
  }

  private headers(): HeadersInit {
    if (this.credentials.token) return { "content-type": "application/json", authorization: `Bearer ${this.credentials.token}` };
    if (!this.cookie) throw new Error("Space API not logged in");
    return { "content-type": "application/json", cookie: this.cookie };
  }

  async createMessage(channelId: string, text: string): Promise<SpaceMessage> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.request(`${this.baseUrl}/api/cmd/create_message`, {
        method: "POST", headers: this.headers(),
        body: JSON.stringify({ message: { id: crypto.randomUUID(), channel_id: channelId, author_id: null, text, created_at: Math.floor(Date.now() / 1_000), edited_at: null, thread_of: null, archived: false } }),
      });
      const payload = await response.json() as CommandResponse<SpaceMessage>;
      if (response.ok && payload.ok && payload.value) return payload.value;
      if (response.status >= 500 && attempt === 0) continue;
      throw new SpacePostError(response.status, `Space create_message failed: ${payload.error ?? response.status}`);
    }
    throw new Error("unreachable");
  }
}
