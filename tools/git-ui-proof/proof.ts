/* Headless proof for the Repos "Changes" tab (T003 L2): real Repos.tsx in vite + real
 * libgit2 via the git-rpc bin. Usage: bun tools/git-ui-proof/proof.ts [outPng]
 * Needs `cargo build --bin git-rpc` (CARGO_TARGET_DIR honoured). No screencapture. */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const out = resolve(process.argv[2] ?? join(root, "reports/git-ui/changes.png"));
const target = process.env.CARGO_TARGET_DIR ?? join(root, "src-tauri/target");
const rpc = join(target, "debug/git-rpc");
const work = mkdtempSync(join(root, "reports/git-ui/work-"));
const repo = join(work, "demo");
const git = (...a: string[]) => {
  const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const lines = (edits: Record<number, string> = {}) =>
  Array.from({ length: 40 }, (_, i) => edits[i + 1] ?? `line${i + 1}`).join("\n") + "\n";
mkdirSync(repo, { recursive: true });
spawnSync("git", ["init", "-q", repo]);
git("config", "user.name", "Proof");
git("config", "user.email", "proof@example.com");
writeFileSync(join(repo, "app.txt"), lines());
writeFileSync(join(repo, "README.md"), "hello\n");
git("add", ".");
git("commit", "-qm", "base");
git("branch", "feature/old"); // merged branch, deletable
// dirty: app.txt has TWO hunks; README modified; notes.txt untracked
writeFileSync(join(repo, "app.txt"), lines({ 3: "EDIT-FIRST-HUNK", 37: "EDIT-SECOND-HUNK" }));
writeFileSync(join(repo, "README.md"), "hello world\n");
writeFileSync(join(repo, "notes.txt"), "todo\n");

const server = await createServer({ root, server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls!.local[0].replace(/\/$/, "");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fail: string[] = [];
try {
  page.on("pageerror", (e) => fail.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => d.accept());
  await page.exposeFunction("__rpc", (cmd: string, args: unknown) => {
    if (cmd === "repo_list") return [{ path: repo, name: "demo" }];
    if (cmd === "list_projects" || cmd === "list_hosted_repos") return [];
    const r = spawnSync(rpc, [cmd], { input: JSON.stringify(args ?? {}), encoding: "utf8" });
    const reply = JSON.parse(r.stdout || '{"ok":false,"error":"no output"}');
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  });
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = { invoke: (cmd: string, args: unknown) => (window as any).__rpc(cmd, args), transformCallback: () => 0 };
  });
  await page.goto(`${base}/tools/git-ui-proof/index.html`);
  await page.getByText("Local Changes").first().click();
  await page.getByTestId("lc-unstaged").waitFor();
  const tid = (id: string) => page.getByTestId(id);
  const count = async (id: string) => (await tid(id).locator("li:not(.hint)").count());
  const expect = (name: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) fail.push(name); };

  expect("initial: 0 staged / 2 unstaged / 1 untracked", (await count("lc-staged")) === 0 && (await count("lc-unstaged")) === 2 && (await count("lc-untracked")) === 1);
  // open app.txt -> hunk view shows two hunks; stage the SECOND one via the UI
  await tid("lc-unstaged").getByText("app.txt").click();
  await page.getByTestId("hunk-view").waitFor();
  expect("hunk view shows 2 hunks", (await page.locator(".hunk").count()) === 2);
  await page.locator(".hunk").nth(1).getByText("Stage hunk").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lc-staged"] li:not(.hint)').length === 1);
  const cached = git("diff", "--cached", "--", "app.txt");
  expect("git CLI: only 2nd hunk staged", cached.includes("+EDIT-SECOND-HUNK") && !cached.includes("EDIT-FIRST-HUNK"));
  expect("app.txt now in staged AND unstaged", (await count("lc-staged")) === 1 && (await count("lc-unstaged")) === 2);
  // stage README by file button, commit with amend checkbox unchecked
  await page.getByLabel("Stage README.md").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lc-staged"] li:not(.hint)').length === 2);
  await page.getByPlaceholder("Commit message").fill("proof commit");
  // leave the repo dirty for the screenshot: do the commit assertion on a second pass below
  // create + checkout a branch via the sidebar
  await page.getByLabel("New branch name").fill("gv/demo-branch");
  await page.getByText("Create & checkout").click();
  await page.waitForFunction(() => document.body.innerText.includes("gv/demo-branch"));
  expect("git CLI: HEAD is gv/demo-branch", git("rev-parse", "--abbrev-ref", "HEAD").trim() === "gv/demo-branch");
  expect("staged index survived the checkout", git("diff", "--cached", "--name-only").trim().split("\n").sort().join() === "README.md,app.txt");
  // delete the merged branch via its button (dialog auto-accepted)
  await page.getByLabel("Delete branch feature/old").click();
  await page.waitForFunction(() => !document.body.innerText.includes("feature/old"));
  expect("git CLI: feature/old deleted", !git("branch", "--list", "feature/old").trim());
  // re-open the hunk view for the screenshot: first hunk of app.txt, unstaged side
  await tid("lc-unstaged").getByText("app.txt").click();
  await page.getByTestId("hunk-view").waitFor();
  await page.waitForTimeout(300);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`screenshot ${out}`);
  // commit + amend through the UI
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lc-staged"] li:not(.hint)').length === 0);
  expect("git CLI: commit created", git("log", "-1", "--format=%s").trim() === "proof commit");
  const before = git("rev-parse", "HEAD").trim();
  await page.getByLabel("Stage notes.txt").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lc-staged"] li:not(.hint)').length === 1);
  await page.getByLabel("Amend last commit").check();
  await page.getByRole("button", { name: "Amend", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lc-staged"] li:not(.hint)').length === 0);
  expect("git CLI: amend replaced HEAD (same count, new sha, subject kept)", git("rev-parse", "HEAD").trim() !== before && git("rev-list", "--count", "HEAD").trim() === "2" && git("log", "-1", "--format=%s").trim() === "proof commit" && git("show", "--name-only", "--format=", "HEAD").includes("notes.txt"));
  // discard the remaining unstaged first hunk file
  await page.getByLabel("Discard app.txt").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="lc-unstaged"] li:not(.hint)').length === 0);
  expect("git CLI: working tree clean after discard", git("status", "--porcelain").trim() === "");
} catch (e) {
  fail.push(String(e));
  await page.screenshot({ path: out.replace(/\.png$/, "-failure.png") }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
  rmSync(work, { recursive: true, force: true });
}
if (fail.length) { console.error("FAILED:\n" + fail.join("\n")); process.exit(1); }
console.log("ALL PASS");
