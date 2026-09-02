/** Work items created FROM a linked GAIA room — opt-in, explicit, two-step.
 *
 *  The bridge otherwise only moves text. This module lets a person standing in a GAIA room say
 *  "make this a ticket" and have Space create it. Because that is a WRITE into someone's project,
 *  every gate here is deliberately paranoid:
 *
 *    1. OFF by default (`actions.enabled`), and per-room narrowable (`actions.allowedRoomIds`).
 *    2. Only a message that BEGINS with the command prefix is even looked at — normal chat text,
 *       and text that merely mentions `!space` mid-sentence, can never act.
 *    3. Only events authored by `user` act. A model's turn is never an actor: an agent that types
 *       `!space ticket …` is ignored, so no prompt injection reaching the room can create work.
 *    4. Forwarded Space messages arrive as `Space message from <id>: …` (see `inboundText`), so
 *       they never begin with the prefix either — Space chat cannot drive Space writes.
 *    5. Nothing is created by the naming step. `!space ticket <title>` only PREVIEWS: it answers
 *       with the resolved context and a one-time token, and only `!space confirm <token>` from the
 *       same room, within the TTL, executes. The token is not guessable and not reusable.
 *    6. Context is used only where it is unambiguous: the room's channel decides the project. A
 *       channel that belongs to no project can hold no ticket, and the bridge refuses instead of
 *       guessing a project.
 *    7. Replay/duplicates: handled event ids, consumed tokens and completed fingerprints are all
 *       durable, and a restart primes the room instead of re-executing its backlog.
 *
 *  Permission is never modelled here. The create call rides the SAME authenticated Space transport
 *  as everything else; with `space.personalAccessToken` set (see README) that is the token owner,
 *  and the server rebinds `created_by`/`profile_id` to that session (`bind_session_identity`) and
 *  enforces `CommandPolicy::ProjectMemberWrite` + `Right::CreateIssue` / `TodoCreate`. A refusal is
 *  reported verbatim — the bridge grants nobody anything.
 */
import type { GaiaEvent, GaiaTransport, Mapping, SpaceTransport } from "./src.ts";
import type { OriginGuard } from "./own-account.ts";
import type { SpaceChannel } from "./whole-space.ts";

/* ---------- config ---------- */

export type ActionsConfig = {
  enabled: boolean;
  commandPrefix: string;
  /** Which item kinds may be created at all. Both must be switched on deliberately. */
  kinds: { task: boolean; ticket: boolean };
  confirmTtlMs: number;
  maxTitleLength: number;
  /** A repeat of the same room+kind+title inside this window is treated as a duplicate. */
  duplicateWindowMs: number;
  statePath: string;
  stateLimit: number;
  /** Base of the human-facing Space URL. Empty = report ids only, never a guessed link. */
  webBaseUrl: string;
  /** Path prefix the SPA is mounted under (deployment-dependent; the router itself is agnostic). */
  webBasePath: string;
  /** Also post the created item's id/link into the Space channel the room is linked to. */
  announceInChannel: boolean;
  /** Empty = every linked room may act. Non-empty = only these rooms. */
  allowedRoomIds: string[];
};

const bool = (value: unknown, fallback: boolean) => (value === undefined ? fallback : value === true);
const positive = (value: unknown, name: string, fallback: number) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`config ${name} must be positive`);
  return number;
};
const text = (value: unknown, name: string, fallback: string) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`config ${name} must be a string`);
  return value;
};
const stringList = (value: unknown, name: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`config ${name} must be an array of strings`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`config ${name}[${index}] must be a non-empty string`);
    return item.trim();
  });
};

export const defaultActions = (): ActionsConfig => ({
  enabled: false,
  commandPrefix: "!space",
  kinds: { task: true, ticket: true },
  confirmTtlMs: 300_000,
  maxTitleLength: 200,
  duplicateWindowMs: 86_400_000,
  statePath: "bridge/room-link/state/actions.json",
  stateLimit: 500,
  webBaseUrl: "",
  webBasePath: "",
  announceInChannel: true,
  allowedRoomIds: [],
});

