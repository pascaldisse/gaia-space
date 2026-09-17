import { describe, expect, test } from "bun:test";
import { createCrmSync, type CrmCache, type CrmTransport } from "./crmSync";
import { CRM_CONFLICT, conflictRevision, type CrmDocument } from "./api/crm";
import { createOrganization, seed, type CrmData } from "./crmStore";

const doc = (data: string, revision: number): CrmDocument => ({ data, revision, updatedAt: revision, updatedBy: null });

/** A cache that behaves like localStorage does for this module: `stored` is null until
 *  something has actually been written, `load` always renders something. */
function memoryCache(initial?: CrmData): CrmCache & { current: () => CrmData } {
  let held: CrmData | null = initial ?? null;
  const fallback = seed();
  return { load: () => held ?? fallback, stored: () => held, save: (data) => { held = data; }, current: () => held ?? fallback };
}

function server(initial?: CrmDocument) {
  let stored = initial ?? doc("", 0);
  const calls: Array<{ data: string; baseRevision: number }> = [];
  const transport: CrmTransport = {
    get: async () => stored,
    save: async (data, baseRevision) => {
      calls.push({ data, baseRevision });
      if (baseRevision !== stored.revision) throw new Error(`${CRM_CONFLICT}${stored.revision}`);
      stored = doc(data, stored.revision + 1);
      return stored;
    },
  };
  return { transport, calls, stored: () => stored };
}

/** A document with exactly one organization. `createOrganization` mutates the document
 *  it is handed and returns the record, so the document is what we keep. */
const withOrg = (name: string): CrmData => { const data = seed(); createOrganization(data, { name }); return data; };

describe("first pull", () => {
  test("a stored workspace document wins over whatever this browser cached", async () => {
    const theirs = withOrg("Serverfirma");
    const cache = memoryCache(withOrg("Browserfirma"));
    const sync = createCrmSync(server(doc(JSON.stringify(theirs), 7)).transport, cache);

    const result = await sync.pull();

    expect(result.source).toBe("server");
    expect(result.revision).toBe(7);
    expect(result.data.organizations.map(org => org.name)).toContain("Serverfirma");
    // The cache is rewritten, so a reload paints the workspace document, not the old one.
    expect(cache.current().organizations.map(org => org.name)).toContain("Serverfirma");
    expect(cache.current().organizations.map(org => org.name)).not.toContain("Browserfirma");
  });

  test("an empty server ADOPTS the prototype data this browser still holds", async () => {
    const cache = memoryCache(withOrg("Altbestand"));
    const remote = server();
    const sync = createCrmSync(remote.transport, cache);

    const result = await sync.pull();

    expect(result.source).toBe("adopted");
    expect(sync.revision()).toBe(1);
    expect(JSON.parse(remote.stored().data).organizations.map((org: { name: string }) => org.name)).toContain("Altbestand");
  });

  test("an empty server and a browser that never stored anything adopt NOTHING — the demo seed never claims a workspace", async () => {
    const remote = server();
    const sync = createCrmSync(remote.transport, memoryCache());

    const result = await sync.pull();

    expect(result.source).toBe("empty");
    expect(remote.calls).toHaveLength(0);
    expect(remote.stored().revision).toBe(0);
  });

  test("an unreachable server yields the cache, marked unsynced", async () => {
    const cache = memoryCache(withOrg("Offline GmbH"));
    const sync = createCrmSync({ get: async () => { throw new Error("network"); }, save: async () => { throw new Error("network"); } }, cache);

    const result = await sync.pull();

    expect(result.source).toBe("offline");
    expect(result.data.organizations.map(org => org.name)).toContain("Offline GmbH");
    expect(sync.online()).toBe(false);
  });

  test("a stored document that will not parse never blanks the view", async () => {
    const cache = memoryCache(withOrg("Cachefirma"));
    const sync = createCrmSync(server(doc("{not json", 3)).transport, cache);

    const result = await sync.pull();

    expect(result.source).toBe("offline");
    expect(result.data.organizations.map(org => org.name)).toContain("Cachefirma");
  });
});

describe("push", () => {
  test("saves against the held revision and moves forward", async () => {
    const remote = server(doc(JSON.stringify(seed()), 4));
    const sync = createCrmSync(remote.transport, memoryCache());
    await sync.pull();

    const outcome = await sync.push(withOrg("Neu AG"));

    expect(outcome).toEqual({ status: "saved", revision: 5 });
    expect(remote.calls[remote.calls.length - 1].baseRevision).toBe(4);
  });

  test("a stale write is REFUSED and reports the revision that exists", async () => {
    const remote = server(doc(JSON.stringify(seed()), 4));
    const sync = createCrmSync(remote.transport, memoryCache());
    await sync.pull();
    // Somebody else saves in between.
    const other = createCrmSync(remote.transport, memoryCache());
    await other.pull();
    await other.push(withOrg("Fremde Firma"));

    const outcome = await sync.push(withOrg("Meine Firma"));

    expect(outcome).toEqual({ status: "conflict", revision: 5 });
    // And the other person's document is still the one stored.
    expect(JSON.parse(remote.stored().data).organizations.map((org: { name: string }) => org.name)).toContain("Fremde Firma");
  });

  test("the local edit survives a conflict in the cache — nothing typed is thrown away", async () => {
    const cache = memoryCache();
    const sync = createCrmSync({
      get: async () => doc(JSON.stringify(seed()), 2),
      save: async () => { throw new Error(`${CRM_CONFLICT}9`); },
    }, cache);
    await sync.pull();

    const mine = withOrg("Meine Eingabe");
    const outcome = await sync.push(mine);

    expect(outcome.status).toBe("conflict");
    expect(cache.current().organizations.map(org => org.name)).toContain("Meine Eingabe");
  });

  test("an offline push keeps working locally and says so", async () => {
    const cache = memoryCache();
    const sync = createCrmSync({ get: async () => doc("", 0), save: async () => { throw new Error("fetch failed"); } }, cache);

    const outcome = await sync.push(withOrg("Zug ohne Netz"));

    expect(outcome.status).toBe("offline");
    expect(cache.current().organizations.map(org => org.name)).toContain("Zug ohne Netz");
  });
});

describe("protocol details", () => {
  test("conflictRevision reads the server's number out of any error shape", () => {
    expect(conflictRevision(new Error("crm-conflict:12"))).toBe(12);
    expect(conflictRevision("crm-conflict:0")).toBe(0);
    expect(conflictRevision("permission denied")).toBeNull();
    expect(conflictRevision(undefined)).toBeNull();
  });
});
