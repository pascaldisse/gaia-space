/**
 * Transport-agnostic `invoke`. In Tauri (desktop) it delegates to the real
 * IPC bridge. In a plain browser (web build, served behind `/space/`) it
 * calls the HTTP command bridge at `{BASE}api/cmd/<command>` with the same
 * args object, and unwraps `{ok:true,value}` / `{ok:false,error}`.
 *
 * Every `import { invoke } from "@tauri-apps/api/core"` in this codebase is
 * redirected here via a Vite `resolve.alias`, gated on `--mode web`
 * (see vite.config.ts). The Tauri build/dev path never touches this file
 * (imports resolve to the real `@tauri-apps/api/core` package as before).
 *
 * NB: we call `window.__TAURI_INTERNALS__.invoke` directly rather than
 * `import`ing `@tauri-apps/api/core` (the real package's `invoke` is just a
 * thin wrapper around that same global) — importing the real package from
 * this file would recurse through the web-mode alias, which points
 * `@tauri-apps/api/core` right back at this file.
 */

import { isTauriRuntime } from "../runtime";

type CmdOk<T> = { ok: true; value: T };
type CmdErr = { ok: false; error: string };
type CmdResponse<T> = CmdOk<T> | CmdErr;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

// One shared runtime predicate (runtime.ts): `__TAURI__` OR `__TAURI_INTERNALS__`.
// The IPC bridge itself still needs the internals object, so dispatch also
// checks that it can actually invoke; a `__TAURI__`-only page uses HTTP.
const isTauri = () => isTauriRuntime();
const canInvoke = () =>
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
// A remote page inside the mobile shell has Tauri available, but must call its
// selected server over HTTP rather than the shell's intentionally empty IPC API.
const isMobileServer = () =>
  isTauri() &&
  window.__GAIA_SPACE_MOBILE__ === true &&
  window.location.hostname !== "tauri.localhost" &&
  window.location.protocol !== "tauri:";

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri() && canInvoke() && !isMobileServer()) {
    return window.__TAURI_INTERNALS__!.invoke(cmd, args) as Promise<T>;
  }
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}api/cmd/${cmd}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  let body: CmdResponse<T>;
  try {
    body = (await res.json()) as CmdResponse<T>;
  } catch {
    throw new Error(`${cmd}: bad response (HTTP ${res.status})`);
  }
  if (!body.ok) throw new Error(body.error);
  return body.value;
}

export type ServerCapabilities = {
  protocol: number;
  features: Record<string, boolean>;
};
/** Server handshake precedes mobile navigation; callers must gate optional surfaces on it. */
export async function serverCapabilities(
  base = import.meta.env.BASE_URL,
): Promise<ServerCapabilities> {
  const response = await fetch(`${base}api/capabilities`, {
    credentials: "include",
  });
  const body = (await response.json()) as CmdResponse<ServerCapabilities>;
  if (!response.ok || !body.ok)
    throw new Error(!body.ok ? body.error : "capability negotiation failed");
  if (body.value.protocol !== 1) throw new Error("Unsupported server protocol");
  return body.value;
}
