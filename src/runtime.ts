type TauriRuntime = {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

const runtimeWindow = (): TauriRuntime | undefined =>
  typeof window === "undefined" ? undefined : window as Window & TauriRuntime;

/** Both globals are supplied by supported Tauri configurations. */
export const isTauriRuntime = (runtime: TauriRuntime | undefined = runtimeWindow()): boolean =>
  runtime?.__TAURI__ !== undefined || runtime?.__TAURI_INTERNALS__ !== undefined;
