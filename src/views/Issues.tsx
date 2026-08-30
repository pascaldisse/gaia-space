import { createEffect, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { planningApi, type Issue, type Status } from "../api/issues";
import { platformApi } from "../api/platform";
import { ProfilePicker, ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import IssueCreateDrawer from "../components/IssueCreateDrawer";
import { humanError, projectId as sessionProject, setProjectId } from "../session";
import { linkEntity, linkProps, navigate, route, useDeepLink } from "../router";
import PageHeader, { Chip, useEmbedded } from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import { ControlRow, GhostPill, PillMenu, PillSelect, QuietSearch } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { projectName } from "../orgScope";
import "../components/paper.css";
import "./Issues.css";

import { dueTone, priorityTone, statusTone, todayISO } from "../statusTone";

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
 * forking the header out of here. They are a VIEW control — which section of
 * Development you are looking at — so the slot renders at the right end of the
 * action row, with the project picker, and not as a strip of its own. */
export default function Issues(props: { filterTagName?: string; sections?: JSX.Element; title?: string } = {}) {
  /* ICON + SUBLINE (design rollout). The glyph is the rail's own `target`, so the page
     wears the mark you clicked to get here. The subline is dropped when a host has
     already named this surface — in the project workspace it would be the second
     answer to a question nobody asked twice. */
  const embedded = useEmbedded();
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
  /* A pinned tag (Development › Bugs) is the view's IDENTITY, not a filter the
     reader set — so it never counts as "you filtered this away". */
  const filtered = () => !!query().trim() || !!statusFilter() || !!assigneeFilter() || !!customFieldFilter()
    || (!props.filterTagName && !!tagFilter());
  const clearFilters = () => {
    setQuery(""); setStatusFilter(""); setAssigneeFilter("");
    setCustomFieldFilter(""); setCustomValueFilter("");
    if (!props.filterTagName) setTagFilter("");
  };
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
  /* The two states below that print an EmptyState carrying "New ticket". While either
     is on screen the action row does not repeat the act. */
  const emptyStateOffersCreate = () => pinnedTagMissing() || (!issues.loading && !issues()?.length && !filtered());
  // Colour law: one pill states one fact. The status pill reads the STATUS and
  // nothing else — folding urgency into it made two rows with the identical words
  // "No status" render red and teal. Urgency lives on the date, priority on its own
  // pill, both from the shared model in src/statusTone.ts.
  const pillTone = (issue: Issue) => statusTone(statuses()?.find(entry => entry.id === issue.status_id));
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
    {/* On its own route this page IS Tickets. Mounted as a SECTION of
        Development it is not: the rail entry that opened it says "Overview",
        the pills below say which section you are in, and a second surface
        calling itself "Tickets" made two rail entries look like one page.
        The host passes its own name. */}
    <PageHeader
      kicker={projectName(projectId())}
      icon="target"
      title={props.title ?? "Tickets"}
      subline={embedded() ? undefined : "Tracked work in this project — every bug, feature and chore with a status."}
      chips={<Show when={issues()?.length}><Chip value={issues()!.length} label="tickets" /></Show>}
    />
    {/* THE ACTION ROW (PageHeader.css `.page-actionbar`). What MAKES something is on
        the left; what changes WHAT YOU SEE is at the right end. The header keeps the
        ticket count and nothing else — it used to carry the picker and four acts, so
        the same "New ticket" had two addresses on two pages. */}
    <nav class="page-actionbar" aria-label="Ticket actions">
      {/* ONE ACTION, ONE PLACE: while an empty state below is offering "New ticket",
          the row does not draw it a second time. */}
      <Show when={!emptyStateOffersCreate()}>
        <button type="button" class="primary" disabled={!projectId()} onClick={() => setDrawerOpen(true)}>New ticket</button>
      </Show>
      {/* The creation column and the status editor column were removed from the body;
          their acts stay reachable here, ranked below the primary. */}
      <GhostPill onClick={() => setStatusEditorOpen(open => !open)} aria-expanded={statusEditorOpen()}>Statuses</GhostPill>
      <GhostPill disabled={!issues()?.length} onClick={exportCsv}>Export CSV</GhostPill>
      <GhostPill {...linkProps({ view: "Boards", projectId: projectId() })}>Open board</GhostPill>
      <span class="actionbar-view-controls">
        {/* Header first, THEN the section switch — and the switch is a view control. */}
        {props.sections}
        {/* The picker's VALUE is its label now — the word "Project" above it was the
            old idiom and is gone from the screen, not from the accessibility tree. */}
        <ProjectPicker labelHidden />
      </span>
    </nav>
    {/* Which section of Development you are in, and what it carries. Bugs are the
        same tickets narrowed to one tag, so it says that instead of pretending to be
        a different store. */}
    <ContentHead
      icon="target"
      title={props.filterTagName === "bug" ? "Bugs" : "Tickets"}
      line={props.filterTagName === "bug"
        ? "Tickets tagged bug — the same store, narrowed to what is broken."
        : "Work with a status: every bug, feature and chore this project tracks."} />
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
          {/* A project's workflow statuses are a closed handful of ITS OWN words
              — the list this row is read by — so it opens our menu. Tags and
              custom fields below stay native `PillSelect`: those grow with the
              project, a hundred tags is a real list, and the platform popup is
              better at a hundred rows than a hand-built one. */}
          <PillMenu label="Filter by status" value={statusFilter()} onChange={setStatusFilter}
            options={[{ value: "", label: "All statuses" }, ...(statuses() ?? []).map(status => ({ value: status.id, label: status.name }))]} />
          <Show when={!props.filterTagName}>
            <PillSelect label="Filter by tag" value={tagFilter()} disabled={!projectId()} onChange={setTagFilter}><option value="">All tags</option><For each={tags()}>{tag => <option value={tag.id}>{tag.name}</option>}</For></PillSelect>
          </Show>
          <ProfilePicker label="Assignee" labelHidden value={assigneeFilter()} onChange={setAssigneeFilter} allowAll />
          <PillSelect label="Filter by custom field" value={customFieldFilter()} disabled={!projectId()} onChange={value => { setCustomFieldFilter(value); setCustomValueFilter(""); }}><option value="">All custom fields</option><For each={customFields()}>{field => <option value={field.id}>{field.name}</option>}</For></PillSelect>
          <Show when={customFieldFilter()}><QuietSearch label="Filter custom field value" placeholder="Exact custom value" grow={false} value={customValueFilter()} onInput={setCustomValueFilter} /></Show>
        </ControlRow>
        <Show when={pinnedTagMissing()}>
          {/* Honest: no such tag in this project, so there is no list to show — not
              "every issue" pretending to be the bug list. NOTHING YET, and the way
              out is a ticket carrying that tag, so the primary opens the drawer in
              THIS project — no picker, the project is already known. */}
          <EmptyState
            title={`No “${props.filterTagName}” ticket in this project yet`}
            hint="This list is built from the tag. File one and tag it to start it."
            actions={<button type="button" class="primary" disabled={!projectId()} onClick={() => setDrawerOpen(true)}>New ticket</button>}
          />
        </Show>
        <Show when={!pinnedTagMissing()}>
        <Show when={issues.loading}><p class="hint">Loading tickets…</p></Show>
        {/* The two cases, kept apart. Tickets are filtered SERVER-side, so an
            empty result cannot tell us whether the project is empty — but with no
            filter set at all, an empty result IS an empty project. */}
        <Show when={!issues.loading && !issues()?.length && filtered()}>
          <EmptyState variant="no-match" title="No tickets match these filters." actions={<GhostPill onClick={clearFilters}>Clear filters</GhostPill>} />
        </Show>
        <Show when={!issues.loading && !issues()?.length && !filtered()}>
          <EmptyState
            title="No tickets in this project yet"
            hint="A ticket is tracked work with a status — bugs, features, anything that belongs on the board."
            actions={<>
              <button type="button" class="primary" disabled={!projectId()} onClick={() => setDrawerOpen(true)}>New ticket</button>
              <GhostPill {...linkProps({ view: "Boards", projectId: projectId() })}>Open board</GhostPill>
            </>}
          />
        </Show>
        <ul class="issue-list paper-list"><For each={issues()}>{issue => <li classList={{ active: selected()?.id === issue.id }}>
          {/* Title line, then a muted meta line, then at most one status pill —
              the same three-part shape every list surface uses now. */}
          <a class="issue-row" {...linkProps(issueRoute(issue))} onClick={event => followIssue(event, issue)}>
            <span class="row-main">
              <strong>{issue.title}</strong>
              <span class="row-meta">
                <span class="issue-number">#{issue.number}</span>
                <Show when={issue.due_date}>{date => <time classList={{ [dueTone(date())]: true, overdue: date() < todayISO() }}>{date()}</time>}</Show>
              </span>
            </span>
            <Show when={priorityTone(issue.priority)}>
              <span class="status-name" classList={{ [priorityTone(issue.priority)]: true }}>{(issue.priority ?? "").toLowerCase()}</span>
            </Show>
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
