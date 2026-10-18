/** ── COMMIT GRAPH LANE ASSIGNMENT ────────────────────────────────────────────
 *
 *  A small, pure, deterministic port of the `git log --graph` lane algorithm.
 *  Input is a list of commits in the order `repo_log` already returns them:
 *  revwalk sorted `TIME | TOPOLOGICAL`, so a commit always appears before any
 *  of its parents. That single invariant is all this needs — no repository
 *  access, no async, so it is trivially unit-testable.
 *
 *  MODEL: `active` is an array of "lane slots". Slot `i` holds the id of the
 *  commit that lane is currently waiting for (or `null` if the lane is free).
 *  Walking newest-to-oldest:
 *    1. This commit occupies whichever lane was already waiting for it (a
 *       previously-seen child's first parent), or the first free lane, or a
 *       brand new one on the right if none is free.
 *    2. Its first parent inherits that same lane (the straight line down a
 *       branch never moves lanes).
 *    3. Every other parent (a merge) claims its own lane: the one already
 *       waiting for it if some other child got there first, else the first
 *       free lane, else a new one.
 *  A commit with no parents (repo root) simply frees its lane.
 *
 *  `parentLanes` on each node is what the SVG renderer draws: one line from
 *  this node's lane to each parent's lane, in commit order top-to-bottom.
 */

export type GraphCommit = { id: string; parents: string[] };

export type GraphParentLink = { id: string; lane: number };

export type LaneNode = {
  id: string;
  lane: number;
  parentLanes: GraphParentLink[];
  /** Lanes that are alive (waiting for a not-yet-visited commit) when this row is
   *  drawn, OTHER than this row's own lane. The renderer draws these as a plain
   *  unbroken vertical through the row's full height — an unrelated branch just
   *  passing by — as distinct from `parentLanes`, which are this commit's own
   *  diagonal connectors down to its parents. */
  passthroughLanes: number[];
};

export type GraphLayout = {
  nodes: LaneNode[];
  /** Total number of lane columns the whole graph ever occupies at once. */
  laneCount: number;
};

/** Deterministic lane assignment. Pure function of the input order — same
 *  commits in the same order always produce the same lanes, which is what
 *  lets the SVG column stay stable across re-renders and what the tests below
 *  pin down exactly. */
export function assignLanes(commits: GraphCommit[]): GraphLayout {
  const active: (string | null)[] = [];
  const nodes: LaneNode[] = [];
  let laneCount = 0;

  const claim = (id: string): number => {
    let lane = active.indexOf(id);
    if (lane === -1) lane = active.indexOf(null);
    if (lane === -1) {
      lane = active.length;
      active.push(null);
    }
    active[lane] = id;
    laneCount = Math.max(laneCount, lane + 1);
    return lane;
  };

  for (const commit of commits) {
    // Snapshot BEFORE this row touches anything: every lane still waiting for a
    // commit it hasn't reached yet, as of the moment this row starts drawing.
    const entering = active.slice();

    const lane = claim(commit.id);
    active[lane] = null; // this commit is now resolved; the slot is free until a parent re-claims it

    const parentLanes: GraphParentLink[] = commit.parents.map((parentId, index) => {
      if (index === 0) {
        active[lane] = parentId;
        laneCount = Math.max(laneCount, lane + 1);
        return { id: parentId, lane };
      }
      return { id: parentId, lane: claim(parentId) };
    });

    // CONVERGENCE: two branches can both still be waiting on the same not-yet-visited ancestor
    // (a merge base). The duplicate reservation must be dropped, but WHICH one survives matters:
    // links emitted on EARLIER rows already ended (row-local edge) in the older lane and rows since
    // then draw it as a passthrough. Freeing the older lane would kill those lines mid-graph. So the
    // reservation that already existed when this row started (`entering`) always wins; only slots
    // newly set by THIS row (first-parent inheritance / claim) yield, and the links this row just
    // emitted are re-pointed below. With no older reservation the lowest index wins.
    const owner = new Map<string, number>();
    for (let i = 0; i < active.length; i++) {
      const id = active[i];
      if (id !== null && entering[i] === id) owner.set(id, i);
    }
    for (let i = 0; i < active.length; i++) {
      const id = active[i];
      if (id === null) continue;
      if (owner.has(id)) {
        if (owner.get(id) !== i) active[i] = null;
      } else owner.set(id, i);
    }

    // Re-point each parent link at the lane that actually SURVIVED convergence, so the edge
    // curves into the shared ancestor's lane instead of dead-ending in a lane that was freed.
    for (const link of parentLanes) {
      const owned = owner.get(link.id);
      if (owned !== undefined) link.lane = owned;
    }
    const passthroughLanes = entering.reduce<number[]>((acc, id, index) => {
      if (id !== null && index !== lane) acc.push(index);
      return acc;
    }, []);

    nodes.push({ id: commit.id, lane, parentLanes, passthroughLanes });
  }

  return { nodes, laneCount };
}

export type BrokenEdge = { row: number; from: string; to: string; lane: number; deadAtRow: number };

/** INVARIANT CHECK (row-local-edge + passthroughLanes model of CommitGraph.tsx): a link emitted
 *  at row r ends at the bottom of row r in `link.lane`. Every later row up to the parent must then
 *  draw that lane as a passthrough (the line never dies), and the parent row must sit ON that lane.
 *  A parent absent from the list (feed truncated) must stay alive to the last row.
 *  Returns every violating edge; `[]` = graph is sound. */
export function brokenEdges(layout: GraphLayout): BrokenEdge[] {
  const { nodes } = layout;
  const rowOf = new Map(nodes.map((n, i) => [n.id, i]));
  const out: BrokenEdge[] = [];
  nodes.forEach((n, r) => {
    for (const link of n.parentLanes) {
      const p = rowOf.get(link.id);
      const end = p ?? nodes.length;
      let dead = -1;
      for (let j = r + 1; j < end; j++) {
        if (!nodes[j].passthroughLanes.includes(link.lane)) { dead = j; break; }
      }
      if (dead === -1 && p !== undefined && nodes[p].lane !== link.lane) dead = p;
      if (dead !== -1) out.push({ row: r, from: n.id, to: link.id, lane: link.lane, deadAtRow: dead });
    }
  });
  return out;
}

/** SVG path for one Fork-style edge from a node (x1,y1) to its parent's lane (x2,y2).
 *  Same lane -> straight line; lane change -> S-curve (vertical tangents at both ends) so the
 *  connector meets the lane verticals smoothly instead of cutting a hard diagonal. `curve`
 *  is the fraction of the row height the bend takes (0 = diagonal-free straight drop). */
export function edgePath(x1: number, y1: number, x2: number, y2: number, curve = 0.5): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dy = (y2 - y1) * curve;
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

/** Ref chip kinds, as emitted by the backend `repo_log_graph`. */
export type GraphRefKind = "head" | "branch" | "remote" | "tag";
export type GraphRefChip = { name: string; kind: GraphRefKind | string };
const REF_ORDER: Record<string, number> = { head: 0, branch: 1, remote: 2, tag: 3 };
/** Chip order on a row: HEAD first, then local branches, remotes, tags; name as tiebreak. */
export function orderRefs<T extends GraphRefChip>(refs: T[]): T[] {
  return refs
    .slice()
    .sort((a, b) => (REF_ORDER[a.kind] ?? 9) - (REF_ORDER[b.kind] ?? 9) || a.name.localeCompare(b.name));
}
