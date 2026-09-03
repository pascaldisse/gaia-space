import { describe, expect, it, beforeEach } from "bun:test";
import { PALETTES, applyPalette, palette, setPalette } from "./theme";

/** The palette is a PREFERENCE: it must land on <html> (so portalled layers are
 *  inside it), survive a restart, and never leave two palettes on at once. */
describe("colour scheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("puts exactly one palette class on the document root", () => {
    applyPalette("dusk");
    const classes = [...document.documentElement.classList].filter((name) => name.startsWith("palette-"));
    expect(classes).toEqual(["palette-dusk"]);
    applyPalette("sand");
    expect([...document.documentElement.classList].filter((name) => name.startsWith("palette-"))).toEqual(["palette-sand"]);
  });

  it("tells the OS which scheme to draw its own furniture in", () => {
    applyPalette("dusk");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyPalette("deep");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyPalette("paleblood");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyPalette("lagoon");
    expect(document.documentElement.style.colorScheme).toBe("light");
    applyPalette("paper");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("remembers the choice", () => {
    setPalette("dusk");
    expect(palette()).toBe("dusk");
    expect(localStorage.getItem("space.theme.palette")).toBe("dusk");
  });

  it("offers six palettes — every one with a sentence saying what it is", () => {
    expect(PALETTES.map((entry) => entry.id)).toEqual(["paper", "sand", "dusk", "lagoon", "deep", "paleblood"]);
    for (const entry of PALETTES) expect(entry.hint.length).toBeGreaterThan(20);
  });
});
