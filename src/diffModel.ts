// Unified-diff → side-by-side model.
// Mirrors Space's sideBySide LinesRangeMapping idea: del/add runs inside a hunk are
// paired positionally into rows; leftovers become one-sided rows. Context lines map 1:1.
// Pure data — no DOM, no I/O. Line numbers come from the @@ hunk header.

export type SideKind = "ctx" | "add" | "del" | "chg";

export interface SideCell {
  n: number;
  text: string;
}

export interface SideRow {
  kind: SideKind;
  left?: SideCell;
  right?: SideCell;
}

export type WordDiffKind = "same" | "del" | "add";
export interface WordDiffSegment {
  kind: WordDiffKind;
  text: string;
}
export interface WordDiff {
  left: WordDiffSegment[];
  right: WordDiffSegment[];
}

/** Split a changed line into displayable tokens without losing whitespace. */
function wordTokens(text: string): string[] {
  return text.match(/\s+|\w+|[^\w\s]/g) ?? [];
}

/**
 * LCS word mapping for paired changed lines. Whitespace can be treated as equal so
 * formatting-only changes do not distract the review, while displayed text stays exact.
 */
export function wordDiff(
  left: string,
  right: string,
  ignoreWhitespace = false,
): WordDiff {
  const a = wordTokens(left);
  const b = wordTokens(right);
  const same = (x: string, y: string) =>
    x === y || (ignoreWhitespace && /^\s+$/.test(x) && /^\s+$/.test(y));
  const lcs = Array.from({ length: a.length + 1 }, () =>
    Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = same(a[i], b[j])
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const result: WordDiff = { left: [], right: [] };
  const push = (side: WordDiffSegment[], kind: WordDiffKind, text: string) => {
    const last = side[side.length - 1];
    if (last?.kind === kind) last.text += text;
    else side.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(a[i], b[j])) {
      push(result.left, "same", a[i++]);
      push(result.right, "same", b[j++]);
    } else if (
      j < b.length &&
      (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])
    ) {
      push(result.right, "add", b[j++]);
    } else {
      push(result.left, "del", a[i++]);
    }
  }
  return result;
}

export interface DiffHunk {
  header: string;
  rows: SideRow[];
}

export interface DiffFile {
  path: string;
  meta: string[];
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function filePathOf(line: string): string {
  // "diff --git a/foo b/foo" → "foo"
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (m) return m[2];
  return line.replace(/^diff --git\s*/, "").trim();
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let leftNo = 0;
  let rightNo = 0;
  let delRun: SideCell[] = [];
  let addRun: SideCell[] = [];

  const flushRuns = () => {
    if (!hunk) {
      delRun = [];
      addRun = [];
      return;
    }
    const paired = Math.min(delRun.length, addRun.length);
    for (let i = 0; i < paired; i++) {
      hunk.rows.push({ kind: "chg", left: delRun[i], right: addRun[i] });
    }
    for (let i = paired; i < delRun.length; i++) {
      hunk.rows.push({ kind: "del", left: delRun[i] });
    }
    for (let i = paired; i < addRun.length; i++) {
      hunk.rows.push({ kind: "add", right: addRun[i] });
    }
    delRun = [];
    addRun = [];
  };

  const ensureFile = (path: string) => {
    file = { path, meta: [], hunks: [] };
    files.push(file);
    hunk = null;
  };

  // drop the single trailing newline of a well-formed patch; it is a terminator,
  // not an empty context line
  for (const line of text.replace(/\n$/, "").split("\n")) {
    if (line.startsWith("diff --git")) {
      flushRuns();
      ensureFile(filePathOf(line));
      file!.meta.push(line);
      continue;
    }
    const hm = HUNK_RE.exec(line);
    if (hm) {
      flushRuns();
      if (!file) ensureFile("");
      leftNo = Number(hm[1]);
      rightNo = Number(hm[3]);
      hunk = { header: line, rows: [] };
      file!.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (!file) {
        if (!line.trim()) continue;
        ensureFile("");
      }
      if (line.length) file!.meta.push(line);
      continue;
    }
    if (line.startsWith("+")) {
      addRun.push({ n: rightNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      delRun.push({ n: leftNo++, text: line.slice(1) });
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" — belongs to neither side
      continue;
    } else {
      flushRuns();
      const t = line.startsWith(" ") ? line.slice(1) : line;
      hunk.rows.push({
        kind: "ctx",
        left: { n: leftNo++, text: t },
        right: { n: rightNo++, text: t },
      });
    }
  }
  flushRuns();
  return files;
}

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
}

export function diffStat(files: DiffFile[]): DiffStat {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    for (const h of f.hunks) {
      for (const r of h.rows) {
        if (r.kind === "add") additions++;
        else if (r.kind === "del") deletions++;
        else if (r.kind === "chg") {
          additions++;
          deletions++;
        }
      }
    }
  }
  return { files: files.length, additions, deletions };
}
