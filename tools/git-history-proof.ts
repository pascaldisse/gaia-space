// Headless proof of the Repos "History ops" rebase plan editor.
//   bun tools/git-history-proof.ts [--out reports/git-ui/rebase.png] [--port 5317]
// Starts vite, mocks the Tauri IPC bridge in the page (no desktop window, no screencapture),
// drives the real Repos view with playwright and writes page.screenshot(). The IPC mock is
// fixture data — backend behaviour is covered by `cargo test git::`; this proves the UI.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const arg = (name: string, fallback: string) => {
  const i = Bun.argv.indexOf(name);
  return i >= 0 ? Bun.argv[i + 1] : fallback;
};
const out = resolve(arg("--out", "reports/git-ui/rebase.png"));
const port = Number(arg("--port", "5317"));
const url = `http://localhost:${port}`;

const REPO = "/work/demo-repo";
const ids = ["b1a5e00c", "a1f0c2d3", "c2d9e8f1", "d3e4a5b6", "e4f5b6c7"].map((s) => s.repeat(5).slice(0, 40));
const summaries = ["Initial import", "Add commit graph lanes", "fix lane overlap", "Add stage/unstage", "wip: debugging"];
const now = Math.floor(Date.now() / 1000);
const commits = ids.map((id, i) => ({
  id, short_id: id.slice(0, 8), summary: summaries[i], author: "Pascal", email: "p@example.com",
  time: now - (ids.length - i) * 3600, parents: i ? [ids[i - 1]] : [],
})).reverse();

const mock = `
  const REPO = ${JSON.stringify(REPO)};
  const commits = ${JSON.stringify(commits)};
  const plan = ${JSON.stringify(ids.slice(1).map((id, i) => ({ id, action: "pick", summary: summaries[i + 1], message: null })))};
  window.__IPC_LOG__ = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      window.__IPC_LOG__.push({ cmd, args });
      switch (cmd) {
        case "repo_list": return [{ path: REPO, name: "demo-repo" }];
        case "repo_info": return { path: REPO, name: "demo-repo", head: "main", detached: false, bare: false };
        case "repo_log": return commits;
        case "repo_branches": return [{ name: "main", is_head: true, remote: false, target: commits[0].id }];
        case "repo_commit_files": return [{ path: "src/graph.ts", status: "M" }];
        case "repo_rebase_plan": return plan;
        case "repo_rebase_apply": return { status: "done", head: commits[0].id, message: "rebased", conflicts: [], abort_command: null };
        default: return [];
      }
    },
  };
`;

const vite = Bun.spawn(["bun", "--bun", "vite", "--port", String(port), "--strictPort"], { stdout: "pipe", stderr: "pipe" });
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await Bun.sleep(200);
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
    page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLE", m.text().slice(0, 300)); });
    page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
    await page.addInitScript(mock);
    // narrow the commit-list pane so the detail pane (where History ops lives) has room
    await page.addInitScript("localStorage.setItem('repos.center.width', '420'); localStorage.setItem('repos.side.width', '200');");
    await page.goto(url, { waitUntil: "load" });
    await page.goto(`${url}/#/repos`, { waitUntil: "load" });
    await page.getByText("Initial import").first().waitFor({ timeout: 20000 });
    await page.getByText("Initial import").first().click();
    await page.getByRole("button", { name: "Rebase onto this…" }).click();
    const editor = page.getByTestId("rebase-editor");
    await editor.waitFor({ state: "visible" });
    const sel = (i: number) => editor.locator("tbody tr").nth(i).locator("select");
    await sel(1).selectOption("squash");
    await sel(2).selectOption("reword");
    await editor.locator("tbody tr").nth(2).locator('input[type="text"]').fill("Add stage/unstage + hunks");
    await sel(3).selectOption("drop");
    await editor.scrollIntoViewIfNeeded();
    await mkdir(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    const actions = await editor.locator("tbody tr").evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.action));
    console.log("ROW ACTIONS", JSON.stringify(actions));
    await page.getByRole("button", { name: "Start rebase" }).click();
    await page.waitForTimeout(300);
    const applied = await page.evaluate(() => (window as any).__IPC_LOG__.filter((c: any) => c.cmd.startsWith("repo_rebase")));
    console.log("IPC", JSON.stringify(applied));
    console.log("SHOT", out);
  } finally {
    await browser.close();
  }
} finally {
  vite.kill();
}
