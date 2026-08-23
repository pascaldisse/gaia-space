import { describe, expect, test } from "bun:test";
import type { MessagePage, MessageView } from "./api/chat";
import {
  applyPage,
  beginLoad,
  failLoad,
  initialPaging,
  mergeHistory,
  pendingLinkMessages,
  resetPaging,
  visibleMessages,
} from "./messagePaging";

const msg = (id: string, created_at: number, links?: MessageView["links"]): MessageView => ({
  id,
  channel_id: "c",
  author_id: "a",
  text: id,
  created_at,
  edited_at: null,
  thread_of: null,
  archived: false,
  reply_count: 0,
  reactions: [],
  attachments: [],
  links,
});

const page = (messages: MessageView[], next: string | null): MessagePage => ({
  messages,
  next_cursor: next,
  has_more: next !== null,
});

describe("message paging", () => {
  test("older pages land oldest-first and never duplicate a live message", () => {
    let state = initialPaging();
    const live = [msg("m3", 30)];
    const first = beginLoad(state);
    state = applyPage(first.state, first.ticket, page([msg("m2", 20), msg("m1", 10)], "cur-1"));
    // The live window and the page overlap on m3 — one row, not two.
    const second = beginLoad(state);
    state = applyPage(second.state, second.ticket, page([msg("m3", 30), msg("m0", 5)], null));
    expect(visibleMessages(state, live).map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(state.hasMore).toBe(false);
  });

  test("a stale answer cannot overwrite a newer one", () => {
    let state = initialPaging();
    const slow = beginLoad(state);
    state = slow.state;
    // Reset (channel switch) invalidates the in-flight ticket.
    state = resetPaging(state);
    const after = applyPage(state, slow.ticket, page([msg("ghost", 1)], null));
    expect(after.older).toEqual([]);
    expect(failLoad(state, slow.ticket, "boom").error).toBeNull();
  });

  test("a load is never started twice, nor past the beginning of history", () => {
    const busy = beginLoad({ ...initialPaging(), loading: true });
    expect(busy.started).toBe(false);
    const done = beginLoad({ ...initialPaging(), hasMore: false });
    expect(done.started).toBe(false);
  });

  test("a failure keeps the cursor so retry re-asks the same page", () => {
    let state = initialPaging();
    const first = beginLoad(state);
    state = applyPage(first.state, first.ticket, page([msg("m1", 10)], "cur-1"));
    const second = beginLoad(state);
    state = failLoad(second.state, second.ticket, new Error("network down"));
    expect(state.error).toBe("network down");
    expect(state.loading).toBe(false);
    expect(state.cursor).toBe("cur-1");
    expect(state.hasMore).toBe(true);
    // Retry is allowed and clears the error.
    const retry = beginLoad(state);
    expect(retry.started).toBe(true);
    expect(retry.state.error).toBeNull();
  });

  test("equal timestamps are ordered by id, matching the server cursor", () => {
    const merged = mergeHistory([msg("b", 5), msg("a", 5), msg("c", 4)]);
    expect(merged.map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  test("only pending links are worth unfurling", () => {
    const link = (status: "pending" | "ok" | "refused" | "failed") => [
      {
        url: "https://x.example",
        position: 0,
        status,
        title: null,
        description: null,
        site_name: null,
        error: null,
        fetched_at: null,
      },
    ];
    const list = [
      msg("pending", 1, link("pending")),
      msg("done", 2, link("ok")),
      msg("refused", 3, link("refused")),
      msg("none", 4),
    ];
    expect(pendingLinkMessages(list)).toEqual(["pending"]);
  });
});
