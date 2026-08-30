import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { createMemoryAdapter, initRouter } from "../router";

// A FILE SHARED IN A PROJECT CHANNEL IS THE PROJECT'S FILE. The backend files it onto a
// shelf of its own — `From #<channel>` under the project root — so chat screenshots stay
// findable without burying the written documents. The library needs nothing new for that:
// a shelf is a shelf. This test is the proof that the shelf, named after the channel,
// actually appears in the project's Knowledge tab.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProjectId(""); setProfileId("");
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

describe("project library shelves", () => {
  test("a channel's uploads appear on a shelf named after the channel", async () => {
    setProfileId("me");
    serve({
      list_projects: [{ id: "p1", name: "Demo Project", key: "DEMO" }],
      list_document_folders: [
        { id: "project-doc-root-p1", container_type: "project", container_id: "p1", parent_id: null, name: "Documents", description: null, archived: false, created_at: 0 },
        { id: "project-doc-chat-p1-c1", container_type: "project", container_id: "p1", parent_id: "project-doc-root-p1", name: "From #general", description: "Files shared in this channel", archived: false, created_at: 0 },
      ],
      list_documents: [
        {
          id: "doc-shot", container_type: "project", container_id: "p1", folder_id: "project-doc-chat-p1-c1",
          doc_type: "file", body_format: "text", title: "plan.txt", body: "plan.txt (5 bytes, text/plain)\nFrom #general",
          version: 1, archived: false, created_by: "me",
          source_entity_type: "message-attachment", source_entity_id: "att-lib",
        },
      ],
    });

    initRouter(createMemoryAdapter());
    const host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <Documents container="project" containerId="p1" />, host);
    await settle();

    // The project library opens at its root shelf; the channel's shelf stands inside it,
    // which is the whole point: chat files are found, not scattered over the root.
    const root = [...host.querySelectorAll<HTMLButtonElement>("button.documents-shelf-open")]
      .find((button) => button.textContent?.includes("Documents"));
    expect(root, "the project root shelf is rendered").toBeTruthy();
    root!.click();
    await settle();

    expect(host.textContent).toContain("From #general");
    expect(host.textContent).toContain("1 document");

    // …and the file that arrived in the chat is on that shelf, under its own name.
    const shelf = [...host.querySelectorAll<HTMLButtonElement>("button.documents-shelf-open")]
      .find((button) => button.textContent?.includes("From #general"));
    shelf!.click();
    await settle();
    expect(host.textContent).toContain("plan.txt");
  });
});
