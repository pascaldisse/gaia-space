// Headless-Brave proof of the project Repository tab (own browser process + fresh profile;
// never touches a running Brave). Usage: bun tools/project-repo-proof.ts <projectId> <out.png>
import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

const [projectId = "proj-old-ones", out = join(homedir(), ".gaia/cache/space/project-repo-proof.png")] = process.argv.slice(2);
const base = process.env.SPACE_BASE ?? "http://127.0.0.1:8091/space";
const brave = process.env.BRAVE_BIN ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const profile = mkdtempSync(join(homedir(), ".gaia/cache/space/brave-proof-"));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: brave, headless: true, viewport: { width: 1440, height: 1500 } });
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${base}/projects/${projectId}/dev`, { waitUntil: "networkidle" });
  await page.waitForSelector(".pw-readme", { timeout: 20000 });
  await page.waitForSelector(".pw-repo-log .graph-row", { timeout: 20000 });
  const rows = await page.locator(".pw-repo-log .graph-row").count();
  console.log("commit rows:", rows, "| head:", (await page.locator(".pw-repo-head").innerText()).replace(/\n/g, " "));
  // the Repository card (heading + head line + commits + README), not the scrolled viewport
  await page.locator(".pw-card").filter({ has: page.locator(".pw-repo") }).first().screenshot({ path: out });
  console.log("saved", out);
} finally {
  await ctx.close();
}
