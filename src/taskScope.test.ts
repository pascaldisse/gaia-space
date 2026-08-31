import { describe, expect, test } from "bun:test";
import type { Todo } from "./api/personal";
import { groupByAssignee, myTasks } from "./taskScope";

const task = (id: string, assignee_ids: string[], profile_id = "author"): Todo => ({
  id, profile_id, assignee_ids, content: id, due_date: null, project_id: null, done: false,
  source_entity_type: null, source_entity_id: null, notes: null, content_kind: "text",
});

describe("task scope", () => {
  test("My Tasks carries my assigned work and my own unassigned task, never other people's", () => {
    const tasks = [
      task("assigned", ["me"], "other"),
      task("authored", [], "me"),
      task("other", ["other"], "other"),
      task("authored-by-other", [], "other"),
    ];
    expect(myTasks(tasks, "me").map(item => item.id)).toEqual(["assigned", "authored"]);
    expect(myTasks(tasks, "")).toEqual([]);
  });

  test("Team Tasks groups each task beneath its assignee name", () => {
    const tasks = [task("pair", ["b", "a"]), task("solo", ["a"]), task("none", [])];
    expect(groupByAssignee(tasks, [
      { id: "a", display_name: "Ada" }, { id: "b", username: "Bea" },
    ]).map(group => [group.name, group.items.map(item => item.id)])).toEqual([
      ["Ada", ["pair", "solo"]], ["Bea", ["pair"]], ["Unassigned", ["none"]],
    ]);
  });
});
