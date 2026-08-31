import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents, { documentTreeLoading } from "./Documents";
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
  test("a refresh keeps the already loaded tree visible", () => {
    expect(documentTreeLoading("refreshing", "ready")).toBe(false);
    expect(documentTreeLoading("pending", "ready")).toBe(true);
  });
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

    // The way out is the PATH at the top of the page, never a button in the middle of
    // the canvas: it names the level above and lives outside the library surface.
    const crumbs = host.querySelector("nav.documents-breadcrumb") as HTMLElement;
    expect(crumbs).not.toBeNull();
    expect(crumbs.closest(".documents-empty-canvas")).toBeNull();
    expect([...crumbs.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["← My Documents", "Mine"]);
    const back = crumbs.querySelector("button.documents-library-up") as HTMLButtonElement;
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

  // NOTHING IS DELETED FROM A CLICK. The click asks; the command only runs once the
  // question is answered, and cancelling leaves the document exactly where it was.
  test("deleting a document asks first, and cancelling deletes nothing", async () => {
    setProfileId("me");
    const deleted: unknown[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "delete_document") {
        deleted.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_document_folders: [],
        list_documents: [{ id: "d1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", body_format: "text", title: "Draft", body: "", version: 1, archived: false, created_by: "me" }],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const host = await mount();
    registerViews(["Documents"]);
    navigate({ view: "Documents", entityType: "document", entityId: "d1", containerType: "my-docs", containerId: "me" });
    await settle();

    // The one red button, top right, named after what it ends.
    const trigger = host.querySelector('button.delete-button[aria-label="Delete document Draft"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    trigger.click();
    await settle();

    // Asking is not doing.
    expect(deleted.length).toBe(0);
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    // The question names the document, so nobody deletes the wrong one.
    expect(dialog.textContent).toContain("Draft");

    (dialog.querySelector("button.confirm-cancel") as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(deleted.length).toBe(0);

    trigger.click();
    await settle();
    (document.querySelector("button.confirm-danger") as HTMLButtonElement).click();
    await settle();
    expect(deleted.length).toBe(1);
    expect(deleted[0]).toMatchObject({ id: "d1" });
  });

  // EVERY ACT A CARD HAS IS IN ONE MENU — right-click, or the card's own ⋯ for anyone
  // without a right mouse button. Words, never unlabelled glyphs: the ✕ that archived
  // was read as a delete, which is exactly the mistake a menu cannot make.
  test("right-clicking a document offers its acts, and delete still asks", async () => {
    setProfileId("me");
    const deleted: unknown[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "delete_document") {
        deleted.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_document_folders: [folder({ id: "f1", name: "Specs" })],
        list_documents: [{ id: "d1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", body_format: "text", title: "Loose note", body: "", version: 1, archived: false, created_by: "me" }],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const host = await mount();
    // Route state is process-global: land on the library, not on a document another
    // test left open.
    registerViews(["Documents"]);
    navigate({ view: "Documents", containerType: "my-docs", containerId: "me" });
    await settle();

    const card = host.querySelector("a.documents-library-card") as HTMLElement;
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    await settle();

    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      "Open", "Archive", "Delete document…",
    ]);

    (([...menu.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === "Delete document…")) as HTMLButtonElement).click();
    await settle();

    // The menu closed and asked; it did not delete.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(deleted.length).toBe(0);
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Loose note");
    (dialog.querySelector("button.confirm-danger") as HTMLButtonElement).click();
    await settle();
    expect(deleted.length).toBe(1);
  });

  // A shelf carries no unlabelled glyph row any more: its acts are in the same menu,
  // and renaming is ASKED in a dialog instead of turning the tile into a bare input.
  test("a shelf offers rename in a dialog, not a field inside the card", async () => {
    setProfileId("me");
    const renamed: Record<string, any>[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "update_document_folder") {
        renamed.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_document_folders: [folder({ id: "f1", name: "Specs" })],
        list_documents: [],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const host = await mount();

    const shelf = host.querySelector(".documents-shelf") as HTMLElement;
    // No glyph row: the pencil, the ✕ and the bin are gone from the card itself.
    expect(shelf.querySelectorAll("button.shelf-action").length).toBe(0);

    (shelf.querySelector("button.card-menu-button") as HTMLButtonElement).click();
    await settle();
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      "Open", "Rename…", "Archive", "Delete folder…",
    ]);

    (([...menu.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === "Rename…")) as HTMLButtonElement).click();
    await settle();

    const prompt = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(prompt).not.toBeNull();
    const field = prompt.querySelector("input.confirm-input") as HTMLInputElement;
    expect(field.value).toBe("Specs");
    field.value = "Specifications";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    (prompt.querySelector("button.confirm-primary") as HTMLButtonElement).click();
    await settle();

    expect(renamed.length).toBe(1);
    expect(renamed[0].folder).toMatchObject({ id: "f1", name: "Specifications" });
  });

  // OWNERSHIP IS SHOWN, NOT DISCOVERED BY FAILING. In the organization library only a
  // book's owner may end anything; everybody else gets no button and a reason.
  test("the organization library offers delete to its owner only", async () => {
    setProfileId("me");
    let owners: string[] = ["someone-else"];
    globalThis.fetch = (async (url: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      const table: Record<string, unknown> = {
        list_book_owners: owners,
        list_document_folders: [
          { id: "book-1", container_type: "kb", container_id: "book-1", parent_id: null, name: "Handbook", description: null, archived: false, created_at: 0 },
        ],
        list_documents: [{ id: "kb1", container_type: "kb", container_id: "book-1", folder_id: null, doc_type: "text", body_format: "text", title: "House rules", body: "", version: 1, archived: false, created_by: "someone-else" }],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const host = await mount();
    registerViews(["Documents"]);
    navigate({ view: "Documents", entityType: "document", entityId: "kb1", containerType: "kb", containerId: "book-1" });
    await settle();

    // Not an owner, not the author: no red button, and the rule is stated.
    expect(host.querySelector("button.delete-button")).toBeNull();
    expect(host.textContent).toContain("Only the owner of Handbook can delete this");

    owners = ["me"];
    dispose?.(); dispose = undefined;
    document.body.innerHTML = "";
    const owned = await mount();
    navigate({ view: "Documents", entityType: "document", entityId: "kb1", containerType: "kb", containerId: "book-1" });
    await settle();
    expect(owned.querySelector("button.delete-button")).not.toBeNull();
  });

  // A FILE YOU CAN ONLY LOOK AT IS A FILE YOU DO NOT HAVE. The bytes live beside the
  // database, so without this act nothing outside the app can ever use them. On the
  // desktop the native save dialog names the destination and the backend copies the
  // stored file there.
  test("an uploaded file can be taken out of the app; a written document cannot", async () => {
    setProfileId("me");
    const exported: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "export_document_file") {
        exported.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_document_folders: [],
        list_documents: [
          { id: "up1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "file", body_format: "text", title: "logo.png", body: "", version: 1, archived: false, created_by: "me" },
          { id: "d1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text", body_format: "text", title: "Draft", body: "", version: 1, archived: false, created_by: "me" },
        ],
        read_document_file: { document_id: "up1", filename: "logo.png", mime: "image/png", size: 4, truncated: false, text: null, data_base64: "iVBORw==" },
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const host = await mount();
    registerViews(["Documents"]);
    navigate({ view: "Documents", containerType: "my-docs", containerId: "me" });
    await settle();

    // The card's menu offers it for the FILE …
    const fileCard = [...host.querySelectorAll("a.documents-library-card")].find(a => a.textContent?.includes("logo.png")) as HTMLElement;
    fileCard.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
    await settle();
    expect([...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent)).toContain("Download…");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();

    // … and NOT for a document that was written in Space: there is no file to take.
    const textCard = [...host.querySelectorAll("a.documents-library-card")].find(a => a.textContent?.includes("Draft")) as HTMLElement;
    textCard.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 30 }));
    await settle();
    expect([...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent)).not.toContain("Download…");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();

    // Opened, the file carries the act in its own toolbar.
    navigate({ view: "Documents", entityType: "document", entityId: "up1", containerType: "my-docs", containerId: "me" });
    await settle();
    const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Download");
    expect(button).not.toBeUndefined();
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
