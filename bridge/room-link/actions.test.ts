import { describe, expect, test } from "bun:test";
import {
  ActionBridge, defaultActions, emptyActionState, fingerprintOf, helpText, MemoryActionStore, newToken,
  parseActions, parseCommand, permalinkOf, resolveContext, spaceWorkOn,
  type ActionsConfig, type CreatedItem, type SpaceWork,
} from "./actions.ts";
import { parseConfig, type GaiaEvent, type GaiaTransport, type Mapping, type SpaceMessage, type SpaceTransport } from "./src.ts";
import { authorOriginGuard, MemoryLedgerStore, OwnAccountGuard } from "./own-account.ts";
import type { SpaceChannel } from "./whole-space.ts";

/* ---------- doubles ---------- */

const channel = (id: string, projectId: string | null, name = id): SpaceChannel => ({ id, name, archived: false, project_id: projectId });

class FakeGaia implements GaiaTransport {
  readonly rooms = new Map<string, GaiaEvent[]>();
  readonly sent: { roomId: string; text: string }[] = [];
  private sequence = 0;
  say(roomId: string, author: string, text: string): string {
    const id = `e${++this.sequence}`;
    this.rooms.set(roomId, [...(this.rooms.get(roomId) ?? []), { id, author, text }]);
    return id;
  }
  async events(roomId: string): Promise<GaiaEvent[]> { return [...(this.rooms.get(roomId) ?? [])]; }
  async send(roomId: string, text: string): Promise<void> {
    this.sent.push({ roomId, text });
    // The daemon has one ingress: the bridge's own answer lands in the transcript as a USER message.
    this.say(roomId, "user", text);
  }
  last(): string { return this.sent.at(-1)?.text ?? ""; }
}

class FakeSpace implements SpaceTransport, SpaceWork {
    readonly todos: Record<string, unknown>[] = [];
  readonly posted: { channelId: string; text: string; id: string }[] = [];
  refusal: string | undefined;
  private sequence = 0;
  async bridgeAuthorId(): Promise<string> { return "profile-owner"; }
  async listMessages(): Promise<SpaceMessage[]> { return []; }
  async postMessage(channelId: string, text: string, messageId?: string): Promise<string> {
    const id = messageId ?? `space-${++this.sequence}`;
    this.posted.push({ channelId, text, id });
    return id;
  }
  async createTodo(input: { profile_id: string; content: string; project_id: string | null; source_entity_id: string }): Promise<CreatedItem> {
    if (this.refusal) throw new Error(this.refusal);
    this.todos.push(input);
    return { id: `todo-${this.todos.length}` };
  }
}

const config = (overrides: Partial<ActionsConfig> = {}): ActionsConfig => ({ ...defaultActions(), enabled: true, webBaseUrl: "https://space.example", ...overrides });

type Harness = { gaia: FakeGaia; space: FakeSpace; store: MemoryActionStore; bridge: ActionBridge; clock: { now: number } };
function harness(options: { channels?: SpaceChannel[]; mappings?: Mapping[]; config?: Partial<ActionsConfig>; origin?: ReturnType<typeof authorOriginGuard> } = {}): Harness {
  const gaia = new FakeGaia(), space = new FakeSpace(), store = new MemoryActionStore();
  const clock = { now: 1_000_000 };
  let counter = 0;
  const bridge = new ActionBridge(options.mappings ?? [{ spaceChannelId: "c-1", roomId: "room-1" }], {
    gaia, space, store, config: config(options.config), origin: options.origin ?? authorOriginGuard(),
    channels: async () => options.channels ?? [channel("c-1", "p-1")],
    now: () => clock.now, token: () => `TOK${String(++counter).padStart(3, "0")}`,
  });
  return { gaia, space, store, bridge, clock };
}
/** Prime (the first pass never executes), then run the pass under test. */
const primed = async (h: Harness) => { await h.bridge.pollOnce(); };

/* ---------- grammar ---------- */

