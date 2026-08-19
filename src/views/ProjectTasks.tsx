import { createResource, For, Show } from "solid-js";
import { personalApi } from "../api/personal";
import { profileId, projects } from "../session";
import { route } from "../router";

export default function ProjectTasks() {
  const selected = () => route().projectId ?? "";
  const [todos] = createResource(() => [selected(), profileId()] as const, ([id, profile]) => id && profile ? personalApi.projectTodos(id, profile, true) : Promise.resolve([]));
  const project = () => (projects() ?? []).find(item => item.id === selected());
  return <section class="resource-view"><header><h1>{project()?.name ?? "Project"} tasks</h1><p>Tasks filed to this project.</p></header><Show when={todos.error}><p class="error" role="alert">Could not load project tasks: {String(todos.error)}</p></Show><Show when={!todos.loading && !todos()?.length}><p class="empty-state">No project tasks yet.</p></Show><ul class="resource-list"><For each={todos()}>{todo=><li><strong>{todo.content}</strong><Show when={todo.due_date}><code>Due {todo.due_date}</code></Show></li>}</For></ul></section>;
}
