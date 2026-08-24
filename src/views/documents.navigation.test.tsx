import { expect, test, describe, afterEach, beforeEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// Two places, not three. A person opens "My Documents" (their own work plus what they
// starred) or "Project Docs" (one picker over projects AND knowledge-base books).
// The knowledge base stays its own container in storage; it stopped being its own tab.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
const calls: { command: string; body: Record<string, unknown> }[] = [];
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  calls.length = 0;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
  window.history.replaceState({}, "", "/");
});

// Router state is module-global: every test declares the container it starts in
// rather than inheriting whatever the previous one navigated to.
beforeEach(() => {
  registerViews(["Documents"]);
  // Availability is global too, and other files narrow it: an unreachable view would
  // silently refuse navigation and leave this test looking at the wrong container.
  setAvailableViews(null);
  navigate({ view: "Documents", containerType: "my-docs" });
});

const serve = (table: Record<string, unknown>) => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const command = String(url).split("api/cmd/")[1] ?? String(url);
    calls.push({ command, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ ok: true, value: table[command] ?? [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
};

const settle = () => new Promise((done) => setTimeout(done, 40));
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Documents />, host);
  await settle();
  return host;
};

const doc = (over: Record<string, unknown> = {}) => ({
  id: "d1", container_type: "my-docs", container_id: "me", folder_id: null,
  doc_type: "text", body_format: "text", title: "Note", body: "", version: 1,
  archived: false, created_by: "me", ...over,
});

describe("documents navigation", () => {
  test("there are two tabs, and one picker covers both projects and knowledge-base books", async () => {
    setProfileId("me");
    serve({
      list_projects: [{ id: "p1", name: "Orbital", key: "ORB" }],
      list_document_folders: [
        { id: "book-1", container_type: "kb", container_id: "book-1", parent_id: null, name: "Handbook", description: null, archived: false, created_at: 0 },
      ],
      list_documents: [],
    });
    const host = await mount();

    const tabs = Array.from(host.querySelectorAll(".container-tab")).map((a) => a.textContent);
    expect(tabs).toEqual(["My Documents", "Project Docs"]);
    expect(host.textContent).not.toContain("Knowledge Base");

    // Switching to Project Docs offers projects and books in the same control.
    registerViews(["Documents"]);
    navigate({ view: "Documents", containerType: "project", containerId: "p1" });
    await settle();
    const picker = host.querySelector('select[aria-label="Documents source"]') as HTMLSelectElement;
    expect(picker).not.toBeNull();
    expect(Array.from(picker.options).map((option) => option.value)).toEqual(["project:p1", "kb:book-1"]);
    expect(Array.from(picker.querySelectorAll("optgroup")).map((g) => g.label))
      .toEqual(["Projects", "Knowledge base"]);
  });

  test("favourites appear in My Documents and keep pointing at their own container", async () => {
    setProfileId("me");
    serve({
      list_documents: [doc()],
      list_favorite_documents: [
        doc({ id: "shared", container_type: "project", container_id: "p1", title: "Release plan" }),
      ],
      list_projects: [{ id: "p1", name: "Orbital", key: "ORB" }],
    });
    const host = await mount();

    const favourites = host.querySelector('[aria-label="Favourite documents"]');
    expect(favourites).not.toBeNull();
    expect(favourites!.textContent).toContain("Release plan");
    // The link carries the owning project, so opening it lands where the document lives.
    const href = favourites!.querySelector("a")!.getAttribute("href");
    expect(href).toContain("project");
    expect(href).toContain("p1");
  });

  test("in the browser an upload is a file picker, never a path on someone else's disk", async () => {
    setProfileId("me");
    serve({ list_documents: [], list_document_folders: [] });
    const host = await mount();

    const picker = host.querySelector('input[type="file"][aria-label="File to upload"]');
    expect(picker).not.toBeNull();
    const pathField = host.querySelector('input[aria-label="File to upload"]:not([type="file"])');
    expect(pathField).toBeNull();
  });
});
