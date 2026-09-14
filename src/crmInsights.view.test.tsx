import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { createMemoryAdapter, initRouter, navigate, parsePath, registerViews, route, setAvailableViews } from "./router";
import { dayKey } from "./crmStore";

// Rendered proof for `#/crm/insights`: a REPORT PAGE — charts with axes, legends and
// their own data tables carry it, the four headline cards are a strip of links above
// them, a question the document cannot answer is said in words instead of drawn as an
// empty bar, and the filters (range, owner, measure) change the printed numbers.

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
/** A chart is found by the accessible name of its plot, i.e. by what it reports. */
const report = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLElement>(".chart")].find(chart =>
    (chart.querySelector(".chart-plot")?.getAttribute("aria-label") ?? "").startsWith(label))!;
const columnBy = (chart: HTMLElement, label: string) =>
  [...chart.querySelectorAll<HTMLElement>(".chart-column")]
    .find(column => text(column.querySelector(".chart-column-label")).startsWith(label))!;
const cardBy = (host: HTMLElement, title: string) =>
  cards(host).find(card => card.querySelector(".crm-insight-card-title")?.textContent === title)!;
const text = (element: Element | null | undefined) => (element?.textContent ?? "").replace(/\u00a0/g, " ");
/** Choose a value in one of the page's pill menus, the way a person does. */
const pick = async (host: HTMLElement, menu: string, option: string) => {
  host.querySelector<HTMLElement>(`${menu} button`)!.click();
  await settle();
  [...document.querySelectorAll<HTMLElement>(".pill-menu-list [role='option']")]
    .find(item => text(item).trim() === option)!
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await settle();
};

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

test("the pipeline report is a column chart per configured stage, with an axis", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const plot = report(host, "Offene Pipeline nach Phase");
  const columns = [...plot.querySelectorAll<HTMLElement>(".chart-column")];
  expect(columns).toHaveLength(6);                                  // every configured stage
  const qualified = columnBy(plot, "Qualified");
  expect(text(qualified.querySelector(".chart-column-total"))).toBe("1");
  // An empty stage is shown as empty, never hidden to make the report look fuller.
  expect(columnBy(plot, "Non-Qualified").dataset.empty).toBe("true");
  expect(columnBy(plot, "Qualified").dataset.empty).toBe("false");
  // A real axis: rounded ticks from zero, not a bar scaled to its neighbour.
  // A count axis never ticks in halves: one deal is one, and the axis stops at one.
  expect([...plot.querySelectorAll(".chart-axis-y span")].map(tick => text(tick))).toEqual(["1", "0"]);
  expect(qualified.querySelector<HTMLElement>(".chart-stack")!.style.height).toBe("100%");
});

test("the pipeline measure is selectable, and the table prints all three readings", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const plot = () => report(host, "Offene Pipeline nach Phase");
  // The table is the same report written out: count, value and weighted value at once.
  const row = [...plot().querySelectorAll("tbody tr")].find(item => text(item).startsWith("Angebot erstellt"))!;
  expect(text(row)).toContain("20.000");                            // deal value
  expect(text(row)).toContain("10.000");                            // 50 % weighted
  await pick(host, ".crm-insight-measure", "Gewichteter Wert");
  expect(text(columnBy(plot(), "Angebot erstellt").querySelector(".chart-column-total"))).toContain("10 Tsd");
  expect(text(plot().querySelector(".chart-axis-y span"))).toContain("10 Tsd");
});

test("the owner report stacks the actual outcomes per person, with a legend", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const plot = report(host, "Deal-Ausgang nach verantwortlicher Person");
  const rows = [...plot.querySelectorAll<HTMLElement>(".chart-bar")];
  expect(rows.map(row => text(row.querySelector(".chart-bar-label")))).toEqual(["Bjarne", "Jannes"]);
  expect(text(rows[1].querySelector(".chart-bar-value"))).toBe("1 offen · 1 gewonnen · 0 verloren");
  // Outcome semantics are kept: one segment per outcome, in the app's own palette.
  expect([...rows[1].querySelectorAll(".chart-stack i")].map(part => part.getAttribute("data-tone"))).toEqual(["open", "won"]);
  expect([...plot.querySelectorAll(".chart-legend li")].map(item => text(item))).toEqual(["Offen", "Gewonnen", "Verloren"]);
  // The plot speaks one summary sentence rather than dozens of bar elements.
  expect(plot.querySelector(".chart-plot")!.getAttribute("aria-label")).toContain("Jannes: 1 offen, 1 gewonnen, 0 verloren");
});

