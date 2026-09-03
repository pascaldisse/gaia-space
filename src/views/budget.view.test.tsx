import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import Budget, { currentDate } from "./Budget";
import { emptyBudget } from "../api/budget";
import type { Document } from "../api/documents";

let dispose: (() => void) | undefined;
const realFetch = globalThis.fetch;
const calls: { command: string; body: Record<string, unknown> }[] = [];
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
const DOC: Document = {
  id: "budget-1", container_type: "project", container_id: "project-1", folder_id: null,
  doc_type: "text", body_format: "text", kind: "budget", title: "Household", body: null,
  version: 1, archived: false, created_by: "p-me",
};
const PROFILES = [
  { id: "p-me", username: "me", display_name: "Me" },
  { id: "p-other", username: "other", display_name: "Other" },
];
const STATEMENT = {
  month: currentDate().slice(0, 7), currency: "EUR", total_cents: 1234, rows_counted: 1,
  members: [
    { profile_id: "p-me", name: "Me", paid_cents: 1234, share_cents: 617, net_cents: 617 },
    { profile_id: "p-other", name: "Other", paid_cents: 0, share_cents: 617, net_cents: -617 },
  ],
  transfers: [{ from: "p-other", to: "p-me", cents: 617 }],
};

function mount(replies: Record<string, unknown>, onReload = async () => {}, onOpenDocument: (id: string) => void = () => {}) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const command = String(url).split("/").pop() ?? "";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    calls.push({ command, body });
    if (!(command in replies)) return new Response(JSON.stringify({ ok: false, error: `no stub for ${command}` }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, value: replies[command] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Budget document={DOC} budget={emptyBudget(["p-me", "p-other"])} profiles={PROFILES} profileId="p-me" onChange={() => {}} onReload={onReload} onOpenDocument={onOpenDocument} /> as any, host);
  return host;
}
function input(host: HTMLElement, label: string, value: string) {
  const field = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; globalThis.fetch = realFetch; });

test("quick-add sends today, the session profile, and an empty split for everyone", async () => {
  let reloads = 0;
  const host = mount({ budget_statement: STATEMENT, budget_add_expense: null }, async () => { reloads += 1; });
  await wait();
  input(host, "Amount", "12.34"); input(host, "Description", "Groceries");
  [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "I paid")?.click();
  await wait();
  expect(calls.find((call) => call.command === "budget_add_expense")?.body).toEqual({
    documentId: "budget-1", expense: { date: currentDate(), paid_by: "p-me", amount: "12.34", description: "Groceries", split: [] },
  });
  expect(reloads).toBe(1);
});

test("statement renders member balances and server settlement transfers", async () => {
  const host = mount({ budget_statement: STATEMENT });
  await wait();
  expect(host.textContent).toContain("Me");
  expect(host.textContent).toContain("Other owes Me 6.17 €");
  expect(host.textContent).toContain("12.34 €");
});

test("export sends the selected month and opens the returned page", async () => {
  let opened = "";
  const host = mount({ budget_statement: STATEMENT, budget_export_statement: "statement-page" }, async () => {}, (id) => { opened = id; });
  await wait();
  const month = host.querySelector('[aria-label="Statement month"]') as HTMLInputElement;
  month.value = "2026-08"; month.dispatchEvent(new Event("input", { bubbles: true }));
  await wait();
  [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Export to page")?.click();
  await wait();
  expect(calls.find((call) => call.command === "budget_export_statement")?.body).toEqual({ documentId: "budget-1", month: "2026-08" });
  expect(opened).toBe("statement-page");
});

test("the fixed budget columns are passed as locked grid columns", async () => {
  const host = mount({ budget_statement: STATEMENT });
  await wait();
  expect(host.querySelector(".budget-grid")?.getAttribute("data-locked-column-ids")).toBe("date,paid_by,amount,description,split");
});
