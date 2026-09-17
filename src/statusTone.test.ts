import { describe, expect, it } from "bun:test";
import {
  DEADLINE_SOON_DAYS,
  daysUntil,
  deadlineTone,
  dueTone,
  inDays,
  priorityTone,
  statusTone,
  urgencyLabel,
  urgencyOf,
  urgencyTone,
  deadlineBand,
  bandTone,
} from "./statusTone";

const TODAY = "2030-01-10";

describe("urgencyOf", () => {
  it("separates past, today, near and far", () => {
    expect(urgencyOf("2030-01-09", TODAY)).toBe("overdue");
    expect(urgencyOf("2030-01-10", TODAY)).toBe("today");
    expect(urgencyOf("2030-01-12", TODAY)).toBe("soon");
    expect(urgencyOf("2030-02-01", TODAY)).toBe("later");
  });

  it("treats a missing due date as no urgency at all, not as urgent", () => {
    expect(urgencyOf(null, TODAY)).toBe("none");
    expect(urgencyOf(undefined, TODAY)).toBe("none");
    expect(urgencyOf("", TODAY)).toBe("none");
  });

  it("honours a caller's own horizon for 'soon'", () => {
    expect(urgencyOf("2030-01-15", TODAY, 3)).toBe("later");
    expect(urgencyOf("2030-01-15", TODAY, 7)).toBe("soon");
  });

  it("counts days across a month and a year boundary", () => {
    expect(daysUntil("2030-02-01", "2030-01-31")).toBe(1);
    expect(daysUntil("2030-01-01", "2029-12-31")).toBe(1);
  });
});

describe("the colour law", () => {
  it("gives red only to what is past due", () => {
    expect(urgencyTone("overdue")).toBe("red");
    expect(urgencyTone("today")).toBe("amber");
    expect(urgencyTone("soon")).toBe("amber");
    expect(urgencyTone("later")).toBe("");
    expect(urgencyTone("none")).toBe("");
  });

  it("never lets a status become red or amber — a status is not a deadline", () => {
    for (const status of [null, undefined, {}, { resolved: false }, { resolved: true }]) {
      expect(["teal", "done"]).toContain(statusTone(status));
    }
  });

  it("marks open work teal and resolved work neutral", () => {
    expect(statusTone({ resolved: false })).toBe("teal");
    expect(statusTone(null)).toBe("teal");
    expect(statusTone({ resolved: true })).toBe("done");
  });

  it("keeps priority in its own channel", () => {
    expect(priorityTone("urgent")).toBe("red");
    expect(priorityTone("HIGH")).toBe("amber");
    expect(priorityTone("medium")).toBe("");
    expect(priorityTone(null)).toBe("");
  });
});

describe("the defect this module exists to prevent", () => {
  it("gives two tasks with the same status the same status colour, whatever their due dates", () => {
    const status = { resolved: false };
    const overdueTask = { status, due_date: "2030-01-01" };
    const undatedTask = { status, due_date: null };
    // The pill that says "No status" must say it in one colour only.
    expect(statusTone(overdueTask.status)).toBe(statusTone(undatedTask.status));
    // ...while the urgency is still visible, on the date, where it belongs.
    expect(dueTone(overdueTask.due_date, TODAY)).toBe("red");
    expect(dueTone(undatedTask.due_date, TODAY)).toBe("");
  });
});

describe("labels", () => {
  it("names the urgency it colours", () => {
    expect(urgencyLabel("overdue")).toBe("Overdue");
    expect(urgencyLabel("today")).toBe("Due today");
    expect(urgencyLabel("soon")).toBe("Due soon");
    expect(urgencyLabel("later")).toBe("");
    expect(urgencyLabel("none")).toBe("");
  });
});

describe("deadlineTone keeps Steering's contract", () => {
  it("reproduces the banner's classes and notes exactly", () => {
    expect(deadlineTone("2030-01-10", TODAY)).toMatchObject({ tone: "soon", note: "due today" });
    expect(deadlineTone("2030-01-07", TODAY)).toMatchObject({ tone: "overdue", note: "3 days overdue" });
    expect(deadlineTone("2030-01-09", TODAY)).toMatchObject({ tone: "overdue", note: "1 day overdue" });
    expect(deadlineTone("2030-01-15", TODAY)).toMatchObject({ tone: "soon", note: "in 5 days" });
    expect(deadlineTone("2030-02-10", TODAY)).toMatchObject({ tone: "ok" });
  });

  it("also reports the lawful colour beside the legacy class", () => {
    expect(deadlineTone("2030-01-07", TODAY).colour).toBe("red");
    expect(deadlineTone("2030-01-15", TODAY).colour).toBe("amber");
    expect(deadlineTone("2030-02-10", TODAY).colour).toBe("");
  });

  it("looks a week ahead by default", () => {
    expect(DEADLINE_SOON_DAYS).toBe(7);
    expect(deadlineTone("2030-01-17", TODAY).tone).toBe("soon");
    expect(deadlineTone("2030-01-18", TODAY).tone).toBe("ok");
  });
});

describe("date helpers", () => {
  it("walks forward in whole local days", () => {
    expect(inDays(3, TODAY)).toBe("2030-01-13");
    expect(inDays(0, TODAY)).toBe(TODAY);
    expect(inDays(30, TODAY)).toBe("2030-02-09");
  });
});

describe("the deadline band an open task's mark carries", () => {
  const DAY = "2030-01-10";
  it("is urgent when the deadline is past, today or tomorrow", () => {
    expect(deadlineBand("2030-01-01", DAY)).toBe("urgent");
    expect(deadlineBand("2030-01-10", DAY)).toBe("urgent");
    expect(deadlineBand("2030-01-11", DAY)).toBe("urgent");
  });
  it("is soon from two days out to the end of the week", () => {
    expect(deadlineBand("2030-01-12", DAY)).toBe("soon");
    expect(deadlineBand("2030-01-13", DAY)).toBe("soon");
    expect(deadlineBand("2030-01-17", DAY)).toBe("soon");
  });
  it("is calm with more than a week of room", () => {
    expect(deadlineBand("2030-01-18", DAY)).toBe("calm");
    expect(deadlineBand("2030-03-01", DAY)).toBe("calm");
  });
  it("colours nothing when nobody set a deadline", () => {
    expect(deadlineBand(null, DAY)).toBe("none");
    expect(bandTone(deadlineBand(null, DAY))).toBe("");
  });
  it("speaks the one colour vocabulary: red, amber, teal", () => {
    expect(bandTone("urgent")).toBe("red");
    expect(bandTone("soon")).toBe("amber");
    expect(bandTone("calm")).toBe("teal");
  });
});
