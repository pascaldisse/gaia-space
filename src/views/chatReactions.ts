import type { Reaction } from "../api/chat";

/**
 * Tooltip for a reaction chip: who reacted, not how many.
 * The count is already on the chip face; the hover answers the other question.
 * Falls back to the bare emoji when the backend gave us no names.
 */
export function reactionChipTitle(reaction: Reaction): string {
  const names = (reaction.reactors ?? []).filter((n) => n.trim().length > 0);
  if (!names.length) return reaction.emoji;
  return `${reaction.emoji} ${names.join(", ")}`;
}

/**
 * Existing reactions on a message, in backend order. Empty array means the
 * chip row renders nothing — never a placeholder, never a hover-only ghost.
 */
export function reactionChips(message: { reactions?: Reaction[] }): Reaction[] {
  return (message.reactions ?? []).filter((r) => r.count > 0);
}
