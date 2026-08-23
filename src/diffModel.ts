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
