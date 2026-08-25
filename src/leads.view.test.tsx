import { afterEach, expect, mock, test } from "bun:test";
import { render } from "solid-js/web";
import { invoke } from "./api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import Leads from "./views/Leads";

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const settle = () => new Promise(done => setTimeout(done, 30));

afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; globalThis.fetch = realFetch; });

function mount(reply: unknown, ok = true) {
  globalThis.fetch = (async (_url: unknown) => new Response(JSON.stringify(ok ? { ok: true, value: reply } : { ok: false, error: reply }), { status: ok ? 200 : 403, headers: { "content-type": "application/json" } })) as typeof fetch;
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Leads /> as any, host);
  return host;
}

test("Leads renders the server-supplied contact records and refreshes through the command bridge", async () => {
  const host = mount([{ id: "lead-1", bereich: "software", interesse: "vormerken", name: "Ada Lovelace", business: "Analytical Engines", address: "1 Logic Lane", phone: "+49 30 123", email: "ada@example.test", created_at: "2026-08-25T13:00:22.544Z" }]);
  await settle();
  expect(host.textContent).toContain("Ada Lovelace");
  expect(host.textContent).toContain("Analytical Engines");
  expect(host.textContent).toContain("1 lead");
  expect((host.querySelector("a[href='mailto:ada@example.test']") as HTMLAnchorElement)?.textContent).toBe("ada@example.test");
  expect(host.querySelector("a[href='tel:+49 30 123']")).toBeTruthy();
  expect(host.querySelector("button")?.textContent).toBe("Refresh");
});

test("Leads shows a permission failure, never an empty-state lie", async () => {
  const host = mount("only an administrator can view leads", false);
  await settle();
  expect(host.querySelector("[role=alert]")?.textContent).toContain("administrator");
  expect(host.textContent).not.toContain("No contact submissions yet");
});