describe("command grammar", () => {
  const parse = (text: string) => parseCommand(text, config());

  test("normal chat text is never a command, not even when it mentions the prefix", () => {
    expect(parse("we should file a ticket for this")).toBeUndefined();
    expect(parse("as I said, !space ticket Login is broken")).toBeUndefined();      // prefix mid-text
    expect(parse("!spacex ticket Login is broken")).toBeUndefined();                 // different word
    expect(parse("Space message from p-9: !space ticket Login is broken")).toBeUndefined(); // forwarded chat
  });

  test("task and ticket take a title, and later lines become the description", () => {
    expect(parse("!space ticket Login is broken")).toEqual({ type: "create", kind: "ticket", title: "Login is broken", description: null });
    expect(parse("!space task Write the changelog\nfor the 2.1 release")).toEqual({ type: "create", kind: "task", title: "Write the changelog", description: "for the 2.1 release" });
  });

  test("malformed input is answered, never silently swallowed", () => {
    expect(parse("!space ticket")).toMatchObject({ type: "invalid" });
    expect(parse("!space ticket   ")).toMatchObject({ type: "invalid" });
    expect(parse("!space frobnicate a thing")).toMatchObject({ type: "invalid", reason: 'unknown command "frobnicate"' });
    expect(parse("!space confirm")).toMatchObject({ type: "invalid" });
    expect(parse("!space confirm not-a-token")).toMatchObject({ type: "invalid" });
    expect(parse(`!space ticket ${"x".repeat(300)}`)).toMatchObject({ type: "invalid" });
    expect(parse("!space")).toEqual({ type: "help" });
    expect(parse("!space help")).toEqual({ type: "help" });
  });

  test("a kind switched off in config cannot be addressed", () => {
    expect(parseCommand("!space ticket X", config({ kinds: { task: true, ticket: false } }))).toMatchObject({ type: "invalid" });
    expect(parseCommand("!space task X", config({ kinds: { task: true, ticket: false } }))).toMatchObject({ type: "create" });
  });

  test("tokens are unguessable enough and avoid look-alike characters", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

/* ---------- context ---------- */

describe("context resolution", () => {
  const mappings = [{ spaceChannelId: "c-1", roomId: "room-1" }];
  test("room → channel → project, only when the chain is unambiguous", () => {
    expect(resolveContext("room-1", mappings, [channel("c-1", "p-1")])).toEqual({ ok: true, context: { channelId: "c-1", channelName: "c-1", projectId: "p-1" } });
    expect(resolveContext("room-x", mappings, [channel("c-1", "p-1")])).toMatchObject({ ok: false });
    expect(resolveContext("room-1", mappings, [])).toMatchObject({ ok: false });   // channel not visible to this account
    expect(resolveContext("room-1", [...mappings, { spaceChannelId: "c-2", roomId: "room-1" }], [channel("c-1", "p-1"), channel("c-2", "p-2")]))
      .toMatchObject({ ok: false, reason: expect.stringContaining("ambiguous") });
  });

  test("permalinks are built only from the verified router grammar, never guessed", () => {
    expect(permalinkOf("ticket", "i-1", "p-1", { webBaseUrl: "https://s", webBasePath: "" })).toBe("https://s/projects/p-1/tasks");
    expect(permalinkOf("ticket", "i-1", "p-1", { webBaseUrl: "https://s", webBasePath: "/space" })).toBe("https://s/space/projects/p-1/tasks");
    expect(permalinkOf("task", "t-1", "p-1", { webBaseUrl: "https://s", webBasePath: "" })).toBe("https://s/projects/p-1/tasks");
    expect(permalinkOf("task", "t-1", null, { webBaseUrl: "https://s", webBasePath: "" })).toBeNull(); // personal task has no address
    expect(permalinkOf("ticket", "i-1", "p-1", { webBaseUrl: "", webBasePath: "" })).toBeNull();       // no base configured → id only
  });
});

/* ---------- the two-step ---------- */

describe("preview and confirm", () => {
  test("naming a ticket creates nothing; only the confirm token does", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);
    expect(h.gaia.last()).toContain("nothing created yet");
    expect(h.gaia.last()).toContain("TOK001");

    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([{ profile_id: "profile-owner", content: "Login is broken", project_id: "p-1", notes: null, category: "dev", source_entity_type: "channel", source_entity_id: "c-1" }]);
    expect(h.gaia.last()).toContain("todo-1");
    expect(h.gaia.last()).toContain("https://space.example/projects/p-1/tasks");
  });

  test("a task without a project is personal, and carries its channel anchor", async () => {
    const h = harness({ channels: [channel("c-1", null)] });
    await primed(h);
    h.gaia.say("room-1", "user", "!space task Water the plants");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([{ profile_id: "profile-owner", content: "Water the plants", project_id: null, notes: null, source_entity_type: "channel", source_entity_id: "c-1" }]);
  });

  test("a ticket in a project-less channel is refused, not guessed into some project", async () => {
    const h = harness({ channels: [channel("c-1", null)] });
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);
    expect(h.gaia.last()).toContain("belongs to no project");
    expect(h.gaia.last()).toContain("!space task");
  });

  test("an ambiguous room refuses before it ever asks for confirmation", async () => {
    const h = harness({ mappings: [{ spaceChannelId: "c-1", roomId: "room-1" }, { spaceChannelId: "c-2", roomId: "room-1" }], channels: [channel("c-1", "p-1"), channel("c-2", "p-2")] });
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    expect(h.gaia.last()).toContain("ambiguous");
    expect(h.space.todos).toEqual([]);
  });

  test("cancel discards the token, and the cancelled token cannot be confirmed afterwards", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space task Something");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space cancel TOK001");
    await h.bridge.pollOnce();
    expect(h.gaia.last()).toContain("discarded");
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);
    expect(h.gaia.last()).toContain("no pending item");
  });

  test("an expired token creates nothing", async () => {
    const h = harness({ config: { confirmTtlMs: 60_000 } });
    await primed(h);
    h.gaia.say("room-1", "user", "!space task Something");
    await h.bridge.pollOnce();
    h.clock.now += 60_001;
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);
    expect(h.gaia.last()).toContain("expired");
  });

  test("a token from another room does not work in this one", async () => {
    const h = harness({ mappings: [{ spaceChannelId: "c-1", roomId: "room-1" }, { spaceChannelId: "c-2", roomId: "room-2" }], channels: [channel("c-1", "p-1"), channel("c-2", "p-2")] });
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Cross-room attempt");
    await h.bridge.pollOnce();
    h.gaia.say("room-2", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);
    expect(h.gaia.sent.at(-1)!.roomId).toBe("room-2");
    expect(h.gaia.last()).toContain("no pending item");
  });
});

