import { createEffect, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { planningApi, type Issue, type Status } from "../api/issues";
import { platformApi } from "../api/platform";
import { ProfilePicker, ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import IssueCreateDrawer from "../components/IssueCreateDrawer";
import { humanError, projectId as sessionProject, setProjectId } from "../session";
import { linkEntity, linkProps, navigate, route, useDeepLink } from "../router";
import PageHeader, { Chip } from "../components/PageHeader";
import { ControlRow, GhostPill, PillSelect, QuietSearch } from "../components/controls";
import { projectName } from "../orgScope";
import "../components/paper.css";
import "./Issues.css";

const todayISO = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Workspace issue tracker: filters query the persisted planning domain; the
 * detail panel owns issue fields, tags, checklists, time entries, and children.
 *
 * Layout (stage 6b): the list is the surface. Creation lives in a drawer, the status
 * editor in a panel, and the detail pane only exists once a row is selected — no
 * permanent form column, no permanent empty column.
 *
 * `filterTagName` pins the view to one planning tag (Development's "Bugs" section). If
 * the project has no such tag, the view says so rather than showing every issue.
 *
 * `sections` is a slot, not a second header: Development owns the section pills but
 * this view owns the PageHeader, and the pills must render BELOW it (stage 9a
 * ordering fix). Passing them in is the only way to get header-then-pills without
 * forking the header out of here. */
export default function Issues(props: { filterTagName?: string; sections?: JSX.Element } = {}) {
  const projectId = sessionProject;
  const [query, setQuery] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("");
  const [tagFilter, setTagFilter] = createSignal("");
  const [assigneeFilter, setAssigneeFilter] = createSignal("");
  const [customFieldFilter, setCustomFieldFilter] = createSignal("");
  const [customValueFilter, setCustomValueFilter] = createSignal("");
  const [selected, setSelected] = createSignal<Issue>();
  const [error, setError] = createSignal("");
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [statusEditorOpen, setStatusEditorOpen] = createSignal(false);
  const [issues, { refetch: reloadIssues }] = createResource(
    () => [projectId(), query(), statusFilter(), tagFilter(), assigneeFilter(), customFieldFilter(), customValueFilter()] as const,
    ([project_id, text, status_id, tag_id, assignee_id, custom_field_id, custom_value]) => planningApi.issues({
      project_id: project_id || undefined,
      text: text || undefined,
      status_id: status_id || undefined,
      tag_id: tag_id || undefined,
      assignee_id: assignee_id || undefined,
      custom_field_id: custom_field_id || undefined,
      custom_field_value_json: custom_field_id && custom_value ? JSON.stringify(custom_value) : undefined,
    }),
  );
  const [statuses, { refetch: reloadStatuses }] = createResource(projectId, id => id ? planningApi.statuses(id) : Promise.resolve([]));
  const [tags, { refetch: reloadTags }] = createResource(projectId, id => id ? planningApi.tags(id) : Promise.resolve([]));
  // A pinned tag ("Bugs") is a FILTER, not a second data path: it resolves to the same
  // tag_id the filter select would have sent. Absent tag -> honest empty state, no list.
  const pinnedTag = () => props.filterTagName
    ? (tags() ?? []).find(tag => tag.name.toLowerCase() === props.filterTagName!.toLowerCase())
    : undefined;
  const pinnedTagMissing = () => !!props.filterTagName && !tags.loading && !!tags() && !pinnedTag();
  createEffect(() => { if (props.filterTagName) setTagFilter(pinnedTag()?.id ?? ""); });
  const [customFields] = createResource(projectId, id => id ? platformApi.cfDefinitions(`issue:${id}`) : Promise.resolve([]));
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
  const followIssue = (event: MouseEvent, issue: Issue) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openInUrl(issue);
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
  // The deep link can fire BEFORE the list exists: opening an issue puts the project in
  // the URL, which remounts this view with an empty list, and `get_issue_detail` is not
  // available in every build. So when the list does arrive, honour the URL from it —
  // otherwise the detail pane stays shut on a URL that names an issue.
  createEffect(() => {
    const id = route().entityType === "issue" ? route().entityId : undefined;
    if (!id || selected()?.id === id) return;
    const fromList = issues()?.find(issue => issue.id === id);
    if (fromList) setSelected(fromList);
  });

  const afterCreate = async (issue: Issue) => { await reloadIssues(); openInUrl(issue); };
  // Colour law, one pill per row: red = overdue or urgent, amber = due within three days
  // or high priority, teal = open work, neutral = a status the project calls resolved.
  const pillTone = (issue: Issue) => {
    const status = statuses()?.find(entry => entry.id === issue.status_id);
    if (status?.resolved) return "done";
    const priority = (issue.priority ?? "").toUpperCase();
    if (priority === "URGENT" || (issue.due_date && issue.due_date < todayISO())) return "red";
    if (priority === "HIGH" || (issue.due_date && issue.due_date <= inDays(3))) return "amber";
    return "teal";
  };
  const csvCell = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const exportCsv = () => {
const rows = issues() ?? [];
const statusName = (id: string | null) => statuses()?.find(status => status.id === id)?.name ?? "";
const csv = [
["Number", "Title", "Description", "Status", "Due date", "Priority", "Assignees"],
...rows.map(issue => [issue.number, issue.title, issue.description, statusName(issue.status_id), issue.due_date, issue.priority, issue.assignee_ids.join("; ")]),
].map(row => row.map(csvCell).join(",")).join("\r\n");
const href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
const link = document.createElement("a"); link.href = href; link.download = "tickets.csv"; link.click(); URL.revokeObjectURL(href);
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
    <PageHeader
      kicker={projectName(projectId())}
      title="Tickets"
      chips={<Show when={issues()?.length}><Chip value={issues()!.length} label="tickets" /></Show>}
      actions={<>
        {/* The picker's VALUE is its label now — the word "Project" above it was the
            old idiom and is gone from the screen, not from the accessibility tree. */}
        <ProjectPicker labelHidden />
        {/* Header region is the PageHeader lane's; these three entries are only ADDED to
            its actions slot, because the creation column and the status editor column
            were removed from the body and their acts must stay reachable. They were
            reading as bare text links; as GhostPills they read as pressable. */}
        <GhostPill onClick={() => setStatusEditorOpen(open => !open)} aria-expanded={statusEditorOpen()}>Statuses</GhostPill>
        <GhostPill disabled={!issues()?.length} onClick={exportCsv}>Export CSV</GhostPill>
        <GhostPill {...linkProps({ view: "Boards", projectId: projectId() })}>Open board</GhostPill>
        <button type="button" class="primary" disabled={!projectId()} onClick={() => setDrawerOpen(true)}>New ticket</button>
      </>}
    />
    {/* Header first, THEN the section switch. */}
    {props.sections}
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    {/* Statuses used to be a permanent column; it is the same editor, on demand. */}
    <Show when={statusEditorOpen()}>
      <section class="status-editor issue-status-panel">
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
    </Show>
    <div class="issue-layout" classList={{ "with-detail": !!selected() }}>
      <main class="issue-list-pane">
        {/* ONE calm line of pills inside the paper card: search, then the four
            pickers, each labelled by its own current value. */}
        <ControlRow label="Ticket filters" class="filter-row">
          <QuietSearch label="Search tickets" placeholder="Search title or description" value={query()} onInput={setQuery} />
          <PillSelect label="Filter by status" value={statusFilter()} onChange={setStatusFilter}><option value="">All statuses</option><For each={statuses()}>{status => <option value={status.id}>{status.name}</option>}</For></PillSelect>
          <Show when={!props.filterTagName}>
            <PillSelect label="Filter by tag" value={tagFilter()} disabled={!projectId()} onChange={setTagFilter}><option value="">All tags</option><For each={tags()}>{tag => <option value={tag.id}>{tag.name}</option>}</For></PillSelect>
          </Show>
          <ProfilePicker label="Assignee" labelHidden value={assigneeFilter()} onChange={setAssigneeFilter} allowAll />
          <PillSelect label="Filter by custom field" value={customFieldFilter()} disabled={!projectId()} onChange={value => { setCustomFieldFilter(value); setCustomValueFilter(""); }}><option value="">All custom fields</option><For each={customFields()}>{field => <option value={field.id}>{field.name}</option>}</For></PillSelect>
          <Show when={customFieldFilter()}><QuietSearch label="Filter custom field value" placeholder="Exact custom value" grow={false} value={customValueFilter()} onInput={setCustomValueFilter} /></Show>
        </ControlRow>
        <Show when={pinnedTagMissing()}>
          {/* Honest: no such tag in this project, so there is no list to show — not
              "every issue" pretending to be the bug list. */}
          <p class="empty-state">This project has no “{props.filterTagName}” tag yet. Tag a ticket to build this list.</p>
        </Show>
        <Show when={!pinnedTagMissing()}>
        <Show when={issues.loading}><p class="hint">Loading tickets…</p></Show>
        <Show when={!issues.loading && !issues()?.length}><p class="empty-state">No tickets match these filters.</p></Show>
        <ul class="issue-list paper-list"><For each={issues()}>{issue => <li classList={{ active: selected()?.id === issue.id }}>
          {/* Title line, then a muted meta line, then at most one status pill —
              the same three-part shape every list surface uses now. */}
          <a class="issue-row" {...linkProps(issueRoute(issue))} onClick={event => followIssue(event, issue)}>
            <span class="row-main">
              <strong>{issue.title}</strong>
              <span class="row-meta">
                <span class="issue-number">#{issue.number}</span>
                <Show when={issue.due_date}>{date => <time classList={{ overdue: date() < todayISO() }}>{date()}</time>}</Show>
              </span>
            </span>
            {/* Exactly one pill per row, coloured by the law: see `pillTone`. */}
            <span class="status-name" classList={{ [pillTone(issue)]: true }}>
              {statuses()?.find(entry => entry.id === issue.status_id)?.name ?? "No status"}
            </span>
          </a>
        </li>}</For></ul>
        </Show>
      </main>
      {/* The detail pane EXISTS only once a row is chosen; until then the list is the
          whole width, instead of an empty column asking to be filled. */}
      <Show when={selected()}>
        {issue => <aside class="issue-detail">
          <button type="button" class="ghost issue-detail-close" aria-label="Close ticket detail" onClick={() => { setSelected(undefined); navigate({ view: route().view, projectId: route().projectId }, undefined, undefined, true); }}>×</button>
          <IssueDetail issueId={issue().id} statuses={statuses()} onChanged={() => { void reloadIssues(); void reloadTags(); }} />
        </aside>}
      </Show>
    </div>
    <Show when={drawerOpen() && projectId()}>
      <IssueCreateDrawer projectId={projectId()} statuses={statuses() ?? []} onClose={() => setDrawerOpen(false)} onCreated={issue => void afterCreate(issue)} />
    </Show>
  </section>;
}
