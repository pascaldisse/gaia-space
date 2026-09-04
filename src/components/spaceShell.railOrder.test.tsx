import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SpaceShell from "./SpaceShell";
import { setProfileId, reloadProjects, reloadProfiles } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// DIRECT MESSAGES SIT ON TOP (Pascal, 2026-09-04: "direct messages should always
// appear on top"). Before this the DM section rendered LAST, below every project's
// channels and "Other channels" — this test pins the order the rail must draw in, the
// glyph/label/badge each DM row carries, and the most-recent-activity sort inside the
// section, so a regression fails here instead of on a screenshot.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProfileId("");
  window.history.replaceState({}, "", "/");
});

const settle = () => new Promise((done) => setTimeout(done, 60));

describe("rail: direct messages float to the top", () => {
  test("DIRECT MESSAGES heads the list, above project groups and Other channels, @-glyphed, sorted by activity, unread badge kept", async () => {
    setProfileId("me");
    globalThis.fetch = (async (url: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      const table: Record<string, unknown> = {
        list_channels_with_meta: [
          { id: "c1", name: "general", project_id: "p1", unread_count: 0, archived: false, last_message_at: 5, content_type: "text" },
          { id: "loose1", name: "random", project_id: null, unread_count: 0, archived: false, last_message_at: 1, content_type: "text" },
          // Older DM, unread.
          { id: "dm1", name: null, project_id: null, unread_count: 3, archived: false, last_message_at: 2, content_type: "dm", member_count: 2 },
          // Newer DM, named after both people the way Chat's create path does.
          { id: "dm2", name: "Bjarne \u00b7 Jannes", project_id: null, unread_count: 0, archived: false, last_message_at: 9, content_type: "dm", member_count: 2 },
        ],
        list_projects: [{ id: "p1", name: "Orbital" }],
        list_profiles: [{ id: "me", display_name: "Jannes" }, { id: "them", display_name: "Bjarne" }],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    await reloadProjects().catch(() => undefined);
    await reloadProfiles().catch(() => undefined);

    const host = document.createElement("div");
    document.body.appendChild(host);
    registerViews(["Chat", "Documents", "Projects"]);
    setAvailableViews(null);
    window.history.replaceState({}, "", "/chat");
    dispose = render(
      () => (
        <SpaceShell views={[{ name: "Chat", icon: "chat" }]} active="Chat" onOpenSearch={() => {}}>
          <div />
        </SpaceShell>
      ),
      host,
    );
    navigate({ view: "Chat" });
    await settle();

    const sidebar = host.querySelector(".space-sidebar") as HTMLElement;
    expect(sidebar).not.toBeNull();

    const heads = [...sidebar.querySelectorAll(".section-head span")].map((s) => s.textContent);
    // Direct messages first, then the project group, then "Other channels" (the
    // project-less named channel) last.
    expect(heads).toEqual(["Direct messages", "Orbital", "Other channels"]);

    const dmSection = [...sidebar.querySelectorAll(".section")].find(
      (s) => s.querySelector(".section-head span")?.textContent === "Direct messages",
    )!;
    const dmRows = [...dmSection.querySelectorAll(".channel")];

    // Every DM row carries `@`, never `#`.
    expect(dmRows.map((row) => row.querySelector(".hash")?.textContent)).toEqual(["@", "@"]);

    // Sorted by most recent activity first: dm2 (last_message_at 9, labelled "Bjarne"
    // via membership) before dm1 (2, no membership loaded so it falls back to the
    // fallback label).
    expect(dmRows.map((row) => row.textContent?.replace(/[@\d]/g, "").trim())).toEqual(["Bjarne", "Direct message"]);

    // The unread badge on the older DM survives the reorder.
    const unreadRow = dmRows.find((row) => row.classList.contains("unread")) as HTMLElement;
    expect(unreadRow).not.toBeNull();
    expect(unreadRow.querySelector(".count")?.textContent).toBe("3");

    // Project and Other-channels rows are unaffected: still `#`.
    const projectSection = [...sidebar.querySelectorAll(".section")].find(
      (s) => s.querySelector(".section-head span")?.textContent === "Orbital",
    )!;
    expect([...projectSection.querySelectorAll(".channel .hash")].map((g) => g.textContent)).toEqual(["#"]);
  });
});
