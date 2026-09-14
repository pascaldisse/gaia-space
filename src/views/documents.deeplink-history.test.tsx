import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Documents from "./Documents";
import { createPathAdapter, initRouter, navigate, registerViews, setAvailableViews } from "../router";
import { setProfileId, setProjectId } from "../session";

const realFetch = globalThis.fetch;
let dispose: (() => void) | undefined;

const settle = () => new Promise((done) => setTimeout(done, 250));

beforeEach(() => {
  setProfileId("me");
  setProjectId("");
  registerViews(["Documents"]);
  setAvailableViews(null);
  // Give Back somewhere meaningful to go; the deep link is added after its document loads.
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/space/dashboard");
  history.pushState({}, "", "/space/documents/my-docs/me");
  initRouter(createPathAdapter("/space/"));
  globalThis.fetch = (async (url: unknown) => {
    const command = String(url).split("api/cmd/")[1] ?? String(url);
    const value = command === "list_documents" ? [{
      id: "d-1", container_type: "project", container_id: "p-1", folder_id: null,
      doc_type: "text", body_format: "text", title: "Deep link", body: "", version: 1,
      archived: false, created_by: "me",
    }] : [];
    return new Response(JSON.stringify({ ok: true, value }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
  setProfileId("");
  setProjectId("");
  history.replaceState({}, "", "/");
});

test("resolving a container-less document deep link replaces it, so Back skips the temporary URL", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Documents />, host);
  await settle(); // resources settle before the container-less Goto/deep-link arrives
  const lengthBeforeResolution = history.length;
  navigate({ view: "Documents", entityType: "document", entityId: "d-1" });
  await settle();

  expect(location.pathname).toBe("/space/documents/project/p-1/d-1");
  // Goto adds the temporary URL; resolution must replace that slot, not append another.
  expect(history.length).toBe(lengthBeforeResolution + 1);
  let pathSeenOnBack = "";
  window.addEventListener("popstate", () => { pathSeenOnBack = location.pathname; }, { capture: true, once: true });
  history.back();
  await settle();

  // A push exposes `/documents/d-1` to Back before it is re-resolved.
  expect(pathSeenOnBack).toBe("/space/documents/my-docs/me");
  expect(location.pathname).toBe("/space/documents/my-docs/me");
});
