export type GitHubPushConfig = {
  port: number;
  webhookSecret: string;
  notifyToken: string;
  spaceServerUrl: string;
  spaceToken?: string;
  spaceUsername?: string;
  spacePassword?: string;
  channelId: string;
  repoChannelMap: Record<string, string>;
  statePath: string;
  maxCommits: number;
};

export class ConfigError extends Error {}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigError(`${key} is required`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) throw new ConfigError(`${key} must be a positive integer`);
  return parsed;
}

function channelMap(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return Object.fromEntries(Object.entries(parsed).map(([repo, channel]) => {
      if (!repo.trim() || typeof channel !== "string" || !channel.trim()) throw new Error();
      return [repo, channel.trim()];
    }));
  } catch {
    throw new ConfigError("REPO_CHANNEL_MAP must be a JSON object of repo to channel ID");
  }
}

/** Reads deployment configuration; secrets deliberately have no defaults. */
export function readConfig(env: Record<string, string | undefined> = Bun.env): GitHubPushConfig {
  const spaceToken = env.SPACE_TOKEN?.trim();
  const spaceUsername = env.SPACE_USERNAME?.trim();
  const spacePassword = env.SPACE_PASSWORD?.trim();
  if (!spaceToken && (!spaceUsername || !spacePassword)) {
    throw new ConfigError("SPACE_TOKEN or SPACE_USERNAME and SPACE_PASSWORD are required");
  }
  return {
    port: positiveInteger(env.PORT, 8093, "PORT"),
    webhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    notifyToken: required(env, "NOTIFY_TOKEN"),
    spaceServerUrl: (env.SPACE_SERVER_URL?.trim() || "http://127.0.0.1:8090").replace(/\/$/, ""),
    spaceToken: spaceToken || undefined,
    spaceUsername: spaceUsername || undefined,
    spacePassword: spacePassword || undefined,
    channelId: env.SPACE_CHANNEL_ID?.trim() || "target",
    repoChannelMap: channelMap(env.REPO_CHANNEL_MAP),
    statePath: env.STATE_PATH?.trim() || "bridge/github-push/state.json",
    maxCommits: positiveInteger(env.MAX_COMMITS, 5, "MAX_COMMITS"),
  };
}
