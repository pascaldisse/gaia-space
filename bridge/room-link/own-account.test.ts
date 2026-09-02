import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomLink, isForwardable, type GaiaEvent, type GaiaTransport, type SpaceMessage, type SpaceTransport } from "./src.ts";
import { FileLedgerStore, MemoryLedgerStore, OutboundLedger, OwnAccountGuard, authorOriginGuard } from "./own-account.ts";

const message = (id: string, author_id: string | null, text = "hello"): SpaceMessage => ({ id, channel_id: "space-1", author_id, text, created_at: 1, thread_of: null, archived: false });
const OWNER = "jannes-profile";

/** A Space that stores what the bridge posts, exactly as the server does: the client id is kept,
 *  the author is rebound to the session profile (`bind_session_identity`). */
const spaceStub = (messages: SpaceMessage[], posted: string[] = []): SpaceTransport & { posted: string[] } => ({
  posted,
  bridgeAuthorId: async () => OWNER,
  listMessages: async () => messages,
  postMessage: async (channelId, text, messageId) => {
    const id = messageId ?? `bridge-${messages.length}`;
    posted.push(`${channelId}:${id}:${text}`);
    messages.push({ ...message(id, OWNER, text), channel_id: channelId });
    return id;
  },
});
const gaiaStub = (sent: string[]): GaiaTransport => {
  let reads = 0;
  return {
    events: async (): Promise<GaiaEvent[]> => (reads++ === 0 ? [{ id: "before", author: "user", text: "prior" }] : [{ id: "before", author: "user", text: "prior" }, { id: `reply-${reads}`, author: "terra", text: "agent reply" }]),
    send: async (_room, text) => { sent.push(text); },
  };
};
const counterIds = () => { let n = 0; return () => `id-${++n}`; };

