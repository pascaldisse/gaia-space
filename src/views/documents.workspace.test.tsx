import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { navigate, registerViews } from "../router";

// The Documents workspace is session-locked in web mode: the personal container is the
// session's own profile, the UI offers no way to act as anybody else, and a forged
// `my-docs` container id in the URL cannot re-point it. Loading, empty and error are
// three distinct rendered states — a failed fetch is never an empty tree (SPEC H7).

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  delete (window as any).__TAURI_INTERNALS__;
  // Session state is process-global: hand it back the way you found it.
  setProjectId(""); setProfileId("");
  window.history.replaceState({}, "", "/");
});

type Reply = { ok: true; value: unknown } | { status: number; body: unknown };
const serve = (table: Record<string, Reply>) => {
  globalThis.fetch = (async (url: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    const reply = table[cmd] ?? ({ ok: true, value: [] } as Reply);
    if ("status" in reply)
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};

const settle = () => new Promise((done) => setTimeout(done, 40));
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Documents />, host);
  await settle();
  return host;
};

const folder = (over: Record<string, unknown> = {}) => ({
  id: "f1", container_type: "my-docs", container_id: "me", parent_id: null,
  name: "Mine", description: null, archived: false, created_at: 0, ...over,
});

describe("documents workspace composition", () => {
  test("web mode locks the personal container to the session and offers no actor switch", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { ok: true, value: [folder()] },
      list_documents: { ok: true, value: [] },
    });
    const host = await mount();

    expect(host.textContent).not.toContain("Acting as");
    // The rendered personal tree is the session's, and it is the only one reachable.
    expect(host.textContent).toContain("Mine");
  });

  test("a forged my-docs container id in the URL does not re-point the personal container", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { ok: true, value: [folder(), folder({ id: "f2", container_id: "someone-else", name: "Theirs" })] },
      list_documents: { ok: true, value: [] },
    });
    window.history.replaceState({}, "", "/documents/my-docs/someone-else");
    const host = await mount();

    expect(host.textContent).toContain("Mine");
    expect(host.textContent).not.toContain("Theirs");
  });

  test("a failed fetch renders a visible alert, never an empty tree", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { status: 500, body: { ok: false, error: "database is locked" } },
      list_documents: { ok: true, value: [] },
    });
    const host = await mount();

    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("could not be loaded");
    expect(host.textContent).not.toContain("no folders or documents yet");
  });

  test("a successful empty response renders the empty state, distinct from loading", async () => {
    setProfileId("me");
    serve({ list_document_folders: { ok: true, value: [] }, list_documents: { ok: true, value: [] } });
    const host = await mount();

    expect(host.textContent).toContain("no folders or documents yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  test("the owner can inspect person and team document grants", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { ok: true, value: [] },
      list_documents: { ok: true, value: [{ id: "private-doc", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", title: "Private plan", body: "", version: 1, archived: false, created_by: "me" }] },
      list_profiles: { ok: true, value: [{ id: "me", display_name: "Me" }, { id: "viewer", display_name: "A Viewer" }] },
      list_teams: { ok: true, value: [{ id: "team-1", name: "Design" }] },
      list_document_access: { ok: true, value: [{ recipient_type: "profile", recipient_id: "viewer", access_level: "viewer" }] },
    });
    const host = await mount();
    registerViews(["Documents"]);
    navigate({ view: "Documents", entityType: "document", entityId: "private-doc", containerType: "my-docs", containerId: "me" });
    await settle();

    const share = [...host.querySelectorAll("button")].find((button) => button.textContent === "Share") as HTMLButtonElement;
    expect(share).not.toBeUndefined();
    share.click();
    await settle();

    expect(host.textContent).toContain("Share document");
    expect(host.textContent).toContain("A Viewer");
    expect(host.textContent).toContain("Viewer");
    expect(host.textContent).toContain("Person");
    expect(host.textContent).toContain("Team");
  });

  test("renders rich text, interactive checklists, and numbered code by saved body format", async () => {
setProfileId("me");
const docs = [
{ id: "rich", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", body_format: "rich-text", title: "Rich", body: "<h2>Stored heading</h2><p>formatted</p>", version: 1, archived: false, created_by: "me" },
{ id: "list", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", body_format: "checklist", title: "List", body: "- [ ] draft\n- [x] ship", version: 1, archived: false, created_by: "me" },
{ id: "code", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", body_format: "code", title: "Code", body: "```typescript\nconst answer = 42;\n```", version: 1, archived: false, created_by: "me" },
];
serve({ list_document_folders: { ok: true, value: [] }, list_documents: { ok: true, value: docs } });
const host = await mount();
registerViews(["Documents"]);
for (const [id, selector] of [["rich", ".rich-text-renderer"], ["list", ".checklist-renderer"], ["code", ".code-renderer"]] as const) {
navigate({ view: "Documents", entityType: "document", entityId: id, containerType: "my-docs", containerId: "me" });
await settle();
expect(host.querySelector(selector), `missing ${id}: ${host.innerHTML}`).not.toBeNull();
}
expect(host.querySelector(".code-language")?.textContent).toBe("typescript");
expect(host.querySelector(".code-line-number")?.textContent).toBe("1");
navigate({ view: "Documents", entityType: "document", entityId: "list", containerType: "my-docs", containerId: "me" });
await settle();
const check = host.querySelector(".checklist-renderer input") as HTMLInputElement;
check.click();
await settle();
expect(check.checked).toBe(true);
});
// THE LIBRARY IS THE PAGE. There is no tree column any more, so a folder is a CARD,
// and opening it is a real button — reachable by Tab, fired by Enter/Space, with no
// custom key handling — while Back returns to the level above.
test("a folder opens and closes from the keyboard, and its documents follow", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { ok: true, value: [folder({ id: "f1", name: "Mine" })] },
      list_documents: { ok: true, value: [{ id: "d1", container_type: "my-docs", container_id: "me", folder_id: "f1", doc_type: "text", title: "Inside", body: "", version: 1, archived: false, created_by: "me" }] },
    });
    const host = await mount();

    const card = host.querySelector("button.documents-shelf-open") as HTMLButtonElement;
    expect(card).not.toBeNull();
    expect(card.tagName).toBe("BUTTON");
    expect(card.textContent).toContain("Mine");
    // A document inside the folder is not shown at the level above it.
    expect(host.textContent).not.toContain("Inside");

    card.focus();
    expect(document.activeElement).toBe(card);
    card.click();
    await settle();

    // Inside the folder: its name is the heading and its documents are listed.
    expect(host.querySelector("h2")?.textContent).toBe("Mine");
    expect(host.textContent).toContain("Inside");

    const back = host.querySelector("button.documents-library-up") as HTMLButtonElement;
    expect(back).not.toBeNull();
    back.click();
    await settle();

    expect(host.textContent).not.toContain("Inside");
    expect(host.querySelector("button.documents-shelf-open")).not.toBeNull();
  });

  // THE BOOKSHELF. Folders stand side by side as shelves and are drop targets: a
  // document dragged onto one is filed inside it, which is the structural half of the
  // library. A shelf also states what it holds, so choosing one is not a guess.
  test("a shelf states what it holds and takes a document dropped onto it", async () => {
    setProfileId("me");
    const moved: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "move_document") {
        moved.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_document_folders: [folder({ id: "f1", name: "Specs" })],
        list_documents: [
          { id: "d1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", title: "Loose note", body: "", version: 1, archived: false, created_by: "me" },
          { id: "d2", container_type: "my-docs", container_id: "me", folder_id: "f1", doc_type: "text", title: "Filed", body: "", version: 1, archived: false, created_by: "me" },
        ],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const host = await mount();

    const shelf = host.querySelector(".documents-shelf") as HTMLElement;
    expect(shelf).not.toBeNull();
    // It says what is inside it, so the shelf is readable before it is opened.
    expect(shelf.textContent).toContain("Specs");
    expect(shelf.textContent).toContain("1 document");

    // The loose document is a drag source; the shelf accepts it.
    const card = host.querySelector("a.documents-library-card") as HTMLElement;
    expect(card.getAttribute("draggable")).toBe("true");

    const payload = new Map<string, string>();
    const dataTransfer = {
      types: ["text/plain"],
      setData: (kind: string, value: string) => payload.set(kind, value),
      getData: (kind: string) => payload.get(kind) ?? "",
    };
    const dragStart = new Event("dragstart", { bubbles: true }) as DragEvent;
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    card.dispatchEvent(dragStart);
    expect(payload.get("text/plain")).toBe("document:d1");

    const drop = new Event("drop", { bubbles: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    shelf.dispatchEvent(drop);
    await settle();

    expect(moved.length).toBe(1);
    expect(moved[0]).toMatchObject({ id: "d1", containerType: "my-docs", containerId: "me", folderId: "f1" });
  });

  // The source (My Documents / organization book / project library) is chosen in the
  // shell's Knowledge sidebar, so this page shows no tabs and no picker.
  test("the source picker belongs to the shell, not to the page", async () => {
    setProfileId("me");
    serve({ list_document_folders: { ok: true, value: [] }, list_documents: { ok: true, value: [] } });
    const host = await mount();

    expect(host.querySelectorAll("a.container-tab").length).toBe(0);
    expect(host.querySelector('select[aria-label="Project Docs"]')).toBeNull();
  });

  // In KB the book row is itself the root of the tree, so an article filed directly in
  // the book carries `folder_id = <book id>`, not null. The root listing must follow that
  // convention or the author owns an article the workspace can never show.
  test("an article filed directly in a book is listed at the root of the knowledge base", async () => {
    setProfileId("me");
    serve({
      list_document_folders: {
        ok: true,
        value: [folder({ id: "book-1", container_type: "kb", container_id: "book-1", name: "Handbook" })],
      },
      list_documents: {
        ok: true,
        value: [
          { id: "a1", container_type: "kb", container_id: "book-1", folder_id: "book-1", doc_type: "text", title: "House rules", body: "", version: 1, archived: false, created_by: "me" },
          { id: "a2", container_type: "kb", container_id: "other-book", folder_id: "other-book", doc_type: "text", title: "Foreign article", body: "", version: 1, archived: false, created_by: "me" },
        ],
      },
    });
    const host = await mount();
    // Land on the book the way a deep link does: the route carries container + book id.
    registerViews(["Documents"]);
    navigate({ view: "Documents", containerType: "kb", containerId: "book-1" });
    await settle();

    expect(host.textContent).toContain("House rules");
    // The empty state must not claim the book is empty while it holds an article.
    expect(host.textContent).not.toContain("no folders or documents yet");
    // A different book's article stays out of this tree.
    expect(host.textContent).not.toContain("Foreign article");
  });
});
