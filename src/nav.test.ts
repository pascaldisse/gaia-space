import { expect, test, describe } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Regression guard for cross-view navigation: every requestView("X") string
// literal in the source must reference a real registry destination key in
// App.tsx. A stale label (e.g. requestView("Portfolio") when the destination
// is "Projects") silently no-ops in the App effect, breaking the link.

const srcDir = import.meta.dir;

// Extract registry destination keys from the `const registry: Record<...> = { ... }` block.
function registryKeys(): Set<string> {
  const app = readFileSync(join(srcDir, "App.tsx"), "utf8");
  const start = app.indexOf("const registry");
  expect(start).toBeGreaterThanOrEqual(0);
  const braceOpen = app.indexOf("{", start);
  // Walk to the matching closing brace of the registry object literal.
  let depth = 0, end = -1;
  for (let i = braceOpen; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = app.slice(braceOpen + 1, end);
  const keys = new Set<string>();
  // Match `name: "MyWork"` — the canonical key each entry declares.
  for (const m of body.matchAll(/name:\s*"([^"]+)"/g)) keys.add(m[1]);
  return keys;
}

// Recursively collect .ts/.tsx sources (skip tests) and their requestView literals.
function requestViewLiterals(): { file: string; label: string }[] {
  const out: { file: string; label: string }[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(ent.name) || /\.test\.tsx?$/.test(ent.name)) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/requestView\("([^"]+)"\)/g)) out.push({ file: p, label: m[1] });
    }
  };
  walk(srcDir);
  return out;
}

describe("cross-view navigation", () => {
  const keys = registryKeys();

  test("registry parses a sane set of destinations", () => {
    expect(keys.has("Projects")).toBe(true);
    expect(keys.has("Calendar")).toBe(true);
    // "Portfolio" is the component, not a destination key — must not exist.
    expect(keys.has("Portfolio")).toBe(false);
  });

  test("every requestView label targets a real registry destination", () => {
    const stale = requestViewLiterals().filter(({ label }) => !keys.has(label));
    expect(stale).toEqual([]);
  });
});
