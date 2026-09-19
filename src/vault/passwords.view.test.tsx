import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "solid-js/web";
import { createMemoryAdapter, initRouter, registerViews, setAvailableViews } from "../router";
import Passwords from "../views/Passwords";
import { encryptBytes, encryptString, deriveMasterKey, generateUserKey, stretchMasterKey } from "./crypto";

const EMAIL = "user@example.com";
const PASSWORD = "correct horse battery staple";
const ITERATIONS = 100; // tiny on purpose — this is a protocol test, not a KDF-cost test

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply> = {};
const calls: string[] = [];
const realFetch = globalThis.fetch;

function routeKey(url: string): string {
  if (url.includes("/identity/accounts/prelogin")) return "prelogin";
  if (url.includes("/identity/connect/token")) return "token";
  if (url.includes("/api/sync")) return "sync";
  return url;
}

function stubFetch() {
  globalThis.fetch = (async (url: unknown) => {
    const key = routeKey(String(url));
    calls.push(key);
    const reply = replies[key] ?? { body: { error: `no stub for ${key}` }, status: 500 };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

let dispose: (() => void) | undefined;
const settle = (ms = 30) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  // CI law: a view test owns router state, even a view that (like this one) never
  // itself navigates — the shared router module is process-global.
  registerViews(["Passwords"]);
  setAvailableViews(["Passwords"]);
  initRouter(createMemoryAdapter());
  replies = {};
  calls.length = 0;
  stubFetch();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  globalThis.fetch = realFetch;
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <Passwords /> as any, host);
  return host;
}

function fill(host: HTMLElement, label: string, value: string) {
  const field = host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Builds a token response + one Login cipher, both encrypted with a REAL userKey via
 *  `../vault/crypto.ts` — same protocol the app itself uses to decrypt them. */
async function seedEncryptedVault() {
  const masterKey = await deriveMasterKey(EMAIL, PASSWORD, ITERATIONS);
  const stretched = await stretchMasterKey(masterKey);
  const userKey = generateUserKey();
  const encUserKey = await encryptBytes(stretched, userKey);
  const cipher = {
    id: "c1",
    type: 1,
    name: await encryptString(userKey, "GitHub"),
    login: {
      username: await encryptString(userKey, "octocat"),
      password: await encryptString(userKey, "hunter2"),
      uris: [],
    },
  };
  replies.prelogin = { body: { kdf: 0, kdfIterations: ITERATIONS } };
  replies.token = { body: { access_token: "tok-1", refresh_token: "ref-1", Key: encUserKey } };
  replies.sync = { body: { ciphers: [cipher], folders: [] } };
}

async function unlock(host: HTMLElement) {
  fill(host, "Email", EMAIL);
  fill(host, "Master password", PASSWORD);
  const form = host.querySelector("form[aria-label='Unlock vault']") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle(60);
}

describe("Passwords — unlock card", () => {
  test("renders the setup/unlock card with email + master password fields and both actions", () => {
    const host = mount();
    expect(host.querySelector("[aria-label='Vault unlock']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Email']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Master password']")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Unlock")).toBe(true);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Create vault")).toBe(true);
    expect(host.querySelector(".passwords-list")).toBeNull();
  });
});

describe("Passwords — unlocked list", () => {
  test("unlocking decrypts the synced cipher and lists it", async () => {
    await seedEncryptedVault();
    const host = mount();
    await unlock(host);
    expect(calls).toEqual(["prelogin", "token", "sync"]);
    expect(host.querySelector("[aria-label='Vault unlock']")).toBeNull();
    const row = host.querySelector(".passwords-row-title");
    expect(row?.textContent).toBe("GitHub");
    expect(host.querySelector(".passwords-row-meta")?.textContent).toBe("octocat");
  });

  test("search filters the list by name/username", async () => {
    await seedEncryptedVault();
    const host = mount();
    await unlock(host);
    expect(host.querySelectorAll(".passwords-row-title").length).toBe(1);

    fill(host, "Search passwords", "nothing-matches-this");
    await settle();
    expect(host.querySelectorAll(".passwords-row-title").length).toBe(0);
    expect(host.querySelector(".passwords-empty")).toBeTruthy();

    fill(host, "Search passwords", "github");
    await settle();
    expect(host.querySelectorAll(".passwords-row-title").length).toBe(1);

    fill(host, "Search passwords", "octocat");
    await settle();
    expect(host.querySelectorAll(".passwords-row-title").length).toBe(1);
  });

  test("the password field is masked until Reveal is toggled", async () => {
    await seedEncryptedVault();
    const host = mount();
    await unlock(host);
    (host.querySelector(".passwords-row") as HTMLButtonElement).click();
    await settle();

    const passwordField = [...host.querySelectorAll(".passwords-field")].find((f) => f.textContent?.includes("Password"));
    expect(passwordField?.textContent).toContain("••••••••");
    expect(passwordField?.textContent).not.toContain("hunter2");

    const reveal = host.querySelector("[aria-label='Reveal password']") as HTMLButtonElement;
    expect(reveal).toBeTruthy();
    reveal.click();
    await settle();

    const revealed = [...host.querySelectorAll(".passwords-field")].find((f) => f.textContent?.includes("Password"));
    expect(revealed?.textContent).toContain("hunter2");
    expect(host.querySelector("[aria-label='Hide password']")).toBeTruthy();
  });
});