/** Parse the `actions` block. Absent block = feature absent, not merely disabled. */
export function parseActions(raw: unknown): ActionsConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new Error("config actions must be an object");
  const input = raw as Record<string, unknown>;
  const kindsInput = (input.kinds ?? {}) as Record<string, unknown>;
  const fallback = defaultActions();
  const prefix = text(input.commandPrefix, "actions.commandPrefix", fallback.commandPrefix).trim();
  if (!prefix) throw new Error("config actions.commandPrefix must be a non-empty string");
  if (/\s/.test(prefix)) throw new Error("config actions.commandPrefix must not contain whitespace");
  const config: ActionsConfig = {
    enabled: bool(input.enabled, fallback.enabled),
    commandPrefix: prefix,
    kinds: { task: bool(kindsInput.task, fallback.kinds.task), ticket: bool(kindsInput.ticket, fallback.kinds.ticket) },
    confirmTtlMs: positive(input.confirmTtlMs, "actions.confirmTtlMs", fallback.confirmTtlMs),
    maxTitleLength: positive(input.maxTitleLength, "actions.maxTitleLength", fallback.maxTitleLength),
    duplicateWindowMs: positive(input.duplicateWindowMs, "actions.duplicateWindowMs", fallback.duplicateWindowMs),
    statePath: text(input.statePath, "actions.statePath", fallback.statePath).trim() || fallback.statePath,
    stateLimit: positive(input.stateLimit, "actions.stateLimit", fallback.stateLimit),
    webBaseUrl: text(input.webBaseUrl, "actions.webBaseUrl", fallback.webBaseUrl).trim().replace(/\/$/, ""),
    webBasePath: text(input.webBasePath, "actions.webBasePath", fallback.webBasePath).trim().replace(/\/$/, ""),
    announceInChannel: bool(input.announceInChannel, fallback.announceInChannel),
    allowedRoomIds: stringList(input.allowedRoomIds, "actions.allowedRoomIds"),
  };
  if (config.enabled && !config.kinds.task && !config.kinds.ticket) throw new Error("config actions.kinds enables neither task nor ticket");
  return config;
}

/* ---------- grammar ---------- */

export type ItemKind = "task" | "ticket";
export type Command =
  | { type: "create"; kind: ItemKind; title: string; description: string | null }
  | { type: "confirm"; token: string }
  | { type: "cancel"; token: string }
  | { type: "help" }
  | { type: "invalid"; reason: string };

/** Every line is INDENTED on purpose: the bridge posts its own answers into the same room, and a
 *  help text whose first line began with the prefix would be a command the bridge reads back. */
export const helpText = (prefix: string) =>
  ["Space actions — nothing is created before an explicit confirm.",
   `  ${prefix} task <title>     — preview a task (to-do)`,
   `  ${prefix} ticket <title>   — preview a ticket (project issue)`,
   `  ${prefix} confirm <token>  — create the previewed item`,
   `  ${prefix} cancel <token>   — discard the preview`,
   `  ${prefix} help`,
   "A second line and everything after it becomes the item's description."].join("\n");

/** `undefined` = not addressed to the bridge at all. Anything else is an explicit address and is
 *  ANSWERED, including nonsense — silence on a typo is how people end up believing they filed a ticket. */
