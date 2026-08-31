import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./Chat.css", import.meta.url), "utf8");

function rule(selector: string) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("GS #14 chat message density", () => {
  test("hover-only actions do not add to a message row's measured height", () => {
    const row = rule(".message-row");
    const actions = rule(".message-actions");

    // `display: none` -> `display: flex` made hover controls enter normal flow,
    // increasing the row's used height. An absolute overlay has zero flow height.
    expect(row).toMatch(/position:\s*relative/);
    expect(actions).toMatch(/position:\s*absolute/);
    expect(actions).not.toMatch(/display:\s*none/);
  });
});
