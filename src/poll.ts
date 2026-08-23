// Poll presentation logic, kept out of the view so it can be tested without a DOM.
// The server owns the tally; these functions only decide what a ballot click means and
// how a count is drawn.
import type { PollOptionResult, PollView } from "./api/chat";

/// Share of the *electorate*, not of the ballots: in a multiple-choice poll the
/// percentages legitimately add up to more than 100, and dividing by the ballot total
/// would understate every option.
export function optionShare(option: PollOptionResult, voterCount: number): number {
  if (voterCount <= 0) return 0;
  return Math.round((option.vote_count / voterCount) * 100);
}

/// What a click on `optionId` sends. Single choice: the click *is* the ballot, and
/// clicking the current pick withdraws it. Multiple choice: the click toggles that one
/// option inside the existing ballot. Selection order never matters, so the result is
/// sorted by option position for a stable request.
export function ballotAfterClick(poll: PollView, optionId: string): string[] {
  const picked = new Set(poll.options.filter((o) => o.me_voted).map((o) => o.id));
  if (!poll.multiple_choice) {
    return picked.has(optionId) ? [] : [optionId];
  }
  if (picked.has(optionId)) picked.delete(optionId);
  else picked.add(optionId);
  return poll.options.filter((o) => picked.has(o.id)).map((o) => o.id);
}

/// A poll is votable only while it is open; a closed poll shows a final tally.
export function pollIsOpen(poll: PollView): boolean {
  return poll.closed_at === null;
}

/// Composer validation mirrors the backend bounds so the user is told before the round
/// trip; the backend still enforces them (this is convenience, never the gate).
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 20;
export function pollDraftError(question: string, options: string[]): string | null {
  if (!question.trim()) return "A poll needs a question.";
  const filled = options.map((o) => o.trim()).filter(Boolean);
  if (filled.length < POLL_MIN_OPTIONS) return `A poll needs at least ${POLL_MIN_OPTIONS} options.`;
  if (filled.length > POLL_MAX_OPTIONS) return `A poll accepts at most ${POLL_MAX_OPTIONS} options.`;
  if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) return "Poll options must be distinct.";
  return null;
}
