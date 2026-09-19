import { expect, test } from "bun:test";
import {
  activityEntries, activityState, addActivity, dayKey, emptyActivity, emptyDeal, emptyOrganization,
  filterActivityEntries, linkActivity, matchesActivityView, normalize, normalizeActivity, seed, setActivityDone,
  toggleActivity, weekBounds, type CrmData,
} from "./crmStore";

// The activity worklist is the CRM's only surface that answers "what do I owe today",
// so the rules it stands on are pinned here rather than in the view: what an activity
// IS at a moment (§activityState), which filter admits it, where it is stored, and
// that linking MOVES it instead of copying it.

const AT = new Date(2026, 8, 16, 10, 0, 0);        // Wednesday, 2026-09-16
const day = (offset: number) => { const date = new Date(AT); date.setDate(date.getDate() + offset); return dayKey(date); };

const base = (): CrmData => {
  const org = emptyOrganization("Optik Nord", "Jannes");
  const deal = { ...emptyDeal(org.id, "Optik Nord", "Jannes") };
  return { version: 2, organizations: [org], deals: [deal], labels: [], pipelineStages: seed().pipelineStages, activities: [] };
};

test("an activity's state is the one fact every filter, tone and badge reads", () => {
  expect(activityState(emptyActivity({ dueDate: day(-1) }), AT)).toBe("overdue");
  expect(activityState(emptyActivity({ dueDate: day(0) }), AT)).toBe("today");
  expect(activityState(emptyActivity({ dueDate: day(3) }), AT)).toBe("planned");
  expect(activityState(emptyActivity({ dueDate: "" }), AT)).toBe("unscheduled");
  // Done outranks every date: a completed activity is never overdue.
  expect(activityState(emptyActivity({ dueDate: day(-9), done: true }), AT)).toBe("done");
});

test("the filters narrow the same worklist, and This week is the Monday–Sunday week", () => {
  const overdue = emptyActivity({ dueDate: day(-2) });
  const today = emptyActivity({ dueDate: day(0) });
  const friday = emptyActivity({ dueDate: day(2) });       // still this week
  const nextWeek = emptyActivity({ dueDate: day(9) });
  const done = emptyActivity({ dueDate: day(0), done: true });
  const undated = emptyActivity({});
  expect(weekBounds(AT)).toEqual({ start: "2026-09-14", end: "2026-09-20" });

  const admits = (view: Parameters<typeof matchesActivityView>[1]) =>
    [overdue, today, friday, nextWeek, done, undated].filter(activity => matchesActivityView(activity, view, AT)).length;
  expect(admits("todo")).toBe(5);        // everything not done, including the undated one
  expect(admits("overdue")).toBe(1);
  expect(admits("today")).toBe(1);
  // Monday's slipped call IS part of this week's work; "this week" is the calendar week,
  // not the future part of it — the Overdue filter is where lateness is read.
  expect(admits("week")).toBe(3);        // overdue (Mon) + today + friday
  expect(admits("done")).toBe(1);
  expect(admits("all")).toBe(6);
});

test("an activity with no deal lives in the inbox; linking MOVES it onto the deal", () => {
  const data = base();
  const dealId = data.deals[0].id;
  const loose = addActivity(data, null, { title: "Messekontakt zurückrufen", dueDate: day(1) });
  addActivity(data, dealId, { title: "Angebot nachfassen", dueDate: day(0), kind: "E-Mail" });
  expect(data.activities).toHaveLength(1);
  expect(data.deals[0].activities).toHaveLength(1);

  const entries = activityEntries(data);
  expect(entries).toHaveLength(2);
  expect(entries[0].activity.title).toBe("Angebot nachfassen");           // sorted by day
  expect(entries.find(entry => entry.activity.id === loose.id)!.deal).toBeNull();
  expect(entries[0].org?.name).toBe("Optik Nord");

  linkActivity(data, loose.id, dealId);
  expect(data.activities).toHaveLength(0);                                 // moved, never copied
  expect(data.deals[0].activities.map(item => item.title)).toContain("Messekontakt zurückrufen");
  expect(activityEntries(data).every(entry => entry.deal?.id === dealId)).toBe(true);
});

test("completing an activity is one write, wherever the checkbox was clicked", () => {
  const data = base();
  const dealId = data.deals[0].id;
  const onDeal = addActivity(data, dealId, { title: "Anruf", dueDate: day(0) });
  const inInbox = addActivity(data, null, { title: "Recherche" });

  toggleActivity(data, onDeal.id);
  expect(data.deals[0].activities[0].done).toBe(true);
  expect(data.deals[0].activities[0].doneAt).toBeTruthy();                 // when, not merely that
  setActivityDone(data, inInbox.id, true);
  expect(data.activities[0].done).toBe(true);
  expect(filterActivityEntries(activityEntries(data), "todo")).toHaveLength(0);
  expect(filterActivityEntries(activityEntries(data), "done")).toHaveLength(2);

  toggleActivity(data, onDeal.id);
  expect(data.deals[0].activities[0].doneAt).toBeNull();                   // undo clears the stamp
});

test("a legacy activity reads back complete, and the inbox is additive to a v2 document", () => {
  const legacy = normalizeActivity({ id: "a1", kind: "Anruf", title: "Rückruf", dueDate: "2026-09-20", outcome: "", done: false });
  expect(legacy).toMatchObject({ duration: 0, priority: "Normal", dueTime: "", doneAt: null });

  const stored = { ...seed(), activities: undefined };
  const read = normalize({ ...stored, deals: [{ ...emptyDeal("org", "Deal"), activities: [{ id: "x", kind: "Quatsch", title: "Alt", dueDate: "nope", done: true }] }] });
  expect(read.activities).toEqual([]);
  expect(read.deals[0].activities[0]).toMatchObject({ kind: "Aufgabe", dueDate: "", done: true, priority: "Normal" });
  // A completion time is never invented: a legacy record that never stored one reads null.
  expect(read.deals[0].activities[0].doneAt).toBeNull();
});
