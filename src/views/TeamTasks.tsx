import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { personalApi, type Todo } from "../api/personal";
import { ProfilePicker } from "../components/Pickers";
import { profileId, profiles, projects, reloadProjects } from "../session";
import { linkProps, navigate } from "../router";
import { GhostPill, QuietSearch } from "../components/controls";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { todayISO, urgencyOf } from "../statusTone";
import "../components/paper.css";
import "./Issues.css";
import "./TeamTasks.css";

/** Cross-project team surface: what EVERYONE is currently working on, everywhere the
 *  caller is a member. Deliberately NOT "my" tasks — the assignee filter defaults to
 *  all people, because the question this view answers is "who is on what".
 *
 *  LAW: a project lead is PURELY INFORMATIONAL. Nothing here — reading a row, filtering,
 *  opening a project — is ever gated on being the lead. Every project member sees every
 *  project task of every member and may create tasks for themselves and for others. */
export default function TeamTasks() {
  const [text, setText] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal(""); // "" = ALL people. The point of the view.
  const [includeDone, setIncludeDone] = createSignal(false);

  const [tasks, { refetch: reloadTasks }] = createResource(
    () => [profileId(), includeDone()] as const,
    ([profile_id, include_done]) => profile_id ? personalApi.teamTodos(profile_id, include_done) : Promise.resolve([] as Todo[]),
  );
  onMount(() => { void reloadProjects().catch(() => undefined); });
  // A team surface is collaborative: another member's write must arrive without making
  // the current user discover a secret reload gesture. Focus refresh is immediate; the
  // bounded interval covers two people who keep the view open side by side.
  onMount(() => {
    const refresh = () => { void reloadTasks(); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    onCleanup(() => { window.clearInterval(interval); window.removeEventListener("focus", refresh); });
  });

  const nameOf = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  const projectName = (id: string) => projects()?.find(item => item.id === id)?.name ?? "Unknown project";
  const visible = () => (tasks() ?? []).filter(task => {
    const query = text().trim().toLowerCase();
    return (!query || task.content.toLowerCase().includes(query) || (task.notes ?? "").toLowerCase().includes(query))
      && (!assigneeId() || task.assignee_ids.includes(assigneeId()));
  });
  /* Two different facts about "the list is empty": a filter is hiding the work,
     or there is no work. `includeDone` is NOT a filter for this purpose — it
     only ever ADDS rows, so it can never be the reason nothing is shown. */
  const filtered = () => !!text().trim() || !!assigneeId();
  const clearFilters = () => { setText(""); setAssigneeId(""); };
  /** Grouped by project, project names ordered alphabetically so the list is stable. */
  const groups = () => {
    const by = new Map<string, Todo[]>();
    for (const task of visible()) {
      const key = task.project_id ?? "";
      const bucket = by.get(key); bucket ? bucket.push(task) : by.set(key, [task]);
    }
    return [...by.entries()]
      .map(([project_id, items]) => ({ project_id, name: projectName(project_id), items }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  return <section class="planning-view team-tasks-view">
    <PageHeader title="Team tasks" subline="Everybody's running work, not just yours" />
    <Show when={tasks.error}><p class="planning-error" role="alert">Could not load team tasks: {String(tasks.error)}</p></Show>
    <div class="filter-row" aria-label="Team task filters">
      {/* One control language: a quiet search and a pill whose resting value
          ("All profiles") is its own label — no caption above either. */}
      <QuietSearch label="Search team tasks" placeholder="Search tasks" value={text()} onInput={setText} />
      <ProfilePicker label="Assignee" labelHidden value={assigneeId()} onChange={setAssigneeId} allowAll />
      <label class="tt-toggle"><input type="checkbox" aria-label="Show completed" checked={includeDone()} onChange={event => setIncludeDone(event.currentTarget.checked)} /> Show completed</label>
    </div>
    <Show when={!profileId()}><p class="hint">Your account profile is still loading; team tasks will appear when it is ready.</p></Show>
    <Show when={tasks.loading}><p class="hint">Loading team tasks…</p></Show>
    {/* FILTERS MATCH NOTHING: the store has work, this filter simply hides it,
        so the only right offer is to clear the filter — never "create", which
        would invite a duplicate of the task being searched for. */}
    <Show when={!tasks.loading && !groups().length && filtered()}>
      <EmptyState variant="no-match" title="No team tasks match these filters." actions={<GhostPill onClick={clearFilters}>Clear filters</GhostPill>} />
    </Show>
    {/* NOTHING YET across every project the caller is a member of. This surface
        has no composer of its own; creation lives in My tasks, so that is where
        the primary goes — named for what it does, not for where it lands. */}
    <Show when={!tasks.loading && !groups().length && !filtered() && !!profileId()}>
      <EmptyState
        title="Nobody has a running task yet"
        hint="This is everyone's work across your projects — it fills up as people add tasks."
        actions={<button type="button" class="primary" onClick={() => navigate({ view: "To-Do" })}>Add the first task</button>}
      />
    </Show>
    <For each={groups()}>{group => <section class="tt-group" aria-label={group.name}>
      <h2 class="tt-group-head"><a {...linkProps({ view: "Project Tasks", projectId: group.project_id })}>{group.name}</a> <small>{group.items.length}</small></h2>
      <ul class="issue-list tt-list">
        <For each={group.items}>{task => <li>
          {/* Same three-part row as Issues: title line, muted meta line, one pill. */}
          {/* The row is marked overdue by the shared urgency rule; the pill beside it
              names the assignee and carries no colour, so the two never contradict. */}
          <div class="issue-row tt-row" classList={{ overdue: !task.done && urgencyOf(task.due_date, todayISO()) === "overdue" }}>
            <span class="project-task-check" aria-hidden="true">{task.done ? "✓" : "○"}</span>
            <span class="row-main">
              <strong>{task.content}</strong>
              <span class="row-meta">
                <span class="tt-assignees">{task.assignee_ids.length ? task.assignee_ids.map(nameOf).join(", ") : "Unassigned"}</span>
                <Show when={task.due_date}>{date => <time>{date()}</time>}</Show>
              </span>
            </span>
            <span class="status-name">{nameOf(task.profile_id)}</span>
          </div>
        </li>}</For>
      </ul>
    </section>}</For>
  </section>;
}
