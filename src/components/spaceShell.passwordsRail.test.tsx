import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SpaceShell from "./SpaceShell";
import { setProfileId, reloadProjects, reloadProfiles } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// PASSWORDS IS A RAIL DESTINATION, not a side-link buried inside Library's sidebar.
// Home never saw it: Library's sidebar only renders when `mode() === "library"`, so
// a user standing on Home had no path to it at all. It now owns its own rail mode
// (RailMode "passwords" in nav.ts), lands directly on the Passwords view, and its
// sidebar column is deliberately empty — like Home, it is one page and owns no objects.

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

const mountHome = async () => {
  setProfileId("me");
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: true, value: [] }), { status: 200, headers: { "content-type": "application/json" } })) as any;
  await reloadProjects().catch(() => undefined);
  await reloadProfiles().catch(() => undefined);

  const host = document.createElement("div");
  document.body.appendChild(host);
  registerViews([
    "Home", "Chat", "Projects", "Documents", "Development",
    { name: "To-Do", aliases: ["todo", "tasks"] },
    "Passwords",
  ]);
  setAvailableViews(null);
  window.history.replaceState({}, "", "/");
  dispose = render(
    () => (
      <SpaceShell
        views={[
          { name: "Home", icon: "home" },
          { name: "Chat", icon: "chat" },
          { name: "Projects", icon: "layers" },
          { name: "Documents", icon: "book-nav" },
          { name: "Development", icon: "target" },
          { name: "Passwords", icon: "key" },
        ]}
        active="Home"
        onOpenSearch={() => {}}
      >
        <div />
      </SpaceShell>
    ),
    host,
  );
  navigate({ view: "Home" });
  await settle();
  return host;
};

describe("Passwords is reachable from the rail, not only from inside Library", () => {
  test("the rail carries a Passwords link that opens /passwords", async () => {
    const host = await mountHome();
    const link = [...host.querySelectorAll<HTMLAnchorElement>(".rail-item")]
      .find((a) => a.textContent?.includes("Passwords"));
    expect(link).not.toBeUndefined();
    expect(link!.getAttribute("href")).toBe("/passwords");
  });

  test("standing on Passwords, the rail's Passwords entry is the active one and the sidebar is empty", async () => {
    const host = await mountHome();
    window.history.replaceState({}, "", "/passwords");
    navigate({ view: "Passwords" });
    await settle();
    const active = [...host.querySelectorAll(".rail-item.active .rail-label")].map((n) => n.textContent);
    expect(active).toContain("Passwords");
    expect(host.querySelector(".space-chat-shell")?.classList.contains("no-sidebar")).toBe(true);
  });
});
