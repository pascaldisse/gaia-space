import { expect, test, describe, afterEach, beforeEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { setProfileId, setProjectId } from "../session";
import { navigate, registerViews, setAvailableViews } from "../router";

// Opening an uploaded PDF must never end in a spinner that never stops: the bytes have
// a URL of their own, so a slow or failed *preview* still owes the reader a viewer, a
// stated reason, and a download that works.

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

/** `read_document_file` behaves as told; everything else answers empty. */
const serve = (preview: "hang" | "error" | Record<string, unknown>) => {
  globalThis.fetch = (async (url: unknown) => {
    const raw = String(url);
    const command = raw.split("api/cmd/")[1] ?? raw;
    const json = (value: unknown) =>
      new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
    if (command === "read_document_file") {
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
  test("a stalled preview ends in a stated error and a working download, not an endless spinner", async () => {
    setProfileId("me");
    serve("hang");
    const host = await open();

    expect(host.textContent).not.toContain("Loading file…");
    const alert = host.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert!.textContent!.toLowerCase()).toContain("took too long");
    const download = host.querySelector("a.file-download") as HTMLAnchorElement | null;
    expect(download).not.toBeNull();
    expect(download!.getAttribute("href")).toContain("api/documents/files/doc-pdf");
  });

  test("a failed preview says why and still offers the file", async () => {
    setProfileId("me");
    serve("error");
    const host = await open();

    expect(host.textContent).not.toContain("Loading file…");
    const alert = host.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("No such file or directory");
    expect(host.querySelector("a.file-download")).not.toBeNull();
  });

  test("a pdf is previewed from its own URL, with no base64 payload needed", async () => {
    setProfileId("me");
    serve({
      document_id: "doc-pdf", filename: "LOI Page.pdf", mime: "application/pdf",
      size: 240000, truncated: true, text: null, data_base64: null,
    });
    const host = await open();

    const frame = host.querySelector(".file-pdf") as HTMLObjectElement | null;
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("data")).toContain("api/documents/files/doc-pdf");
    expect(host.querySelector("a.file-download")).not.toBeNull();
  });
});
