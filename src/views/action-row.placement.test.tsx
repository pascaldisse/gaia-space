import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";

/* WHERE AN ACT LIVES IS DECIDED BY ITS KIND (PageHeader.css, "THE ACTION ROW").
   Half these surfaces used to hang "New …" in the header's top-right corner, so the
   same act had two addresses depending on which page you were on. This test guards
   the address, not the styling: the header's corner is for FACTS (chips) and the one
   irreversible act (DeleteButton); everything that makes something, and everything
   that only changes what you see, belongs to the row below it.

   It reads the source rather than mounting, because the claim is about WHERE the
   markup is written — every one of these views needs a different backend to mount,
   and a rule that costs seventeen stubs to state does not get maintained. */

const VIEWS = [
  "Projects", "ProjectHome", "Calendar", "Meetings", "Members",
  "Locations", "Absences", "Blogs", "Leads", "Inbox",
] as const;

const source = (view: string) => readFileSync(new URL(`./${view}.tsx`, import.meta.url), "utf8");

/** The `actions=` prop of THIS view's own PageHeader. Nested headers (SectionHeading,
 *  EmptyState, embedded guests) take an `actions` prop too, so the search is anchored
 *  on the page header's opening tag. */
const headerActions = (text: string) => {
  const found: string[] = [];
  const opener = /<PageHeader\b/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text))) {
    // Up to the end of the element's opening tag — attribute values here never contain `>`
    // outside JSX expressions, so we stop at the first `/>` that closes the tag.
    const tail = text.slice(match.index);
    const end = tail.indexOf("/>");
    const tag = end === -1 ? tail.slice(0, 400) : tail.slice(0, end);
    if (/\bactions=/.test(tag)) found.push(tag);
  }
  return found;
};

describe("the action row is where an act lives", () => {
  for (const view of VIEWS) {
    test(`${view} keeps no acts in the header's top-right corner`, () => {
      expect(headerActions(source(view))).toEqual([]);
    });

    test(`${view} has an action row under its header`, () => {
      expect(source(view)).toContain('class="page-actionbar"');
    });
  }

  test("a view that changes what you see puts those controls at the far end", () => {
    for (const view of ["Calendar", "Members", "Absences", "Blogs", "Leads", "ProjectHome", "Projects"]) {
      expect(source(view)).toContain("actionbar-view-controls");
    }
  });

  test("no surface writes `font: inherit` on an act-button", () => {
    // Size, weight, height and radius come from --btn-*; inheriting means the button
    // takes the size of whatever page it landed on.
    expect(readFileSync(new URL("./Projects.css", import.meta.url), "utf8")).not.toContain("font: inherit");
  });
});