export function parseCommand(rawText: string, config: Pick<ActionsConfig, "commandPrefix" | "kinds" | "maxTitleLength">): Command | undefined {
  const trimmed = (rawText ?? "").trim();
  const prefix = config.commandPrefix;
  if (!trimmed.startsWith(prefix)) return undefined;                 // mid-text mentions never act
  const rest = trimmed.slice(prefix.length);
  if (rest && !/^\s/.test(rest)) return undefined;                   // "!spacex …" is a different word
  const body = rest.trim();
  if (!body) return { type: "help" };
  const verb = body.split(/\s+/, 1)[0]!.toLowerCase();
  const argument = body.slice(verb.length).trim();
  if (verb === "help") return { type: "help" };
  if (verb === "confirm" || verb === "cancel") {
    const token = argument.split(/\s+/, 1)[0] ?? "";
    if (!token) return { type: "invalid", reason: `${verb} needs the token from the preview` };
    if (!/^[A-Z0-9]{4,12}$/.test(token)) return { type: "invalid", reason: `"${token}" is not a confirmation token` };
    return { type: verb === "confirm" ? "confirm" : "cancel", token };
  }
  if (verb !== "task" && verb !== "ticket") return { type: "invalid", reason: `unknown command "${verb}"` };
  if (!config.kinds[verb]) return { type: "invalid", reason: `${verb} creation is switched off for this bridge` };
  const [first, ...remaining] = argument.split("\n");
  const title = (first ?? "").trim();
  if (!title) return { type: "invalid", reason: `${verb} needs a title` };
  if (title.length > config.maxTitleLength) return { type: "invalid", reason: `title is longer than ${config.maxTitleLength} characters` };
  const description = remaining.join("\n").trim();
  return { type: "create", kind: verb, title, description: description || null };
}

/* ---------- context ---------- */

export type Context = { channelId: string; channelName: string | null; projectId: string | null };
export type ContextResult = { ok: true; context: Context } | { ok: false; reason: string };

/** Room → channel → project, and only when that chain is unambiguous. Two channels claiming one
 *  room (a corrupt mapping table) is refused rather than resolved by picking the first. */
export function resolveContext(roomId: string, mappings: readonly Mapping[], channels: readonly SpaceChannel[]): ContextResult {
  const linked = mappings.filter(mapping => mapping.roomId === roomId);
  if (!linked.length) return { ok: false, reason: "this room is not linked to a Space channel" };
  const channelIds = [...new Set(linked.map(mapping => mapping.spaceChannelId))];
  if (channelIds.length > 1) return { ok: false, reason: `this room is linked to ${channelIds.length} Space channels, so the target is ambiguous` };
  const channelId = channelIds[0]!;
  const channel = channels.find(candidate => candidate.id === channelId);
  if (!channel) return { ok: false, reason: `Space channel ${channelId} is not visible to this bridge's account` };
  return { ok: true, context: { channelId, channelName: channel.name ?? null, projectId: channel.project_id ?? null } };
}

/* ---------- durable state ---------- */

export type Pending = {
  token: string; roomId: string; channelId: string; projectId: string | null;
  kind: ItemKind; title: string; description: string | null;
  requestEventId: string; createdAtMs: number; fingerprint: string;
};
export type Completed = { fingerprint: string; token: string; kind: ItemKind; itemId: string; permalink: string | null; roomId: string; createdAtMs: number };
export type ActionState = { version: 1; pending: Pending[]; completed: Completed[]; handledEventIds: string[]; primedRoomIds: string[] };
export const emptyActionState = (): ActionState => ({ version: 1, pending: [], completed: [], handledEventIds: [], primedRoomIds: [] });

export interface ActionStore { load(): Promise<ActionState>; save(state: ActionState): Promise<void>; }

/** Atomic file store: temp write + rename, so a crash mid-write never truncates the state. */
export class FileActionStore implements ActionStore {
  constructor(private readonly path: string) {}
  async load(): Promise<ActionState> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return emptyActionState();
    const parsed = JSON.parse(await file.text()) as Partial<ActionState>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.pending) || !Array.isArray(parsed.completed) || !Array.isArray(parsed.handledEventIds)) throw new Error(`actions state ${this.path} is malformed`);
    return { version: 1, pending: parsed.pending, completed: parsed.completed, handledEventIds: parsed.handledEventIds, primedRoomIds: Array.isArray(parsed.primedRoomIds) ? parsed.primedRoomIds : [] };
  }
  async save(state: ActionState): Promise<void> {
    const { mkdir, rename } = await import("node:fs/promises");
    await mkdir(this.path.replace(/\/[^/]*$/, ""), { recursive: true }).catch(() => {});
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, this.path);
  }
}
export class MemoryActionStore implements ActionStore {
  constructor(private state: ActionState = emptyActionState()) {}
  async load(): Promise<ActionState> { return structuredClone(this.state); }
  async save(state: ActionState): Promise<void> { this.state = structuredClone(state); }
}

