// Mention bookkeeping for the composer, kept out of the view so it can be tested
// without a DOM. The stored mention is a profile id; the text only carries a spelling
// of the name, which is why the two have to be reconciled explicitly.
export type MentionProfile = { id: string; username: string; display_name: string; archived?: boolean };

// The `@…` fragment the caret currently sits in, lowercased; null when the text does
// not end in an open mention, so the menu closes instead of matching everything.
export function mentionQuery(text: string): string | null {
  return text.match(/(?:^|\s)@([^\s@]*)$/)?.[1].toLocaleLowerCase() ?? null;
}

// Replace the open `@…` fragment with the chosen name, keeping the leading space.
export function insertMention(text: string, profile: MentionProfile): string {
  const at = "@" + profile.display_name + " ";
  return text.replace(/(?:^|\s)@([^\s@]*)$/, (match) => (match.startsWith(" ") ? " " + at : at));
}

// Candidates for the open fragment, matched on either display name or username.
export function mentionCandidates(text: string, profiles: MentionProfile[], limit = 5): MentionProfile[] {
  const query = mentionQuery(text);
  if (query === null) return [];
  return profiles
    .filter((profile) => [profile.display_name, profile.username].some((value) => value.toLocaleLowerCase().includes(query)))
    .slice(0, limit);
}

// A mention only lives as long as its name is still written in the text: deleting the
// "@name" is how a user un-mentions someone, so an edit must not carry a ghost id that
// no longer appears anywhere in the message.
export function survivingMentions(text: string, ids: string[], profiles: MentionProfile[]): string[] {
  const lowered = text.toLocaleLowerCase();
  return ids.filter((id) => {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) return false;
    return [profile.display_name, profile.username].some((value) => lowered.includes("@" + value.toLocaleLowerCase()));
  });
}
