/** ── COLOUR SCHEME, AS A PREFERENCE ─────────────────────────────────────────
 *
 *  ONE PLACE, TOKENS ONLY. A palette is not a second design: it re-points the
 *  ~30 BASE custom properties `spaceTheme.css` builds everything else from
 *  (paper, wash, ink, line, the three status fills). Everything downstream —
 *  ~1300 colour decisions across 27 views — reads those tokens and follows
 *  without being touched. A palette that needed a rule of its own would be a
 *  fork, and the next view would forget it.
 *
 *  The class lands on <html> so PORTALLED layers (pill menus, dialogs, which
 *  leave the shell's DOM) are inside it too — `palettes.css` therefore selects
 *  `.palette-x .theme-space-light`, which outranks the plain theme scope.
 */
import { createSignal, createEffect } from "solid-js";

export type PaletteId = "paper" | "sand" | "dusk";

export const PALETTES: { id: PaletteId; label: string; hint: string }[] = [
  { id: "paper", label: "Paper", hint: "White cards on a warm off-white canvas — the default." },
  { id: "sand", label: "Sand", hint: "The same light scheme, warmer and a shade deeper — easier in a bright room." },
  { id: "dusk", label: "Dusk", hint: "Dark canvas, light text. Teal, amber and red keep their meaning." },
];

const KEY = "space.theme.palette";
const IDS = PALETTES.map((entry) => entry.id);

const read = (): PaletteId => {
  try {
    const stored = localStorage.getItem(KEY);
    return IDS.includes(stored as PaletteId) ? (stored as PaletteId) : "paper";
  } catch {
    return "paper";
  }
};

const [palette, setSignal] = createSignal<PaletteId>(read());
export { palette };

/** Applied to <html>, not to the shell: portals must inherit it too. */
export function applyPalette(id: PaletteId) {
  const root = document.documentElement;
  for (const entry of IDS) root.classList.toggle(`palette-${entry}`, entry === id);
  /* The OS draws scrollbars and form furniture from this, so a dark palette that
     forgot it would keep white scrollbars. */
  root.style.colorScheme = id === "dusk" ? "dark" : "light";
}

export function setPalette(next: PaletteId) {
  try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice is still live */ }
  setSignal(next);
  applyPalette(next);
}

/** Called once at start-up so the stored choice is on the page before first paint. */
export function initPalette() {
  applyPalette(palette());
  createEffect(() => applyPalette(palette()));
}
