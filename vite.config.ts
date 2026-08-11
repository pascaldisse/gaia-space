import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => ({
  plugins: [solid()],

  // `vite build --mode web` produces the plain-browser build served at
  // /space/. It redirects every `@tauri-apps/api/core` import to our
  // transport-agnostic src/api/invoke.ts wrapper (HTTP fallback), and is
  // otherwise a normal Vite build — it never touches src-tauri.
  ...(mode === "web"
    ? {
        base: "/space/",
        build: { outDir: "dist-web" },
        resolve: {
          alias: {
            "@tauri-apps/api/core": fileURLToPath(new URL("./src/api/invoke.ts", import.meta.url)),
          },
        },
      }
    : {}),

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
