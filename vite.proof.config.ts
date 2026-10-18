import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Headless proof build: proof/git-graph/ -> dist-proof/ (served with `vite preview`). Params via env.
export default defineConfig({
  plugins: [solid()],
  root: "proof/git-graph",
  base: "./",
  build: { outDir: "../../dist-proof", emptyOutDir: true },
  preview: { port: Number(process.env.GIT_PROOF_PORT ?? 4173), strictPort: true },
});
