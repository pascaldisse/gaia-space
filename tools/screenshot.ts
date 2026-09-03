import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Options = {
  url: string;
  out: string;
  width: number;
  height: number;
  mobile: boolean;
  evaluation?: string;
  wait: number;
  login?: { username: string; password: string };
  click?: string;
};

const DEFAULT_URL = "http://localhost:5173";
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_WAIT_MS = 0;

function usage(): never {
  throw new Error("Usage: bun run shot -- --out <path> [--url <url>] [--width <px>] [--height <px>] [--mobile] [--login <user:pass>] [--eval <js>] [--click <selector>] [--wait <ms>]");
}

function numberOption(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return parsed;
}

function parseArgs(args: string[]): Options {
  let url = DEFAULT_URL;
  let out: string | undefined;
  let width = DEFAULT_WIDTH;
  let height = DEFAULT_HEIGHT;
  let mobile = false;
  let evaluation: string | undefined;
  let wait = DEFAULT_WAIT_MS;
  let login: Options["login"];
  let click: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => args[++index] ?? usage();
    switch (arg) {
      case "--url": url = value(); break;
      case "--out": out = value(); break;
      case "--width": width = numberOption("--width", value(), DEFAULT_WIDTH); break;
      case "--height": height = numberOption("--height", value(), DEFAULT_HEIGHT); break;
      case "--mobile": mobile = true; break;
      case "--login": {
        const credentials = value();
        const separator = credentials.indexOf(":");
        if (separator <= 0 || separator === credentials.length - 1) usage();
        login = { username: credentials.slice(0, separator), password: credentials.slice(separator + 1) };
        break;
      }
      case "--eval": evaluation = value(); break;
      case "--click": click = value(); break;
      case "--wait": wait = numberOption("--wait", value(), DEFAULT_WAIT_MS); break;
      default: usage();
    }
  }

  if (!out || width <= 0 || height <= 0) usage();
  return { url, out, width, height, mobile, evaluation, wait, login, click };
}

const options = parseArgs(Bun.argv.slice(2));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    ...(options.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  await page.goto(options.url, { waitUntil: "networkidle" });
  if (options.login) {
    await page.locator("input").first().fill(options.login.username);
    await page.locator('input[type="password"]').fill(options.login.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.locator(".space-chat-shell").waitFor({ state: "visible" });
  }

  if (options.evaluation !== undefined) {
    const result = await page.evaluate(options.evaluation);
    console.log(`EVAL ${JSON.stringify(result)}`);
    // Preferences are often read during application initialization. Reload after
    // evaluation so localStorage/session mutations are reflected in the shot.
    await page.reload({ waitUntil: "networkidle" });
  }
  if (options.click) await page.locator(options.click).click();
  if (options.wait > 0) await page.waitForTimeout(options.wait);

  const out = resolve(options.out);
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log(`SHOT ${out}`);
} finally {
  await browser.close();
}
