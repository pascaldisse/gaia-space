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

// CARRYING A THING TO THE PLACE THAT SHOULD HOLD IT. Knowledge proved the gesture on
// its own shelves; the sidebar is the one list always on screen, so the two moves that
// cross surfaces live there: a document dropped on a conversation is SHARED into it,
// and a conversation dropped on a project's head JOINS that project.
describe("what the sidebar accepts", () => {
  test("a document dropped on a conversation posts one message carrying it", async () => {
    setProfileId("me");
    const sent: Record<string, any>[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "create_message") {
        sent.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_channels_with_meta: [
          { id: "c1", name: "general", project_id: "p1", unread_count: 0, archived: false, last_message_at: 2, content_type: "text" },
        ],
        list_projects: [{ id: "p1", name: "Orbital", key: "ORB" }],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    await reloadProjects().catch(() => undefined);

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

    const row = [...host.querySelectorAll(".channel")].find((a) => a.textContent?.includes("general")) as HTMLElement;
    expect(row).not.toBeNull();

    const payload = new Map<string, string>([
      ["application/x-gaia-document", JSON.stringify({ id: "d1", title: "House rules", path: "/documents/kb/book-1/d1" })],
    ]);
    const dataTransfer = {
      types: ["application/x-gaia-document"],
      getData: (kind: string) => payload.get(kind) ?? "",
      setData: (kind: string, value: string) => payload.set(kind, value),
    };
    const drop = new Event("drop", { bubbles: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    row.dispatchEvent(drop);
    await settle();

    expect(sent.length).toBe(1);
    const message = sent[0].message as Record<string, unknown>;
    expect(message.channel_id).toBe("c1");
    expect(message.author_id).toBe("me");
    // The message carries the title AND the way back — a share nobody can follow is a note.
    expect(String(message.text)).toContain("House rules");
    expect(String(message.text)).toContain("/documents/kb/book-1/d1");
  });

  test("a conversation dropped on a project's head joins that project", async () => {
    setProfileId("me");
    const updates: Record<string, any>[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "update_channel") {
        updates.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_channels_with_meta: [
          { id: "c1", name: "general", project_id: "p1", unread_count: 0, archived: false, last_message_at: 2, content_type: "text" },
          { id: "c2", name: "loose talk", project_id: null, unread_count: 0, archived: false, last_message_at: 1, content_type: "text" },
        ],
        get_channel: { id: "c2", name: "loose talk", project_id: null, archived: false, content_type: "text" },
        list_projects: [{ id: "p1", name: "Orbital", key: "ORB" }],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    await reloadProjects().catch(() => undefined);

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

    const head = [...host.querySelectorAll(".section-head")].find((h) => h.textContent?.includes("Orbital")) as HTMLElement;
    expect(head).not.toBeNull();

    const dataTransfer = {
      types: ["application/x-gaia-channel"],
      getData: (kind: string) => (kind === "application/x-gaia-channel" ? "c2" : ""),
      setData: () => {},
    };
    const drop = new Event("drop", { bubbles: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    head.dispatchEvent(drop);
    await settle();

    expect(updates.length).toBe(1);
    expect((updates[0].channel as Record<string, unknown>).id).toBe("c2");
    expect((updates[0].channel as Record<string, unknown>).project_id).toBe("p1");
  });
});

// A CHANNEL'S NAME IS THE ONLY THING MOST PEOPLE SEE OF IT, and until now it could be
// set once and never corrected. Renaming is ASKED in the shared dialog — the row never
// becomes a bare input — and a direct message is not offered it: a DM has no name of
// its own, it is the people in it.
describe("renaming a conversation", () => {
  const serveChannels = (updates: Record<string, any>[]) => {
    globalThis.fetch = (async (url: any, init: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "update_channel") {
        updates.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = {
        list_channels_with_meta: [
          { id: "c1", name: "genral", project_id: null, unread_count: 0, archived: false, last_message_at: 2, content_type: "text" },
          { id: "dm1", name: null, project_id: null, unread_count: 0, archived: false, last_message_at: 1, content_type: "dm" },
        ],
        get_channel: { id: "c1", name: "genral", project_id: null, archived: false, content_type: "text" },
        list_projects: [],
      };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
  };

  const mountShell = async () => {
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
    return host;
  };

  test("the row's menu renames it through the dialog, and a DM is not offered it", async () => {
    setProfileId("me");
    const updates: Record<string, any>[] = [];
    serveChannels(updates);
    const host = await mountShell();

    const row = [...host.querySelectorAll(".channel")].find((a) => a.textContent?.includes("genral")) as HTMLElement;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    await settle();
    const entries = () => [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(entries()).toEqual(["Open", "Rename…", "Delete conversation…"]);

    ([...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === "Rename…") as HTMLButtonElement).click();
    await settle();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const field = dialog.querySelector("input.confirm-input") as HTMLInputElement;
    // The current name is offered for correction, not an empty box.
    expect(field.value).toBe("genral");
    field.value = "general";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    (dialog.querySelector("button.confirm-primary") as HTMLButtonElement).click();
    await settle();

    expect(updates.length).toBe(1);
    expect((updates[0].channel as Record<string, unknown>).name).toBe("general");
    expect((updates[0].channel as Record<string, unknown>).id).toBe("c1");

    // A direct message carries no name of its own.
    const dm = [...host.querySelectorAll(".channel")].find((a) => !a.textContent?.includes("genral")) as HTMLElement;
    dm.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    await settle();
    expect(entries()).not.toContain("Rename…");
  });
});


// A DELETE THAT LEAVES THE ROW IN THE LIST LOOKS LIKE A DELETE THAT DID NOT HAPPEN.
// The sidebar holds the channels as its own read; deleting one — here or inside the
// channel's own page — has to make that read happen again, or the conversation is gone
// everywhere except on screen.
describe("the sidebar forgets a deleted conversation", () => {
  test("after the delete the list is read again, without the deleted row", async () => {
    setProfileId("me");
    let channels = [
      { id: "c1", name: "general", project_id: null, unread_count: 0, archived: false, last_message_at: 2, content_type: "text" },
      { id: "c2", name: "loose talk", project_id: null, unread_count: 0, archived: false, last_message_at: 1, content_type: "text" },
    ];
    let reads = 0;
    globalThis.fetch = (async (url: any) => {
      const cmd = String(url).split("api/cmd/")[1] ?? String(url);
      if (cmd === "list_channels_with_meta") reads += 1;
      if (cmd === "delete_channel") {
        channels = channels.filter((channel) => channel.id !== "c2");
        return new Response(JSON.stringify({ ok: true, value: null }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const table: Record<string, unknown> = { list_channels_with_meta: channels, list_projects: [] };
      return new Response(JSON.stringify({ ok: true, value: table[cmd] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;

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
    expect([...host.querySelectorAll(".channel")].some((row) => row.textContent?.includes("loose talk"))).toBe(true);
    const readsBefore = reads;

    const row = [...host.querySelectorAll(".channel")].find((a) => a.textContent?.includes("loose talk")) as HTMLElement;
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    await settle();
    ([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "Delete conversation…") as HTMLButtonElement).click();
    await settle();
    (document.querySelector("button.confirm-danger") as HTMLButtonElement).click();
    await settle();

    // The list was read again …
    expect(reads).toBeGreaterThan(readsBefore);
    // … and the conversation is gone from it.
    expect([...host.querySelectorAll(".channel")].some((r) => r.textContent?.includes("loose talk"))).toBe(false);
    expect([...host.querySelectorAll(".channel")].some((r) => r.textContent?.includes("general"))).toBe(true);
  });
});
