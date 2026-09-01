import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import Finance, { deviationTone, euro, monthsBetween, parseEuroToCents, readViewState } from "./Finance";

/** The view is mounted against a stubbed command bridge (the same one `leads.view.test`
 *  uses), so what is asserted here is the VIEW's behaviour — never the database's. */
const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const calls: { url: string; body: unknown }[] = [];
const settle = () => new Promise(done => setTimeout(done, 30));

const ACCESS = { allowed: true, profile_id: "p-jannes", reason: null, missing: ["Charles"] };
const planRow = (over: Partial<Record<string, unknown>>) => ({
  id: "pl", category: "Beispielkosten", item: "Beispielposten A", month: "2026-09", planned_cents: -25_000,
  kind: "cost", optional: false, estimated: false, assumption: null,
  source_file: "beispiel.html", source_block: "Beispielkosten", source_detail: "Beispielzeile",
  ...over,
});
const PLAN = [
  planRow({ id: "pl-1" }),
  planRow({ id: "pl-2", month: "2026-10", planned_cents: -25_000 }),
  planRow({ id: "pl-3", category: "Beispielblock", item: "Beispielposten", month: "2026-10", planned_cents: -6_000, estimated: true, assumption: "Monat nicht im Dokument; hier angenommen." }),
  planRow({ id: "pl-4", category: "Beispielumsatz", item: "Beispielerlös", month: "2026-09", planned_cents: 70_000, kind: "revenue" }),
];
const ENTRIES = [
  { id: "e-1", entry_date: "2026-09-04", description: "Beispielbeleg", category: "Beispielkosten", amount_cents: -12_000, currency: "EUR", source: "splitwise", external_id: "sw-1" },
  { id: "e-2", entry_date: "2026-09-18", description: "Werkzeug-Abo", category: "Werkzeuge", amount_cents: -6_000, currency: "EUR", source: "manual", external_id: null },
];

beforeEach(() => { globalThis.localStorage?.clear?.(); });
afterEach(() => { dispose?.(); dispose = undefined; calls.length = 0; document.body.innerHTML = ""; globalThis.fetch = realFetch; globalThis.localStorage?.clear?.(); });

function mount(replies: Record<string, unknown>) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const command = String(url).split("/").pop() ?? "";
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!(command in replies)) return new Response(JSON.stringify({ ok: false, error: `no stub for ${command}` }), { status: 500, headers: { "content-type": "application/json" } });
    const value = replies[command];
    return new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Finance /> as any, host);
  return host;
}

const allowedStubs = {
  finance_access_check: ACCESS,
  list_finance_plan: PLAN,
  list_finance_entries: ENTRIES,
  list_finance_access: [{ profile_id: "p-jannes", display_name: "Jannes Zude", username: "jannes" }],
};

const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === label) as HTMLButtonElement;
const cell = (host: HTMLElement, selector: string, month: string) =>
  host.querySelector(`${selector} td[data-month="${month}"]`) as HTMLTableCellElement;

test("a person without finance access is told so, and sees no money at all", async () => {
  const host = mount({ finance_access_check: { allowed: false, profile_id: "p-x", reason: "Finance is restricted to its named owners", missing: [] } });
  await settle();
  expect(host.textContent).toContain("Finance is restricted to its named owners");
  expect(host.querySelector("table")).toBeNull();
  expect(calls.some(call => call.url.endsWith("list_finance_entries"))).toBe(false);
});

test("the matrix carries one column per month and one row per category", async () => {
  const host = mount(allowedStubs);
  await settle();
  const headers = [...host.querySelectorAll(".finance-matrix thead th")].map(node => node.textContent?.trim());
  expect(headers[0]).toContain("Kategorie");
  expect(headers.length).toBe(10); // Aug 2026 … Mär 2027 plus the name column and Σ
  expect(headers[headers.length-1]).toBe("Σ");
  const categories = [...host.querySelectorAll(".finance-category")].map(row => row.getAttribute("data-category"));
  expect(categories).toContain("Beispielkosten");
  expect(categories).toContain("Beispielumsatz");
  // Costs and revenue are SEPARATE blocks, not one column mixed by its sign.
  expect([...host.querySelectorAll(".finance-block")].map(node => node.getAttribute("data-kind"))).toEqual(["cost", "revenue"]);
});

