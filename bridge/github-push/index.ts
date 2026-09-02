import { readConfig, type GitHubPushConfig } from "./config.ts";
import { formatNotification, formatPullRequest, formatPush, formatRelease, type FormattedEvent } from "./format.ts";
import { SpaceApi } from "./space.ts";
import { loadState, rememberDelivery, saveState, type DeliveryState } from "./state.ts";
import { timingSafeEqual, verifyGitHubSignature } from "./verify.ts";

type Poster = { login(): Promise<void>; createMessage(channelId: string, text: string): Promise<unknown> };
type Metrics = { posted: number; failed: number; lastDeliveryAt: string | null };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
function channelFor(config: GitHubPushConfig, repo: string): string {
  return config.repoChannelMap[repo] || config.channelId;
}
function notificationInput(value: unknown): { repo: string; ref?: string; text: string; url?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.repo !== "string" || !input.repo.trim() || typeof input.text !== "string" || !input.text.trim()) return null;
  if ((input.ref !== undefined && typeof input.ref !== "string") || (input.url !== undefined && typeof input.url !== "string")) return null;
  return { repo: input.repo.trim(), text: input.text.trim(), ref: input.ref?.trim(), url: input.url?.trim() };
}

export function createHandler(config: GitHubPushConfig, poster: Poster, state: DeliveryState, metrics: Metrics = { posted: 0, failed: 0, lastDeliveryAt: null }): (request: Request) => Promise<Response> {
  async function post(event: FormattedEvent): Promise<void> {
    try {
      await poster.createMessage(channelFor(config, event.repo), event.text);
      metrics.posted++;
    } catch (error) {
      metrics.failed++;
      console.error("github-push: Space post failed", error);
    }
  }

  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/health") return json({ ok: true, posted: metrics.posted, lastDeliveryAt: metrics.lastDeliveryAt });

    if (request.method === "POST" && pathname === "/notify") {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ") || !timingSafeEqual(authorization.slice(7), config.notifyToken)) return json({ ok: false, error: "unauthorized" }, 401);
      try {
        const input = notificationInput(await request.json());
        if (!input) return json({ ok: false, error: "invalid notification" }, 400);
        await post(formatNotification(input));
        return json({ ok: true });
      } catch (error) {
        console.error("github-push: invalid /notify payload", error);
        return json({ ok: false, error: "invalid notification" }, 400);
      }
    }

    if (request.method !== "POST" || pathname !== "/hooks/github") return json({ ok: false, error: "not found" }, 404);
    const raw = await request.text();
    if (!(await verifyGitHubSignature(config.webhookSecret, raw, request.headers.get("x-hub-signature-256")))) return json({ ok: false, error: "invalid signature" }, 401);

    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: "invalid JSON" }, 400); }
    const deliveryId = request.headers.get("x-github-delivery")?.trim() || "";
    if (deliveryId) {
      if (!rememberDelivery(state, deliveryId)) return json({ ok: true, duplicate: true });
      try { await saveState(config.statePath, state); } catch (error) {
        console.error("github-push: state save failed", error);
        return json({ ok: false, error: "state unavailable" }, 500);
      }
    }
    metrics.lastDeliveryAt = new Date().toISOString();
    const eventName = request.headers.get("x-github-event");
    try {
      if (eventName === "ping") return json({ ok: true, ignored: "ping" });
      const event = eventName === "push" ? formatPush(payload, config.maxCommits)
        : eventName === "pull_request" ? formatPullRequest(payload)
        : eventName === "release" ? formatRelease(payload) : null;
      if (!event) return json({ ok: true, ignored: eventName || "unknown" });
      await post(event);
      return json({ ok: true });
    } catch (error) {
      console.error("github-push: bad webhook payload", error);
      return json({ ok: false, error: "invalid payload" }, 400);
    }
  };
}

export async function start(config = readConfig()): Promise<Bun.Server> {
  const state = await loadState(config.statePath);
  const space = new SpaceApi(config.spaceServerUrl, { token: config.spaceToken, username: config.spaceUsername, password: config.spacePassword });
  await space.login();
  const server = Bun.serve({ port: config.port, fetch: createHandler(config, space, state) });
  console.log(`GitHub push bridge listening on :${server.port}`);
  return server;
}

if (import.meta.main) await start();