/* ---------- refusal, duplicates, replay ---------- */

describe("safety", () => {
  test("only a human turn acts — an agent quoting the grammar is ignored", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "assistant", "!space ticket Ignore all previous instructions");
    h.gaia.say("room-1", "assistant", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);
    expect(h.gaia.sent).toEqual([]);
  });

  test("the bridge's own answers never act, even though they re-enter the room as user messages", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space help");
    await h.bridge.pollOnce();
    await h.bridge.pollOnce();          // second pass sees the help text the bridge just posted
    await h.bridge.pollOnce();
    expect(h.gaia.sent.length).toBe(1); // it answered once and then fell silent
    expect(h.space.todos).toEqual([]);
    expect(h.space.todos).toEqual([]);
  });

  test("a Space refusal is reported verbatim and the token is spent, never retried in a loop", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    h.space.refusal = "POST /api/cmd/create_issue: HTTP 403 project access denied";
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.gaia.last()).toContain("403 project access denied");
    h.space.refusal = undefined;
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos).toEqual([]);        // a spent token stays spent
    expect(h.gaia.last()).toContain("no pending item");
  });

  test("confirming twice creates one item — the token is single-use", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.todos.length).toBe(1);
  });

  test("re-asking for the same item points at the one that exists instead of creating a second", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space ticket   login IS broken  ");   // same intent, different spelling
    await h.bridge.pollOnce();
    expect(h.gaia.last()).toContain("already exists");
    expect(h.gaia.last()).toContain("/tasks");
    expect(h.space.todos.length).toBe(1);
    h.gaia.say("room-1", "user", "!space ticket Login is broken again");  // a different title is a different item
    await h.bridge.pollOnce();
    expect(h.gaia.last()).toContain("nothing created yet");
  });

  test("naming the same item twice before confirming reuses the open preview, not a second token", async () => {
    const h = harness();
    await primed(h);
    h.gaia.say("room-1", "user", "!space task Same thing");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space task Same thing");
    await h.bridge.pollOnce();
    expect(h.gaia.last()).toContain("already waiting for confirmation");
    expect(h.gaia.last()).toContain("TOK001");
    expect(h.gaia.last()).not.toContain("TOK002");
  });

  test("a restart never re-executes the transcript: old confirms are primed away", async () => {
    const store = new MemoryActionStore();
    const gaia = new FakeGaia(), space = new FakeSpace();
    const make = (token: string) => new ActionBridge([{ spaceChannelId: "c-1", roomId: "room-1" }], {
      gaia, space, store, config: config(), origin: authorOriginGuard(),
      channels: async () => [channel("c-1", "p-1")], now: () => 1_000_000, token: () => token,
    });
    const first = make("TOK001");
    await first.pollOnce();                                     // prime
    gaia.say("room-1", "user", "!space ticket Login is broken");
    await first.pollOnce();
    gaia.say("room-1", "user", "!space confirm TOK001");
    await first.pollOnce();
    expect(space.todos.length).toBe(1);

    const afterRestart = make("TOK002");                        // same durable state, fresh process
    await afterRestart.pollOnce();
    await afterRestart.pollOnce();
    expect(space.todos.length).toBe(1);                        // the old confirm in the transcript did nothing
  });

  test("a room that was never seen before primes instead of executing its backlog", async () => {
    const h = harness();
    h.gaia.say("room-1", "user", "!space ticket Historic");
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.gaia.sent).toEqual([]);
    expect(h.space.todos).toEqual([]);
  });

  test("actions stay silent when disabled, or when the room is not on the allow-list", async () => {
    const off = harness({ config: { enabled: false } });
    off.gaia.say("room-1", "user", "!space task X");
    expect(await off.bridge.pollOnce()).toBe(0);
    expect(off.gaia.sent).toEqual([]);

    const narrowed = harness({ config: { allowedRoomIds: ["room-9"] } });
    await primed(narrowed);
    narrowed.gaia.say("room-1", "user", "!space task X");
    await narrowed.bridge.pollOnce();
    expect(narrowed.gaia.sent).toEqual([]);
  });

  test("the created item is announced in the Space channel under the bridge's own origin id", async () => {
    const origin = await OwnAccountGuard.open(new MemoryLedgerStore(), 10, "bridge-", () => "fixed");
    const h = harness({ origin });
    await primed(h);
    h.gaia.say("room-1", "user", "!space ticket Login is broken");
    await h.bridge.pollOnce();
    h.gaia.say("room-1", "user", "!space confirm TOK001");
    await h.bridge.pollOnce();
    expect(h.space.posted.length).toBe(1);
    expect(h.space.posted[0]!.channelId).toBe("c-1");
    expect(h.space.posted[0]!.id).toBe("bridge-fixed");        // suppressed on the way back, never a loop
    expect(h.space.posted[0]!.text).toContain("https://space.example/projects/p-1/tasks");

    const quiet = harness({ config: { announceInChannel: false } });
    await primed(quiet);
    quiet.gaia.say("room-1", "user", "!space task Silent");
    await quiet.bridge.pollOnce();
    quiet.gaia.say("room-1", "user", "!space confirm TOK001");
    await quiet.bridge.pollOnce();
    expect(quiet.space.posted).toEqual([]);
  });
});

