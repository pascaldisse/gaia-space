import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";

const base = process.env.SPACE_PROOF_URL!;
const token = process.env.SPACE_PROOF_SESSION!;
const out = process.env.SPACE_PROOF_OUT ?? import.meta.dir;
assert(base && token, "SPACE_PROOF_URL + SPACE_PROOF_SESSION required");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addCookies([{ name: "space_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const results = [];
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path, title, selector] of [
      ["todo", "My tasks", "article.task-tile"],
      ["to-do", "My tasks", "article.task-tile"],
      ["team-tasks", "Team tasks", "article.task-tile"],
      ["task-ledger", "Task Ledger", ".ledger-row"],
    ]) {
      await page.goto(`${base}/${path}`, { waitUntil: "networkidle" });
      await page.locator(selector).first().waitFor();
      assert.equal((await page.locator("h1").first().innerText()).toLowerCase(), title.toLowerCase());
      if (path === "todo") assert(page.url().endsWith("/to-do"));
      const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, content: [...document.querySelectorAll(".space-content > section")].map(x => ({ x: x.getBoundingClientRect().x, width: x.getBoundingClientRect().width, scroll: x.scrollWidth })) }));
      assert(geometry.scroll <= width, JSON.stringify(geometry));
      const rows = await page.locator(selector).count();
      await page.screenshot({ path: `${out}/${path}-${width}.png` });
      results.push({ path, width, title, rows, geometry });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/todo`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const fields = await page.locator("input,textarea,select").evaluateAll(elements => elements.map(x => ({ tag: x.tagName, placeholder: x.getAttribute("placeholder"), value: (x as HTMLInputElement).value })));
  console.log("COMPOSER", JSON.stringify(fields));
  await page.screenshot({ path: `${out}/new-task.png` });
  assert(await page.getByRole("button", { name: "Cancel", exact: true }).isVisible());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("h1").first().innerText(), "My tasks");
  assert(await page.getByRole("button", { name: "Edit Product Wiki", exact: true }).isVisible());
  assert.deepEqual(errors, []);
  await Bun.write(`${out}/browser-results.json`, JSON.stringify({ results, composer: "opened + cancelled", reload: "My tasks", errors }, null, 2));
  console.log(JSON.stringify({ results, composer: "opened + cancelled", reload: "My tasks", errors }, null, 2));
} finally { await browser.close(); }
