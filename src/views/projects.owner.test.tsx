import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "../api/invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import Projects from "./Projects";
import { setProfileId } from "../session";

// Desktop (Tauri, local sqlite) has no server session to mint an owner from:
// the only identity that exists there is the locally selected profile. If the
// client sends nothing, `projects.created_by` lands NULL and the project is
// ownerless forever. Web keeps sending nothing on purpose — the session mints it.

const calls: { cmd: string; args: any }[] = [];
const realFetch = globalThis.fetch;
const stubFetch = () => {
  globalThis.fetch = (async (url: any, init: any) => {
    const cmd = String(url).split("api/cmd/")[1] ?? String(url);
    calls.push({ cmd, args: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true, value: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = ""; calls.length = 0;
  globalThis.fetch = realFetch;
  delete (window as any).__TAURI_INTERNALS__;
});

// Desktop transport: the real Tauri IPC hook the shell installs on `window`.
const stubTauriIpc = () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => { calls.push({ cmd, args }); return Promise.resolve([]); },
  };
};

const settle = () => new Promise((done) => setTimeout(done, 30));
const createProjectThrough = async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Projects /> as any, host);
  await settle();
  const [name, key] = Array.from(host.querySelectorAll<HTMLInputElement>(".project-form input"));
  name.value = "Local project"; name.dispatchEvent(new Event("input", { bubbles: true }));
  key.value = "loc"; key.dispatchEvent(new Event("input", { bubbles: true }));
  host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  const created = calls.find((c) => c.cmd === "create_project");
  expect(created).toBeTruthy();
  return created!.args.project;
};

describe("project ownership at creation", () => {
  test("desktop binds the local profile as owner, never NULL", async () => {
    stubTauriIpc();
    setProfileId("p-local-operator");
    const project = await createProjectThrough();
    expect(project.created_by).toBe("p-local-operator");
  });

  test("web sends no owner: the session mints it server-side", async () => {
    stubFetch();
    setProfileId("p-someone-else");
    const project = await createProjectThrough();
    expect(project.created_by ?? null).toBeNull();
  });
});
