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

    // CONVERGENCE: two branches can both still be waiting on the same not-yet-
    // visited ancestor (a merge base). Without this, the later of the two lanes
    // would hold a reservation for a commit that only ever gets drawn once, in
    // the earlier lane — wasting a column for the rest of the graph. The lowest
    // lane index keeps the reservation; every later duplicate frees up here,
    // which is also exactly the row after which their graph lines should merge.
    const owner = new Map<string, number>();
    for (let i = 0; i < active.length; i++) {
      const id = active[i];
      if (id === null) continue;
      if (owner.has(id)) active[i] = null;
      else owner.set(id, i);
    }

    const passthroughLanes = entering.reduce<number[]>((acc, id, index) => {
      if (id !== null && index !== lane) acc.push(index);
      return acc;
    }, []);

    nodes.push({ id: commit.id, lane, parentLanes, passthroughLanes });
  }

  return { nodes, laneCount };
}
