import { createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Issue, type Status } from "../api/issues";
import { ProfilePicker, ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import { humanError, projectId as sessionProject, setProjectId } from "../session";
import { linkEntity, linkProps, route, useDeepLink } from "../router";
import "./Issues.css";

const blank = () => ({ title: "", description: "", status_id: "", assignee_id: "", due_date: "" });

/** Workspace issue tracker: filters query the persisted planning domain; the
 * detail panel owns issue fields, tags, checklists, time entries, and children. */
export default function Issues() {
  const projectId = sessionProject;
  const [query, setQuery] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal("");
  const [assigneeFilter, setAssigneeFilter] = createSignal("");
  const [selected, setSelected] = createSignal<Issue>();
  const [form, setForm] = createSignal(blank());
  const [error, setError] = createSignal("");
  const [issues, { refetch: reloadIssues }] = createResource(
    () => [projectId(), query(), statusFilter(), tagFilter(), assigneeFilter()] as const,
    ([project_id, text, status_id, tag_id, assignee_id]) => planningApi.issues({
      project_id: project_id || undefined,
      text: text || undefined,
      status_id: status_id || undefined,
      tag_id: tag_id || undefined,
      assignee_id: assignee_id || undefined,
    }),
  );
  const [statuses, { refetch: reloadStatuses }] = createResource(projectId, id => id ? planningApi.statuses(id) : Promise.resolve([]));
  const [tags, { refetch: reloadTags }] = createResource(projectId, id => id ? planningApi.tags(id) : Promise.resolve([]));
  let deepLinkSequence = 0;
  const issueRoute = (issue: Issue) => ({ view: "Issues", entityType: "issue", entityId: issue.id, projectId: issue.project_id || projectId() || undefined });
  const select = (issue: Issue) => {
    deepLinkSequence++;
    setSelected(issue);
    if (issue.project_id !== projectId()) setProjectId(issue.project_id);
  };
  const openInUrl = (issue: Issue) => {
    select(issue);
    linkEntity("issue", issue.id, { projectId: issue.project_id }, true);
  };
  useDeepLink("issue", async id => {
    const fromList = issues()?.find(issue => issue.id === id);
    if (fromList) { select(fromList); return; }
    const sequence = ++deepLinkSequence;
    try {
      const detail = await planningApi.issue(id);
      if (sequence !== deepLinkSequence || route().entityId !== id || !detail) return;
      setSelected(detail.issue);
      if (detail.issue.project_id !== projectId()) setProjectId(detail.issue.project_id);
      if (!route().projectId) linkEntity("issue", detail.issue.id, { projectId: detail.issue.project_id }, true);
    } catch (reason) {
      if (sequence === deepLinkSequence) setError(humanError(reason));
    }
  }, () => { deepLinkSequence++; setSelected(undefined); });

  const createIssue = async (event: SubmitEvent) => {
    event.preventDefault();
    const values = form();
    if (!projectId() || !values.title.trim()) { setError("Pick a project and enter an issue title."); return; }
    try {
      const issue = await planningApi.createIssue({
        project_id: projectId(), title: values.title.trim(), description: values.description.trim() || null,
        status_id: values.status_id || null, assignee_id: values.assignee_id || null, created_by: null,
        due_date: values.due_date || null, priority: null, archived: false,
      });
      setForm(blank());
      await reloadIssues();
      openInUrl(issue);
    } catch (reason) { setError(humanError(reason)); }
  };
  const createStatus = async () => {
    const name = prompt("Status name")?.trim();
    if (!name || !projectId()) return;
    try {
      await planningApi.createStatus({ project_id: projectId(), name, color: "#6d7c99", resolved: false });
      await reloadStatuses();
    } catch (reason) { setError(humanError(reason)); }
  };
  const saveStatus = async (status: Status, change: Partial<Status>) => {
    try { await planningApi.updateStatus({ ...status, ...change }); await reloadStatuses(); }
    catch (reason) { setError(humanError(reason)); }
  };

  return <section class="planning-view">
    <header class="planning-head">
      <div><h1>Issues</h1><p>Track work independently from the boards that visualize it.</p></div>
      <div class="planning-actions">
        <ProjectPicker />
        <a class="primary" {...linkProps({ view: "Boards", projectId: projectId() })}>Open board</a>
      </div>
    </header>
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    <div class="issue-layout">
      <aside class="issue-sidebar">
        <form class="new-issue" onSubmit={createIssue}>
          <h2>New issue</h2>
          <input aria-label="Issue title" placeholder="Title" value={form().title} onInput={event => setForm({ ...form(), title: event.currentTarget.value })} />
          <textarea aria-label="Issue description" placeholder="Description" value={form().description} onInput={event => setForm({ ...form(), description: event.currentTarget.value })} />
          <select aria-label="Issue status" value={form().status_id} onChange={event => setForm({ ...form(), status_id: event.currentTarget.value })}>
            <option value="">No status</option><For each={statuses()}>{status => <option value={status.id}>{status.name}</option>}</For>
          </select>
          <ProfilePicker label="Assignee" value={form().assignee_id} onChange={id => setForm({ ...form(), assignee_id: id })} allowAll />
          <input aria-label="Due date" type="date" value={form().due_date} onInput={event => setForm({ ...form(), due_date: event.currentTarget.value })} />
          <button class="primary" disabled={!projectId() || !form().title.trim()}>Create issue</button>
        </form>
        <section class="status-editor">
          <div class="section-title"><h2>Statuses</h2><button type="button" aria-label="Create status" onClick={() => void createStatus()}>+</button></div>
          <For each={statuses()}>{status => <div class="status-row">
            <input aria-label={`${status.name} color`} type="color" value={status.color} onChange={event => void saveStatus(status, { color: event.currentTarget.value })} />
            <input aria-label={`${status.name} name`} value={status.name} onBlur={event => void saveStatus(status, { name: event.currentTarget.value.trim() || status.name })} />
            <label><input type="checkbox" checked={status.resolved} onChange={event => void saveStatus(status, { resolved: event.currentTarget.checked })} /> done</label>
            <button class="ghost" type="button" aria-label={`Delete ${status.name}`} onClick={async () => {
              try { await planningApi.deleteStatus(status.id); await reloadStatuses(); }
              catch (reason) { setError(humanError(reason)); }
            }}>×</button>
          </div>}</For>
        </section>
      </aside>
      <main class="issue-list-pane">
        <div class="filter-row" aria-label="Issue filters">
          <input aria-label="Search issues" placeholder="Search title or description" value={query()} onInput={event => setQuery(event.currentTarget.value)} />
          <select aria-label="Filter by status" value={statusFilter()} onChange={event => setStatusFilter(event.currentTarget.value)}><option value="">All statuses</option><For each={statuses()}>{status => <option value={status.id}>{status.name}</option>}</For></select>
          <select aria-label="Filter by tag" value={tagFilter()} disabled={!projectId()} onChange={event => setTagFilter(event.currentTarget.value)}><option value="">All tags</option><For each={tags()}>{tag => <option value={tag.id}>{tag.name}</option>}</For></select>
          <ProfilePicker label="Assignee" value={assigneeFilter()} onChange={setAssigneeFilter} allowAll />
        </div>
        <Show when={issues.loading}><p class="hint">Loading issues…</p></Show>
        <Show when={!issues.loading && !issues()?.length}><p class="empty-state">No issues match these filters.</p></Show>
        <ul class="issue-list"><For each={issues()}>{issue => <li classList={{ active: selected()?.id === issue.id }}>
          <a class="issue-row" {...linkProps(issueRoute(issue))} onClick={event => { event.preventDefault(); openInUrl(issue); }}>
            <span class="issue-number">#{issue.number}</span><strong>{issue.title}</strong>
            <Show when={issue.status_id}>{id => <span class="status-name">{statuses()?.find(status => status.id === id())?.name ?? "Status"}</span>}</Show>
            <Show when={issue.due_date}>{date => <time>{date()}</time>}</Show>
          </a>
        </li>}</For></ul>
      </main>
      <aside class="issue-detail">
        <Show when={selected()} fallback={<p class="hint pad">Select an issue to manage its tags, checklist, time, and sub-items.</p>}>
          {issue => <IssueDetail issueId={issue().id} statuses={statuses()} onChanged={() => { void reloadIssues(); void reloadTags(); }} />}
        </Show>
      </aside>
    </div>
  </section>;
}
