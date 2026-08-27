import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime";

declare global {
  interface Window {
    __GAIA_SPACE_MOBILE__?: boolean;
  }
}

const hasTauri = () => isTauriRuntime();
export const isMobileShell = () => hasTauri() && window.__GAIA_SPACE_MOBILE__ === true;
/** A mobile shell loading a remote GAIA Space server, not its bundled setup screen. */
export const isMobileServer = () => isMobileShell() && window.location.hostname !== "tauri.localhost" && window.location.protocol !== "tauri:";
export const isMobileSetup = () => isMobileShell() && !isMobileServer();

export async function connectServer(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Enter an http:// or https:// server URL.");
  await invoke<void>("connect_space_server", { url: url.toString() });
}

export async function openServerSetup() {
  await invoke<void>("open_space_setup");
}
