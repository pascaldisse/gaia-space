/**
 * Vaultwarden (Bitwarden-compatible) REST client. Unlike every other `src/api/*` file this
 * does NOT go through the space `invoke`/`api/cmd` bridge — Vaultwarden speaks its own wire
 * protocol at a same-origin path (`/space/vault`, Caddy → 127.0.0.1:8095), so this talks to it
 * with plain `fetch`. Crypto (PBKDF2/EncString/TOTP) lives in `../vault/crypto.ts`; this file is
 * transport + wire shapes only.
 */
import { createSignal } from "solid-js";
import { isTauriRuntime } from "../runtime";
import { isMobileShell } from "../mobile";

const DEFAULT_VAULT_BASE = "/space/vault";
/** The desktop Tauri window is not served from the real domain (its origin is the packaged
 *  webview's own, e.g. `tauri://localhost`), so a same-origin fetch would hit nothing there —
 *  it must fully qualify the URL. The mobile shell is different: once connected, it has
 *  NAVIGATED to the selected server's own origin (see `../mobile.ts`), so a relative fetch is
 *  already correct there, same as in a plain browser tab. */
const DESKTOP_VAULT_ORIGIN = "https://paloptic.com";

export const VAULT_BASE: string =
  (import.meta.env.VITE_VAULT_BASE as string | undefined) ?? DEFAULT_VAULT_BASE;

function vaultOrigin(): string {
  return isTauriRuntime() && !isMobileShell() ? DESKTOP_VAULT_ORIGIN : "";
}

const vaultUrl = (path: string) => `${vaultOrigin()}${VAULT_BASE}${path}`;

// --- session (access token: memory only, never persisted) -------------------

const [accessTokenSignal, setAccessTokenSignal] = createSignal<string | null>(null);
const [refreshTokenSignal, setRefreshTokenSignal] = createSignal<string | null>(null);
export const accessToken = accessTokenSignal;
export const hasSession = () => accessTokenSignal() !== null;
export function clearSession(): void {
  setAccessTokenSignal(null);
  setRefreshTokenSignal(null);
}

