import { describe, expect, test } from "bun:test";
import { assignLanes, edgePath, orderRefs, type GraphCommit } from "./gitGraph";

function c(id: string, parents: string[] = []): GraphCommit {
  return { id, parents };
}

describe("assignLanes", () => {
  test("empty history", () => {
    expect(assignLanes([])).toEqual({ nodes: [], laneCount: 0 });
  });

  test("single root commit", () => {
    const { nodes, laneCount } = assignLanes([c("A")]);
    expect(laneCount).toBe(1);
    expect(nodes).toEqual([{ id: "A", lane: 0, parentLanes: [], passthroughLanes: [] }]);
  });

  test("linear chain stays on one lane", () => {
    // newest-first, as repo_log (TIME | TOPOLOGICAL) returns it
    const commits = [c("C", ["B"]), c("B", ["A"]), c("A")];
    const { nodes, laneCount } = assignLanes(commits);
    expect(laneCount).toBe(1);
    expect(nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(nodes[0].parentLanes).toEqual([{ id: "B", lane: 0 }]);
    expect(nodes[2].parentLanes).toEqual([]);
  });

  test("branch + merge opens a second lane for the feature branch", () => {
    // M merges A (mainline) and B (feature); both descend from Base.
    const commits = [
      c("M", ["A", "B"]),
      c("A", ["Base"]),
      c("B", ["Base"]),
      c("Base"),
    ];
    const { nodes, laneCount } = assignLanes(commits);
    expect(laneCount).toBe(2);
    expect(nodes).toEqual([
      { id: "M", lane: 0, parentLanes: [{ id: "A", lane: 0 }, { id: "B", lane: 1 }], passthroughLanes: [] },
      // While A's row is drawn on lane 0, B's own lane 1 has not been visited yet
      // and must draw a plain vertical straight through this row.
      { id: "A", lane: 0, parentLanes: [{ id: "Base", lane: 0 }], passthroughLanes: [1] },
      // Symmetric: lane 0 is now waiting on Base, and passes straight through B's row.
// B's edge curves INTO lane 0 (the surviving owner of Base), not into the freed lane 1.
      { id: "B", lane: 1, parentLanes: [{ id: "Base", lane: 0 }], passthroughLanes: [0] },
      { id: "Base", lane: 0, parentLanes: [], passthroughLanes: [] },
    ]);
  });

  test("two independent root branches use two lanes without ever merging", () => {
    const commits = [c("A2", ["A1"]), c("B2", ["B1"]), c("A1"), c("B1")];
    const { nodes, laneCount } = assignLanes(commits);
    expect(laneCount).toBe(2);
    expect(nodes.map((n) => n.lane)).toEqual([0, 1, 0, 1]);
  });

  test("octopus merge (3 parents) opens one lane per extra parent", () => {
    const commits = [
      c("M", ["A", "B", "C"]),
      c("A", ["Base"]),
      c("B", ["Base"]),
      c("C", ["Base"]),
      c("Base"),
    ];
    const { nodes, laneCount } = assignLanes(commits);
    expect(laneCount).toBe(3);
    const merge = nodes[0];
    expect(merge.lane).toBe(0);
    expect(merge.parentLanes).toEqual([
      { id: "A", lane: 0 },
      { id: "B", lane: 1 },
      { id: "C", lane: 2 },
    ]);
  });

  test("unrelated lanes pass straight through a row that does not touch them", () => {
    const commits = [
      c("M", ["A", "B", "C"]),
      c("A", ["Base"]),
      c("B", ["Base"]),
      c("C", ["Base"]),
      c("Base"),
    ];
    const { nodes } = assignLanes(commits);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Drawing A (lane 0) must not disturb the still-unvisited B/C lanes.
    expect(byId.A.passthroughLanes).toEqual([1, 2]);
    // By C's row, B has resolved (and its lane is now waiting on Base, same as
    // lane 0) — only the still-distinct lane 0 passes through.
    expect(byId.C.passthroughLanes).toEqual([0]);
    expect(byId.Base.passthroughLanes).toEqual([]);
  });

  test("a freed lane is reused by the next unrelated branch instead of growing forever", () => {
    // A merges into mainline and finishes; a brand new, unrelated branch starts
    // right after. It should reuse lane 1 rather than opening lane 2.
    const commits = [
      c("M", ["Main2", "Feat"]),
      c("Main2", ["Main1"]),
      c("Feat", ["Main1"]),
      c("Main1", ["Root"]),
      c("New", ["Root"]), // unrelated second child of Root, appears after the merge resolved
      c("Root"),
    ];
    const { nodes, laneCount } = assignLanes(commits);
    expect(laneCount).toBe(2);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId.Feat.lane).toBe(1);
    expect(byId.New.lane).toBe(1);
  });

  test("deterministic: same input order always yields the same layout", () => {
    const commits = [c("M", ["A", "B"]), c("A", ["Base"]), c("B", ["Base"]), c("Base")];
    expect(assignLanes(commits)).toEqual(assignLanes(commits));
  });
});

describe("edgePath", () => {
  test("same lane is a straight line", () => {
    expect(edgePath(8, 15, 8, 30)).toBe("M 8 15 L 8 30");
  });
  test("lane change is a cubic S-curve with vertical tangents", () => {
    expect(edgePath(8, 15, 24, 30)).toBe("M 8 15 C 8 22.5, 24 22.5, 24 30");
    expect(edgePath(8, 15, 24, 30, 0.25)).toBe("M 8 15 C 8 18.75, 24 26.25, 24 30");
  });
});
describe("orderRefs", () => {
  test("HEAD, branches, remotes, tags; alphabetical within a kind", () => {
    const out = orderRefs([
      { name: "v1", kind: "tag" },
      { name: "origin/main", kind: "remote" },
      { name: "zeta", kind: "branch" },
      { name: "HEAD", kind: "head" },
      { name: "alpha", kind: "branch" },
    ]);
    expect(out.map((r) => r.name)).toEqual(["HEAD", "alpha", "zeta", "origin/main", "v1"]);
  });
});
describe("assignLanes — graph feed shapes", () => {
  test("two long-lived branches interleaved keep their lanes and converge on the merge base", () => {
    // topo order as repo_log_graph emits for main(m2<-m1<-base) + feature(f2<-f1<-base)
    const { nodes, laneCount } = assignLanes([
      c("m2", ["m1"]), c("f2", ["f1"]), c("m1", ["base"]), c("f1", ["base"]), c("base"),
    ]);
    expect(laneCount).toBe(2);
    expect(nodes.map((n) => n.lane)).toEqual([0, 1, 0, 1, 0]);
    expect(nodes[3].parentLanes).toEqual([{ id: "base", lane: 0 }]);
    // base row sits on lane 0; lane 1 was released by f1's edge curving into lane 0
    expect(nodes[4]).toEqual({ id: "base", lane: 0, parentLanes: [], passthroughLanes: [] });
  });
  test("every parent edge targets a lane that the parent row actually occupies or inherits", () => {
    const commits = [c("M", ["A", "B"]), c("A", ["R"]), c("B", ["R"]), c("R")];
    const { nodes } = assignLanes(commits);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) for (const link of n.parentLanes) expect(byId.get(link.id)).toBeDefined();
  });
});
