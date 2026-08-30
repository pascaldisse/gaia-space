import { afterEach, expect, test } from "bun:test";
import { mock } from "bun:test";
import { invoke } from "./api/invoke";
// Views reached by a mounted App call the Tauri IPC package; in tests it has no
// bridge, so route it through the same HTTP transport the web build uses.
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { render } from "solid-js/web";
import { authChecked, checkAuth, isWeb, profileLocked } from "./session";
import App from "./App";
import { hrefFor } from "./router";

const runtime = window as Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __GAIA_SPACE_MOBILE__?: boolean;
};
const fetchBefore = globalThis.fetch;
// The test document's location is not the bundled shell origin (not
// `tauri.localhost`, not the `tauri:` protocol), i.e. it already looks like a
// remote page to isMobileServer(); only the __GAIA_SPACE_MOBILE__ marker
// (set by src-tauri/src/lib.rs on the mobile shell) is missing.

let dispose: (() => void) | undefined;
const mount = (online: boolean) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => App({ online }), host);
  return host;
};
const settle = () => new Promise((r) => setTimeout(r, 0));
// One stub for a mounted App: it answers both the auth probe and the command
// bridge, and records which auth requests were made.
const stubServer = () => {
  const auth: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("api/auth")) { auth.push(url); return Response.json({ user: null }); }
    return Response.json({ ok: true, value: [] });
  }) as unknown as typeof fetch;
  return auth;
};

afterEach(() => {
  dispose?.(); dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = fetchBefore;
  delete runtime.__TAURI__;
  delete runtime.__TAURI_INTERNALS__;
  delete runtime.__GAIA_SPACE_MOBILE__;
});

test("online is the default in a browser and can be disabled by its caller", () => {
  expect(isWeb()).toBe(true);
  expect(isWeb(false)).toBe(false);
});

test("a Tauri global disables the login gate even without internals", () => {
  runtime.__TAURI__ = {};
  expect(isWeb()).toBe(false);
});

test("the internal Tauri bridge also disables the login gate", () => {
  runtime.__TAURI_INTERNALS__ = { invoke: async () => undefined };
  expect(isWeb()).toBe(false);
});

test("the local Tauri shell makes no auth request", async () => {
  runtime.__TAURI__ = {};
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; return new Response(); }) as unknown as typeof fetch;
  await checkAuth();
  expect(requests).toBe(0);
});

// --- caller-threaded contract (no ambient mode state) ---------------------

// Local desktop shell: App renders with online=false, so nothing in the session
// may assume web, not even in a browser-like runtime without Tauri globals.
test("an offline caller: no auth request, no login gate, profile stays free", async () => {
  expect(isWeb(false)).toBe(false);
  expect(profileLocked(false)).toBe(false);
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; return new Response(); }) as unknown as typeof fetch;
  await checkAuth(false);
  expect(requests).toBe(0);
  expect(authChecked()).toBe(true); // checkAuth is the only setter, and it opened the shell
});

// Remote mobile: the shell has Tauri globals but loads a real server over HTTP
// (src-tauri/src/lib.rs sets __GAIA_SPACE_MOBILE__), so login/auth DOES happen.
test("the remote mobile shell authenticates like the web client", async () => {
  runtime.__TAURI__ = {};
  runtime.__TAURI_INTERNALS__ = { invoke: async () => undefined };
  runtime.__GAIA_SPACE_MOBILE__ = true;
  expect(isWeb()).toBe(true);
  expect(profileLocked()).toBe(true);
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; return Response.json({ user: null }); }) as unknown as typeof fetch;
  await checkAuth();
  expect(requests).toBe(1);
});

test("an online web caller keeps the auth gate and locks the acting-as profile", async () => {
  expect(isWeb(true)).toBe(true);
  expect(profileLocked(true)).toBe(true);
  let requests = 0;
  globalThis.fetch = (async () => { requests += 1; return Response.json({ user: null }); }) as unknown as typeof fetch;
  await checkAuth(true);
  expect(requests).toBe(1);
});

// --- transport seam: one shared Tauri predicate (src/api/invoke.ts) --------

test("a __TAURI__-only page has no IPC bridge and falls back to the HTTP command", async () => {
  runtime.__TAURI__ = {}; // recognised by runtime.ts, but no invoke bridge exists
  let url = "";
  globalThis.fetch = (async (input: string) => { url = String(input); return Response.json({ ok: true, value: 7 }); }) as unknown as typeof fetch;
  expect(await invoke<number>("ping")).toBe(7);
  expect(url).toContain("api/cmd/ping");
});

test("the desktop IPC bridge is used when the internals object is present", async () => {
  let called = "";
  runtime.__TAURI_INTERNALS__ = { invoke: async (cmd: string) => { called = cmd; return 1; } };
  globalThis.fetch = (async () => { throw new Error("desktop must not use HTTP"); }) as unknown as typeof fetch;
  expect(await invoke<number>("ping")).toBe(1);
  expect(called).toBe("ping");
});

// --- App mounted for real: the strongest available evidence short of a live
// --- Tauri run (no app-tools on this machine, so live remains unverified).

test("App(online=false) mounts the shell directly: no login, no auth request", async () => {
  const auth = stubServer();
  const host = mount(false);
  await settle();
  expect(auth).toEqual([]);
  expect(host.querySelector(".login")).toBeNull();
  expect(host.textContent).not.toContain("Sign in");
  expect(host.querySelector(".space-shell-loading")).toBeNull(); // gate not pending
  expect(host.querySelector(".space-chat-shell")).not.toBeNull();
  expect(authChecked()).toBe(true);
});

test("App(online=true) in a browser gates on login and asks the server who I am", async () => {
  const auth = stubServer();
  const host = mount(true);
  await settle();
  expect(auth.length).toBe(1);
  expect(host.querySelector(".space-chat-shell")).toBeNull();
  expect(host.querySelector("input[type=password]")).not.toBeNull(); // the login form
});

// Adapter evidence comes from the installed adapter's own link grammar
// (hash `#/x` vs path `/base/x`), asked through hrefFor — it never re-reads
// App's branch, so it cannot fail the same way the branch would.
test("App(online=false) installs the hash adapter", async () => {
  stubServer();
  mount(false);
  await settle();
  // hrefFor asks the installed adapter itself; it never re-reads App's branch.
  expect(hrefFor({ view: "Settings" })).toBe("#/settings");
});

test("App(online=true) installs the path adapter", async () => {
  stubServer();
  mount(true);
  await settle();
  const href = hrefFor({ view: "Settings" });
  expect(href.startsWith("#")).toBe(false);
  expect(href).toContain("settings");
});

test("the remote mobile page keeps using HTTP even with the IPC bridge present", async () => {
  runtime.__TAURI_INTERNALS__ = { invoke: async () => { throw new Error("mobile server must not use IPC"); } };
  runtime.__GAIA_SPACE_MOBILE__ = true;
  globalThis.fetch = (async () => Response.json({ ok: true, value: 3 })) as unknown as typeof fetch;
  expect(await invoke<number>("ping")).toBe(3);
});
