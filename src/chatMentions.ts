// Mention bookkeeping for the composer, kept out of the view so it can be tested
// without a DOM. The text only carries a spelling of a target name, which is why the
// selected targets have to be reconciled explicitly on every edit.
export type MentionProfile = { id: string; username: string; display_name: string; archived?: boolean };
export type MentionTargetKind = "profile" | "team" | "issue" | "document";
export type MentionTarget = {
  // Composer candidates remain people/teams; entity refs arrive from persisted messages.
  kind: "profile" | "team";
  id: string;
  name: string;
  secondary?: string;
  archived?: boolean;
};
export type MentionTargetRef = { kind: MentionTargetKind; id: string };

function targetOf(profile: MentionProfile): MentionTarget {
  return { kind: "profile", id: profile.id, name: profile.display_name, secondary: profile.username, archived: profile.archived };
}

// The `@…` fragment the caret currently sits in, lowercased; null when the text does
// not end in an open mention, so the menu closes instead of matching everything.
export function mentionQuery(text: string): string | null {
  return text.match(/(?:^|\s)@([^\s@]*)$/)?.[1].toLocaleLowerCase() ?? null;
}

export function insertMention(text: string, target: MentionTarget): string;
export function insertMention(text: string, profile: MentionProfile): string;
// Replace the open `@…` fragment with the chosen target name, keeping the leading space.
export function insertMention(text: string, item: MentionProfile | MentionTarget): string {
  const name = "kind" in item ? item.name : item.display_name;
  const at = "@" + name + " ";
  return text.replace(/(?:^|\s)@([^\s@]*)$/, (match) => (match.startsWith(" ") ? " " + at : at));
}

export function mentionCandidates(text: string, profiles: MentionProfile[], limit?: number): MentionProfile[];
export function mentionCandidates(text: string, targets: MentionTarget[], limit?: number): MentionTarget[];
// Profiles always precede teams; limit applies after both groups are combined. The
// profile overload preserves the existing people-only API for older callers.
export function mentionCandidates(text: string, items: (MentionProfile | MentionTarget)[], limit = 5): (MentionProfile | MentionTarget)[] {
  const query = mentionQuery(text);
  if (query === null || limit <= 0) return [];
  const targets = items.map((item) => "kind" in item ? item : targetOf(item));
  const matches = targets
    .filter((target) => !target.archived && [target.name, target.secondary].some((value) => value?.toLocaleLowerCase().includes(query)))
    .sort((a, b) => Number(a.kind === "team") - Number(b.kind === "team"))
    .slice(0, limit);
  return "kind" in (items[0] ?? {}) ? matches : matches.map((target) => items.find((item) => item.id === target.id)!);
}

export function survivingMentions(text: string, ids: string[], profiles: MentionProfile[]): string[];
export function survivingMentions(text: string, mentions: MentionTargetRef[], targets: MentionTarget[]): MentionTargetRef[];
// A mention only lives as long as its name is still written in the text: deleting the
// "@name" removes a person or team target, never leaving a ghost target on an edit.
export function survivingMentions(text: string, mentions: (string | MentionTargetRef)[], items: (MentionProfile | MentionTarget)[]): (string | MentionTargetRef)[] {
  const lowered = text.toLocaleLowerCase();
  const legacy = typeof mentions[0] === "string";
  const targets = items.map((item) => "kind" in item ? item : targetOf(item));
  return mentions.filter((mention) => {
    // Entity targets have no @display-name candidate in this composer yet. Preserve their
    // durable reference through a text-only edit instead of silently deleting it.
    if (!legacy && ["issue", "document"].includes((mention as MentionTargetRef).kind)) return true;
    const target = legacy
      ? targets.find((candidate) => candidate.kind === "profile" && candidate.id === mention)
      : targets.find((candidate) => candidate.id === (mention as MentionTargetRef).id && candidate.kind === (mention as MentionTargetRef).kind);
    return target !== undefined && [target.name, target.secondary].some((value) => value && lowered.includes("@" + value.toLocaleLowerCase()));
  });
}
