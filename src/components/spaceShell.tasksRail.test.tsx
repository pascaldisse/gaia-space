import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SpaceShell from "./SpaceShell";
import { setProfileId, reloadProjects, reloadProfiles } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// THE TASK AREA MUST BE NAMED BY A MENU, not only by a URL.
//
// The generated Task Ledger arrived mapped to "more" and holding the slug `todo`,
// while To-Do and Team Tasks were mapped to "home" — a mode whose sidebar is
// deliberately EMPTY. `moreViews()` lists only what is mapped to "more". The result:
// the ledger was the only task surface any menu offered, and the three working
// surfaces were reachable by typed URL alone. This test pins the way back in.

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

const mountTasks = async () => {
  setProfileId("me");
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, value: [] }), { status: 200, headers: { "content-type": "application/json" } })) as any;
  await reloadProjects().catch(() => undefined);
  await reloadProfiles().catch(() => undefined);

  const host = document.createElement("div");
  document.body.appendChild(host);
  registerViews([
    { name: "To-Do", aliases: ["todo", "tasks"] },
    "Team Tasks",
    { name: "Task Ledger", slug: "task-ledger" },
    "Chat", "Projects",
  ]);
  setAvailableViews(null);
  window.history.replaceState({}, "", "/to-do");
  dispose = render(
    () => (
      <SpaceShell
        views={[
          { name: "To-Do", icon: "check" },
          { name: "Team Tasks", icon: "users" },
          { name: "Task Ledger", icon: "columns" },
        ]}
        active="To-Do"
        onOpenSearch={() => {}}
      >
        <div />
      </SpaceShell>
    ),
    host,
  );
  navigate({ view: "To-Do" });
  await settle();
  return host;
};

describe("nothing the narrow rail drops becomes unreachable", () => {
  test("More lists every destination the mobile rail has no room for", async () => {
    const host = await mountTasks();
    (host.querySelector('.mobile-rail [aria-label="More"]') as HTMLElement).click();
    await settle();
    const panel = document.querySelector(".more-panel") as HTMLElement;
    expect(panel).not.toBeNull();
    const dropped = panel.querySelector(".more-mobile-only") as HTMLElement;
    expect(dropped).not.toBeNull();
    const labels = [...dropped.querySelectorAll(".more-item")].map((n) => n.textContent?.trim());
    // Library and Development are the two RAIL modes the five-slot mobile rail omits.
    expect(labels).toContain("Library");
  });
});

describe("the task area is reachable from the rail", () => {
  test("Tasks is a rail destination and its sidebar names all three task lists", async () => {
    const host = await mountTasks();

    // 1. The rail carries a Tasks destination.
    const railLabels = [...host.querySelectorAll(".rail-item .rail-label")].map((n) => n.textContent);
    expect(railLabels).toContain("Tasks");

    // 2. Its sidebar lists the three task surfaces — Team tasks NOT hidden behind
    //    "More", not reachable only by URL.
    const sidebar = host.querySelector(".space-sidebar") as HTMLElement;
    expect(sidebar).not.toBeNull();
    const entries = [...sidebar.querySelectorAll("a, button")]
      .map((n) => n.textContent?.trim())
      .filter(Boolean) as string[];
    for (const label of ["My tasks", "Team tasks", "Task ledger"]) {
      expect(entries.some((entry) => entry.includes(label))).toBe(true);
    }
  });

  test("standing on My tasks, the rail's Tasks entry is the active one", async () => {
    const host = await mountTasks();
    const active = [...host.querySelectorAll(".rail-item.active .rail-label")].map((n) => n.textContent);
    expect(active).toContain("Tasks");
  });
});
