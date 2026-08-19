export type BridgeConfig = {
  telegramToken: string;
  spaceServerUrl: string;
  spaceUsername: string;
  spacePassword: string;
  channelId: string;
  pollIntervalMs: number;
  statePath: string;
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
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ConfigError(`${key} must be a positive integer`);
  return parsed;
}

/** Reads deployment configuration; secrets deliberately have no defaults. */
export function readConfig(env: Record<string, string | undefined> = Bun.env): BridgeConfig {
  return {
    telegramToken: required(env, "TELEGRAM_BOT_TOKEN"),
    spaceServerUrl: (env.SPACE_SERVER_URL?.trim() || "http://127.0.0.1:8090").replace(/\/$/, ""),
    spaceUsername: required(env, "SPACE_USERNAME"),
    spacePassword: required(env, "SPACE_PASSWORD"),
    channelId: required(env, "SPACE_CHANNEL_ID"),
    pollIntervalMs: positiveInteger(env.TELEGRAM_POLL_INTERVAL_MS, 1_500, "TELEGRAM_POLL_INTERVAL_MS"),
    statePath: env.TELEGRAM_STATE_PATH?.trim() || "bridge/telegram/state.json",
  };
}
