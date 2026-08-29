import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";

/* ── AN EMPTY STATE CENTRES ON THE PAGE, OR IT LOOKS BROKEN ──────────────────
 *
 *  `EmptyState` centres its own contents (`justify-items: center; text-align: center`
 *  in EmptyState.css). That is the whole component: a dashed box that sits in the
 *  middle of whatever it is given.
 *
 *  So the ONLY thing a view has to get right is the box it hands over. Give it the
 *  page's measure and it lands in the middle of the page. Give it a narrow column
 *  that is itself pinned to the left, and the centred box lands off-centre — aligned
 *  to neither the left edge where the heading starts, nor the middle where the eye
 *  expects it. That is exactly what Time off did: a 423px box centred inside a 640px
 *  cap on a 1282px page, so it sat at 508–932 while the page's middle was 1041.
 *
 *  MEASURED, NOT ARGUED: with the cap removed the box spans 829–1253, mid 1041, and
 *  the page spans 400–1682, mid 1041.
 *
 *  This reads the stylesheet rather than mounting, following the house pattern in
 *  action-row.placement.test.tsx: the claim is about what the CSS says, and Absences
 *  needs a live backend to render.
 */

const css = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

/** The declaration block of one selector, or "" when the rule is absent. */
const block = (text: string, selector: string): string => {
  const at = text.indexOf(selector);
  if (at < 0) return "";
  const open = text.indexOf("{", at);
  const close = text.indexOf("}", open);
  return open < 0 || close < 0 ? "" : text.slice(open + 1, close);
};

describe("an empty state is handed the page's measure", () => {
  test("Time off's empty branch puts no width cap on the column holding the empty state", () => {
    const rule = block(css("Absences.css"), ".timeoff-onboarding .view-main");
    expect(rule).not.toBe("");
    // A cap here re-creates the off-centre box. If a future layout genuinely needs a
    // narrower reading measure, it must ALSO stop EmptyState centring inside it —
    // one or the other, never a centred box in a left-pinned column.
    expect(rule).not.toContain("max-width");
    expect(rule).not.toContain("width:");
  });

  test("EmptyState still centres itself — the assumption this rests on", () => {
    // If this ever changes, the rule above stops being the right fix and this test
    // says so instead of failing silently somewhere else.
    const lead = block(css("../components/EmptyState.css"), ".empty-lead");
    expect(lead).toContain("justify-items: center");
    expect(lead).toContain("text-align: center");
  });
});
