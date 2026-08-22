// Composer slash-command discovery (KB §07 §3.2 Applications #5).
//
// Space stores no command catalog: the platform asks each chatbot's own endpoint what
// it answers to. The pure part of that flow lives here — when a `/` is a command
// prefix at all, how several bots' answers become one menu, and what typing a menu
// entry does to the draft — so the rules are testable without a channel or a network.
import type { CommandListing } from "./api/applications";

/** The command prefix being typed, or `null` when the draft is not a command. */
export function slashPrefix(text: string): string | null {
  // Only a leading slash opens the menu: `http://x` and mid-sentence slashes are text.
  const match = /^\/([^\s/]*)$/.exec(text);
  return match ? match[1] : null;
}

export type CommandEntry = {
  name: string;
  description: string;
  chatbot_id: string;
  bot_name: string;
  /** `"app"` = the bot answered live · `"registration"` = declared fallback. */
  source: string;
};

/**
 * One menu out of many bots. Two bots may claim the same command name, so entries stay
 * per-bot and are ordered by name then bot, and a bot that answered live wins over its
 * own stale declared fallback for the same name.
 */
export function mergeCommandListings(
  listings: { listing: CommandListing; bot_name: string }[],
): CommandEntry[] {
  const byKey = new Map<string, CommandEntry>();
  for (const { listing, bot_name } of listings) {
    for (const command of listing.commands ?? []) {
      const key = `${listing.chatbot_id}\u0000${command.name}`;
      const existing = byKey.get(key);
      if (existing && existing.source === "app" && listing.source !== "app") continue;
      byKey.set(key, {
        name: command.name,
        description: command.description ?? "",
        chatbot_id: listing.chatbot_id,
        bot_name,
        source: listing.source,
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.bot_name.localeCompare(b.bot_name),
  );
}

/** How many bot endpoints one keystroke may be in flight to at once. */
export const COMMAND_FANOUT_LIMIT = 4;

/**
 * Bounded fan-out. A workspace with fifty bots must not turn one keystroke into fifty
 * simultaneous outbound requests, and a superseded query must stop dispatching the
 * moment it is superseded — `cancelled` is consulted before every call, so the work
 * already scheduled is the only work that is wasted.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  cancelled: () => boolean = () => false,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      if (cancelled()) return;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results.filter((value) => value !== undefined) as R[];
}

/** Picking an entry completes the command and leaves the caret after a space. */
export function applyCommand(name: string): string {
  return `/${name} `;
}