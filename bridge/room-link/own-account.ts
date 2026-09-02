/** Own-account mode: the bridge runs under a *human's* Space credential.
 *
 *  The default mode suppresses by AUTHOR — every message written by the bridge's profile is
 *  ignored, which is right when the bridge owns a dedicated account. Under a human's token the
 *  author is the human, so author-suppression would also swallow everything that person types by
 *  hand in Space. Own-account mode therefore suppresses by ORIGIN instead: only messages this
 *  bridge itself created are held back, everything else — the owner's own typing included — is
 *  forwarded.
 *
 *  Origin is carried by the message ID, never by a marker in the text:
 *    1. the id is chosen by the client and `create_message` stores and returns it verbatim
 *       (server-side only `author_id` is rebound, by `bind_session_identity`), so a posted id is
 *       a fact both sides agree on;
 *    2. every outbound id is written to a durable, bounded ledger BEFORE the post goes out
 *       (write-ahead: a crash between record and post can only over-suppress, never loop);
 *    3. the id prefix (`bridge-` by default) is a second, stateless guard that still holds after
 *       the ledger has evicted an old id or the state file was lost.
 */
import type { SpaceMessage } from "./src.ts";


/* ---------- durable, bounded ledger of ids this bridge posted ---------- */

export type LedgerState = { version: 1; ids: string[] };
export const emptyLedgerState = (): LedgerState => ({ version: 1, ids: [] });

export interface LedgerStore { load(): Promise<LedgerState>; save(state: LedgerState): Promise<void>; }

/** Atomic file store: temp write + rename, so a crash mid-write never truncates the ledger. */
export class FileLedgerStore implements LedgerStore {
  constructor(private readonly path: string) {}
  async load(): Promise<LedgerState> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return emptyLedgerState();
    const parsed = JSON.parse(await file.text()) as Partial<LedgerState>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.ids)) throw new Error(`outbound ledger ${this.path} is malformed`);
    return { version: 1, ids: parsed.ids.filter((id): id is string => typeof id === "string") };
  }
  async save(state: LedgerState): Promise<void> {
    const { mkdir, rename } = await import("node:fs/promises");
    await mkdir(this.path.replace(/\/[^/]*$/, ""), { recursive: true }).catch(() => {});
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, this.path);
  }
}
export class MemoryLedgerStore implements LedgerStore {
  constructor(private state: LedgerState = emptyLedgerState()) {}
  async load(): Promise<LedgerState> { return structuredClone(this.state); }
  async save(state: LedgerState): Promise<void> { this.state = structuredClone(state); }
}

/** FIFO ring of the last `limit` outbound ids. Bounded, so a long-lived bridge cannot grow the
 *  state file without end; the id prefix keeps evicted ids safe. */
export class OutboundLedger {
  private constructor(private readonly store: LedgerStore, private readonly limit: number, private ids: string[]) {}
  static async open(store: LedgerStore, limit: number): Promise<OutboundLedger> {
    if (!Number.isFinite(limit) || limit <= 0) throw new Error("outbound ledger limit must be positive");
    const state = await store.load();
    return new OutboundLedger(store, limit, state.ids.slice(-limit));
  }
  has(id: string): boolean { return this.ids.includes(id); }
  size(): number { return this.ids.length; }
  /** Durable before it is useful: the write completes before the caller may post. */
  async record(id: string): Promise<void> {
    if (this.ids.includes(id)) return;
    this.ids = [...this.ids, id].slice(-this.limit);
    await this.store.save({ version: 1, ids: this.ids });
  }
}

/* ---------- origin guards ---------- */

/** What RoomLink asks before forwarding, and tells after posting. */
export interface OriginGuard {
  /** True when this message was created by the bridge and must never be forwarded back. */
  isOwnOrigin(message: SpaceMessage, bridgeAuthorId: string): boolean;
  /** Reserve (and durably record) the id of the next outbound post; `undefined` = transport picks. */
  claim(): Promise<string | undefined>;
  /** Record the id the server actually stored, in case it ever differs from the claimed one. */
  confirm(id: string): Promise<void>;
}

/** Default, unchanged behaviour: a dedicated bridge account, suppression by author. */
export const authorOriginGuard = (): OriginGuard => ({
  isOwnOrigin: (message, bridgeAuthorId) => message.author_id === bridgeAuthorId,
  claim: async () => undefined,
  confirm: async () => {},
});

export const isOwnPostedId = (id: string, prefix: string, ledger: { has(id: string): boolean }) => ledger.has(id) || (!!prefix && id.startsWith(prefix));

/** Own-account mode: suppression by origin id, so the token owner's manual messages flow through. */
export class OwnAccountGuard implements OriginGuard {
  constructor(private readonly ledger: OutboundLedger, private readonly prefix: string, private readonly newId: () => string = () => crypto.randomUUID()) {}
  static async open(store: LedgerStore, limit: number, prefix: string, newId?: () => string): Promise<OwnAccountGuard> {
    return new OwnAccountGuard(await OutboundLedger.open(store, limit), prefix, newId);
  }
  isOwnOrigin(message: SpaceMessage): boolean { return isOwnPostedId(message.id, this.prefix, this.ledger); }
  async claim(): Promise<string> {
    const id = `${this.prefix}${this.newId()}`;
    await this.ledger.record(id); // write-ahead: recorded before it can ever be read back
    return id;
  }
  async confirm(id: string): Promise<void> { await this.ledger.record(id); }
}
