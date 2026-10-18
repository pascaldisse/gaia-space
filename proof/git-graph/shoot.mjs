// Headless proof: vite preview (built proof harness) + playwright headless chromium page.screenshot.
// Backend = the REAL git.rs via src-tauri/examples/git_cli (cargo build --example git_cli first).
// Params (env): GIT_PROOF_REPO (default: this checkout), GIT_PROOF_PORT (4173), GIT_PROOF_OUT
// (reports/git-ui), GIT_CLI (path to built git_cli), GIT_PROOF_VIEWPORT ("1800x1000").
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repo = process.env.GIT_PROOF_REPO ?? root;
const port = Number(process.env.GIT_PROOF_PORT ?? 4173);
const outDir = resolve(root, process.env.GIT_PROOF_OUT ?? "reports/git-ui");
const cli = process.env.GIT_CLI ?? resolve(process.env.CARGO_TARGET_DIR ?? `${root}/src-tauri/target`, "debug/examples/git_cli");
const [vw, vh] = (process.env.GIT_PROOF_VIEWPORT ?? "1800x1000").split("x").map(Number);
mkdirSync(outDir, { recursive: true });

const run = (cmd, args) =>
  new Promise((ok, fail) => {
    const p = spawn(cli, [cmd, JSON.stringify(args ?? {})], { cwd: root });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => { try { ok(JSON.parse(out.trim().split("\n").pop())); } catch { fail(new Error(`${cmd}: ${err || out}`)); } });
  });

const preview = spawn("bunx", ["vite", "preview", "--config", "vite.proof.config.ts", "--host", "127.0.0.1"], { cwd: root, env: { ...process.env, GIT_PROOF_PORT: String(port) }, stdio: "inherit" });
const stop = () => preview.kill();
process.on("exit", stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {} await Bun.sleep(250); }

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  const calls = [];
  page.on("console", (m) => { if (m.type() === "error") console.error("console.error:", m.text()); });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.exposeFunction("__gitProof", async (cmd, args) => {
    calls.push(cmd);
    if (cmd === "repo_list") return [{ path: repo, name: repo.split("/").pop() }];
    if (["list_projects", "list_hosted_repos"].includes(cmd)) return [];
    const r = await run(cmd, args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  });
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => window.__gitProof(cmd, args ?? {}), transformCallback: () => 0 };
    window.__TAURI__ = {};
    localStorage.setItem("repos.center.width", String(window.innerWidth * 0.5)); // wide center pane so lanes + chips + summary all read
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.waitForSelector(".graph-row", { timeout: Number(process.env.GIT_PROOF_TIMEOUT ?? 15000) }).catch(async (e) => { await page.screenshot({ path: resolve(root, "dist-proof/failure.png") }); throw e; });
  await page.waitForSelector("[data-head-marker]");
  await page.screenshot({ path: `${outDir}/graph.png` });
  // click a row -> commit detail panel (meta + changed files); then a file -> Diff tab
  await page.locator(".graph-row").nth(1).click();
  await page.waitForSelector(".commit-meta dl");
  await page.waitForSelector(".file-list li.file-open");
  await page.screenshot({ path: `${outDir}/graph-detail.png` });
  await page.locator(".file-list li.file-open").first().click();
  await page.waitForSelector(".detail-tabs button.active:has-text('Changes')");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/graph-diff.png` });
  const stats = await page.evaluate(() => ({
    rows: document.querySelectorAll(".graph-row").length,
    chips: document.querySelectorAll(".graph-row .ref-badge").length,
    headMarkers: document.querySelectorAll("[data-head-marker]").length,
    paths: document.querySelectorAll(".graph-row svg path").length,
  }));
  console.log(JSON.stringify({ repo, stats, calls: [...new Set(calls)] }));
} finally {
  await browser.close();
  stop();
}
