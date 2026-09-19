import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "./api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SpaceShell from "./components/SpaceShell";
import { setProfileId, reloadProjects, reloadProfiles } from "./session";
import { buildPath, parsePath, registerViews, setAvailableViews, setRoutePending } from "./router";

// THE WEB BUILD HID THE CRM AND KEPT ITS BUTTON.
//
// `CRM` was listed among the LOCAL-ONLY views (next to Repos, Code Reviews,
// Pipelines), and App drops those from `setAvailableViews` in the browser. The router
// then refuses an unavailable view (§known) and falls back — so `/crm/leads` rendered
// HOME, complete with its task widgets, while the rail still offered a CRM button.
// Jannes saw a dashboard where his pipeline should be, 2026-09-19.
//
// Two rules are pinned here:
//   1. CRM is reachable in the web build — its address survives availability.
//   2. A rail button exists only for a destination this build can actually reach.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProfileId("");
  setAvailableViews(null);
  setRoutePending(false);
  window.history.replaceState({}, "", "/");
});

const settle = () => new Promise((done) => setTimeout(done, 60));

/** The view names the WEB build offers: every workspace view except the three that
 *  need this machine (Repos, Code Reviews, Pipelines). CRM belongs to this list. */
const WEB_VIEWS = ["Home", "Chat", "Projects", "Documents", "Development", "To-Do", "CRM"];

describe("the CRM survives the web build", () => {
  test("a CRM address stays a CRM address when only web views are available", () => {
    registerViews([...WEB_VIEWS, "Repos"]);
    setAvailableViews(WEB_VIEWS);

    const route = parsePath("crm/leads");
    expect(route.view).toBe("CRM");
    expect(route.tab).toBe("leads");
    expect(buildPath({ view: "CRM", tab: "pipeline" })).toBe("crm/pipeline");

    // The contrast that proves the mechanism: a view the web build does NOT offer
    // still falls back — that behaviour is right, CRM was simply on the wrong list.
    expect(parsePath("repos").view).not.toBe("Repos");
  });

  test("the rail offers no button for a destination this build cannot reach", async () => {
    setProfileId("me");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, value: [] }), { status: 200, headers: { "content-type": "application/json" } })) as any;
    await reloadProjects().catch(() => undefined);
    await reloadProfiles().catch(() => undefined);

    registerViews(WEB_VIEWS);
    setAvailableViews(WEB_VIEWS);
    const host = document.createElement("div");
    document.body.appendChild(host);
    window.history.replaceState({}, "", "/crm/pipeline");
    dispose = render(
      () => (
        <SpaceShell
          views={WEB_VIEWS.map((name) => ({ name, icon: "columns" as const }))}
          active="CRM"
          onOpenSearch={() => {}}
        >
          <div />
        </SpaceShell>
      ),
      host,
    );
    await settle();

    const labels = [...host.querySelectorAll(".desktop-rail .rail-item .rail-label")].map((n) => n.textContent?.trim());
    expect(labels).toContain("CRM");

    // Same shell, a build WITHOUT the CRM: the button is gone rather than landing on Home.
    dispose(); dispose = undefined; host.remove();
    const without = WEB_VIEWS.filter((name) => name !== "CRM");
    registerViews(without);
    setAvailableViews(without);
    const bare = document.createElement("div");
    document.body.appendChild(bare);
    dispose = render(
      () => (
        <SpaceShell views={without.map((name) => ({ name, icon: "columns" as const }))} active="Home" onOpenSearch={() => {}}>
          <div />
        </SpaceShell>
      ),
      bare,
    );
    await settle();
    const bareLabels = [...bare.querySelectorAll(".desktop-rail .rail-item .rail-label")].map((n) => n.textContent?.trim());
    expect(bareLabels).not.toContain("CRM");
    expect(bareLabels).toContain("Home");
  });
});
