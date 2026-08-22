import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Issue } from "../api/issues";
import { ProfilePicker, ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import { projectId as sessionProject, projects, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import "./Issues.css";

/** Project-scoped issue tracker. Boards are a view of this same work, never a
 * separate task store. */
export default function ProjectTasks() {
  const selectedProject = () => route().projectId ?? sessionProject();
  const [text, setText] = createSignal("");
  const [statusId, setStatusId] = createSignal("");
  const [tagId, setTagId] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal("");
  const [selected, setSelected] = createSignal<Issue>();
  createEffect(() => { selectedProject(); setSelected(undefined); });
  const [issues, { refetch }] = createResource(
    () => [selectedProject(), text(), statusId(), tagId(), assigneeId()] as const,
    ([project_id, query, status_id, tag_id, assignee_id]) => project_id
      ? planningApi.issues({ project_id, text: query || undefined, status_id: status_id || undefined, tag_id: tag_id || undefined, assignee_id: assignee_id || undefined })
      : Promise.resolve([]),
  );
  const [statuses] = createResource(selectedProject, id => id ? planningApi.statuses(id) : Promise.resolve([]));
  const [tags] = createResource(selectedProject, id => id ? planningApi.tags(id) : Promise.resolve([]));
  const project = () => (projects() ?? []).find(item => item.id === selectedProject());
  const board = () => ({ view: "Boards", projectId: selectedProject() });
  const openBoard = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setProjectId(selectedProject());
    navigate({ view: "Boards" });
  };

  return <section class="planning-view project-tasks-view">
    <header class="planning-head">
      <div>
        <h1>{project()?.name ?? "Project"} work</h1>
        <p>Issues are the source of truth. Use a board to plan the same work visually.</p>
      </div>
      <div class="planning-actions">
        <ProjectPicker value={selectedProject()} onChange={id => { setProjectId(id); navigate({ view: "Project Tasks", projectId: id }); }} />
        <a class="primary" {...linkProps(board())} onClick={openBoard}>Open board</a>
      </div>
    </header>
    <div class="issue-layout project-issue-layout">
      <main class="issue-list-pane">
        <div class="filter-row" aria-label="Issue filters">
          <input aria-label="Search issues" placeholder="Search issues" value={text()} onInput={event => setText(event.currentTarget.value)} />
          <select aria-label="Filter by status" value={statusId()} onChange={event => setStatusId(event.currentTarget.value)}>
            <option value="">All statuses</option>
            <For each={statuses()}>{status => <option value={status.id}>{status.name}</option>}</For>
          </select>
          <select aria-label="Filter by tag" value={tagId()} onChange={event => setTagId(event.currentTarget.value)}>
            <option value="">All tags</option>
            <For each={tags()}>{tag => <option value={tag.id}>{tag.name}</option>}</For>
          </select>
          <ProfilePicker label="Assignee" value={assigneeId()} onChange={setAssigneeId} allowAll />
        </div>
        <Show when={issues.loading}><p class="hint">Loading issues…</p></Show>
        <Show when={!issues.loading && !issues()?.length}><p class="empty-state">No issues match these filters.</p></Show>
        <ul class="issue-list">
          <For each={issues()}>{issue => <li classList={{ active: selected()?.id === issue.id }}>
            <button type="button" class="issue-row" onClick={() => setSelected(issue)}>
              <span class="issue-number">#{issue.number}</span>
              <strong>{issue.title}</strong>
              <Show when={issue.status_id}>{id => <span class="status-name">{statuses()?.find(status => status.id === id())?.name ?? "Status"}</span>}</Show>
              <Show when={issue.due_date}>{date => <time>{date()}</time>}</Show>
            </button>
          </li>}</For>
        </ul>
      </main>
      <aside class="issue-detail project-issue-detail">
        <Show when={selected()} fallback={<p class="hint pad">Select an issue to edit its checklist, tags, and time.</p>}>
          {issue => <IssueDetail issueId={issue().id} statuses={statuses()} onChanged={() => void refetch()} />}
        </Show>
      </aside>
    </div>
  </section>;
}