/** Room + kind + normalized title: the same sentence said twice is the same intent. */
export const fingerprintOf = (roomId: string, kind: ItemKind, title: string) =>
  `${roomId}\u0000${kind}\u0000${title.trim().toLowerCase().replace(/\s+/g, " ")}`;

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — tokens get retyped by humans
export const newToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]).join("");
};

/* ---------- Space work transport ---------- */

export type CreatedItem = { id: string; number?: number | null };
export interface SpaceWork {
  /** `POST /api/cmd/create_issue { input }` — policy ProjectMemberWrite + Right::CreateIssue. */
  createIssue(input: { project_id: string; title: string; description: string | null; source_entity_type: string; source_entity_id: string }): Promise<CreatedItem>;
  /** `POST /api/cmd/create_todo { input }` — policy TodoCreate; `profile_id` is rebound server-side. */
  createTodo(input: { profile_id: string; content: string; project_id: string | null; notes: string | null; source_entity_type: string; source_entity_id: string }): Promise<CreatedItem>;
}

type JsonCaller = SpaceTransport & { authenticatedJson(path: string, body: unknown): Promise<unknown> };

const createdItem = (payload: unknown, command: string): CreatedItem => {
  const value = (payload as { value?: { id?: unknown; number?: unknown } } | null)?.value;
  if (!value || typeof value.id !== "string" || !value.id) throw new Error(`Space ${command} returned no item id`);
  return { id: value.id, number: typeof value.number === "number" ? value.number : null };
};

/** Adds the two write commands to the existing authenticated transport — same session, same
 *  credential, no second login and no privilege of its own. */
export function spaceWorkOn<T extends JsonCaller>(transport: T): T & SpaceWork {
  const work = transport as T & SpaceWork;
  work.createIssue = async input => createdItem(await transport.authenticatedJson("/api/cmd/create_issue", { input }), "create_issue");
  work.createTodo = async input => createdItem(await transport.authenticatedJson("/api/cmd/create_todo", { input: { ...input, done: false } }), "create_todo");
  return work;
}

/* ---------- rendering ---------- */

/** Issues have an address in the router grammar (`projects/<p>/issues/<id>`); to-dos do not —
 *  they are reached through the project's `tasks` tab, or not at all when the task is personal.
 *  Without a configured web base nothing is guessed: the id is the answer. */
export function permalinkOf(kind: ItemKind, itemId: string, projectId: string | null, config: Pick<ActionsConfig, "webBaseUrl" | "webBasePath">): string | null {
  if (!config.webBaseUrl) return null;
  const base = `${config.webBaseUrl}${config.webBasePath}`;
  if (kind === "ticket") return projectId ? `${base}/projects/${projectId}/issues/${itemId}` : null;
  return projectId ? `${base}/projects/${projectId}/tasks` : null;
}

export const previewText = (pending: Pending, config: Pick<ActionsConfig, "commandPrefix" | "confirmTtlMs">) =>
  [`Preview — nothing created yet.`,
   `kind:    ${pending.kind === "ticket" ? "ticket (project issue)" : "task (to-do)"}`,
   `title:   ${pending.title}`,
   ...(pending.description ? [`details: ${pending.description.split("\n")[0]!.slice(0, 120)}${pending.description.length > 120 ? "…" : ""}`] : []),
   `channel: ${pending.channelId}`,
   `project: ${pending.projectId ?? (pending.kind === "task" ? "none — personal task" : "none")}`,
   ``,
   `Create it: ${config.commandPrefix} confirm ${pending.token}   (expires in ${Math.round(config.confirmTtlMs / 60000)} min)`,
   `Discard it: ${config.commandPrefix} cancel ${pending.token}`].join("\n");

