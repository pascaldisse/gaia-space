// Client-side state for "load older messages" (KB §04 §1.3 history paging).
//
// Pure functions, no framework: the hard parts of paging a live list are ordering,
// duplication and races, and all three are decidable from state alone.
//   * ORDER: the backend answers newest-first; the view renders oldest-first. Merging
//     sorts by (created_at, id) — the same total order the cursor uses — so a client
//     never invents an ordering the server does not share.
//   * DUPLICATION: a message can arrive twice (page N+1 overlapping a live refresh, or a
//     double click). Merge is by id, last write wins, so a re-fetched row updates rather
//     than doubling.
//   * RACE: only the newest in-flight request may write. Each load takes a ticket; a
//     late answer holding an old ticket is dropped, which is what stops a slow first page
//     from overwriting a fast second one.
import type { MessagePage, MessageView } from "./api/chat";

export type PagingState = {
  /// Older pages already pulled in, oldest-first.
  older: MessageView[];
  /// Opaque server cursor for the next older page; null = beginning of history reached.
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /// Ticket of the request allowed to write next.
  ticket: number;
};

export function initialPaging(): PagingState {
  return { older: [], cursor: null, hasMore: true, loading: false, error: null, ticket: 0 };
}

/// Switching channel (or profile) invalidates everything, including in-flight answers:
/// the ticket moves, so a page requested for the previous channel can never land here.
export function resetPaging(state: PagingState): PagingState {
  return { ...initialPaging(), ticket: state.ticket + 1 };
}

/// Take a ticket. Returns the new state and the ticket the caller must present back.
/// A load already in flight is not started twice — `started` is false and the caller
/// simply does nothing.
export function beginLoad(state: PagingState): {
  state: PagingState;
  ticket: number;
  started: boolean;
} {
  if (state.loading || !state.hasMore) {
    return { state, ticket: state.ticket, started: false };
  }
  const ticket = state.ticket + 1;
  return { state: { ...state, loading: true, error: null, ticket }, ticket, started: true };
}

export function applyPage(state: PagingState, ticket: number, page: MessagePage): PagingState {
  if (ticket !== state.ticket) return state; // stale answer
  return {
    ...state,
    older: mergeHistory(page.messages, state.older),
    cursor: page.next_cursor,
    hasMore: page.has_more && page.next_cursor !== null,
    loading: false,
    error: null,
  };
}

/// A failed page leaves `cursor`/`hasMore` untouched: the position is still valid, so
/// "retry" means re-asking for the same page rather than skipping it.
export function failLoad(state: PagingState, ticket: number, error: unknown): PagingState {
  if (ticket !== state.ticket) return state;
  return { ...state, loading: false, error: describeError(error) };
}

export function describeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/// Merge any number of message lists into one oldest-first list, de-duplicated by id.
/// Later occurrences win, so a freshly fetched copy of a message replaces a stale one.
export function mergeHistory(...lists: MessageView[][]): MessageView[] {
  const byId = new Map<string, MessageView>();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/// What the channel pane renders: older pages plus the live newest window, as one
/// ordered, duplicate-free list.
export function visibleMessages(state: PagingState, live: MessageView[] | undefined): MessageView[] {
  return mergeHistory(state.older, live ?? []);
}

/// Links worth unfurling: only ones the server has not judged yet. `refused`/`failed` are
/// terminal answers, and asking again would just re-dial a host that already said no.
export function pendingLinkMessages(messages: MessageView[]): string[] {
  return messages
    .filter((m) => (m.links ?? []).some((l) => l.status === "pending"))
    .map((m) => m.id);
}
