/** ── END-TO-END: the real client against the real server ──────────────────────
 *  Both halves of the shared CRM were built against a frozen contract, each with the
 *  other half mocked. This test is the only place they MEET: the untouched frontend
 *  modules (`api/crm.ts`, `crmSync.ts`) talk over HTTP to a running `space-server`,
 *  as two different logged-in people.
 *
 *  It runs only when SPACE_E2E names that server, so the normal suite stays offline. */
import { expect, test, describe, mock } from "bun:test";

const BASE = process.env.SPACE_E2E ?? "";
const JANNES = process.env.SPACE_E2E_COOKIE_A ?? "";
const BJARNE = process.env.SPACE_E2E_COOKIE_B ?? "";

/** The person whose session the next invoke runs under. */
let cookie = JANNES;

/** The web build's transport, narrowed to what this proof needs: POST the args object
 *  to /api/cmd/<name>, unwrap {ok,value}, carry a session cookie. */
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const response = await fetch(`${BASE}/api/cmd/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(args ?? {}),
    });
    const body = await response.json();
    if (!response.ok || body?.ok === false) throw new Error(body?.error ?? `HTTP ${response.status}`);
    return body.value ?? body;
  },
}));

const { crmApi, isEmptySnapshot } = await import("./api/crm");
const { snapshotToCrmData, crmWriteFor, crmDataToPut } = await import("./crmSync");
const { normalize, emptyOrganization, emptyDeal } = await import("./crmStore");

const as = (who: string) => { cookie = who; };
const run = BASE ? describe : describe.skip;

run("the shared CRM, end to end", () => {
  test("two people write different records over HTTP and both survive, verbatim", async () => {
    as(JANNES);
    const first = await crmApi.snapshot();
    expect(isEmptySnapshot(first)).toBe(true);
    expect(first.revision).toBe(0);

    // Jannes creates an organization with a deal — through the SAME shape the store
    // would send, not a hand-written payload.
    const doc = normalize({ version: 2, organizations: [], deals: [] });
    const org = emptyOrganization("Optik Sonnenschein GmbH", "Jannes");
    doc.organizations.push(org);
    const deal = emptyDeal(org.id, "Sonnenschein · Gründungskunde", "Jannes");
    deal.value = "12.500";
    doc.deals.push(deal);
    await crmApi.putRecords(crmDataToPut(doc));

    // Bjarne, a DIFFERENT session, sees it and adds a second deal.
    as(BJARNE);
    const seen = await crmApi.snapshot();
    expect(seen.organizations).toHaveLength(1);
    expect(seen.deals).toHaveLength(1);
    const mine = snapshotToCrmData(seen);
    expect(mine.organizations[0].name).toBe("Optik Sonnenschein GmbH");
    // The value survived the round trip as WRITTEN — the server does not re-model it.
    expect(mine.deals[0].value).toBe("12.500");

    const next = normalize(JSON.parse(JSON.stringify(mine)));
    const second = emptyDeal(next.organizations[0].id, "Sonnenschein · Filiale Mitte", "Bjarne");
    next.deals.push(second);
    const write = crmWriteFor(mine, next);
    // The whole point: Bjarne's write names ONE deal, not the whole CRM.
    expect(write.put.deals).toHaveLength(1);
    expect(write.put.organizations ?? []).toHaveLength(0);
    await crmApi.putRecords(write.put);

    // Jannes' original deal is untouched by Bjarne's write.
    as(JANNES);
    const together = await crmApi.snapshot();
    expect(together.deals).toHaveLength(2);
    const titles = snapshotToCrmData(together).deals.map((d) => d.title).sort();
    expect(titles).toEqual(["Sonnenschein · Filiale Mitte", "Sonnenschein · Gründungskunde"]);
    expect(together.revision).toBeGreaterThan(first.revision);

    // And the owner strings inside the payloads were NOT rewritten to the session.
    const owners = snapshotToCrmData(together).deals.map((d) => d.owner).sort();
    expect(owners).toEqual(["Bjarne", "Jannes"]);
  });

  test("a record without an id is refused, and nothing is written", async () => {
    as(JANNES);
    const before = await crmApi.snapshot();
    await expect(crmApi.putRecords({ deals: [{ title: "namenlos" } as any] })).rejects.toThrow(/crm record without id/);
    const after = await crmApi.snapshot();
    expect(after.deals).toHaveLength(before.deals.length);
    expect(after.revision).toBe(before.revision);
  });

  test("an unauthenticated caller gets nothing", async () => {
    as("");
    await expect(crmApi.snapshot()).rejects.toThrow();
  });
});
