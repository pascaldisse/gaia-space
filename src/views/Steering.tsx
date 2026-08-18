import { createMemo, createResource, For, Show } from "solid-js";
import { api } from "../api";
import { planningApi, type Status } from "../api/issues";
import { personalApi } from "../api/personal";
import { projectId, projects, profiles, reloadProfiles } from "../session";
import { requestView } from "../nav";
import "./Steering.css";

// Steering — the default project cockpit. Surfaces what needs a decision right
// now (overdue / due-soon / unassigned) alongside current work and the next
// meetings. Everything is derived from existing data (issues, personal tasks,
// statuses, meetings, channels); no new backend surface.
//
// Two kinds of work live here, kept visually distinct:
//   • Issue — planning work (has a #number, a status, and an optional assignee).
//   • Task  — a project-filed personal to-do (always carries an owner).
// Action-needed categories span BOTH kinds where meaningful:
//   • Overdue / Due soon — issues + tasks (both carry due dates).
//   • Unassigned — issues only. A task always has an owner, so it can never be
//     "unassigned"; flagging owned tasks there would mislead.
// Current work — active (not-done) tasks + assigned issues, each deep-linking to
// its own workspace (Tasks vs Issues).
const DAY = 86_400;
const todayStr = () => new Date().toISOString().slice(0, 10);

type Kind = "task" | "issue";
type WorkItem = {
  kind: Kind;
  id: string;
  title: string;
  due_date: string | null;
  assigned: boolean;      // issue has an assignee / task has an owner (always true)
  assigneeLabel: string;
  number?: number;        // issue only
  statusColor?: string;   // issue only
};

