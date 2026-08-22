// Rich-text/Markdown editing primitives — pure string functions so the editor logic is
// testable without a DOM, and so the same sanitizer guards every innerHTML path.

// Allowlist: structural + inline formatting only. Anything else is unwrapped (content
// kept, tag dropped) rather than deleted, so pasting from a word processor degrades to
// readable text instead of vanishing.
export const ALLOWED_TAGS = [
  "p", "br", "b", "strong", "i", "em", "u", "s", "code", "pre", "blockquote",
  "h1", "h2", "h3", "h4", "ul", "ol", "li", "a", "hr", "span", "div", "table",
  "thead", "tbody", "tr", "th", "td",
];
// `href` is the only attribute worth keeping; every other attribute (style, class,
// on*, srcdoc…) is a scripting or exfiltration surface with no editor value.
const ALLOWED_ATTRS = ["href"];
const VOID_TAGS = new Set(["br", "hr"]);

function safeHref(value: string): string | null {
  const url = value.trim();
  // Reject any scheme we do not explicitly trust, including obfuscated `java\nscript:`.
  const scheme = url.replace(/[\s\u0000-\u001f]/g, "").match(/^([a-zA-Z][\w+.-]*):/);
  if (!scheme) return url; // relative or anchor link
  return /^(https?|mailto)$/i.test(scheme[1]) ? url : null;
}

function sanitizeAttrs(raw: string): string {
  const out: string[] = [];
  const attr = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(raw))) {
    const name = m[1].toLowerCase();
    if (!ALLOWED_ATTRS.includes(name)) continue;
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    const href = safeHref(value);
    if (href === null) continue;
    out.push(`${name}="${href.replace(/"/g, "&quot;")}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

/// Strip everything scriptable from stored rich-text HTML. Applied on save *and* on
/// render: an old row written before this existed must not execute either.
export function sanitizeRichHtml(html: string): string {
  if (!html) return "";
  // Element *and* content removal — the text inside these is never document content.
  let out = html.replace(/<(script|style|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<(script|style|iframe|object|embed|noscript)\b[^>]*\/?>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  return out.replace(/<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, (tag, name: string, attrs: string) => {
    const lower = name.toLowerCase();
    if (!ALLOWED_TAGS.includes(lower)) return "";
    if (tag.startsWith("</")) return `</${lower}>`;
    return VOID_TAGS.has(lower) ? `<${lower}>` : `<${lower}${sanitizeAttrs(attrs)}>`;
  });
}

export type MarkdownCommand =
  | "bold" | "italic" | "code" | "strike"
  | "h1" | "h2" | "h3"
  | "ul" | "ol" | "quote" | "link";

export type Selection = { start: number; end: number };
export type EditResult = { body: string; start: number; end: number };

const WRAPPERS: Partial<Record<MarkdownCommand, string>> = {
  bold: "**", italic: "*", code: "`", strike: "~~",
};
const PREFIXES: Partial<Record<MarkdownCommand, string>> = {
  h1: "# ", h2: "## ", h3: "### ", quote: "> ", ul: "- ",
};

function lineRange(body: string, sel: Selection): Selection {
  const start = body.lastIndexOf("\n", sel.start - 1) + 1;
  const nl = body.indexOf("\n", sel.end);
  return { start, end: nl === -1 ? body.length : nl };
}

/// Apply a toolbar command to a Markdown body. Returns the new body plus the selection
/// the caller must restore — a toolbar that loses the caret is unusable for a second click.
export function applyMarkdownCommand(body: string, sel: Selection, cmd: MarkdownCommand): EditResult {
  const selected = body.slice(sel.start, sel.end);
  const wrap = WRAPPERS[cmd];
  if (wrap) {
    // Second click on an already-wrapped selection unwraps it (toggle, not accumulate).
    const before = body.slice(Math.max(0, sel.start - wrap.length), sel.start);
    const after = body.slice(sel.end, sel.end + wrap.length);
    if (before === wrap && after === wrap) {
      const body2 = body.slice(0, sel.start - wrap.length) + selected + body.slice(sel.end + wrap.length);
      return { body: body2, start: sel.start - wrap.length, end: sel.end - wrap.length };
    }
    const body2 = body.slice(0, sel.start) + wrap + selected + wrap + body.slice(sel.end);
    return { body: body2, start: sel.start + wrap.length, end: sel.end + wrap.length };
  }
  if (cmd === "link") {
    const text = selected || "link text";
    const inserted = `[${text}](https://)`;
    const body2 = body.slice(0, sel.start) + inserted + body.slice(sel.end);
    // Select the URL placeholder so typing replaces it.
    const urlStart = sel.start + text.length + 3;
    return { body: body2, start: urlStart, end: urlStart + 8 };
  }
  const range = lineRange(body, sel);
  const block = body.slice(range.start, range.end);
  const lines = block.split("\n");
  let next: string[];
  if (cmd === "ol") {
    const numbered = lines.every((l) => /^\s*\d+\.\s/.test(l) || !l.trim());
    next = lines.map((l, i) => (numbered ? l.replace(/^(\s*)\d+\.\s/, "$1") : `${i + 1}. ${l}`));
  } else {
    const prefix = PREFIXES[cmd]!;
    const applied = lines.every((l) => l.startsWith(prefix) || !l.trim());
    next = lines.map((l) => (applied ? (l.startsWith(prefix) ? l.slice(prefix.length) : l) : prefix + l));
  }
  const replaced = next.join("\n");
  const body2 = body.slice(0, range.start) + replaced + body.slice(range.end);
  return { body: body2, start: range.start, end: range.start + replaced.length };
}
