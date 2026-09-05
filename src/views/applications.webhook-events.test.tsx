import { afterEach, describe, expect, test } from "bun:test";
const calls: { command: string; args: any }[] = [];
const app = { id: "app-1", name: "Hooks", description: null, application_type: "Application" as const, endpoint_uri: "https://hooks.example/webhook", client_id: "client", client_credentials_flow_enabled: true, code_flow_enabled: false, pkce_required: false, connection_status: "CONNECTED" as const, archived: false };
import { render } from "solid-js/web";
import Applications from "./Applications";
let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; calls.length = 0; delete (window as any).__TAURI_INTERNALS__; });
const mount = async () => {
  (window as any).__TAURI_INTERNALS__ = { invoke: (command: string, args: any = {}) => {
    calls.push({ command, args });
    if (command === "list_applications") return Promise.resolve([app]);
    if (command === "list_event_types") return Promise.resolve(["issue.created", "review.merged"]);
    return Promise.resolve([]);
  } };
  const host = document.createElement("div"); document.body.appendChild(host);
  dispose = render(() => <Applications /> as any, host);
  await settle();
  // The application row is a CARD whose pressable part is a real <button> now
  // (design rollout): same act, same one click — an address change, not a
  // relaxation. Clicking the <li> would click the card's padding.
  host.querySelector(".apps-list li .dev-card")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
  return host;
};
describe("webhook event picker", () => {
  test("renders backend taxonomy and saves one closed-set payload per selected event", async () => {
    const host = await mount();
    const options = Array.from(host.querySelectorAll<HTMLInputElement>(".hook-event-picker input"));
    expect(options.map(option => option.value)).toEqual(["issue.created", "review.merged"]);
    for (const option of options) { option.checked = true; option.dispatchEvent(new Event("change", { bubbles: true })); }
    host.querySelector<HTMLInputElement>(".hook-filters")!.value = '{"issue.priority":"HIGH"}';
    host.querySelector<HTMLInputElement>(".hook-filters")!.dispatchEvent(new Event("input", { bubbles: true }));
    Array.from(host.querySelectorAll("button")).find(button => button.textContent === "+ Webhook")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    const saved = calls.filter(call => call.command === "save_webhook").map(call => call.args.value);
    expect(saved).toHaveLength(2);
    expect(saved.map(value => value.event_type)).toEqual(["issue.created", "review.merged"]);
    expect(saved.every(value => value.application_id === app.id && value.filters_json === '{"issue.priority":"HIGH"}')).toBe(true);
  });
  test("rejects registration without a supported event selection", async () => {
    const host = await mount();
    Array.from(host.querySelectorAll("button")).find(button => button.textContent === "+ Webhook")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(calls.some(call => call.command === "save_webhook")).toBe(false);
    expect(host.textContent).toContain("Choose one or more supported event types.");
  });
});

describe("marketplace and external tracker registration", () => {
  test("saves a named listing and links the selected app as an external tracker", async () => {
    const host = await mount();
    const listingName = host.querySelector<HTMLInputElement>('input[aria-label="Marketplace listing name"]')!;
    const listingVendor = host.querySelector<HTMLInputElement>('input[aria-label="Marketplace vendor"]')!;
    listingName.value = "Issue bridge"; listingName.dispatchEvent(new Event("input", { bubbles: true }));
    listingVendor.value = "Acme"; listingVendor.dispatchEvent(new Event("input", { bubbles: true }));
    Array.from(host.querySelectorAll("button")).find(button => button.textContent === "+ Listing")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Link external task tracker")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    const listing = calls.find(call => call.command === "save_marketplace_app")!.args.value;
    expect(listing.name).toBe("Issue bridge"); expect(listing.vendor).toBe("Acme");
    const tracker = calls.find(call => call.command === "save_ui_extension")!.args.value;
    expect(tracker).toMatchObject({ application_id: app.id, extension_type: "ExternalIssueTracker", iframe_url: app.endpoint_uri });
  });
});
