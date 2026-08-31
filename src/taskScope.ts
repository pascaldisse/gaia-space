import type { Todo } from "./api/personal";

export type TaskMember = { id: string; display_name?: string | null; username?: string | null };
export type AssigneeGroup = { id: string; name: string; items: Todo[] };

/** Tasks assigned to the active profile; authorship alone does not put work on My Tasks. */
export const myTasks = (tasks: Todo[], userId: string): Todo[] =>
  userId ? tasks.filter(task => task.assignee_ids.includes(userId)) : [];

/** A task appears beneath each assigned person's name; unassigned work remains explicit. */
export const groupByAssignee = (tasks: Todo[], members: TaskMember[]): AssigneeGroup[] => {
  const names = new Map(members.map(member => [member.id, member.display_name || member.username || member.id]));
  const groups = new Map<string, AssigneeGroup>();
  const add = (id: string, name: string, task: Todo) => {
    const group = groups.get(id);
    if (group) group.items.push(task);
    else groups.set(id, { id, name, items: [task] });
  };
  for (const task of tasks) {
    if (task.assignee_ids.length) for (const id of task.assignee_ids) add(id, names.get(id) ?? id, task);
    else add("", "Unassigned", task);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
};
