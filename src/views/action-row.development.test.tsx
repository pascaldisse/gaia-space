import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";

/* WHERE AN ACT LIVES IS DECIDED BY ITS KIND (PageHeader.css, "THE ACTION ROW"), for
   the DEVELOPMENT family: Tickets, Boards, Pull requests, Repositories, Pipelines,
   Packages, Dev environments, Applications, the record browser, and the Development
   surface that embeds two of them.

   This family's own hazard is not the header corner but the SECOND LINE: these views
   grew heavy filter bars (`.control-row`, `.board-bar`, `.review-list-controls`) that
   each drew a separator of their own directly under the header's. A page has ONE
   hairline and it belongs to the action row, so the guards below check both the
   address of the acts and the absence of the rival bars.

   It reads the source rather than mounting: every one of these views needs a
   different backend, and a rule that costs a dozen stubs to state does not get
   maintained. */

const source = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

/** The `actions=` prop of THIS view's own PageHeader. Nested headers (SectionHeading,
 *  EmptyState, embedded guests) take an `actions` prop too, so the search is anchored
 *  on the page header's opening tag. */
const headerActions = (text: string) => {
  const found: string[] = [];
  const opener = /<PageHeader\b/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text))) {
    const tail = text.slice(match.index);
    const end = tail.indexOf("/>");
    const tag = end === -1 ? tail.slice(0, 400) : tail.slice(0, end);
    if (/\bactions=/.test(tag)) found.push(tag);
  }
  return found;
};

/** Every view of the family, including the two whose acts are carried by a permanent
 *  band of fields — those must ALSO keep the header corner clean. */
const FAMILY = [
  "Issues", "Boards", "Reviews", "Repos", "Pipelines",
  "Packages", "DevEnvironments", "Applications", "ResourceView", "Development",
] as const;

/** The views that draw the row itself. `Packages` and `Applications` are operator
 *  tools whose one act ("Create repository", "Register application") is the submit of
 *  a permanently visible band of fields — one act, one place, so no row repeats it. */
const WITH_ROW = ["Issues", "Boards", "Reviews", "Repos", "Pipelines", "DevEnvironments", "ResourceView", "Development"] as const;

describe("the development family: the action row is where an act lives", () => {
  for (const view of FAMILY) {
    test(`${view} keeps no acts in the header's top-right corner`, () => {
      expect(headerActions(source(`${view}.tsx`))).toEqual([]);
    });
  }

  for (const view of WITH_ROW) {
    test(`${view} has an action row under its header`, () => {
      expect(source(`${view}.tsx`)).toContain('class="page-actionbar"');
    });
  }

  test("what changes the view sits at the far end of that row", () => {
    // Tickets: project + section pills. Boards: which board. Pull requests: quick
    // filters + sort. Pipelines/Development: which section. Environments: which project.
    for (const view of ["Issues", "Boards", "Reviews", "Pipelines", "DevEnvironments", "Development"]) {
      expect(source(`${view}.tsx`)).toContain("actionbar-view-controls");
    }
  });

  test("ONE line per page: the rival bars are gone", () => {
    // `.board-bar` was a second hairline under the header's own.
    expect(source("Boards.tsx")).not.toContain('class="board-bar"');
    expect(source("Boards.css")).not.toContain(".board-bar {");
    // The reviews list column carried its own control block; it is on the row now.
    expect(source("Reviews.tsx")).not.toContain('class="review-list-controls"');
    // The ticket filter bar is too wide for the row and stays below it — but it gives
    // up the separator controls.css draws under it, or the page has two.
    expect(source("Issues.css")).toContain(".issue-list-pane > .control-row.filter-row");
  });

  test("the section pills are part of the row, not a strip above the content", () => {
    // Both paths through Development: the pills are handed into the Issues row, and
    // the two sections without a guest view draw the same row themselves.
    expect(source("Development.tsx")).toContain("actionbar-sections");
    expect(source("Issues.tsx")).toMatch(/actionbar-view-controls[\s\S]{0,400}props\.sections/);
  });

  test("no surface of this family writes `font: inherit` on an act-button", () => {
    // Size, weight, height and radius come from --btn-*; inheriting means the button
    // takes the size of whatever page it landed on.
    for (const file of ["Issues.css", "Boards.css", "Development.css"]) {
      expect(source(file)).not.toContain("font: inherit");
    }
  });

  test("structure is never scoped to one theme", () => {
    // The rules this lane added decide WHERE things are and how many lines a page
    // has. A dark reader gets the same page.
    for (const file of ["Issues.css", "Development.css"]) {
      const added = source(file).split("\n").filter((line) => /page-actionbar|actionbar-sections|control-row\.filter-row/.test(line));
      expect(added.length).toBeGreaterThan(0);
      for (const line of added) expect(line).not.toContain(".theme-space-light");
    }
  });
});
