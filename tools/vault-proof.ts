#!/usr/bin/env bun
// tools/vault-proof.ts — bun+playwright, one-shot live proof for the Passwords vault.
// screenshot.ts's --login helper waits for a stale ".space-chat-shell" selector that no
// longer exists in the DOM (App.tsx renders ".space-shell"), so this script reimplements
// the same login flow with the correct selector, then drives the Passwords view end to end.
//
// Usage: bun tools/vault-proof.ts
// Env overrides: VP_BASE_URL, VP_ADMIN_USER, VP_ADMIN_PASS, VP_VAULT_EMAIL, VP_VAULT_PASS

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE_URL = process.env.VP_BASE_URL ?? "https://paloptic.com/space/";
const ADMIN_USER = process.env.VP_ADMIN_USER ?? "admin";
const ADMIN_PASS = process.env.VP_ADMIN_PASS ?? "";
const VAULT_EMAIL = process.env.VP_VAULT_EMAIL ?? "vault-proof-0917@paloptic.com";
const VAULT_PASS = process.env.VP_VAULT_PASS ?? "Proof-0917-ebrietas!";
const OUT_DIR = resolve("proof/vault-0917");

if (!ADMIN_PASS) throw new Error("VP_ADMIN_PASS is required");

type NetLine = string;
const netLines: NetLine[] = [];

async function shot(page: import("playwright").Page, name: string) {
  await mkdir(OUT_DIR, { recursive: true });
  const out = resolve(OUT_DIR, name);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`SHOT ${out}`);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`CONSOLE-ERROR ${msg.text()}`);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/space/vault/")) {
      const path = url.slice(url.indexOf("/space/vault/"));
      const line = `${res.request().method()} ${path} ${res.status()}`;
      netLines.push(line);
      console.log(`NET ${line}`);
    }
  });

  // 1. Log in as the Space admin (app-level auth gate, separate from the vault account).
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator("input").first().fill(ADMIN_USER);
  await page.locator('input[type="password"]').fill(ADMIN_PASS);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".space-chat-shell").waitFor({ state: "visible", timeout: 15000 });
  console.log("LOGIN ok");

  // 2. Navigate to the Passwords view.
  await page.goto(new URL("passwords", BASE_URL).toString(), { waitUntil: "networkidle" });
  await page.locator('[aria-label="Vault unlock"]').waitFor({ state: "visible", timeout: 15000 });

  // (a) unlock card screenshot.
  await shot(page, "01-unlock.png");

  // (b) Create vault.
  await page.locator('input[aria-label="Email"]').fill(VAULT_EMAIL);
  await page.locator('input[aria-label="Master password"]').fill(VAULT_PASS);
  await page.getByRole("button", { name: "Create vault" }).click();
  await page.locator('ul[aria-label="Passwords"]').waitFor({ state: "visible", timeout: 20000 });
  const createError = await page.locator(".passwords-error").count();
  if (createError > 0) {
    const text = await page.locator(".passwords-error").first().textContent();
    throw new Error(`Create vault failed: ${text}`);
  }
  await shot(page, "02-empty.png");

  // (c) Add login.
  await page.getByRole("button", { name: "+ Login" }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  await page.locator('input[aria-label="Name"]').fill("Proof Site");
  await page.locator('input[aria-label="Username"]').fill("nari");
  await page.locator('input[aria-label="Password"]').fill("hunter2x");
  await page.locator('input[aria-label="URL"]').fill("https://example.com");
  await page.locator('input[aria-label="TOTP secret"]').fill("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator('[role="dialog"]').waitFor({ state: "hidden", timeout: 15000 });
  await page.getByText("Proof Site").first().waitFor({ state: "visible", timeout: 15000 });

  // (d) reload -> unlock again -> list shows Proof Site -> click row -> detail.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[aria-label="Vault unlock"]').waitFor({ state: "visible", timeout: 15000 });
  await page.locator('input[aria-label="Email"]').fill(VAULT_EMAIL);
  await page.locator('input[aria-label="Master password"]').fill(VAULT_PASS);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.locator('ul[aria-label="Passwords"]').waitFor({ state: "visible", timeout: 20000 });
  const unlockError = await page.locator(".passwords-error").count();
  if (unlockError > 0) {
    const text = await page.locator(".passwords-error").first().textContent();
    throw new Error(`Unlock failed: ${text}`);
  }
  await page.getByText("Proof Site").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".passwords-row", { hasText: "Proof Site" }).click();
  await page.locator('[aria-label="TOTP code"]').waitFor({ state: "visible", timeout: 15000 });
  await shot(page, "03-list-detail.png");

  // (e) reveal toggle.
  await page.getByRole("button", { name: "Reveal password" }).click();
  await page.waitForTimeout(300);
  await shot(page, "04-reveal.png");

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, "network.txt"), netLines.join("\n") + "\n");
  console.log("DONE");
} finally {
  await browser.close();
}
