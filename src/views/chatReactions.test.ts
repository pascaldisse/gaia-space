import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { reactionChipTitle, reactionChips } from "./chatReactions";

describe("reaction chips", () => {
  it("keeps an existing reaction as a chip with its count", () => {
    const chips = reactionChips({ reactions: [{ emoji: "\u{1f44d}", count: 1, mine: false }] });
    expect(chips).toHaveLength(1);
    expect(chips[0].emoji).toBe("\u{1f44d}");
    expect(chips[0].count).toBe(1);
  });

  it("drops reactions that nobody holds any more", () => {
    expect(reactionChips({ reactions: [{ emoji: "\u{1f44d}", count: 0, mine: false }] })).toEqual([]);
    expect(reactionChips({})).toEqual([]);
  });

  it("names the reactors in the tooltip", () => {
    expect(
      reactionChipTitle({ emoji: "\u{1f44d}", count: 2, mine: true, reactors: ["Ada", "Grace"] }),
    ).toBe("\u{1f44d} Ada, Grace");
  });

  it("falls back to the bare emoji when no names came back", () => {
    expect(reactionChipTitle({ emoji: "\u{1f44d}", count: 1, mine: false })).toBe("\u{1f44d}");
    expect(reactionChipTitle({ emoji: "\u{1f44d}", count: 1, mine: false, reactors: [" "] })).toBe("\u{1f44d}");
  });
});

describe("reaction visibility (GS #11)", () => {
  const light = readFileSync(new URL("./ChatSpaceLight.css", import.meta.url), "utf8");

  it("never hides the reaction row behind a hover", () => {
    expect(light).not.toMatch(/\.reaction-row\s*\{[^}]*opacity:\s*0\b/);
    expect(light).toMatch(/\.reaction-row\s*\{[^}]*opacity:\s*1\b/);
  });

  it("still keeps the add-a-reaction palette quiet until hover", () => {
    expect(light).toMatch(/\.reaction-add\s*\{[^}]*opacity:\s*0\b/);
    expect(light).toMatch(/message-row:hover \.reaction-add/);
  });

  it("renders existing chips even in a read-only channel", () => {
    const chat = readFileSync(new URL("./Chat.tsx", import.meta.url), "utf8");
    expect(chat).toMatch(/when=\{reactionChips\(m\)\.length \|\| !activeChannel\(\)\?\.read_only\}/);
    expect(chat).toMatch(/title=\{reactionChipTitle\(r\)\}/);
  });
});