export default function Steering() {
  const project = createMemo(() => projects()?.find((p) => p.id === projectId()));
  void reloadProfiles();

  const [data] = createResource(projectId, async (pid) => {
    if (!pid) return undefined;
    const [issues, statuses, meetings, channels, todos] = await Promise.all([
      planningApi.issues({ project_id: pid }), planningApi.statuses(pid),
      api.listMeetings(), api.listChannels(),
      personalApi.projectTodos(pid).catch(() => []),
    ]);
    const resolved = new Set(statuses.filter((s) => s.resolved).map((s) => s.id));
    const activeIssues = issues.filter((i) => !i.archived && !resolved.has(i.status_id ?? ""));
    const activeTasks = todos.filter((t) => !t.done);
    const now = Date.now() / 1000;
    const channelIds = new Set(channels.filter((c) => c.project_id === pid).map((c) => c.id));
    const meetingsNext = meetings
      .filter((m) => !m.archived && m.channel_id && channelIds.has(m.channel_id) && m.ends_at >= now)
      .sort((a, b) => a.starts_at - b.starts_at)
      .slice(0, 5);
    return { statuses, activeIssues, activeTasks, meetingsNext };
  });

  const nameFor = (id: string | null) => profiles()?.find((p) => p.id === id)?.display_name || (id ? "—" : "Unassigned");
  const colorOf = (statusId: string | null, statuses: Status[]) => statuses.find((s) => s.id === statusId)?.color ?? "#3d4a68";

  // Unify both data types into a single WorkItem stream. Built in a memo so
  // profile names stay reactive as profiles load.
  const items = createMemo<WorkItem[]>(() => {
    const d = data(); if (!d) return [];
    const issueItems: WorkItem[] = d.activeIssues.map((i) => ({
      kind: "issue", id: i.id, title: i.title, due_date: i.due_date ?? null,
      assigned: !!i.assignee_id, assigneeLabel: nameFor(i.assignee_id),
      number: i.number, statusColor: colorOf(i.status_id ?? null, d.statuses),
    }));
    const taskItems: WorkItem[] = d.activeTasks.map((t) => ({
      kind: "task", id: t.id, title: t.content, due_date: t.due_date ?? null,
      assigned: true, assigneeLabel: nameFor(t.profile_id),
    }));
    return [...issueItems, ...taskItems];
  });

  const buckets = createMemo(() => {
    const all = items();
    const today = todayStr();
    const soonCutoff = new Date(Date.now() + 7 * DAY * 1000).toISOString().slice(0, 10);
    const overdue = all.filter((x) => x.due_date && x.due_date < today).sort(byDue);
    const soon = all.filter((x) => x.due_date && x.due_date >= today && x.due_date <= soonCutoff).sort(byDue);
    // Unassigned is an issue-only signal — tasks always carry an owner.
    const unassigned = all.filter((x) => x.kind === "issue" && !x.assigned).sort(byDue);
    // Current work: every active task + issues that have an owner.
    const currentWork = all.filter((x) => x.kind === "task" || x.assigned).sort(byDue);
    return { overdue, soon, unassigned, currentWork };
  });

  // Project deadline state, derived against today: drives the deadline banner tone.
  const DAY_MS = DAY * 1000;
  const deadline = createMemo(() => {
    const d = project()?.deadline;
    if (!d) return undefined;
    const today = todayStr();
    const soon = new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10);
    const tone: "overdue" | "soon" | "ok" = d < today ? "overdue" : d <= soon ? "soon" : "ok";
    const days = Math.round((new Date(d + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / DAY_MS);
    return { date: d, tone, days };
  });
  const deadlineNote = () => {
    const info = deadline(); if (!info) return "";
    if (info.days === 0) return "due today";
    return info.days < 0 ? `${-info.days} day${info.days === -1 ? "" : "s"} overdue` : `in ${info.days} day${info.days === 1 ? "" : "s"}`;
  };

  const goto = (x: WorkItem) => requestView(x.kind === "issue" ? "Issues" : "ProjectTasks");
  const workItemRow = (x: WorkItem, badge?: "overdue" | "soon" | "unassigned") =>
    <li onClick={() => goto(x)}>
      <span class="st-kind" classList={{ [x.kind]: true }}>{x.kind === "issue" ? "Issue" : "Task"}</span>
      <Show when={x.kind === "issue"}><span class="st-num">#{x.number}</span></Show>
      <strong>{x.title}</strong>
      <Show when={x.kind === "issue"}><span class="st-status" style={{ background: x.statusColor }}/></Show>
      <span class="st-assignee">{x.assigneeLabel}</span>
      <Show when={x.due_date}><time classList={{ late: badge === "overdue" }}>{x.due_date}</time></Show>
    </li>;

  const actionCard = (title: string, list: WorkItem[], tone: "overdue" | "soon" | "unassigned") =>
    <section class="st-action" classList={{ [tone]: true, empty: !list.length }}>
      <header><span class="st-dot"/><h3>{title}</h3><b>{list.length}</b></header>
      <Show when={list.length} fallback={<p class="st-clear">All clear</p>}>
        <ul class="st-list">
          <For each={list.slice(0, 6)}>{(x) => workItemRow(x, tone)}</For>
        </ul>
        <Show when={list.length > 6}>
          <button class="st-more" onClick={() => goto(list[0]!)}>+{list.length - 6} more →</button>
        </Show>
      </Show>
    </section>;

  return <section class="st-view">
    <header class="st-head">
      <div class="st-title">
        <div class="st-mark">{(project()?.key ?? "··").slice(0, 2).toUpperCase()}</div>
        <div>
          <h1>{project()?.name ?? "Steering"}</h1>
          <p>{project()?.description || "What needs a decision now — plus current work and what's coming up."}</p>
        </div>
      </div>
    </header>

    <Show when={!projectId()}><p class="st-empty">No project selected — choose one from the project switcher above, or open Projects to pick one.</p></Show>

    <Show when={projectId()}>
      <Show when={data.loading}><p class="st-muted">Loading steering overview…</p></Show>
      <Show when={data()}>
        <>
          <Show when={deadline()}>{info =>
            <button class="st-deadline" classList={{ [info().tone]: true }} onClick={() => requestView("ProjectSettings")}>
              <span class="st-deadline-dot"/>
              <span class="st-deadline-label">Project deadline</span>
              <time>{info().date}</time>
              <em>{deadlineNote()}</em>
            </button>}
          </Show>

          <div class="st-band">
            <span class="st-band-label">Action needed</span>
            <div class="st-actions">
              {actionCard("Overdue", buckets().overdue, "overdue")}
              {actionCard("Due soon", buckets().soon, "soon")}
              {actionCard("Unassigned", buckets().unassigned, "unassigned")}
            </div>
          </div>

          <div class="st-grid">
            <section class="st-card">
              <div class="st-card-head"><h2>Current work <small>{buckets().currentWork.length} active</small></h2><button class="st-link" onClick={() => requestView("Issues")}>Open Work →</button></div>
              <Show when={buckets().currentWork.length} fallback={<p class="st-muted">Nothing in flight — everything is unassigned or done.</p>}>
                <ul class="st-list">
                  <For each={buckets().currentWork.slice(0, 8)}>{(x) => workItemRow(x)}</For>
                </ul>
              </Show>
            </section>

            <section class="st-card st-agenda">
              <div class="st-card-head"><h2>Upcoming agenda <small>{data()!.meetingsNext.length} scheduled</small></h2><button class="st-link st-cal" onClick={() => requestView("ProjectCalendar")}>Open calendar →</button></div>
              <Show when={data()!.meetingsNext.length} fallback={<p class="st-muted">Nothing scheduled.</p>}>
                <ul class="st-list agenda">
                  <For each={data()!.meetingsNext}>{(m) =>
                    <li onClick={() => requestView("ProjectCalendar")}><time>{new Date(m.starts_at * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {new Date(m.starts_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><strong>{m.title}</strong><Show when={m.location}><small>{m.location}</small></Show></li>}</For>
                </ul>
              </Show>
            </section>
          </div>
        </>
      </Show>
    </Show>
  </section>;
}

const byDue = (a: WorkItem, b: WorkItem) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
