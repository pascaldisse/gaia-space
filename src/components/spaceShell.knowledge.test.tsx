import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import SpaceShell from "./SpaceShell";
import { setProfileId, reloadProjects } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// KNOWLEDGE KEEPS THE SECOND BAR. Every other rail mode lists its objects beside the
// rail; Knowledge listed none, so the column vanished mid-navigation. Its objects are
// the LIBRARIES: the organization's books first, then one row per project.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProfileId("");
  window.history.replaceState({}, "", "/");
});

const serve = (table: Record<string, unknown>) => {
  globalThis.fetch = (async (url: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    const value = table[cmd] ?? [];
    return new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};

const settle = () => new Promise((done) => setTimeout(done, 60));

describe("knowledge sidebar", () => {
  test("lists the organization library above the project libraries", async () => {
    setProfileId("me");
    serve({
      list_projects: [{ id: "p1", name: "Orbital", key: "ORB" }],
      list_document_folders: [
        { id: "book-1", container_type: "kb", container_id: "book-1", parent_id: null, name: "Handbook", description: null, archived: false, created_at: 0 },
      ],
    });
    await reloadProjects().catch(() => undefined);

    const host = document.createElement("div");
    document.body.appendChild(host);
    registerViews(["Documents", "Projects"]);
    // Availability is process-global: another file may have restricted it.
    setAvailableViews(null);
    // The rail mode is a pure function of the LIVE route, so the route is set from the
    // URL first: a leftover path from another file would otherwise pick the mode.
    window.history.replaceState({}, "", "/documents");
    dispose = render(
      () => (
        <SpaceShell views={[{ name: "Documents", icon: "book-nav" }]} active="Documents" onOpenSearch={() => {}}>
          <div />
        </SpaceShell>
      ),
      host,
    );
    navigate({ view: "Documents" });
    await settle();

    const sidebar = host.querySelector(".space-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar!.querySelector(".side-mode")?.getAttribute("data-mode")).toBe("knowledge");

    const heads = [...sidebar!.querySelectorAll(".section-head span")].map((s) => s.textContent);
    expect(heads).toEqual(["Organization library", "Project libraries"]);

    const links = [...sidebar!.querySelectorAll(".side-link")].map((a) => a.textContent?.trim());
    // Personal docs are the fixed anchor, then the books, then the projects.
    expect(links).toEqual(["My Documents", "Handbook", "Orbital"]);
  });
});
