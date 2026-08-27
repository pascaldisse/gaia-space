#!/usr/bin/env bun
/**
 * Generate `src/spaceLightOverrides.css`.
 *
 * The token remap in spaceTheme.css converts every colour decision that already
 * goes through a custom property. What it cannot reach are the raw literals
 * still sitting in view stylesheets. Restyling 24 views by hand is the wrong
 * job; this derives the light restatement mechanically instead:
 *
 *   for every rule that paints a DARK literal surface or a NEAR-WHITE literal
 *   ink, emit the same selector prefixed with `.theme-space-light` and the
 *   light equivalent of that literal, hue preserved.
 *
 * Nothing in the source stylesheets is edited, so grouped/flat stay identical.
 * Run: bun tools/lightOverrides.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;
// Files that are already light (prototype surfaces) or already scoped.
const SKIP = new Set(["spaceTheme.css", "spaceLightOverrides.css", "HomeCalendar.css", "ChatSpaceLight.css", "WorkItemDrawer.css"]);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".css") && !SKIP.has(e)) files.push(p);
  }
})(SRC);
files.sort();

// ── colour helpers ─────────────────────────────────────────────────────────
const hex = (h) => {
  h = h.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { h: 0, s: 0 };
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / max };
};
/** hue family → the palette family it belongs to */
const family = (rgb) => {
  const { h, s } = hue(rgb);
  const L = lum(rgb);
  if (s < 0.18) return "neutral";
  // The dark theme's chrome is navy, not "blue": #0f1b33, #243050, #2b3550,
  // #141d30, #b9c2d4 … all sit in the blue arc but read as neutral greys.
  // True blue accents in this app come from tokens, not literals.
  if (h >= 195 && h < 255 && (L < 0.36 || s < 0.45)) return "neutral";
  if (h >= 150 && h < 200) return "teal";
  if (h >= 90 && h < 150) return "green";
  if (h >= 30 && h < 90) return "amber";
  if (h >= 200 && h < 250) return "blue";
  if (h >= 250 && h < 300) return "purple";
  return "red"; // 300-360 / 0-30
};
const INK = { neutral: "var(--muted)", teal: "var(--teal-ink)", green: "#1c6b44", amber: "var(--amber-ink)", blue: "#3a49a0", purple: "#5a3a8a", red: "var(--red-ink)" };
const SOFT = { neutral: "var(--wash)", teal: "var(--teal-soft)", green: "var(--green-soft)", amber: "var(--amber-soft)", blue: "#e7eaf9", purple: "#f2e9fa", red: "var(--red-soft)" };
const LINE = { neutral: "var(--line)", teal: "var(--teal)", green: "var(--green)", amber: "var(--amber)", blue: "var(--blue)", purple: "#b79ad2", red: "var(--red)" };

const INK_PROPS = /^(color|fill|stroke|caret-color|text-decoration-color|-webkit-text-fill-color)$/;
const BORDER_PROPS = /^(border|border-(top|right|bottom|left)|border-color|border-(top|right|bottom|left)-color|outline|outline-color|border-inline.*|border-block.*)$/;
const BG_PROPS = /^(background|background-color)$/;

/** literal -> light replacement, or null to keep it */
function convert(prop, raw, sel = "") {
  const rgb = raw.startsWith("#") ? hex(raw) : raw.match(/[\d.]+/g).slice(0, 3).map(Number);
  const alpha = raw.startsWith("rgba") ? Number(raw.match(/[\d.]+/g)[3] ?? 1) : 1;
  const L = lum(rgb), fam = family(rgb);
  if (INK_PROPS.test(prop)) {
    if (L < 0.5) return null;                       // already dark ink: fine on paper
    if (fam === "neutral") return L > 0.82 ? "var(--ink)" : "var(--muted)";
    return INK[fam];
  }
  if (BORDER_PROPS.test(prop)) {
    if (L > 0.72 && fam === "neutral") return "var(--line)"; // near-white hairline vanishes
    if (L >= 0.45) return null;
    return LINE[fam];
  }
  if (BG_PROPS.test(prop)) {
    if (L >= 0.5) return null;                      // already a light fill
    if (alpha <= 0.14 && fam === "neutral") return "rgba(31,35,40,0.05)"; // white veil -> ink veil
    if (fam !== "neutral") return SOFT[fam];
    // A hover/active state must move AWAY from the resting paper, never to it.
    if (/:hover|:focus|\.active|\.selected|\[aria-selected/.test(sel)) return "#f6f2ec";
    return L < 0.12 ? "var(--paper)" : "var(--wash)";
  }
  return null;
}

// ── very small CSS scanner (rules + one level of at-rule nesting) ───────────
const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

function rules(css, prefix = "") {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    const sel = css.slice(i, open).trim();
    const body = css.slice(open + 1, j - 1);
    if (sel.startsWith("@")) {
      if (/^@(media|supports|container)/.test(sel)) out.push(...rules(body, sel));
      // @keyframes / @font-face: nothing to restate
    } else if (sel) out.push({ at: prefix, sel, body });
    i = j;
  }
  return out;
}

const SKIP_SEL = /^(:root|html|body|\*|::|:where\(:root\))/;
const scope = (sel) =>
  sel.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    if (!s || SKIP_SEL.test(s) || s.startsWith(".theme-space-light")) return null;
    return `.theme-space-light ${s}`;
  });

let outCss = `/* GENERATED by tools/lightOverrides.mjs — do not hand-edit.
   Light restatement of every dark literal left in the view stylesheets, scoped
   to .theme-space-light. Source rules are untouched, so grouped/flat stay dark.
   Regenerate: bun tools/lightOverrides.mjs */\n`;
let count = 0;

for (const file of files) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const parts = [];
  for (const { at, sel, body } of rules(css)) {
    const decls = [];
    for (const decl of body.split(";")) {
      const c = decl.indexOf(":");
      if (c < 0) continue;
      const prop = decl.slice(0, c).trim().toLowerCase();
      let value = decl.slice(c + 1).trim();
      if (!value || value.includes("gradient") || value.includes("url(")) continue; // brand marks & artwork stay
      if (!LITERAL.test(value)) { LITERAL.lastIndex = 0; continue; }
      LITERAL.lastIndex = 0;
      let changed = false;
      const next = value.replace(LITERAL, (m) => { const r = convert(prop, m, sel); if (r) changed = true; return r ?? m; });
      if (changed) decls.push(`${prop}: ${next}`);
    }
    if (!decls.length) continue;
    const sels = scope(sel).filter(Boolean);
    if (!sels.length) continue;
    count += decls.length;
    const rule = `${sels.join(",\n")} { ${decls.join("; ")}; }`;
    parts.push(at ? `${at} { ${rule} }` : rule);
  }
  if (parts.length) outCss += `\n/* ── ${file.slice(SRC.length)} ── */\n${parts.join("\n")}\n`;
}

writeFileSync(join(SRC, "spaceLightOverrides.css"), outCss);
console.log(`spaceLightOverrides.css: ${count} declarations restated`);
