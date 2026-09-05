import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";

/* WHERE AN ACT LIVES IS DECIDED BY ITS KIND (PageHeader.css, "THE ACTION ROW"), for
   the DEVELOPMENT family: Dev tasks, Pull requests, Repositories, Pipelines,
   Packages, Dev environments, Applications, the record browser, and the Development
   surface that embeds all of them.

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
  "Reviews", "Repos", "Pipelines",
  "Packages", "DevEnvironments", "Applications", "ResourceView", "Development",
] as const;

/** The views that draw the row itself. `Packages` and `Applications` are operator
 *  tools whose one act ("Create repository", "Register application") is the submit of
 *  a permanently visible band of fields — one act, one place, so no row repeats it. */
const WITH_ROW = ["Reviews", "Repos", "Pipelines", "DevEnvironments", "ResourceView", "Development"] as const;

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
    // Development: project picker + section pills. Pull requests: quick filters +
    // sort. Pipelines: which section. Environments: which project.
    for (const view of ["Reviews", "Pipelines", "DevEnvironments", "Development"]) {
      expect(source(`${view}.tsx`)).toContain("actionbar-view-controls");
    }
  });

  test("ONE line per page: the rival bars are gone", () => {
    // The reviews list column carried its own control block; it is on the row now.
    expect(source("Reviews.tsx")).not.toContain('class="review-list-controls"');
  });

  test("the section pills are part of the row, not a strip above the content", () => {
    // Development draws its own section pills on the same action row as its project
    // picker — there is no separate guest view carrying them any more (Tasks/Boards
    // used to be the Issues view, embedded; task unification folded that surface in).
    expect(source("Development.tsx")).toContain("actionbar-sections");
    expect(source("Development.tsx")).toMatch(/actionbar-view-controls[\s\S]{0,400}ProjectPicker/);
  });

  test("no surface of this family writes `font: inherit` on an act-button", () => {
    // Size, weight, height and radius come from --btn-*; inheriting means the button
    // takes the size of whatever page it landed on.
    for (const file of ["Development.css"]) {
      expect(source(file)).not.toContain("font: inherit");
    }
  });

  test("structure is never scoped to one theme", () => {
    // The rules this lane added decide WHERE things are and how many lines a page
    // has. A dark reader gets the same page.
    for (const file of ["Development.css"]) {
      const added = source(file).split("\n").filter((line) => /page-actionbar|actionbar-sections|control-row\.filter-row/.test(line));
      expect(added.length).toBeGreaterThan(0);
      for (const line of added) expect(line).not.toContain(".theme-space-light");
    }
  });
});