test("a category unfolds into the document's named positions, with its flags", async () => {
  const host = mount(allowedStubs);
  await settle();
  expect(host.querySelector('.finance-item[data-item="Beispielposten"]')).toBeNull();
  const disclose = [...host.querySelectorAll(".finance-disclose")].find(node => node.textContent?.includes("Beispielblock")) as HTMLButtonElement;
  expect(disclose.getAttribute("aria-expanded")).toBe("false");
  disclose.click();
  await settle();
  const item = host.querySelector('.finance-item[data-item="Beispielposten"]') as HTMLElement;
  expect(item).toBeTruthy();
  // The flags are ONE quiet sign now — the words live in its tooltip, so the name
  // of the position is what the eye meets first.
  const marks = [...item.querySelectorAll(".finance-mark")];
  expect(marks.length).toBe(1);
  expect(marks[0].getAttribute("title")).toContain("geschätzt");
  expect(marks[0].getAttribute("title")).toContain("Annahme");
  expect(item.textContent).not.toContain("GESCHÄTZT");
  expect(disclose.getAttribute("aria-expanded")).toBe("true");
});

test("an optional block stands outside the reckoning until the switch takes it in", async () => {
  const salary = (month: string, cents: number) =>
    planRow({ id: `sal-${month}`, category: "Optionalblock", item: "Optionaler Posten", month, planned_cents: cents, optional: true });
  const host = mount({
    ...allowedStubs,
    list_finance_entries: [],
    // INVENTED figures: 600 € other costs, 1.400 € optional, 9.000 € revenue.
    list_finance_plan: [
      planRow({ id: "c-1", category: "Beispielkosten", item: "Beispielposten A", month: "2026-09", planned_cents: -60_000 }),
      salary("2026-10", -140_000),
      planRow({ id: "r-1", category: "Beispielumsatz", item: "Beispielerlös", month: "2026-09", planned_cents: 900_000, kind: "revenue" }),
    ],
  });
  await settle();
  const totals = () => ({
    costs: (host.querySelector('.finance-block-total[data-total="cost"] .finance-sum') as HTMLElement).textContent ?? "",
    other: (host.querySelector('.finance-total-other[data-total-other="cost"] .finance-sum') as HTMLElement).textContent ?? "",
    balance: (host.querySelector(".finance-grand-total .finance-sum") as HTMLElement).textContent ?? "",
  });
  // DEFAULT: the optional block is out — costs 600 €, balance +8.400 € — and the
  // other reading stands right below it instead of being hidden.
  expect(totals().costs.replace(/\s/g, "")).toContain("600");
  expect(totals().other.replace(/\s/g, "")).toContain("2.000");
  expect(totals().balance.replace(/\s/g, "")).toContain("8.400");
  // The excluded row is still THERE, marked as not counted.
  const salaries = host.querySelector('.finance-category[data-category="Optionalblock"]') as HTMLElement;
  expect(salaries.className).toContain("finance-excluded");
  expect(cell(host, '.finance-category[data-category="Optionalblock"]', "2026-10").textContent).toContain("1.400");
  // The switch takes them back in — and the two readings trade places.
  const toggle = host.querySelector(".finance-optional-toggle") as HTMLButtonElement;
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  toggle.click();
  await settle();
  expect(totals().costs.replace(/\s/g, "")).toContain("2.000");
  expect(totals().other.replace(/\s/g, "")).toContain("600");
  expect(totals().balance.replace(/\s/g, "")).toContain("7.000");
  expect((host.querySelector('.finance-category[data-category="Optionalblock"]') as HTMLElement).className).not.toContain("finance-excluded");
  // And the choice outlives a reload, like every other switch in this view.
  expect(readViewState()).toMatchObject({ withOptional: true });
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  const again = mount(allowedStubs);
  await settle();
  expect((again.querySelector(".finance-optional-toggle") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
});

test("every row of the matrix measures its months against the same column axis", async () => {
  const host = mount(allowedStubs);
  await settle();
  // The width comes from the colgroup, not from what is written in a row: one col
  // per month, all the same, so no bold total can widen its own column.
  const cols = [...host.querySelectorAll(".finance-matrix colgroup col")].map(node => node.className);
  expect(cols[0]).toBe("finance-col-name");
  expect(cols.filter(name => name === "finance-col-month").length).toBe(8);
  expect(cols[cols.length - 1]).toBe("finance-col-sum");
  // Every kind of row carries a cell for the SAME month, in the same table.
  const rows = [".finance-category", ".finance-item", ".finance-block-total", ".finance-grand-total"];
  ([...host.querySelectorAll(".finance-disclose")][0] as HTMLButtonElement).click();
  await settle();
  for (const selector of rows) {
    const row = host.querySelector(selector) as HTMLElement;
    const cells = [...row.querySelectorAll("td")];
    expect(cells.length).toBe(9); // eight months plus Σ
    expect(cells.every(node => node.className.includes("finance-num"))).toBe(true);
  }
});

test("Plan · Ist · Abweichung are three different readings of the same cell", async () => {
  const host = mount(allowedStubs);
  await settle();
  const travel = '.finance-category[data-category="Beispielkosten"]';
  expect(cell(host, travel, "2026-09").textContent).toContain("250");
  button(host, "Ist").click();
  await settle();
  expect(cell(host, travel, "2026-09").textContent).toContain("120");
  button(host, "Abweichung").click();
  await settle();
  expect(cell(host, travel, "2026-09").textContent).toContain("130");
});

test("a month without an actual carries no colour, in any reading", async () => {
  const host = mount(allowedStubs);
  await settle();
  button(host, "Abweichung").click();
  await settle();
  const travel = '.finance-category[data-category="Beispielkosten"]';
  // September has a booking and is under plan → teal. October has none → silent.
  expect(cell(host, travel, "2026-09").className).toContain("tone-teal");
  expect(cell(host, travel, "2026-10").className).not.toContain("tone-");
  expect(cell(host, travel, "2026-10").textContent).toBe("·");
  // And in the plan reading nothing is coloured at all.
  button(host, "Plan").click();
  await settle();
  expect(cell(host, travel, "2026-09").className).not.toContain("tone-");
});

test("costs and revenue can be looked at apart", async () => {
  const host = mount(allowedStubs);
  await settle();
  button(host, "Kosten").click();
  await settle();
  expect([...host.querySelectorAll(".finance-category")].map(row => row.getAttribute("data-category"))).not.toContain("Beispielumsatz");
  button(host, "Umsatz").click();
  await settle();
  const only = [...host.querySelectorAll(".finance-category")].map(row => row.getAttribute("data-category"));
  expect(only).toEqual(["Beispielumsatz"]);
  button(host, "Beides").click();
  await settle();
  expect([...host.querySelectorAll(".finance-category")].length).toBeGreaterThan(1);
});

test("the single month stays one of the views, and the range is choosable", async () => {
  const host = mount(allowedStubs);
  await settle();
  button(host, "Einzelmonat").click();
  await settle();
  expect(host.querySelector(".finance-matrix")).toBeNull();
  expect(host.querySelector('input[aria-label="Month"]')).toBeTruthy();
  button(host, "Monatsmatrix").click();
  await settle();
  const to = host.querySelector('input[aria-label="To month"]') as HTMLInputElement;
  to.value = "2026-10";
  // Solid delegates `input` at the document: an event that does not bubble is an
  // event the view never hears.
  to.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  expect([...host.querySelectorAll(".finance-matrix thead th")].length).toBe(5); // name + Aug/Sep/Okt + Σ
});

test("the chosen view outlives a reload", async () => {
  const host = mount(allowedStubs);
  await settle();
  button(host, "Abweichung").click();
  button(host, "Kosten").click();
  button(host, "Einzelmonat").click();
  await settle();
  expect(readViewState()).toMatchObject({ layout: "month", mode: "deviation", scope: "cost" });
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  const again = mount(allowedStubs);
  await settle();
  expect((button(again, "Abweichung")).getAttribute("aria-pressed")).toBe("true");
  expect((button(again, "Kosten")).getAttribute("aria-pressed")).toBe("true");
  expect(again.querySelector(".finance-matrix")).toBeNull();
});

test("a plan cell is corrected in the view and saved through the upsert command", async () => {
  const host = mount({ ...allowedStubs, upsert_finance_plan: planRow({ id: "pl-3", category: "Beispielblock", item: "Beispielposten", month: "2026-10", planned_cents: -9_900 }) });
  await settle();
  ([...host.querySelectorAll(".finance-disclose")].find(node => node.textContent?.includes("Beispielblock")) as HTMLButtonElement).click();
  await settle();
  const target = host.querySelector('.finance-item[data-item="Beispielposten"] td[data-month="2026-10"] .finance-cell-edit') as HTMLButtonElement;
  expect(target.textContent).toContain("60");
  target.click();
  await settle();
  const input = host.querySelector(".finance-cell-input") as HTMLInputElement;
  input.value = "-99";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
  const sent = calls.find(call => call.url.endsWith("upsert_finance_plan"))?.body as { row: Record<string, unknown> };
  expect(sent.row).toMatchObject({ id: "pl-3", category: "Beispielblock", item: "Beispielposten", month: "2026-10", planned_cents: -9_900, kind: "cost" });
});

test("a deviation of exactly zero carries no colour", () => {
  expect(deviationTone(-25_000, -25_000)).toBe("");
  expect(deviationTone(0, 0)).toBe("");
  // A cost: 10 % under is comfortable, on the line is amber, above it is red.
  expect(deviationTone(-10_000, -8_000)).toBe("teal");
  expect(deviationTone(-10_000, -9_500)).toBe("amber");
  expect(deviationTone(-10_000, -12_000)).toBe("red");
  // Revenue is judged in the other direction, by the same question.
  expect(deviationTone(10_000, 10_000)).toBe("");
  expect(deviationTone(10_000, 12_000)).toBe("teal");
  expect(deviationTone(10_000, 9_500)).toBe("amber");
  expect(deviationTone(10_000, 4_000)).toBe("red");
});

test("importing a CSV reports its result in one line and never duplicates silently", async () => {
  const host = mount({ ...allowedStubs, import_splitwise_csv: { imported: 2, skipped_duplicates: 3, errors: [] } });
  await settle();
  // The row shows a button in the same skin as its neighbours; the browser's file
  // widget is hidden machinery behind it.
  const importer = [...host.querySelectorAll("button")].find(node => node.textContent?.includes("Import Splitwise CSV"));
  expect(importer).toBeTruthy();
  const picker = host.querySelector('input[type="file"][aria-label="Splitwise CSV"]') as HTMLInputElement;
  expect(picker).toBeTruthy();
  expect(picker.className).toContain("finance-csv-input");
  expect(host.textContent).not.toContain("no file selected");
  const file = new File(["Date,Description,Category,Cost,Currency\n2026-09-01,Bahn,Transport,12.50,EUR\n"], "export.csv", { type: "text/csv" });
  Object.defineProperty(picker, "files", { value: [file] });
  picker.dispatchEvent(new Event("change"));
  await settle();
  const sent = calls.find(call => call.url.endsWith("import_splitwise_csv"));
  expect((sent?.body as { csvText: string })?.csvText).toContain("Bahn");
  expect(host.querySelector(".finance-notice")?.textContent).toContain("2 imported");
  expect(host.textContent).toContain("3 already known");
});

test("importing a plan file reports its result in one line, next to the CSV import", async () => {
  const host = mount({
    ...allowedStubs,
    import_finance_plan: { inserted: 4, updated: 0, skipped: 2, categories: 2, positions: 3, errors: [] },
  });
  await settle();
  const importer = [...host.querySelectorAll("button")].find(node => node.textContent?.includes("Plan importieren"));
  expect(importer).toBeTruthy();
  const picker = host.querySelector('input[type="file"][aria-label="Finanzplan JSON"]') as HTMLInputElement;
  expect(picker).toBeTruthy();
  expect(picker.className).toContain("finance-csv-input");
  const file = new File(['{"version":1,"positions":[]}'], "finanzplan.json", { type: "application/json" });
  Object.defineProperty(picker, "files", { value: [file] });
  picker.dispatchEvent(new Event("change"));
  await settle();
  const sent = calls.find(call => call.url.endsWith("import_finance_plan"));
  expect((sent?.body as { payloadJson: string })?.payloadJson).toContain("\"version\":1");
  const notice = host.querySelector(".finance-notice")?.textContent ?? "";
  expect(notice).toContain("4 neu");
  expect(notice).toContain("2 unver\u00e4ndert");
});

test("without a plan the view says what to do in one line, not in a box", async () => {
  const host = mount({ ...allowedStubs, list_finance_plan: [] });
  await settle();
  const lines = [...host.querySelectorAll(".finance-notice")].map(node => node.textContent ?? "");
  expect(lines.some(text => text.includes("Noch kein Plan") && text.includes("Plan importieren"))).toBe(true);
  // ONE line, no box: the sentence is a paragraph and sits outside every card.
  const hint = [...host.querySelectorAll("p.finance-notice")].find(node => node.textContent?.includes("Noch kein Plan"));
  expect(hint?.closest(".paper-card")).toBeFalsy();
});

test("the bookings table sorts by date in both directions", async () => {
  const host = mount(allowedStubs);
  await settle();
  const dates = () => [...host.querySelectorAll(".finance-bookings tbody time")].map(node => node.textContent);
  expect(dates()).toEqual(["2026-09-18", "2026-09-04"]);
  (host.querySelector(".finance-sort") as HTMLButtonElement).click();
  await settle();
  expect(dates()).toEqual(["2026-09-04", "2026-09-18"]);
});

test("a finance owner without a profile is named, not swallowed", async () => {
  const host = mount(allowedStubs);
  await settle();
  expect(host.textContent).toContain("Charles");
});

test("amounts are rendered as euro, out as a negative amount", () => {
  expect(euro(-25_000)).toContain("250");
  expect(euro(-25_000).startsWith("-")).toBe(true);
});

test("a month range is a list of months, a typed amount is cents", () => {
  expect(monthsBetween("2026-08", "2027-03")).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  expect(monthsBetween("2026-08", "2026-08")).toEqual(["2026-08"]);
  expect(parseEuroToCents("-1.234,50")).toBe(-123_450);
  expect(parseEuroToCents("250")).toBe(25_000);
  expect(parseEuroToCents("−250 €")).toBe(-25_000);
  expect(parseEuroToCents("weiß nicht")).toBeUndefined();
});

test("with no booking at all there is no actual and no deviation to claim", async () => {
  const host = mount({ ...allowedStubs, list_finance_entries: [] });
  await settle();
  const chips = [...host.querySelectorAll(".metric-pill")].map(node => node.textContent ?? "");
  expect(chips).toContain("· actual");
  expect(chips).toContain("· deviation");
  expect(chips.some(text => text.includes(" plan"))).toBe(true);
});
