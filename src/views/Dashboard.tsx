import { createResource, createSignal, For, Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { personalApi, type MeetingOccurrence, type Todo } from "../api/personal";
import { platformApi, type Project } from "../api/platform";
import { ProfilePicker } from "../components/Pickers";
import { profileId } from "../session";
import { requestView } from "../nav";
import "./Dashboard.css";

// agenda helpers — group the next meetings into human day-buckets so the
// Overview leads with "what's coming up" and an obvious path to the calendar.
const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const dayLabel = (ts: number) => {
  const d = new Date(ts * 1000), today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};
const timeLabel = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const groupAgenda = (items: MeetingOccurrence[]) => {
  const sorted = [...items].sort((a, b) => a.starts_at - b.starts_at);
  const buckets: { key: string; label: string; items: MeetingOccurrence[] }[] = [];
  for (const it of sorted) {
    const key = dayKey(it.starts_at);
    let bucket = buckets.find((b) => b.key === key);
    if (!bucket) { bucket = { key, label: dayLabel(it.starts_at), items: [] }; buckets.push(bucket); }
    bucket.items.push(it);
  }
  return buckets;
};

// "Today & next" helpers — pure date math over YYYY-MM-DD keys so the action
// area can bucket tasks and score project deadlines without pulling in a lib.
const todayKey = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const parseKey = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };
const daysUntil = (dateStr: string) => Math.round((parseKey(dateStr) - parseKey(todayKey())) / 86_400_000);
const SOON_DAYS = 7; // tasks/deadlines within a week count as "coming up"

type TaskBucket = "overdue" | "today" | "soon";
const taskBucket = (due: string): TaskBucket | null => {
  const n = daysUntil(due);
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n <= SOON_DAYS) return "soon";
  return null;
};
const TASK_SECTIONS: { key: TaskBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "soon", label: "Next 7 days" },
];
const dueLabel = (due: string) => {
  const n = daysUntil(due);
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  return `Due in ${n}d`;
};