test("activities are stacked columns of done versus open, by kind and by state", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const kinds = report(host, "Aktivitäten nach Art, erledigt und offen");
  expect([...kinds.querySelectorAll(".chart-legend li")].map(item => text(item))).toEqual(["Offen", "Erledigt"]);
  const call = columnBy(kinds, "Anruf");
  expect(text(call.querySelector(".chart-column-total"))).toBe("1");
  expect([...call.querySelectorAll(".chart-stack i")].map(part => part.getAttribute("data-tone"))).toEqual(["open"]);
  expect(columnBy(kinds, "Besuch").dataset.empty).toBe("true");
  const states = report(host, "Aktivitäten nach Status");
  expect(text(columnBy(states, "Überfällig").querySelector(".chart-column-total"))).toBe("1");
  expect(text(columnBy(states, "Erledigt").querySelector(".chart-column-total"))).toBe("0");
});

test("a chart column links into the records it counts", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  columnBy(report(host, "Offene Pipeline nach Phase"), "Qualified").querySelector<HTMLElement>("button")!.click();
  await settle();
  expect(route().tab).toBe("pipeline");
});

test("the owner filter narrows every printed number", async () => {
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  await pick(host, ".crm-insight-owner", "Bjarne");
  // Bjarne has one lost and one open deal: no won value, a 0% rate, 20.000 gross open.
  expect(text(cardBy(host, "Gewonnener Deal-Wert"))).toContain("Kein gewonnener Deal");
  expect(text(cardBy(host, "Gewinnquote").querySelector(".crm-insight-card-value"))).toBe("0 %");
  expect(text(cardBy(host, "Gewichtete offene Pipeline"))).toContain("20.000");
});

test("no data is said out loud, never drawn as empty bars or dead buttons", async () => {
  seedWith(EMPTY);
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  expect(cardBy(host, "Gewinnquote").dataset.empty).toBe("true");
  expect(text(cardBy(host, "Gewinnquote"))).toContain("Noch kein Deal gewonnen oder verloren");
  expect(cardBy(host, "Gewinnquote").querySelector(".crm-insight-card-value")).toBeNull();
  // Four charts, four spoken no-data sentences — and not one bar, axis or button.
  const empties = [...host.querySelectorAll(".chart-empty")].map(item => text(item));
  expect(empties).toHaveLength(4);
  expect(empties[0]).toContain("Keine offenen Deals in diesem Zeitraum");
  expect(empties[1]).toContain("Für diesen Zeitraum und Filter gibt es keine Deals");
  expect(host.querySelectorAll(".chart-plot")).toHaveLength(0);
  expect(host.querySelectorAll(".chart-column, .chart-bar, .chart-data")).toHaveLength(0);
});

test("deals in several currencies are never merged into one € figure", async () => {
  seedWith({
    ...DOC,
    deals: [
      deal({ id: 1, stage: "Qualified", value: "10000", currency: "EUR" }),
      deal({ id: 2, stage: "Qualified", value: "20000", currency: "CHF" }),
      deal({ id: 3, status: "Gewonnen", value: "30000", currency: "USD", closedAt: iso(-3) }),
      deal({ id: 4, status: "Gewonnen", value: "5000", currency: "EUR", closedAt: iso(-3) }),
    ],
  });
  navigate({ view: "CRM", tab: "insights" });
  const host = mount();
  await settle();
  const won = cardBy(host, "Gewonnener Deal-Wert");
  expect(text(won.querySelector(".crm-insight-card-value"))).toBe("Gemischte Währungen");
  expect(text(won)).toContain("5.000 €");
  expect(text(won)).toContain("30.000 USD");
  expect(text(won)).not.toContain("35.000");                      // the old, false total
  const pipeline = cardBy(host, "Gewichtete offene Pipeline");
  expect(text(pipeline.querySelector(".crm-insight-card-value"))).toBe("Gemischte Währungen");
  expect(text(pipeline)).toContain("10.000 €");
  expect(text(pipeline)).toContain("20.000 CHF");
  // A money AXIS cannot exist across currencies, so the chart counts and says why.
  expect(text(host.querySelector(".crm-insight-currency-note"))).toContain("Gemischte Währungen");
  const row = [...report(host, "Offene Pipeline nach Phase").querySelectorAll("tbody tr")]
    .find(item => text(item).startsWith("Qualified"))!;
  expect(text(row)).toContain("10.000 €");
  expect(text(row)).toContain("20.000 CHF");
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
