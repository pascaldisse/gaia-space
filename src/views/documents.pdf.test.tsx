import { expect, test, describe, afterEach, beforeEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// AN UPLOAD IS A FILE, NOT A PAGE. Knowledge no longer imitates a reader: a PDF is
// stated as a card and handed over. What these tests guard is that the lookup of its
// facts can never withhold the file — a stall, a failure or a missing metadata row
// still ends in a card with a working download, never in a spinner that never stops.

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;

beforeEach(() => {
  registerViews(["Documents"]);
  setAvailableViews(null);
  navigate({ view: "Documents", containerType: "my-docs" });
  // The wait before a stalled preview is declared dead is a parameter, not a constant:
  // tests shorten it instead of sleeping through the production default.
  (window as unknown as { __GAIA_FILE_PREVIEW_TIMEOUT_MS?: number }).__GAIA_FILE_PREVIEW_TIMEOUT_MS = 60;
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  delete (window as unknown as { __GAIA_FILE_PREVIEW_TIMEOUT_MS?: number }).__GAIA_FILE_PREVIEW_TIMEOUT_MS;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  setProjectId(""); setProfileId("");
  window.history.replaceState({}, "", "/");
});

const pdfDoc = {
  id: "doc-pdf", container_type: "my-docs", container_id: "me", folder_id: null,
  doc_type: "file", body_format: "text", title: "LOI Page", body: "", version: 1,
  archived: false, created_by: "me",
};

/** `get_document_file` behaves as told; everything else answers empty. */
const serve = (preview: "hang" | "error" | Record<string, unknown> | null) => {
  globalThis.fetch = (async (url: unknown) => {
    const raw = String(url);
    const command = raw.split("api/cmd/")[1] ?? raw;
    const json = (value: unknown) =>
      new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
    if (command === "get_document_file") {
      if (preview === "hang") return await new Promise<Response>(() => {});
      if (preview === "error") {
        return new Response(JSON.stringify({ ok: false, error: "read upload: No such file or directory" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return json(preview);
    }
    if (command === "list_documents") return json([pdfDoc]);
    return json([]);
  }) as typeof fetch;
};

const settle = (ms = 60) => new Promise((done) => setTimeout(done, ms));
const open = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Documents />, host);
  await settle();
  navigate({ view: "Documents", entityType: "document", entityId: "doc-pdf", containerType: "my-docs" });
  await settle(250);
  return host;
};

describe("pdf documents", () => {
  const card = (host: HTMLElement) => host.querySelector(".doc-file-card") as HTMLElement | null;
  const download = (host: HTMLElement) => host.querySelector("a.dfc-download") as HTMLAnchorElement | null;

  test("a stalled lookup ends in a card with a working download, not an endless spinner", async () => {
    setProfileId("me");
    serve("hang");
    const host = await open();

    expect(host.textContent).not.toContain("Loading file…");
    expect(card(host)).not.toBeNull();
    const note = host.querySelector("[role='alert']");
    expect(note).not.toBeNull();
    expect(note!.textContent!.toLowerCase()).toContain("took too long");
    expect(download(host)).not.toBeNull();
    expect(download(host)!.getAttribute("href")).toContain("api/documents/files/doc-pdf");
  });

  test("a failed lookup says why and still offers the file", async () => {
    setProfileId("me");
    serve("error");
    const host = await open();

    expect(host.textContent).not.toContain("Loading file…");
    const note = host.querySelector("[role='alert']");
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("No such file or directory");
    expect(download(host)).not.toBeNull();
  });

  test("a pdf is a card, not an embedded viewer", async () => {
    setProfileId("me");
    serve({
      document_id: "doc-pdf", filename: "LOI Page.pdf", mime: "application/pdf",
      size: 240000, uploaded_by: "me", uploaded_at: 1,
    });
    const host = await open();

    // THE VIEWER IS GONE. This is the whole point of the change: no <object>, no
    // <iframe>, no <embed> — the reader opens the file in the app that owns it.
    expect(host.querySelector("object, iframe, embed")).toBeNull();

    const it = card(host)!;
    expect(it).not.toBeNull();
    expect(it.textContent).toContain("LOI Page.pdf");
    expect(it.textContent).toContain("PDF document");
    expect(it.textContent).toContain("234 KB");
    expect(download(host)!.getAttribute("href")).toContain("api/documents/files/doc-pdf");
    expect(download(host)!.getAttribute("download")).toBe("LOI Page.pdf");
    // No bytes were ever asked for: the card reads a metadata row.
    expect(host.textContent).not.toContain("base64");
  });
});
