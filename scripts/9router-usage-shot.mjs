// Screenshot the 9router admin UI served under the /usage mount.
// Secrets arrive via env only (BASIC_USER/BASIC_PASS/APP_PASS) -- never logged.
// OAuth buttons are photographed, NEVER clicked.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = process.env.BASE_URL || "https://paloptic.com/usage";
const OUT = process.env.SHOT_OUT;
if (!OUT) throw new Error("SHOT_OUT required");
mkdirSync(dirname(OUT), { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  httpCredentials: { username: process.env.BASIC_USER, password: process.env.BASIC_PASS },
  viewport: { width: 1440, height: 1100 },
  ignoreHTTPSErrors: false,
});
const page = await ctx.newPage();
const log = (...a) => console.log(...a);

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
log("after /usage/ ->", page.url().replace(/\/\/[^@]*@/, "//"));

if (page.url().includes("/login")) {
  const pw = page.locator('input[type="password"]').first();
  await pw.waitFor({ timeout: 15000 });
  await pw.fill(process.env.APP_PASS || "");
  const user = page.locator('input[type="text"], input[name="username"]').first();
  if (await user.count()) await user.fill(process.env.APP_USER || "admin").catch(() => {});
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {});
  log("after login ->", page.url().replace(/\/\/[^@]*@/, "//"));
}

const target = process.env.SHOT_PATH || "/dashboard/providers/new";
await page.goto(`${BASE}${target}`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2500);
log("shot page ->", page.url().replace(/\/\/[^@]*@/, "//"));

for (const label of ["Claude Code", "Codex"]) {
  log(`visible "${label}":`, await page.getByText(label, { exact: false }).count());
}
await page.screenshot({ path: OUT, fullPage: true });
log("wrote", OUT);
await browser.close();
