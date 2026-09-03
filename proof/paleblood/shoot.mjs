// Drives the REAL built app (dist-web, served by proof/paleblood/serve.mjs)
// against the REAL space-server backend, logs in as the seeded admin, selects
// the Paleblood palette in Settings, and screenshots Settings + a chat view.
import { chromium } from "playwright";

const BASE = process.env.SHOOT_BASE || "http://127.0.0.1:4173/space/";
const OUT = new URL("./", import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector(".login-box", { timeout: 15000 });
await page.fill('.login-box label:has-text("Username") input', "admin");
await page.fill('.login-box label:has-text("Password") input', "PalebloodProof123!");
await page.click('.login-box button[type="submit"]');
await page.waitForSelector(".space-chat-shell, .rail", { timeout: 15000 });

// Navigate to Settings, pick Paleblood.
await page.goto(new URL("settings", BASE).toString(), { waitUntil: "networkidle" });
await page.waitForSelector(".palette-choices", { timeout: 15000 });
const choices = await page.$$eval(".palette-choice", (nodes) => nodes.map((n) => n.textContent || ""));
console.log("palette choices:", JSON.stringify(choices));
await page.click('.palette-choice:has-text("Paleblood") input[type="radio"]');
await page.waitForTimeout(300);
const htmlClass = await page.evaluate(() => document.documentElement.className);
const colorScheme = await page.evaluate(() => document.documentElement.style.colorScheme);
console.log("html class:", htmlClass, "colorScheme:", colorScheme);
await page.screenshot({ path: new URL("settings-paleblood.png", OUT).pathname, fullPage: false });

// A chat view under the same palette.
await page.goto(new URL("chat", BASE).toString(), { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: new URL("chat-paleblood.png", OUT).pathname, fullPage: false });

await browser.close();
console.log("console/page errors:", JSON.stringify(errors.slice(0, 20)));
console.log("DONE");