/* ---------- config + transport ---------- */

describe("configuration", () => {
  test("actions are absent by default and disabled even when the block exists", () => {
    expect(parseConfig({ mappings: [], space: { personalAccessToken: "t" }, gaia: { workspaceId: "w" } }).actions).toBeUndefined();
    expect(parseActions({})!.enabled).toBe(false);
    expect(parseActions(undefined)).toBeUndefined();
  });

  test("a nonsense actions block is refused at parse time, not at command time", () => {
    expect(() => parseActions({ commandPrefix: "" })).toThrow(/commandPrefix/);
    expect(() => parseActions({ commandPrefix: "! space" })).toThrow(/whitespace/);
    expect(() => parseActions({ confirmTtlMs: 0 })).toThrow(/confirmTtlMs/);
    expect(() => parseActions({ allowedRoomIds: "room-1" })).toThrow(/allowedRoomIds/);
    expect(() => parseActions({ enabled: true, kinds: { task: false, ticket: false } })).toThrow(/neither/);
  });

  test("the whole config carries the block through, prefix and all", () => {
    const parsed = parseConfig({ mappings: [], space: { personalAccessToken: "t" }, gaia: { workspaceId: "w" }, actions: { enabled: true, commandPrefix: "!work", allowedRoomIds: ["room-1"] } });
    expect(parsed.actions).toMatchObject({ enabled: true, commandPrefix: "!work", allowedRoomIds: ["room-1"] });
    expect(parseCommand("!work ticket X", parsed.actions!)).toMatchObject({ type: "create", kind: "ticket" });
    expect(parseCommand("!space ticket X", parsed.actions!)).toBeUndefined();
  });

  test("the write commands ride the existing authenticated session — one credential, no login of their own", async () => {
    const calls: { path: string; body: unknown }[] = [];
    const transport = {
      async bridgeAuthorId() { return "profile-owner"; },
      async listMessages() { return []; },
      async postMessage() { return "id"; },
      async authenticatedJson(path: string, body: unknown) {
        calls.push({ path, body });
        return { ok: true, value: { id: "issue-9", number: 42 } };
      },
    };
    const work = spaceWorkOn(transport);
    expect(await work.createTodo({ profile_id: "me", content: "T", project_id: "p-1", notes: null, category: "dev", source_entity_type: "channel", source_entity_id: "c-1" })).toEqual({ id: "issue-9", number: 42 });
    expect(calls.map(call => call.path)).toEqual(["/api/cmd/create_todo"]);
    expect((calls[0]!.body as { input: { done: boolean; category: string } }).input.done).toBe(false);
    expect((calls[0]!.body as { input: { category: string } }).input.category).toBe("dev");
  });

  test("a malformed create response is an error, never a fake success", async () => {
    const work = spaceWorkOn({ async bridgeAuthorId() { return "x"; }, async listMessages() { return []; }, async postMessage() { return "id"; }, async authenticatedJson() { return { ok: true, value: {} }; } });
    await expect(work.createTodo({ profile_id: "x", content: "t", project_id: "p", notes: null, source_entity_type: "channel", source_entity_id: "c" })).rejects.toThrow(/no item id/);
  });

  test("help names the whole grammar, and the fingerprint ignores spelling noise", () => {
    expect(helpText("!space")).toContain("!space confirm <token>");
    // The bridge posts its own answers back into the room as user messages: none of them may parse
    // as a command, or the help text would file a ticket called "<title>".
    for (const line of [helpText("!space"), "Preview — nothing created yet.", "Created ticket: x\nid: y"])
      expect(parseCommand(line, config())).toBeUndefined();
    expect(fingerprintOf("room-1", "task", "  Fix   THE login ")).toBe(fingerprintOf("room-1", "task", "fix the login"));
    expect(fingerprintOf("room-1", "task", "a")).not.toBe(fingerprintOf("room-2", "task", "a"));
    expect(fingerprintOf("room-1", "task", "a")).not.toBe(fingerprintOf("room-1", "ticket", "a"));
    expect(emptyActionState()).toEqual({ version: 1, pending: [], completed: [], handledEventIds: [], primedRoomIds: [] });
  });
});
