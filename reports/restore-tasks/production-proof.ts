import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";

const configPath = process.env.SPACE_PROOF_CONFIG;
assert(configPath, "SPACE_PROOF_CONFIG required");
const { space } = await Bun.file(configPath).json();
const base = (process.env.SPACE_PROOF_URL ?? space.baseUrl).replace(/\/$/, "");
const out = process.env.SPACE_PROOF_OUT ?? `${import.meta.dir}/production`;
const before = process.env.SPACE_PROOF_BEFORE === "1";
assert(space.personalAccessToken || (space.username && space.password), "PAT or login required");
await mkdir(out, { recursive: true });
const anonymous = await fetch(`${base}/api/auth/me`);
assert.equal(anonymous.status, 401);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
if (space.personalAccessToken) await context.route(`${base}/api/**`, route => route.continue({ headers: { ...route.request().headers(), Authorization: `Bearer ${space.personalAccessToken}` } }));
else {
  const login = await context.request.post(`${base}/api/auth/login`, { data: { username: space.username, password: space.password } });
  assert.equal(login.status(), 200, "normal session login");
}
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const results = [];
try {
  for (const width of before ? [1440] : [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path, title] of before ? [["todo", "Task Ledger"], ["to-do", "My tasks"]] : [["todo", "My tasks"], ["to-do", "My tasks"], ["team-tasks", "Team tasks"], ["task-ledger", "Task Ledger"]]) {
      await page.goto(`${base}/${path}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      assert.equal((await page.locator("h1").first().innerText()).toLowerCase(), title.toLowerCase());
      if (!before && path === "todo") assert(page.url().endsWith("/to-do"));
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert(geometry.scroll <= width);
      const tasks = await page.locator("article.task-tile").count();
      const ledgerRows = await page.locator(".ledger-row").count();
      if (title === "My tasks") {
        assert(await page.getByRole("button", { name: "New task", exact: true }).isVisible());
        assert.equal(ledgerRows, 0);
      }
      if (title === "Task Ledger") assert(ledgerRows > 0);
      results.push({ path, url: page.url(), title, width, tasks, ledgerRows, geometry });
      await page.screenshot({ path: `${out}/${path}-${width}.png` });
    }
  }
  if (!before) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/todo`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).waitFor();
    await page.screenshot({ path: `${out}/composer.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").first().innerText(), "My tasks");
    await page.goto(`${base}/task-ledger`, { waitUntil: "networkidle" });
    await page.getByLabel("Status", { exact: true }).selectOption("REGRESSED");
    assert(await page.locator(".ledger-row").count() > 0);
    const statuses = await page.locator(".ledger-row .ledger-status").allTextContents();
    assert(statuses.every(status => status === "REGRESSED"));
  }
  const result = { before, auth: space.personalAccessToken ? "PAT" : "session", anonymousAuthStatus: anonymous.status, results, errors, taskWrites: "none" };
  await Bun.write(`${out}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
} finally {
  if (!space.personalAccessToken) await context.request.post(`${base}/api/auth/logout`);
  await browser.close();
}
