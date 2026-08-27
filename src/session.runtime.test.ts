import { afterEach, expect, test } from "bun:test";
import { checkAuth, isWeb } from "./session";

const runtime = window as Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __GAIA_SPACE_MOBILE__?: boolean;
};
const fetchBefore = globalThis.fetch;

afterEach(() => {
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
