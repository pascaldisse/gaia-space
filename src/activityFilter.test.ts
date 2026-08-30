import { describe, expect, test, beforeEach } from "bun:test";
import {
  ACTIVITY_FILTERS,
  asActivityFilter,
  filterAttention,
  isActivityFilter,
  kindsOfFilter,
  type ActivityFilter,
  type AttentionItem,
  type AttentionKind,
} from "./attention";
import { activityFilters, buildPath, parsePath, registerViews, setAvailableViews, setRoutePending } from "./router";
import { railModeOfRoute } from "./nav";

// Activity's sidebar entries are FILTERS over the one worklist, and the filter lives in
// the ROUTE. Three relationships rot silently unless they are pinned here:
//   filter <-> URL segment   (a deep link must arrive filtered)
//   filter <-> kinds         (a filter with no kind behind it is the `provisional` defect)
//   filtered route -> mode   (a filter must never leave Activity)

const VIEWS = ["Dashboard", "Inbox", "Chat", "Team Tasks", "Code Reviews", "To-Do", "Issues"];
beforeEach(() => { setRoutePending(false); registerViews(VIEWS); setAvailableViews(VIEWS); });

const ALL_KINDS: AttentionKind[] =
  ["mention", "dm", "channel", "thread", "todo", "issue", "review", "notification"];

const item = (kind: AttentionKind): AttentionItem => ({
  id: `${kind}:1`, kind, title: kind, at: 0, action: "Open", tone: "", route: { view: "Inbox" },
});

describe("filter <-> route", () => {
  test("every filter except All is a URL segment under the Inbox slug", () => {
    // The two lists are bound by THIS test, not by an import: the router stays zero-import.
    expect([...activityFilters] as string[]).toEqual(
      ACTIVITY_FILTERS.filter((f) => f.id !== "all").map((f) => f.id as string),
    );
  });

  test("a filtered URL parses to the Inbox with its filter in the route", () => {
    for (const filter of activityFilters) {
      expect(parsePath(`inbox/${filter}`)).toEqual({ view: "Inbox", tab: filter });
      expect(buildPath({ view: "Inbox", tab: filter })).toBe(`inbox/${filter}`);
    }
  });

  test("All is the bare view — one spelling for the unfiltered list", () => {
    expect(buildPath({ view: "Inbox" })).toBe("inbox");
    expect(buildPath({ view: "Inbox", tab: "all" })).toBe("inbox");
    expect(parsePath("inbox")).toEqual({ view: "Inbox" });
  });

  test("an unknown filter degrades to All, never to a blank page", () => {
    expect(parsePath("inbox/nonsense")).toEqual({ view: "Inbox" });
    expect(buildPath({ view: "Inbox", tab: "nonsense" })).toBe("inbox");
    expect(asActivityFilter("nonsense")).toBe("all");
    expect(asActivityFilter(undefined)).toBe("all");
    expect(asActivityFilter("reviews")).toBe("reviews");
  });

  test("a channel tab is not an activity filter and vice versa", () => {
    expect(parsePath("inbox/messages").tab).toBe("messages");
    expect(parsePath("inbox/overview")).toEqual({ view: "Inbox" }); // channel tab word, not a filter
  });

  test("every filtered Activity route still resolves to the activity rail mode", () => {
    for (const filter of ["", ...activityFilters]) {
      expect(railModeOfRoute(parsePath(`inbox/${filter}`))).toBe("activity");
    }
    expect(railModeOfRoute(parsePath("inbox/nonsense"))).toBe("activity");
  });
});

describe("filter <-> kind", () => {
  test("the filters PARTITION the kinds: each kind has exactly one home", () => {
    const seen = ACTIVITY_FILTERS.flatMap((entry) => entry.kinds);
    expect([...seen].sort()).toEqual([...ALL_KINDS].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("Mentions covers mention AND thread — a reply to my message addresses me", () => {
    expect(kindsOfFilter("mentions")).toEqual(["mention", "thread"]);
  });

  test("Assigned is todo + issue, Reviews is review, Messages is dm + channel", () => {
    expect(kindsOfFilter("assigned")).toEqual(["todo", "issue"]);
    expect(kindsOfFilter("reviews")).toEqual(["review"]);
    expect(kindsOfFilter("messages")).toEqual(["dm", "channel"]);
  });

  test("filtering keeps only that filter's kinds, and All keeps everything", () => {
    const worklist = ALL_KINDS.map(item);
    expect(filterAttention(worklist, "all")).toHaveLength(ALL_KINDS.length);
    expect(filterAttention(worklist, "mentions").map((i) => i.kind)).toEqual(["mention", "thread"]);
    expect(filterAttention(worklist, "assigned").map((i) => i.kind)).toEqual(["todo", "issue"]);
    expect(filterAttention(worklist, "reviews").map((i) => i.kind)).toEqual(["review"]);
    expect(filterAttention(worklist, "updates").map((i) => i.kind)).toEqual(["notification"]);
  });

  test("the filter counts sum to the unfiltered worklist — a filter narrows the view, not the number", () => {
    const worklist = ALL_KINDS.map(item);
    const sum = ACTIVITY_FILTERS.filter((f) => f.id !== "all")
      .reduce((total, entry) => total + filterAttention(worklist, entry.id).length, 0);
    expect(sum).toBe(worklist.length);
  });

  test("isActivityFilter accepts exactly the declared ids", () => {
    for (const entry of ACTIVITY_FILTERS) expect(isActivityFilter(entry.id)).toBe(true);
    expect(isActivityFilter("team-tasks")).toBe(false);
    const filter: ActivityFilter = "all";
    expect(kindsOfFilter(filter)).toEqual([]);
  });
});
