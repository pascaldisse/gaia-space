// Markdown for a to-do body: the smallest set that survives a one-line task —
// bold, italic, inline code, and bullet lines. Output is TOKENS, never HTML, so a
// task body can never inject markup into the view.
export type InlineToken = { kind: "text" | "strong" | "em" | "code"; text: string };
export type Block = { bullet: boolean; tokens: InlineToken[] };

const PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;

export function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;
  for (const match of line.matchAll(PATTERN)) {
    const at = match.index ?? 0;
    if (at > cursor) tokens.push({ kind: "text", text: line.slice(cursor, at) });
    const raw = match[0];
    if (raw.startsWith("**")) tokens.push({ kind: "strong", text: raw.slice(2, -2) });
    else if (raw.startsWith("`")) tokens.push({ kind: "code", text: raw.slice(1, -1) });
    else tokens.push({ kind: "em", text: raw.slice(1, -1) });
    cursor = at + raw.length;
  }
  if (cursor < line.length) tokens.push({ kind: "text", text: line.slice(cursor) });
  return tokens;
}

export function parseMarkdown(body: string): Block[] {
  return body.split(/\r?\n/).map((line) => {
    const bullet = /^\s*[-*]\s+/.test(line);
    return { bullet, tokens: parseInline(bullet ? line.replace(/^\s*[-*]\s+/, "") : line) };
  });
}
