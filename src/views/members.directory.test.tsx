import { afterEach, describe, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Members from "./Members";
import { setProfileId } from "../session";

type Reply = { ok: boolean; value: unknown };
const replies: Record<string, Reply> = {
  list_profiles: { ok: true, value: [
    { id: "ada", username: "ada", display_name: "Ada", email: "ada@example.test", archived: false },
    { id: "bea", username: "bea", display_name: "Bea", email: "bea@example.test", archived: false },
  ] },
  list_teams: { ok: true, value: [{ id: "platform", name: "Platform", description: null, parent_id: null, archived: false }] },
  list_roles: { ok: true, value: [{ id: "lead", name: "Lead", description: null, parent_id: null, role_type: "custom", archived: false }] },
  list_team_memberships: { ok: true, value: [{ id: "m1", profile_id: "bea", team_id: "platform", role_id: "lead", lead: false, manager_id: null, since_date: null, till_date: null, requires_approval: false, archived: false }] },
  list_membership_edit_requests: { ok: true, value: [] },
  list_member_locations: { ok: true, value: [] },
  list_directory_feed: { ok: true, value: [{ id: "event", event_type: "member.joined", profile_id: "bea", profile_name: "Bea", team_id: null, team_name: null, role_id: null, role_name: null, created_at: 1 }] },
  list_directory_calendar: { ok: true, value: [{ id: "absence", profile_id: "bea", profile_name: "Bea", reason_type: "Vacation", date_from: "2030-01-02", date_to: "2030-01-04", availability: "away" }] },
  list_messenger_contacts: { ok: true, value: [{ id: "contact", profile_id: "bea", contact_type: "Telegram", login: "@bea", deep_link: "https://example.test/chat" }] },
};
const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const settle = () => new Promise((done) => setTimeout(done, 30));

afterEach(() => {
  dispose?.(); dispose = undefined; document.body.innerHTML = "";
  globalThis.fetch = realFetch; setProfileId("");
});

describe("advanced directory", () => {
  test("renders company feed/calendar and keeps another profile read-only and tabbed", async () => {
    globalThis.fetch = (async (url: string) => {
      const command = url.split("api/cmd/")[1] ?? url;
      const reply = replies[command] ?? { ok: true, value: [] };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    setProfileId("ada");
    const host = document.createElement("div"); document.body.appendChild(host);
    dispose = render(() => <Members /> as any, host);
    await settle();
    expect(host.querySelector("[aria-label='Company feed']")?.textContent).toContain("Bea joined the organization");
    expect(host.querySelector("[aria-label='Organization calendar']")?.textContent).toContain("Vacation");
    const beaRow = [...host.querySelectorAll(".org-list li")].find((row) => row.textContent?.includes("Bea"))!;
    (beaRow.querySelector("button") as HTMLButtonElement).click(); await settle();
    const detail = host.querySelector("[aria-label='Profile detail']")!;
    expect(detail.textContent).toContain("AboutTeamsContacts");
    expect(detail.querySelector("form[aria-label='My profile']")).toBeNull();
    ([...detail.querySelectorAll("button")].find((button) => button.textContent === "Contacts") as HTMLButtonElement).click(); await settle();
    expect(detail.textContent).toContain("Telegram");
  });
});
