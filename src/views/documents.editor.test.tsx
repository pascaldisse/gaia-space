import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { navigate, registerViews } from "../router";

// The document editor is more than a textarea: Markdown gets a toolbar that edits the
// source, rich text gets a WYSIWYG surface whose HTML is sanitized before it can be
// stored or rendered, and a personal draft can be promoted into a blog article.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProjectId(""); setProfileId("");
  window.history.replaceState({}, "", "/");
});

type Reply = { ok: true; value: unknown };
const calls: { cmd: string; url: string; body: any }[] = [];
const serve = (table: Record<string, Reply | (() => Reply)>) => {
  globalThis.fetch = (async (url: any, init: any) => {
    // The web upload is a REST route, not a command: normalize it to one table key so a
    // test can answer it without guessing the base path or the query string.
    const cmd = String(url).includes("api/documents/upload")
      ? "upload_document_file"
      : String(url).split("api/cmd/")[1] ?? String(url);
    calls.push({
      cmd,
      url: String(url),
      body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    const entry = table[cmd];
    const reply = (typeof entry === "function" ? entry() : entry) ?? ({ ok: true, value: [] } as Reply);
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
const doc = (over: Record<string, unknown> = {}) => ({
  id: "d1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "text",
  body_format: "text", title: "Draft", body: "hello world", version: 1, archived: false, created_by: "me", ...over,
});
const open = async (id: string) => {
  registerViews(["Documents"]);
  navigate({ view: "Documents", entityType: "document", entityId: id, containerType: "my-docs", containerId: "me" });
  await settle();
};
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe("document editing surfaces", () => {
  test("the Markdown toolbar rewrites the selected source, not just the preview", async () => {
    setProfileId("me");
    calls.length = 0;
    serve({ list_document_folders: { ok: true, value: [] }, list_documents: { ok: true, value: [doc()] } });
    const host = await mount();
    await open("d1");

    const area = host.querySelector("textarea.editor-body") as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    area.setSelectionRange(6, 11);
    (host.querySelector('.format-toolbar button[aria-label="Bold"]') as HTMLButtonElement).click();
    await settle();

    expect((host.querySelector("textarea.editor-body") as HTMLTextAreaElement).value).toBe("hello **world**");
  });

  test("rich text edits a WYSIWYG surface and stores sanitized HTML", async () => {
    setProfileId("me");
    calls.length = 0;
    serve({
      list_document_folders: { ok: true, value: [] },
      list_documents: { ok: true, value: [doc({ id: "rich", body_format: "rich-text", body: "<p>start</p>" })] },
      save_document: { ok: true, value: doc({ id: "rich", body_format: "rich-text", body: "<p>x</p>", version: 2 }) },
    });
    const host = await mount();
    await open("rich");

    const editable = host.querySelector(".rich-editable") as HTMLElement;
    expect(editable).not.toBeNull();
    expect(editable.getAttribute("contenteditable")).not.toBeNull();
    expect(editable.innerHTML).toContain("start");
    // A hostile paste/edit reaching the editable must not reach the saved row.
    editable.innerHTML = '<p onclick="x()">kept</p><script>alert(1)</script>';
    editable.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    button(host, "Save version")!.click();
    await settle();

    const saved = calls.filter((c) => c.cmd === "save_document").pop();
    expect(saved).not.toBeUndefined();
    expect(saved!.body.body).toBe("<p>kept</p>");
  });

  test("a personal draft publishes to the blog and can be unpublished", async () => {
    setProfileId("me");
    calls.length = 0;
    let published = false;
    const post = () => ({ id: "blog-1", draft_id: "d1", title: "Draft", body: "hello world", author_id: "me", aliases: ["draft"], team_id: null, project_id: null, location_id: null, created_at: 1, published_at: 1, archived: false, archived_by: null, archived_at: null });
    serve({
      list_document_folders: { ok: true, value: [] },
      list_documents: { ok: true, value: [doc()] },
      list_blog_posts: () => ({ ok: true, value: published ? [post()] : [] }),
      publish_blog_draft: () => { published = true; return { ok: true, value: post() }; },
    });
    const host = await mount();
    await open("d1");

    button(host, "Publish to Blog")!.click();
    await settle();

    const call = calls.find((c) => c.cmd === "publish_blog_draft");
    expect(call).not.toBeUndefined();
    expect(call!.body.input.draft_id).toBe("d1");
    expect(host.textContent).toContain("blog article");
    expect(button(host, "unpublish")).not.toBeUndefined();
    expect(button(host, "Publish to Blog")).toBeUndefined();
  });

  test("uploading a file files it as a document and selects it", async () => {
    setProfileId("me");
    calls.length = 0;
    let uploaded = false;
    const file = { id: "up1", container_type: "my-docs", container_id: "me", folder_id: null, doc_type: "file", body_format: "text", title: "logo.png", body: "logo.png (4 bytes, image/png)", version: 1, archived: false, created_by: "me" };
    serve({
      list_document_folders: { ok: true, value: [] },
      list_documents: () => ({ ok: true, value: uploaded ? [doc(), file] : [doc()] }),
      upload_document_file: () => { uploaded = true; return { ok: true, value: { document_id: "up1", filename: "logo.png", mime: "image/png", size: 4, uploaded_by: "me", uploaded_at: 1 } }; },
      read_document_file: { ok: true, value: { document_id: "up1", filename: "logo.png", mime: "image/png", size: 4, truncated: false, text: null, data_base64: "iVBORw==" } },
    });
    // The upload transport is XHR, because only XHR can report how far a body has been
    // sent; the reply shape is the same JSON the route returns.
    const realXhr = globalThis.XMLHttpRequest;
    const sent: string[] = [];
    class RecordingXhr {
      upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      responseText = JSON.stringify({ ok: true, value: { document_id: "up1", filename: "logo.png", mime: "image/png", size: 4, uploaded_by: "me", uploaded_at: 1 } });
      withCredentials = false;
      private url = "";
      open(_method: string, url: string) { this.url = url; }
      setRequestHeader() {}
      send() { uploaded = true; sent.push(this.url); setTimeout(() => this.onload?.(), 0); }
    }
    globalThis.XMLHttpRequest = RecordingXhr as unknown as typeof XMLHttpRequest;
    const host = await mount();

    // A browser has no filesystem for us to name: the bytes are POSTed. (The desktop
    // path-upload command is exercised on the Rust side, where a path is real.)
    const picker = host.querySelector('input[type="file"][aria-label="File to upload"]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    const chosen = new File([new Uint8Array([1, 2, 3, 4])], "logo.png", { type: "image/png" });
    Object.defineProperty(picker, "files", { value: [chosen], configurable: true });
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    globalThis.XMLHttpRequest = realXhr;
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("api/documents/upload");
    expect(sent[0]).toContain("filename=logo.png");
    expect(sent[0]).toContain("container_type=my-docs");
    // The upload lands in the tree and opens as a preview, not as an empty editor.
    expect(host.textContent).toContain("logo.png");
    const img = host.querySelector(".file-preview img.file-image") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("data:image/png;base64,iVBORw==");
    expect(host.querySelector("textarea.editor-body")).toBeNull();
  });

  test("a text upload previews its decoded contents and announces truncation", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { ok: true, value: [] },
      list_documents: { ok: true, value: [doc({ id: "up2", doc_type: "file", title: "notes.txt" })] },
      read_document_file: { ok: true, value: { document_id: "up2", filename: "notes.txt", mime: "text/plain", size: 4096, truncated: true, text: "hello upload", data_base64: null } },
    });
    const host = await mount();
    await open("up2");

    expect(host.querySelector(".file-text")!.textContent).toBe("hello upload");
    expect(host.textContent).toContain("preview truncated");
  });

  test("a document you did not author offers no blog publish control", async () => {
    setProfileId("me");
    serve({
      list_document_folders: { ok: true, value: [] },
      list_documents: { ok: true, value: [doc({ created_by: "someone-else" })] },
    });
    const host = await mount();
    await open("d1");

    expect(button(host, "Publish to Blog")).toBeUndefined();
  });
});