export const createdText = (kind: ItemKind, item: CreatedItem, permalink: string | null, title: string) =>
  `Created ${kind}: ${title}\nid: ${item.id}${item.number ? ` (#${item.number})` : ""}${permalink ? `\nlink: ${permalink}` : ""}`;

export const channelAnnouncement = (kind: ItemKind, item: CreatedItem, permalink: string | null, title: string, roomId: string) =>
  `${kind === "ticket" ? "Ticket" : "Task"} created from GAIA room ${roomId}: ${title} — ${permalink ?? item.id}`;

/* ---------- the bridge ---------- */

export type ActionDependencies = {
  gaia: GaiaTransport;
  space: SpaceTransport & SpaceWork;
  store: ActionStore;
  config: ActionsConfig;
  origin: OriginGuard;
  /** Channel metadata, so the project is read from Space rather than from config. */
  channels: () => Promise<readonly SpaceChannel[]>;
  now?: () => number;
  token?: () => string;
};

/** Reads the linked rooms' events, answers previews, and executes only confirmed tokens. */
export class ActionBridge {
  private mappings: readonly Mapping[];
  private readonly now: () => number;
  private readonly token: () => string;
  constructor(mappings: readonly Mapping[], private readonly deps: ActionDependencies) {
    this.mappings = mappings;
    this.now = deps.now ?? (() => Date.now());
    this.token = deps.token ?? newToken;
  }
  setMappings(mappings: readonly Mapping[]): void { this.mappings = mappings; }

  private rooms(): string[] {
    const linked = [...new Set(this.mappings.map(mapping => mapping.roomId))];
    const allowed = this.deps.config.allowedRoomIds;
    return allowed.length ? linked.filter(roomId => allowed.includes(roomId)) : linked;
  }

  /** One pass over every room that may act. Returns how many commands were answered. */
  async pollOnce(): Promise<number> {
    const config = this.deps.config;
    if (!config.enabled) return 0;
    const rooms = this.rooms();
    if (!rooms.length) return 0;
    let state = await this.deps.store.load();
    let answered = 0;
    for (const roomId of rooms) {
      const events = await this.deps.gaia.events(roomId);
      // First sight of a room — after a restart too — is priming, never execution: an old
      // `confirm` still standing in the transcript must not create anything a second time.
      if (!state.primedRoomIds.includes(roomId)) {
        state = this.remember(state, events.map(event => event.id), roomId);
        await this.deps.store.save(state);
        continue;
      }
      for (const event of events) {
        if (state.handledEventIds.includes(event.id)) continue;
        const outcome = await this.handle(roomId, event, state);
        state = outcome.state;
        state = this.remember(state, [event.id], roomId);
        await this.deps.store.save(state); // durable before the answer: an answer may never be replayed
        if (outcome.answer) { await this.deps.gaia.send(roomId, outcome.answer); answered++; }
      }
    }
    return answered;
  }

  private remember(state: ActionState, eventIds: string[], roomId: string): ActionState {
    const limit = this.deps.config.stateLimit;
    const handledEventIds = [...state.handledEventIds, ...eventIds.filter(id => !state.handledEventIds.includes(id))].slice(-Math.max(limit, eventIds.length));
    const primedRoomIds = state.primedRoomIds.includes(roomId) ? state.primedRoomIds : [...state.primedRoomIds, roomId];
    return { ...state, handledEventIds, primedRoomIds };
  }

  private async handle(roomId: string, event: GaiaEvent, state: ActionState): Promise<{ state: ActionState; answer: string | null }> {
    const config = this.deps.config;
    const command = parseCommand(event.text ?? "", config);
    if (!command) return { state, answer: null };
    // THE actor rule: only a human turn acts. An agent may quote the grammar all day.
    if (event.author !== "user") return { state, answer: null };
    if (command.type === "help") return { state, answer: helpText(config.commandPrefix) };
    if (command.type === "invalid") return { state, answer: `${command.reason}\n\n${helpText(config.commandPrefix)}` };
    if (command.type === "cancel") {
      const found = state.pending.find(pending => pending.token === command.token && pending.roomId === roomId);
      if (!found) return { state, answer: `no pending item with token ${command.token} in this room` };
      return { state: { ...state, pending: state.pending.filter(pending => pending !== found) }, answer: `discarded ${found.kind} "${found.title}"` };
    }
    if (command.type === "create") return this.preview(roomId, event, command, state);
    return this.confirm(roomId, command.token, state);
  }

  private async preview(roomId: string, event: GaiaEvent, command: Extract<Command, { type: "create" }>, state: ActionState): Promise<{ state: ActionState; answer: string }> {
    const config = this.deps.config;
    const resolved = resolveContext(roomId, this.mappings, await this.deps.channels());
    if (!resolved.ok) return { state, answer: `cannot create a ${command.kind}: ${resolved.reason}` };
    const context = resolved.context;
    if (command.kind === "ticket" && !context.projectId)
      return { state, answer: `cannot create a ticket: channel ${context.channelName ?? context.channelId} belongs to no project, and a ticket without a project would be a guess. Run this in a project channel, or use ${config.commandPrefix} task instead.` };
    const fingerprint = fingerprintOf(roomId, command.kind, command.title);
    const duplicate = state.completed.find(done => done.fingerprint === fingerprint && this.now() - done.createdAtMs < config.duplicateWindowMs);
    if (duplicate) return { state, answer: `that ${command.kind} already exists: ${duplicate.permalink ?? duplicate.itemId}. Change the title if you really want a second one.` };
    const open = state.pending.find(pending => pending.fingerprint === fingerprint && this.now() - pending.createdAtMs < config.confirmTtlMs);
    if (open) return { state, answer: `the same ${command.kind} is already waiting for confirmation:\n\n${previewText(open, config)}` };
    const pending: Pending = {
      token: this.token(), roomId, channelId: context.channelId, projectId: context.projectId,
      kind: command.kind, title: command.title, description: command.description,
      requestEventId: event.id, createdAtMs: this.now(), fingerprint,
    };
    const kept = state.pending.filter(item => this.now() - item.createdAtMs < config.confirmTtlMs).slice(-config.stateLimit);
    return { state: { ...state, pending: [...kept, pending] }, answer: previewText(pending, config) };
  }

  private async confirm(roomId: string, token: string, state: ActionState): Promise<{ state: ActionState; answer: string }> {
    const config = this.deps.config;
    const pending = state.pending.find(item => item.token === token && item.roomId === roomId);
    if (!pending) return { state, answer: `no pending item with token ${token} in this room — previews expire after ${Math.round(config.confirmTtlMs / 60000)} min and every token works once` };
    if (this.now() - pending.createdAtMs >= config.confirmTtlMs)
      return { state: { ...state, pending: state.pending.filter(item => item !== pending) }, answer: `token ${token} has expired; run ${config.commandPrefix} ${pending.kind} <title> again` };
    // The token is spent BEFORE the write: a crash between here and the create loses the item,
    // which is the safe direction. A double create is not recoverable, a re-typed command is.
    const spent: ActionState = { ...state, pending: state.pending.filter(item => item !== pending) };
    await this.deps.store.save(spent);
    let item: CreatedItem;
    try {
      item = pending.kind === "ticket"
        ? await this.deps.space.createIssue({ project_id: pending.projectId!, title: pending.title, description: pending.description, source_entity_type: "channel", source_entity_id: pending.channelId })
        : await this.deps.space.createTodo({ profile_id: await this.deps.space.bridgeAuthorId(), content: pending.title, project_id: pending.projectId, notes: pending.description, source_entity_type: "channel", source_entity_id: pending.channelId });
    } catch (error) {
      // Space refused (permission, validation, outage). Report it verbatim; never retry silently.
      return { state: spent, answer: `Space refused to create the ${pending.kind}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const permalink = permalinkOf(pending.kind, item.id, pending.projectId, config);
    const completed: Completed = { fingerprint: pending.fingerprint, token, kind: pending.kind, itemId: item.id, permalink, roomId, createdAtMs: this.now() };
    const next: ActionState = { ...spent, completed: [...spent.completed, completed].slice(-config.stateLimit) };
    if (config.announceInChannel) {
      const claimed = await this.deps.origin.claim();
      const postedId = await this.deps.space.postMessage(pending.channelId, channelAnnouncement(pending.kind, item, permalink, pending.title, roomId), claimed);
      await this.deps.origin.confirm(postedId);
    }
    return { state: next, answer: createdText(pending.kind, item, permalink, pending.title) };
  }
}
