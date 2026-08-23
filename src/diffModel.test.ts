import { describe, expect, test } from "bun:test";
import { diffStat, parseUnifiedDiff } from "./diffModel";

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const x = 1;
-const y = 2;
-const z = 3;
+const y = 20;
+const z = 30;
+const w = 40;
 const done = true;
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,2 +10,1 @@
 keep();
-drop();
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(SAMPLE);

  test("splits files and keeps meta", () => {
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0].meta[0]).toBe("diff --git a/src/a.ts b/src/a.ts");
    expect(files[0].hunks).toHaveLength(1);
  });

  test("pairs del/add runs and leaves extra add one-sided", () => {
    const rows = files[0].hunks[0].rows;
    expect(rows.map((r) => r.kind)).toEqual(["ctx", "chg", "chg", "add", "ctx"]);
    expect(rows[1].left).toEqual({ n: 2, text: "const y = 2;" });
    expect(rows[1].right).toEqual({ n: 2, text: "const y = 20;" });
    expect(rows[3].left).toBeUndefined();
    expect(rows[3].right).toEqual({ n: 4, text: "const w = 40;" });
  });

  test("line numbers follow hunk header on both sides", () => {
    const rows = files[0].hunks[0].rows;
    expect(rows[0].left!.n).toBe(1);
    expect(rows[0].right!.n).toBe(1);
    const tail = rows[rows.length - 1];
    expect(tail.left!.n).toBe(4);
    expect(tail.right!.n).toBe(5);

    const b = files[1].hunks[0].rows;
    expect(b[0].left!.n).toBe(10);
    expect(b[1]).toEqual({ kind: "del", left: { n: 11, text: "drop();" } });
  });

  test("ignores no-newline marker", () => {
    const f = parseUnifiedDiff("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n");
    expect(f[0].hunks[0].rows).toEqual([
      { kind: "chg", left: { n: 1, text: "a" }, right: { n: 1, text: "b" } },
    ]);
  });

  test("empty text yields no files", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n")).toEqual([]);
  });

  test("stat counts changed lines on both sides", () => {
    expect(diffStat(files)).toEqual({ files: 2, additions: 3, deletions: 3 });
  });
});
