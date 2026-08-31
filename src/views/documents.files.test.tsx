import { expect, test, describe, afterEach, beforeEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import * as XLSX from "xlsx";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// Files are first-class documents: they arrive by drop or picker with real transfer
// progress, and they are *read* in the browser — including the zip-archive office
// formats, which need an actual reader, not a download link.

const realFetch = globalThis.fetch;
const realXhr = globalThis.XMLHttpRequest;
let dispose: (() => void) | undefined;
const calls: { command: string; url: string; body: Record<string, unknown> }[] = [];
let fileBytes: ArrayBuffer | null = null;

beforeEach(() => {
  registerViews(["Documents"]);
  setAvailableViews(null);
  navigate({ view: "Documents", containerType: "my-docs" });
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  // The upload transport is global too: leaving a stub behind would silently swallow
  // every later file's uploads.
  globalThis.XMLHttpRequest = realXhr;
  calls.length = 0;
  fileBytes = null;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
  window.history.replaceState({}, "", "/");
});

const serve = (table: Record<string, unknown>) => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const raw = String(url);
    if (raw.includes("api/documents/files/") && fileBytes) {
      return new Response(fileBytes, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    const command = raw.split("api/cmd/")[1] ?? raw;
    calls.push({ command, url: raw, body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true, value: table[command] ?? [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
};

const settle = (ms = 60) => new Promise((done) => setTimeout(done, ms));
const mount = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Documents />, host);
  await settle();
  return host;
};

const fileDoc = (over: Record<string, unknown> = {}) => ({
  id: "f1", container_type: "my-docs", container_id: "me", folder_id: null,
  doc_type: "file", body_format: "text", title: "book.xlsx", body: "", version: 1,
  archived: false, created_by: "me", ...over,
});

describe("document files", () => {
  test("a spreadsheet is rendered as a table per sheet, not offered as a download only", async () => {
    setProfileId("me");
    // A real workbook, written by the same reader the app uses: the assertion is about
    // our rendering path, and the fixture cannot drift from the format.
    const sheet = XLSX.utils.aoa_to_sheet([["Region", "Revenue"], ["North", 42]]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Q3");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    fileBytes = bytes;

    serve({
      list_documents: [fileDoc()],
      list_document_folders: [],
      read_document_file: {
        document_id: "f1", filename: "book.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: bytes.byteLength, truncated: false, text: null, data_base64: null,
      },
    });
    const host = await mount();
    navigate({ view: "Documents", entityType: "document", entityId: "f1", containerType: "my-docs" });
    await settle(200);

    const body = host.querySelector(".office-body");
    expect(body).not.toBeNull();
    expect(body!.querySelector("table")).not.toBeNull();
    expect(body!.textContent).toContain("Region");
    expect(body!.textContent).toContain("North");
    expect(body!.textContent).toContain("42");
    // Sheets are named, so a multi-tab workbook is navigable rather than merged.
    expect(body!.textContent).toContain("Q3");
    // The download stays available; it is no longer the *only* answer.
    expect(host.querySelector("a.file-download")).not.toBeNull();
  });

  test("dropping files on the library uploads them where a click would have filed them", async () => {
    setProfileId("me");
    const uploaded: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const raw = String(url);
      const command = raw.split("api/cmd/")[1] ?? raw;
      return new Response(JSON.stringify({ ok: true, value: command === "list_documents" ? [] : [] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    // XHR is the upload transport (fetch cannot report progress): record it.
    class RecordingXhr {
      upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      responseText = JSON.stringify({ ok: true, value: { document_id: "up-1", filename: "a.txt", mime: "text/plain", size: 1, uploaded_by: "me", uploaded_at: 1 } });
      withCredentials = false;
      private url = "";
      open(_method: string, url: string) { this.url = url; }
      setRequestHeader() {}
      send() {
        uploaded.push(this.url);
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        setTimeout(() => this.onload?.(), 0);
      }
    }
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = RecordingXhr;

    const host = await mount();
    // The drop target is the library surface itself now: the narrow tree column is gone.
    const tree = host.querySelector(".documents-editor") as HTMLElement;
    const file = new File(["hello"], "a.txt", { type: "text/plain" });
    const drop = new Event("drop", { bubbles: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file], types: ["Files"] } });
    tree.dispatchEvent(drop);
    await settle(120);

    expect(uploaded.length).toBe(1);
    expect(uploaded[0]).toContain("api/documents/upload");
    expect(uploaded[0]).toContain("filename=a.txt");
    expect(uploaded[0]).toContain("container_type=my-docs");
  });

  test("a failed middle upload does not drop the remaining files", async () => {
    setProfileId("me");
    const uploaded: string[] = [];
    serve({ list_documents: [], list_document_folders: [] });
    class BatchXhr {
      upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      responseText = "";
      withCredentials = false;
      private url = "";
      open(_method: string, url: string) { this.url = url; }
      setRequestHeader() {}
      send() {
        uploaded.push(this.url);
        this.responseText = this.url.includes("filename=bad.txt")
          ? JSON.stringify({ ok: false, error: "upload refused" })
          : JSON.stringify({ ok: true, value: { document_id: `up-${uploaded.length}`, filename: "ok.txt", mime: "text/plain", size: 1, uploaded_by: "me", uploaded_at: 1 } });
        setTimeout(() => this.onload?.(), 0);
      }
    }
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = BatchXhr;
    const host = await mount();
    const tree = host.querySelector(".documents-editor") as HTMLElement;
    const drop = new Event("drop", { bubbles: true }) as DragEvent;
    Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["a"], "first.txt"), new File(["b"], "bad.txt"), new File(["c"], "last.txt")], types: ["Files"] } });
    tree.dispatchEvent(drop);
    await settle(120);
    expect(uploaded).toHaveLength(3);
    expect(uploaded.map((url) => new URL(url, "http://test").searchParams.get("filename"))).toEqual(["first.txt", "bad.txt", "last.txt"]);
    expect(host.textContent).toContain("bad.txt: Error: upload refused");
  });
});
