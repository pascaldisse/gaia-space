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
};

const DEFAULT_URL = "http://localhost:5173";
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const DEFAULT_WAIT_MS = 0;

function usage(): never {
  throw new Error("Usage: bun run shot -- --out <path> [--url <url>] [--width <px>] [--height <px>] [--mobile] [--eval <js>] [--wait <ms>]");
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

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => args[++index] ?? usage();
    switch (arg) {
      case "--url": url = value(); break;
      case "--out": out = value(); break;
      case "--width": width = numberOption("--width", value(), DEFAULT_WIDTH); break;
      case "--height": height = numberOption("--height", value(), DEFAULT_HEIGHT); break;
      case "--mobile": mobile = true; break;
      case "--eval": evaluation = value(); break;
      case "--wait": wait = numberOption("--wait", value(), DEFAULT_WAIT_MS); break;
      default: usage();
    }
  }

  if (!out || width <= 0 || height <= 0) usage();
  return { url, out, width, height, mobile, evaluation, wait };
}

const options = parseArgs(Bun.argv.slice(2));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    ...(options.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });
  await page.goto(options.url, { waitUntil: "networkidle" });

  if (options.evaluation !== undefined) {
    const result = await page.evaluate(options.evaluation);
    console.log(`EVAL ${JSON.stringify(result)}`);
    // Preferences are often read during application initialization. Reload after
    // evaluation so localStorage/session mutations are reflected in the shot.
    await page.reload({ waitUntil: "networkidle" });
  }
  if (options.wait > 0) await page.waitForTimeout(options.wait);

  const out = resolve(options.out);
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: false });
  console.log(`SHOT ${out}`);
} finally {
  await browser.close();
}
