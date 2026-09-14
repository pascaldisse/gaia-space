import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, parsePath, registerViews, route, setAvailableViews } from "./router";
import { dayKey } from "./crmStore";

// Rendered proof for `#/crm/insights`: four headline cards that are LINKS, three reports
// drawn from the document itself, an explicit no-data state where the data cannot answer,
// and filters (range, owner) that actually change the printed numbers.

const at = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return dayKey(date); };
const iso = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString(); };
const ORG = { id: "org-1", name: "Optik Nord", website: "", employees: "", decisionMaker: "", software: "", source: "", owner: "Jannes", labels: [], locations: [], createdAt: iso(-40), deletedAt: null };
const deal = (values: Record<string, unknown>) => ({
  id: `deal-${values.id}`, organizationId: "org-1", locationId: null, title: `Deal ${values.id}`, stage: "Qualified",
  status: "Offen", owner: "Jannes", source: "", value: "10000", currency: "EUR", expectedClose: "", labels: [],
  nextStep: "", nextStepDate: "", notes: [], activities: [], files: [], createdAt: iso(-5), stageEnteredAt: iso(-5),
  closedAt: null, deletedAt: null, ...values,
});
const DOC = {
  version: 2, organizations: [ORG], labels: [], pipelineStages: [], activities: [],
  deals: [
    deal({ id: 1, stage: "Qualified", value: "10000" }),
    deal({ id: 2, stage: "Angebot erstellt", value: "20000", owner: "Bjarne" }),
    deal({ id: 3, status: "Gewonnen", value: "30000", closedAt: iso(-3), activities: [{ id: "a1", kind: "Anruf", title: "Rückruf", dueDate: at(-2), owner: "Jannes", done: false }] }),
    deal({ id: 4, status: "Verloren", value: "5000", closedAt: iso(-4), owner: "Bjarne" }),
  ],
};
const EMPTY = { version: 2, organizations: [], deals: [], labels: [], pipelineStages: [], activities: [] };

let dispose: (() => void) | undefined;
const settle = () => new Promise(done => setTimeout(done, 10));

const seedWith = (doc: unknown) => {
  localStorage.clear();
  localStorage.setItem("gaia.crm.prototype.v2", JSON.stringify(doc));
  registerViews(["Dashboard", "CRM"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("crm/insights"));
};
beforeEach(() => seedWith(DOC));
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; localStorage.clear(); });

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}

const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".crm-insight-card")];
const cardBy = (host: HTMLElement, title: string) =>
  cards(host).find(card => card.querySelector(".crm-insight-card-title")?.textContent === title)!;
const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\u00a0/g, " ");

test("the route `crm/insights` is real and carries its own tab", () => {
  expect(parsePath("crm/insights")).toMatchObject({ view: "CRM", tab: "insights" });
  // Shipped spellings of a report page resolve here rather than dying on the pipeline.
  expect(parsePath("crm/reports")).toMatchObject({ view: "CRM", tab: "insights" });
});

test("the workspace prints the four counted headline numbers", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  expect(host.querySelector(".crm-insights h2")?.textContent).toBe("Einblicke");
  expect(cards(host)).toHaveLength(4);
  // 30.000 won in the last 90 days — the actual sum of the one won deal.
  expect(text(cardBy(host, "Gewonnener Deal-Wert").querySelector(".crm-insight-card-value"))).toContain("30.000");
  // Qualified 20% of 10.000 + Angebot erstellt 50% of 20.000 = 12.000 weighted.
  expect(text(cardBy(host, "Gewichtete offene Pipeline").querySelector(".crm-insight-card-value"))).toContain("12.000");
  expect(text(cardBy(host, "Gewichtete offene Pipeline"))).toContain("30.000"); // gross, stated as a hint
  expect(text(cardBy(host, "Gewinnquote").querySelector(".crm-insight-card-value"))).toBe("50 %");
  expect(text(cardBy(host, "Offene Aktivitäten").querySelector(".crm-insight-card-value"))).toBe("1");
});

test("a card is a link into the CRM view that owns its records", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  cardBy(host, "Gewonnener Deal-Wert").click();
  await settle();
  expect(route().tab).toBe("won");
  expect(host.querySelector(".crm-deal-directory h2")?.textContent).toBe("Gewonnene Deals");
});

test("the pipeline report counts real deals per configured stage and weights them", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const bars = [...host.querySelectorAll<HTMLElement>(".crm-insight-report .crm-insight-bar")];
  const qualified = bars.find(bar => text(bar.querySelector(".crm-insight-bar-label")).startsWith("Qualified"))!;
  expect(text(qualified.querySelector(".crm-insight-bar-value"))).toContain("1");
  expect(text(qualified.querySelector(".crm-insight-bar-value"))).toContain("10.000");
  expect(text(qualified.querySelector(".crm-insight-bar-value"))).toContain("2.000"); // 20% weighted
  // An empty stage is shown as empty, never hidden to make the report look fuller.
  const nonQualified = bars.find(bar => text(bar.querySelector(".crm-insight-bar-label")).startsWith("Non-Qualified"))!;
  expect(nonQualified.dataset.empty).toBe("true");
});

test("the owner report splits the actual outcomes per person", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const rows = [...host.querySelectorAll<HTMLElement>(".crm-insight-owner-row")];
  expect(rows.map(row => text(row.querySelector(".crm-insight-bar-label")))).toEqual(["Bjarne", "Jannes"]);
  expect(text(rows[1])).toContain("1 offen");
  expect(text(rows[1])).toContain("1 gewonnen");
});

test("the owner filter narrows every printed number", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const owner = host.querySelector<HTMLElement>(".crm-insight-owner button")!;
  owner.click();
  await settle();
  const option = [...document.querySelectorAll<HTMLElement>(".pill-menu-list [role='option']")].find(item => text(item).trim() === "Bjarne")!;
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
  // Bjarne has one lost and one open deal: no won value, a 0% rate, 20.000 gross open.
  expect(text(cardBy(host, "Gewonnener Deal-Wert"))).toContain("Kein gewonnener Deal");
  expect(text(cardBy(host, "Gewinnquote").querySelector(".crm-insight-card-value"))).toBe("0 %");
  expect(text(cardBy(host, "Gewichtete offene Pipeline"))).toContain("20.000");
});

test("no data is said out loud, never printed as a measured zero", async () => {
  seedWith(EMPTY);
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  expect(cardBy(host, "Gewinnquote").dataset.empty).toBe("true");
  expect(text(cardBy(host, "Gewinnquote"))).toContain("Noch kein Deal gewonnen oder verloren");
  expect(cardBy(host, "Gewinnquote").querySelector(".crm-insight-card-value")).toBeNull();
  expect(text(host.querySelector(".crm-insights"))).toContain("Keine offenen Deals in diesem Zeitraum");
  expect(text(host.querySelector(".crm-insights"))).toContain("Für diesen Zeitraum und Filter gibt es keine Deals");
});

test("the sales reports stay inside the CRM: the record toolbar is not drawn here", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  expect(host.querySelector(".crm-toolbar .crm-search")).toBeNull();   // the view owns its own filters
  expect(host.querySelector(".crm-insight-filters")).not.toBeNull();
  navigate({ view: "CRM", tab: "pipeline" });
  await settle();
  expect(host.querySelector(".crm-toolbar .crm-search")).not.toBeNull();
  expect(host.querySelector(".crm-insights")).toBeNull();
});