describe("outbound ledger", () => {
  test("records are durable across a restart and bounded to the configured limit", async () => {
    const store = new MemoryLedgerStore();
    const ledger = await OutboundLedger.open(store, 3);
    for (const id of ["a", "b", "c", "d"]) await ledger.record(id);
    expect(ledger.size()).toBe(3);
    expect(ledger.has("a")).toBe(false); // oldest evicted, the ring never grows without end
    expect(ledger.has("d")).toBe(true);

    const afterRestart = await OutboundLedger.open(store, 3);
    expect(afterRestart.has("d")).toBe(true);
    expect(afterRestart.has("b")).toBe(true);
    expect(afterRestart.has("a")).toBe(false);
  });

  test("recording the same id twice is a no-op, and a positive limit is required", async () => {
    const ledger = await OutboundLedger.open(new MemoryLedgerStore(), 5);
    await ledger.record("x");
    await ledger.record("x");
    expect(ledger.size()).toBe(1);
    await expect(OutboundLedger.open(new MemoryLedgerStore(), 0)).rejects.toThrow("positive");
  });

  test("the file store survives a real restart and refuses a malformed state file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "room-link-ledger-"));
    try {
      const path = join(directory, "nested", "outbound-ids.json");
      const guard = await OwnAccountGuard.open(new FileLedgerStore(path), 100, "bridge-");
      const claimed = await guard.claim();
      // A fresh process, same file: the id posted before the restart is still recognised as ours.
      const reopened = await OwnAccountGuard.open(new FileLedgerStore(path), 100, "bridge-");
      expect(reopened.isOwnOrigin(message(claimed, OWNER))).toBe(true);

      await writeFile(path, "{\"version\":2}");
      await expect(new FileLedgerStore(path).load()).rejects.toThrow("malformed");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("own-account origin guard", () => {
  test("suppresses only what the bridge originated; the owner's own typing is forwarded", async () => {
    const guard = await OwnAccountGuard.open(new MemoryLedgerStore(), 100, "bridge-", counterIds());
    const claimed = await guard.claim();
    expect(claimed).toBe("bridge-id-1");

    expect(guard.isOwnOrigin(message(claimed, OWNER))).toBe(true);                    // GAIA echo
    expect(guard.isOwnOrigin(message("msg-manual", OWNER, "written by hand"))).toBe(false); // token owner
    expect(guard.isOwnOrigin(message("msg-foreign", "someone-else"))).toBe(false);    // another person
    expect(guard.isOwnOrigin(message("msg-null", null))).toBe(false);                 // system/unknown
  });

  test("the id prefix still suppresses after the ledger evicted or lost the id", async () => {
    const guard = await OwnAccountGuard.open(new MemoryLedgerStore(), 1, "bridge-", counterIds());
    const first = await guard.claim();
    await guard.claim(); // evicts `first` from the one-slot ring
    expect(guard.isOwnOrigin(message(first, OWNER))).toBe(true); // prefix is the stateless guard
    expect(guard.isOwnOrigin(message("bridge-from-an-old-run", OWNER))).toBe(true);
    expect(guard.isOwnOrigin(message("manual-id", OWNER))).toBe(false);
  });

  test("a server-assigned id is confirmed into the ledger too", async () => {
    const guard = await OwnAccountGuard.open(new MemoryLedgerStore(), 100, "", counterIds()); // no prefix: ledger alone
    await guard.confirm("server-chosen-id");
    expect(guard.isOwnOrigin(message("server-chosen-id", OWNER))).toBe(true);
    expect(guard.isOwnOrigin(message("other-id", OWNER))).toBe(false);
  });

  test("thread replies and archived messages stay out of the bridge in own-account mode", async () => {
    const guard = await OwnAccountGuard.open(new MemoryLedgerStore(), 100, "bridge-", counterIds());
    const own = (candidate: SpaceMessage) => guard.isOwnOrigin(candidate);
    const seen = new Set<string>();
    expect(isForwardable(message("manual", OWNER, "hi"), own, seen)).toBe(true);
    expect(isForwardable({ ...message("in-thread", OWNER), thread_of: "root" }, own, seen)).toBe(false);
    expect(isForwardable({ ...message("archived", OWNER), archived: true }, own, seen)).toBe(false);
    expect(isForwardable(message("blank", OWNER, "   "), own, seen)).toBe(false);
    expect(isForwardable(message(await guard.claim(), OWNER, "agent reply"), own, seen)).toBe(false);
  });
});

describe("RoomLink under a human's credential", () => {
  const mappings = [{ spaceChannelId: "space-1", roomId: "room-1" }];

  test("forwards the owner's manual message, answers it, and never loops on its own reply", async () => {
    const messages: SpaceMessage[] = [message("old", OWNER, "old")];
    const space = spaceStub(messages);
    const sent: string[] = [];
    const store = new MemoryLedgerStore();
    const guard = await OwnAccountGuard.open(store, 100, "bridge-", counterIds());
    const link = new RoomLink(mappings, space, gaiaStub(sent), 100, 1, guard);

    expect(await link.pollOnce()).toBe(0); // prime history
    messages.push(message("manual-1", OWNER, "hey GAIA, status?"));
    expect(await link.pollOnce()).toBe(1);
    expect(sent).toEqual([`Space message from ${OWNER}: hey GAIA, status?`]);
    expect(space.posted).toEqual(["space-1:bridge-id-1:agent reply"]);

    // The reply is now in the channel, authored by the owner's own profile — and still ignored.
    expect(await link.pollOnce()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  test("a message from another person is forwarded exactly like the owner's", async () => {
    const messages: SpaceMessage[] = [];
    const space = spaceStub(messages);
    const sent: string[] = [];
    const link = new RoomLink(mappings, space, gaiaStub(sent), 100, 1, await OwnAccountGuard.open(new MemoryLedgerStore(), 100, "bridge-", counterIds()));
    expect(await link.pollOnce()).toBe(0);
    messages.push(message("foreign-1", "bjarne-profile", "moin"));
    expect(await link.pollOnce()).toBe(1);
    expect(sent).toEqual(["Space message from bjarne-profile: moin"]);
  });

  test("after a restart the pre-restart reply is still recognised as GAIA's own", async () => {
    const store = new MemoryLedgerStore();
    const messages: SpaceMessage[] = [];
    const space = spaceStub(messages);
    const first = new RoomLink(mappings, space, gaiaStub([]), 100, 1, await OwnAccountGuard.open(store, 100, "bridge-", counterIds()));
    await first.pollOnce();
    messages.push(message("manual-1", OWNER, "question"));
    await first.pollOnce();
    const replyId = messages.at(-1)!.id;

    // New process: new RoomLink, new in-memory seen/primed sets, same durable ledger.
    const restarted = await OwnAccountGuard.open(store, 100, "bridge-", counterIds());
    expect(restarted.isOwnOrigin(message(replyId, OWNER))).toBe(true);
    expect(restarted.isOwnOrigin(message("manual-1", OWNER))).toBe(false);
  });

  test("default mode is untouched: without the guard the owner's own messages are still dropped", async () => {
    const messages: SpaceMessage[] = [];
    const space = spaceStub(messages);
    const sent: string[] = [];
    const link = new RoomLink(mappings, space, gaiaStub(sent), 100, 1); // no origin guard = authorOriginGuard
    expect(await link.pollOnce()).toBe(0);
    messages.push(message("manual-1", OWNER, "typed by the account owner"));
    expect(await link.pollOnce()).toBe(0);
    expect(sent).toEqual([]);
    expect(authorOriginGuard().isOwnOrigin(message("manual-1", OWNER), OWNER)).toBe(true);
  });
});