const DEVICE_ID_KEY = "space.vault.device";
function deviceIdentifier(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// --- errors -------------------------------------------------------------

export type VaultErrorCode = "ArgonUnsupported" | "HttpError" | "NetworkError";
export class VaultError extends Error {
  code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/** `kdf` 0 = PBKDF2 (supported); 1 = Argon2id (not implemented by `../vault/crypto.ts`). Call
 *  this right after `prelogin()`/a token response reports a KDF, before deriving any key. */
export function assertPbkdf2Kdf(kdf: number): void {
  if (kdf !== 0) {
    throw new VaultError("ArgonUnsupported", "This vault uses Argon2, which isn't supported here yet.");
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(vaultUrl(path), { credentials: "include", ...init });
  } catch (e) {
    throw new VaultError("NetworkError", e instanceof Error ? e.message : "the vault could not be reached");
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON body (some Vaultwarden error pages) — fall through to the status-only message.
    }
  }
  if (!res.ok) {
    const err = body as { message?: string; error?: string; error_description?: string; ErrorModel?: { Message?: string } } | null;
    const message =
      err?.error_description ?? err?.message ?? err?.ErrorModel?.Message ?? err?.error ?? `HTTP ${res.status}`;
    throw new VaultError("HttpError", message);
  }
  return body as T;
}

function authHeaders(): Record<string, string> {
  const token = accessTokenSignal();
  if (!token) throw new VaultError("HttpError", "not unlocked (no access token)");
  return { Authorization: `Bearer ${token}` };
}

// --- prelogin / register / login / refresh ----------------------------------

export type PreloginResponse = {
  kdf: number;
  kdfIterations: number;
  kdfMemory?: number | null;
  kdfParallelism?: number | null;
};

export async function prelogin(email: string): Promise<PreloginResponse> {
  return request<PreloginResponse>("/identity/accounts/prelogin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

/**
 * Wire shape verified against vaultwarden's `RegisterData` (src/api/core/accounts.rs): this is
 * the untagged `RegisterDataOld` compat branch (`#[serde(flatten)] kdf: KDFData`, `key` aliased
 * from `userSymmetricKey`, `masterPasswordHash`) plus the top-level `email`/`name` fields. Newer
 * clients also support a `RegisterDataCur` shape (`masterPasswordAuthentication` /
 * `masterPasswordUnlock`); this client intentionally speaks only the old, simpler one.
 * `keys` (asymmetric RSA keypair) is optional server-side and omitted here (orgs/sharing, both
 * unsupported — see docs/specs/passwords-vault.md).
 */
export type RegisterBody = {
  email: string;
  name?: string;
  masterPasswordHash: string;
  key: string;
  kdf: 0;
  kdfIterations: number;
};
export type RegisterResponse = { object: string; captchaBypassToken: string };

export async function register(body: RegisterBody): Promise<RegisterResponse> {
  return request<RegisterResponse>("/identity/accounts/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type LoginResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  /** The account's userKey, wrapped (EncString) under the stretched master key. */
  Key: string;
  PrivateKey?: string | null;
  Kdf?: number;
  KdfIterations?: number;
  scope?: string;
  [key: string]: unknown;
};

function applyTokenResponse(result: LoginResponse): void {
  setAccessTokenSignal(result.access_token);
  setRefreshTokenSignal(result.refresh_token ?? refreshTokenSignal());
}

export async function login(email: string, masterPasswordHash: string): Promise<LoginResponse> {
  const body = new URLSearchParams({
    grant_type: "password",
    username: email,
    password: masterPasswordHash,
    scope: "api offline_access",
    client_id: "web",
    deviceType: "9",
    deviceIdentifier: deviceIdentifier(),
    deviceName: "GAIA Space",
  });
  const result = await request<LoginResponse>("/identity/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  applyTokenResponse(result);
  return result;
}

export async function refresh(): Promise<LoginResponse> {
  const current = refreshTokenSignal();
  if (!current) throw new VaultError("HttpError", "no refresh token to renew the session with");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current, client_id: "web" });
  const result = await request<LoginResponse>("/identity/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  applyTokenResponse(result);
  return result;
}

// --- sync + ciphers -----------------------------------------------------

/**
 * Wire shape verified against vaultwarden's `CipherData` (src/api/core/ciphers.rs): `id`,
 * `folderId`, `organizationId` (aliased `organizationID`), `key`, `type` (1 Login, 2 SecureNote,
 * 3 Card, 4 Identity, 5 SshKey), `name`, `notes`, `fields`, exactly one of
 * `login`/`secureNote`/`card`/`identity`/`sshKey` matching `type`, `favorite`, `reprompt`,
 * `passwordHistory`, `lastKnownRevisionDate`. All string fields that hold vault content
 * (`name`, `notes`, login sub-fields, ...) are EncStrings, opaque to this file.
 */
export type CipherType = 1 | 2 | 3 | 4 | 5; // Login | SecureNote | Card | Identity | SshKey
export type CipherLoginUri = { uri: string | null; match?: number | null };
export type CipherLogin = {
  username?: string | null;
  password?: string | null;
  totp?: string | null;
  uris?: CipherLoginUri[];
};
export type Cipher = {
  id?: string;
  folderId?: string | null;
  organizationId?: string | null;
  key?: string | null;
  type: CipherType;
  name: string;
  notes?: string | null;
  favorite?: boolean;
  reprompt?: number;
  login?: CipherLogin | null;
  secureNote?: { type: number } | null;
  card?: Record<string, unknown> | null;
  identity?: Record<string, unknown> | null;
  passwordHistory?: unknown[] | null;
  revisionDate?: string;
  deletedDate?: string | null;
  [key: string]: unknown;
};
export type Folder = { id?: string; name: string; revisionDate?: string };
export type SyncResponse = { ciphers: Cipher[]; folders: Folder[]; [key: string]: unknown };

export async function sync(): Promise<SyncResponse> {
  return request<SyncResponse>("/api/sync", { headers: authHeaders() });
}

export async function createCipher(cipher: Cipher): Promise<Cipher> {
  return request<Cipher>("/api/ciphers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(cipher),
  });
}

export async function updateCipher(id: string, cipher: Cipher): Promise<Cipher> {
  return request<Cipher>(`/api/ciphers/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(cipher),
  });
}

/** Soft delete (trash) — `PUT /api/ciphers/{id}/delete`, matching vaultwarden's
 *  `delete_cipher_put` route (`CipherDeleteOptions::SoftSingle`). There is no hard-delete here
 *  by design: the UI's "Delete" action is trash, matching Apple Passwords / Enpass. */
export async function deleteCipher(id: string): Promise<void> {
  await request<void>(`/api/ciphers/${encodeURIComponent(id)}/delete`, {
    method: "PUT",
    headers: authHeaders(),
  });
}