// Project deadline risk — read-only signal derived purely from proximity. This
// section flags what needs attention; projects are never "completed" from here.
type Risk = "overdue" | "high" | "medium" | "low";
const projectRisk = (deadline: string): Risk => {
  const n = daysUntil(deadline);
  if (n < 0) return "overdue";
  if (n <= 7) return "high";
  if (n <= 30) return "medium";
  return "low";
};
const riskLabel: Record<Risk, string> = { overdue: "Overdue", high: "At risk", medium: "Approaching", low: "On track" };
const deadlineLabel = (deadline: string) => {
  const n = daysUntil(deadline);
  if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} overdue`;
  if (n === 0) return "Due today";
  return `${n} day${n === 1 ? "" : "s"} left`;
};

const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//i.test(s.trim());
const openMeetingLink = (url: string) => { openUrl(url).catch(() => window.open(url, "_blank")); };

export default function Dashboard() {
  const [dashboard, { refetch }] = createResource(profileId, id => id ? personalApi.dashboard(id) : Promise.resolve(undefined));
  const [projects, { refetch: refetchProjects }] = createResource(() => platformApi.projects().catch(() => [] as Project[]));
  // optimistic completion — hide a task the instant it's checked, then persist.
  const [completing, setCompleting] = createSignal<Set<string>>(new Set());
  const completeTask = async (todo: Todo) => {
    setCompleting(prev => new Set(prev).add(todo.id));
    try { await personalApi.updateTodo({ ...todo, done: true }); await refetch(); }
    catch { setCompleting(prev => { const n = new Set(prev); n.delete(todo.id); return n; }); }
  };

  // actionable tasks = open to-dos with a due date inside the action horizon,
  // grouped overdue → today → soon, minus any just-completed optimistically.
  const actionTasks = () => {
    const data = dashboard();
    if (!data) return [] as { key: TaskBucket; label: string; items: Todo[] }[];
    const done = completing();
    return TASK_SECTIONS.map(sec => ({
      ...sec,
      items: data.open_todos.filter(t => !done.has(t.id) && t.due_date && taskBucket(t.due_date) === sec.key)
        .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1)),
    })).filter(sec => sec.items.length);
  };
  const actionTaskCount = () => actionTasks().reduce((n, s) => n + s.items.length, 0);

  // at-risk projects = non-archived with a deadline, worst (soonest) first.
  const riskyProjects = () => (projects() ?? [])
    .filter(p => !p.archived && p.deadline)
    .map(p => ({ project: p, risk: projectRisk(p.deadline!), days: daysUntil(p.deadline!) }))
    .sort((a, b) => a.days - b.days);

  // agenda for the compact "Today & next" column — soonest meetings first.
  const nextMeetings = () => [...(dashboard()?.meeting_occurrences ?? [])].sort((a, b) => a.starts_at - b.starts_at).slice(0, 5);

  return <section class="dashboard-view">
    <header>
      <div><h1>Overview</h1><p>Your work, calendar, notification feed, and organization availability.</p></div>
      <ProfilePicker/>
    </header>
    <Show when={dashboard.loading}><p class="dashboard-muted">Loading dashboard…</p></Show>
    <Show when={!profileId()}><p class="dashboard-empty">No profile selected — add one in Members.</p></Show>
    <Show when={dashboard()}>{data =>
      <>
        {/* ── Today & next ── prominent action area: what to do, what's at risk, what's scheduled ── */}
        <section class="today-next">
          <div class="tn-head">
            <div class="tn-title"><span class="tn-icon">◎</span><div><h2>Today &amp; next</h2><p>Your actionable items across tasks, project deadlines, and the calendar</p></div></div>
          </div>
          <div class="tn-grid">
            {/* Actionable tasks — completable inline */}
            <article class="tn-col tn-tasks">
              <header><h3>Tasks to action <span>{actionTaskCount()}</span></h3><button class="tn-link" onClick={() => requestView("Calendar")}>Calendar →</button></header>
              <Show when={actionTaskCount()} fallback={<p class="tn-empty">Nothing due in the next {SOON_DAYS} days. You're clear. ✓</p>}>
                <For each={actionTasks()}>{sec =>
                  <div class="tn-tasksec">
                    <span class="tn-seclabel" classList={{ [sec.key]: true }}>{sec.label} <em>{sec.items.length}</em></span>
                    <ul>
                      <For each={sec.items}>{todo =>
                        <li>
                          <label class="tn-check">
                            <input type="checkbox" onChange={() => completeTask(todo)} aria-label={`Complete ${todo.content}`} />
                            <span class="tn-task-body">
                              <strong>{todo.content}</strong>
                              <small classList={{ overdue: sec.key === "overdue" }}>{dueLabel(todo.due_date!)}</small>
                            </span>
                          </label>
                        </li>}</For>
                    </ul>
                  </div>}</For>
              </Show>
            </article>

            {/* Project deadlines & risk — read-only, never completed here */}
            <article class="tn-col tn-risk">
              <header><h3>Project deadlines <span>{riskyProjects().length}</span></h3><button class="tn-link" onClick={() => requestView("Portfolio")}>Portfolio →</button></header>
              <Show when={riskyProjects().length} fallback={<p class="tn-empty">No projects have deadlines set.</p>}>
                <ul class="tn-risklist">
                  <For each={riskyProjects()}>{({ project, risk }) =>
                    <li onClick={() => requestView("Portfolio")}>
                      <span class="tn-riskdot" classList={{ [risk]: true }} />
                      <span class="tn-risk-body">
                        <strong>{project.name}</strong>
                        <small>{project.key} · {deadlineLabel(project.deadline!)}</small>
                      </span>
                      <span class="tn-riskbadge" classList={{ [risk]: true }}>{riskLabel[risk]}</span>
                    </li>}</For>
                </ul>
              </Show>
            </article>

            {/* Calendar agenda — meeting links / open calendar */}
            <article class="tn-col tn-agenda">
              <header><h3>Agenda <span>{data().meeting_occurrences.length}</span></h3><button class="tn-link" onClick={() => requestView("Calendar")}>Open calendar →</button></header>
              <Show when={nextMeetings().length} fallback={<p class="tn-empty">Nothing scheduled this week. <button class="agenda-inline" onClick={() => requestView("Calendar")}>Browse →</button></p>}>
                <ul class="tn-agendalist">
                  <For each={nextMeetings()}>{m =>
                    <li>
                      <span class="tn-when"><time>{dayLabel(m.starts_at)}</time><time class="tn-hour">{timeLabel(m.starts_at)}</time></span>
                      <span class="tn-meet-body">
                        <strong>{m.title}</strong>
                        <Show when={m.location}><small>{m.location}</small></Show>
                      </span>
                      <Show when={isUrl(m.location)} fallback={<button class="tn-meet-btn ghost" onClick={() => requestView("Calendar")}>Open</button>}>
                        <button class="tn-meet-btn join" onClick={() => openMeetingLink(m.location!)}>Join →</button>
                      </Show>
                    </li>}</For>
                </ul>
              </Show>
            </article>
          </div>
        </section>

        {/* prominent agenda hero — leads the rest of the Overview and links straight to the full calendar */}
        <section class="dashboard-agenda">
          <div class="agenda-head">
            <div class="agenda-title"><span class="agenda-icon">▦</span><div><h2>Upcoming agenda</h2><p>Your next {data().meeting_occurrences.length} meeting{data().meeting_occurrences.length === 1 ? "" : "s"} across the week</p></div></div>
            <button class="agenda-open primary" onClick={() => requestView("Calendar")}>Open full calendar →</button>
          </div>
          <Show when={data().meeting_occurrences.length} fallback={<p class="agenda-empty">Nothing scheduled in the next week. <button class="agenda-inline" onClick={() => requestView("Calendar")}>Browse the calendar →</button></p>}>
            <div class="agenda-days">
              <For each={groupAgenda(data().meeting_occurrences)}>{bucket =>
                <div class="agenda-day">
                  <span class="agenda-daylabel">{bucket.label}</span>
                  <ul>
                    <For each={bucket.items}>{m =>
                      <li onClick={() => requestView("Calendar")}>
                        <time>{timeLabel(m.starts_at)}</time>
                        <strong>{m.title}</strong>
                        <Show when={m.location}><small>{m.location}</small></Show>
                      </li>}</For>
                  </ul>
                </div>}</For>
            </div>
          </Show>
        </section>

        <div class="dashboard-grid">
          <section><h2>Open to-dos <span>{data().open_todos.length}</span></h2><For each={data().open_todos}>{todo => <article><strong>{todo.content}</strong><small>{todo.due_date ? `Due ${todo.due_date}` : "No due date"}</small></article>}</For><Show when={!data().open_todos.length}><p class="dashboard-muted">No open tasks.</p></Show></section>
          <section><h2>Assigned issues <span>{data().assigned_issues.length}</span></h2><For each={data().assigned_issues}>{issue => <article><strong>#{issue.number} {issue.title}</strong><small>{issue.project_id}{issue.due_date ? ` · Due ${issue.due_date}` : ""}</small></article>}</For><Show when={!data().assigned_issues.length}><p class="dashboard-muted">No assigned open issues.</p></Show></section>
          <section><h2>Unread notifications <span>{data().unread_notifications.length}</span></h2><For each={data().unread_notifications}>{notification => <article><strong>{notification.title}</strong><small>{notification.event_type}{notification.body ? ` · ${notification.body}` : ""}</small></article>}</For><Show when={!data().unread_notifications.length}><p class="dashboard-muted">No unread notifications.</p></Show></section>
          <section><h2>Currently absent <span>{data().current_absences.length}</span></h2><For each={data().current_absences}>{absence => <article><strong>{absence.profile_id}</strong><small>{absence.reason_type} · through {absence.date_to}</small></article>}</For><Show when={!data().current_absences.length}><p class="dashboard-muted">No approved current absences.</p></Show></section>
        </div>
      </>
    }</Show>
    <Show when={profileId()}><button class="dashboard-refresh" onClick={() => { refetch(); refetchProjects(); }}>Refresh dashboard</button></Show>
  </section>;
}
