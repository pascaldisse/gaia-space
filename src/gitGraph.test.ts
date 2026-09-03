import { describe, expect, test } from "bun:test";
import { assignLanes, type GraphCommit } from "./gitGraph";

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
    expect(nodes).toEqual([{ id: "A", lane: 0, parentLanes: [] }]);
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
      { id: "M", lane: 0, parentLanes: [{ id: "A", lane: 0 }, { id: "B", lane: 1 }] },
      { id: "A", lane: 0, parentLanes: [{ id: "Base", lane: 0 }] },
      { id: "B", lane: 1, parentLanes: [{ id: "Base", lane: 1 }] },
      { id: "Base", lane: 0, parentLanes: [] },
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
