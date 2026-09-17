import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  accessToken,
  assertPbkdf2Kdf,
  clearSession,
  createCipher,
  deleteCipher,
  hasSession,
  login,
  prelogin,
  refresh,
  register,
  sync,
  updateCipher,
  VaultError,
  VAULT_BASE,
} from "./vault";

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
let respond: (call: Call) => Response = () => new Response("{}", { status: 200 });

beforeEach(() => {
  calls.length = 0;
  clearSession();
  localStorage.clear();
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("prelogin / register", () => {
  test("prelogin posts the email and returns kdf settings", async () => {
    respond = () => json({ kdf: 0, kdfIterations: 600000 });
    const result = await prelogin("user@example.com");
    expect(result).toEqual({ kdf: 0, kdfIterations: 600000 });
    expect(calls[0].url).toBe(`${VAULT_BASE}/identity/accounts/prelogin`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "user@example.com" });
  });

  test("assertPbkdf2Kdf accepts 0 and rejects anything else as ArgonUnsupported", () => {
    expect(() => assertPbkdf2Kdf(0)).not.toThrow();
    try {
      assertPbkdf2Kdf(1);
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      expect((e as VaultError).code).toBe("ArgonUnsupported");
    }
  });

  test("register posts the old RegisterData shape (kdf flattened, no keys)", async () => {
    respond = () => json({ object: "register", captchaBypassToken: "" });
    await register({ email: "new@example.com", name: "New", masterPasswordHash: "hash", key: "2.iv|ct|mac", kdf: 0, kdfIterations: 600000 });
    expect(calls[0].url).toBe(`${VAULT_BASE}/identity/accounts/register`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      email: "new@example.com", name: "New", masterPasswordHash: "hash", key: "2.iv|ct|mac", kdf: 0, kdfIterations: 600000,
    });
  });
});

describe("login / refresh", () => {
  test("login sends the password grant form body and stores the access token in memory only", async () => {
    respond = () => json({ access_token: "tok-1", refresh_token: "ref-1", Key: "2.iv|ct|mac" });
    expect(hasSession()).toBe(false);
    const result = await login("user@example.com", "master-hash");
    expect(result.access_token).toBe("tok-1");
    expect(accessToken()).toBe("tok-1");
    expect(hasSession()).toBe(true);
    expect(localStorage.getItem("space.vault.access_token")).toBeNull();
    const [call] = calls;
    expect(call.url).toBe(`${VAULT_BASE}/identity/connect/token`);
    const body = new URLSearchParams(String(call.init.body));
    expect(body.get("grant_type")).toBe("password");
    expect(body.get("username")).toBe("user@example.com");
    expect(body.get("password")).toBe("master-hash");
    expect(body.get("scope")).toBe("api offline_access");
    expect(body.get("client_id")).toBe("web");
    expect(body.get("deviceType")).toBe("9");
    expect(body.get("deviceName")).toBe("GAIA Space");
    expect(body.get("deviceIdentifier")).toBeTruthy();
  });

  test("the device identifier is a uuid persisted across calls", async () => {
    respond = () => json({ access_token: "a", Key: "k" });
    await login("a@b.com", "h");
    const first = new URLSearchParams(String(calls[0].init.body)).get("deviceIdentifier");
    await login("a@b.com", "h");
    const second = new URLSearchParams(String(calls[1].init.body)).get("deviceIdentifier");
    expect(first).toBe(second);
    expect(localStorage.getItem("space.vault.device")).toBe(first);
  });

  test("refresh without a prior session is a typed HttpError, not a network call", async () => {
    await expect(refresh()).rejects.toMatchObject({ code: "HttpError" });
    expect(calls.length).toBe(0);
  });

  test("refresh sends the stored refresh token and rotates the access token", async () => {
    respond = () => json({ access_token: "tok-1", refresh_token: "ref-1", Key: "k" });
    await login("a@b.com", "h");
    respond = () => json({ access_token: "tok-2", Key: "k" });
    await refresh();
    expect(accessToken()).toBe("tok-2");
    const body = new URLSearchParams(String(calls[1].init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ref-1");
  });

  test("clearSession drops the in-memory token (Lock)", async () => {
    respond = () => json({ access_token: "tok-1", Key: "k" });
    await login("a@b.com", "h");
    expect(hasSession()).toBe(true);
    clearSession();
    expect(hasSession()).toBe(false);
    expect(accessToken()).toBeNull();
  });
});

describe("authenticated calls", () => {
  test("sync fails closed with a typed error when locked (no fetch attempted)", async () => {
    await expect(sync()).rejects.toMatchObject({ code: "HttpError" });
    expect(calls.length).toBe(0);
  });

  test("sync carries the bearer token and returns ciphers/folders", async () => {
    respond = () => json({ access_token: "tok-1", Key: "k" });
    await login("a@b.com", "h");
    respond = () => json({ ciphers: [{ id: "c1", type: 1, name: "2.iv|ct|mac" }], folders: [] });
    const result = await sync();
    expect(result.ciphers.length).toBe(1);
    const authCall = calls[1];
    expect(authCall.url).toBe(`${VAULT_BASE}/api/sync`);
    expect((authCall.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  test("createCipher / updateCipher / deleteCipher hit the expected methods and paths", async () => {
    respond = () => json({ access_token: "tok-1", Key: "k" });
    await login("a@b.com", "h");
    const cipher = { type: 1 as const, name: "2.iv|ct|mac", login: { username: "2.iv|ct|mac" } };

    respond = () => json({ id: "c1", ...cipher });
    await createCipher(cipher);
    expect(calls[1].url).toBe(`${VAULT_BASE}/api/ciphers`);
    expect(calls[1].init.method).toBe("POST");

    respond = () => json({ id: "c1", ...cipher });
    await updateCipher("c1", cipher);
    expect(calls[2].url).toBe(`${VAULT_BASE}/api/ciphers/c1`);
    expect(calls[2].init.method).toBe("PUT");

    respond = () => new Response(null, { status: 200 });
    await deleteCipher("c1");
    expect(calls[3].url).toBe(`${VAULT_BASE}/api/ciphers/c1/delete`);
    expect(calls[3].init.method).toBe("PUT");
  });
});

describe("error mapping", () => {
  test("a non-2xx JSON error body surfaces its message as a typed HttpError", async () => {
    respond = () => json({ error_description: "invalid_grant" }, 400);
    await expect(login("a@b.com", "wrong")).rejects.toMatchObject({ code: "HttpError", message: "invalid_grant" });
  });

  test("a fetch rejection surfaces as a typed NetworkError", async () => {
    respond = () => { throw new Error("boom"); };
    await expect(prelogin("a@b.com")).rejects.toMatchObject({ code: "NetworkError" });
  });
});
