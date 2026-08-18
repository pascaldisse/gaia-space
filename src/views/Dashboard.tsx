import { createResource, createSignal, For, Show } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";
import { personalApi, type Todo } from "../api/personal";
import { platformApi, type Project } from "../api/platform";
import { meetingsApi } from "../api/meetings";
import { ProfilePicker } from "../components/Pickers";
import MiniCalendar from "../components/MiniCalendar";
import { profileId } from "../session";
import { requestView, requestTodo, requestDate } from "../nav";
import { buildCalendarItems, itemsOnDay, monthGrid, startOfDay, dayKeyOf, type CalendarItem } from "../calendar";
import "./Dashboard.css";

// agenda helpers — group the next meetings into human day-buckets so the
// Overview leads with "what's coming up" and an obvious path to the calendar.
const dayLabel = (ts: number) => {
  const d = new Date(ts * 1000), today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
};
const timeLabel = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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

// Deep-link into "My tasks", asking that view to focus/highlight the exact row.
const openMyTask = (id?: string) => { requestTodo(id); requestView("To-Do"); };

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

  // ── Embedded Calendar overview ── a compact month grid unifying meetings, task
  // due dates, and project deadlines for the visible month, with an adjacent
  // agenda for the picked day. Clicking through deep-links into the full Calendar
  // workspace focused on that day. Sources mirror the Calendar view exactly.
  const [calCursor, setCalCursor] = createSignal(startOfDay(new Date()));
  const [calDay, setCalDay] = createSignal(dayKeyOf(startOfDay(new Date())));
  const [calItems] = createResource(() => [calCursor().getTime(), profileId()] as const, async () => {
    const g = monthGrid(calCursor());
    const rangeStart = g[0].getTime() / 1000;
    const rangeEnd = new Date(g[41].getFullYear(), g[41].getMonth(), g[41].getDate() + 1).getTime() / 1000;
    const [occurrences, todos, projectsList] = await Promise.all([
      meetingsApi.occurrences(rangeStart, rangeEnd).catch(() => []),
      personalApi.todos(profileId(), true).catch(() => []),
      platformApi.projects().catch(() => []),
    ]);
    return buildCalendarItems({ occurrences, todos, projects: projectsList });
  });
  const calAgenda = () => itemsOnDay(calItems() ?? [], calDay());
  const shiftCal = (amount: number) => { const next = new Date(calCursor()); next.setMonth(next.getMonth() + amount); setCalCursor(startOfDay(next)); };
  const openCalendarAt = (dayKey: string) => { requestDate(dayKey); requestView("Calendar"); };
  const readableDay = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); };
  const calTime = (e: CalendarItem) => e.allDay ? (e.kind === "deadline" ? "Deadline" : "All day") : new Date(e.starts_at! * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
              <header><h3>Tasks to action <span>{actionTaskCount()}</span></h3><button class="tn-link" onClick={() => openMyTask()}>Open My tasks →</button></header>
              <Show when={actionTaskCount()} fallback={<p class="tn-empty">Nothing due in the next {SOON_DAYS} days. You're clear. ✓</p>}>
                <For each={actionTasks()}>{sec =>
                  <div class="tn-tasksec">
                    <span class="tn-seclabel" classList={{ [sec.key]: true }}>{sec.label} <em>{sec.items.length}</em></span>
                    <ul>
                      <For each={sec.items}>{todo =>
                        <li>
                          <input class="tn-check-box" type="checkbox" onChange={() => completeTask(todo)} aria-label={`Complete ${todo.content}`} />
                          <button class="tn-task-body" onClick={() => openMyTask(todo.id)} title="Open in My tasks">
                            <strong>{todo.content}</strong>
                            <small classList={{ overdue: sec.key === "overdue" }}>{dueLabel(todo.due_date!)}</small>
                          </button>
                        </li>}</For>
                    </ul>
                  </div>}</For>
              </Show>
            </article>

            {/* Project deadlines & risk — read-only, never completed here */}
            <article class="tn-col tn-risk">
              <header><h3>Project deadlines <span>{riskyProjects().length}</span></h3><button class="tn-link" onClick={() => requestView("Projects")}>Portfolio →</button></header>
              <Show when={riskyProjects().length} fallback={<p class="tn-empty">No projects have deadlines set.</p>}>
                <ul class="tn-risklist">
                  <For each={riskyProjects()}>{({ project, risk }) =>
                    <li onClick={() => requestView("Projects")}>
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

        {/* ── Calendar overview ── embedded compact month + day agenda; clicks open the full Calendar workspace ── */}
        <section class="cal-overview">
          <div class="co-head">
            <div class="co-title"><span class="co-icon">▦</span><div><h2>Calendar</h2><p>Meetings, task due dates, and project deadlines at a glance</p></div></div>
            <button class="tn-link" onClick={() => openCalendarAt(calDay())}>Open calendar →</button>
          </div>
          <div class="co-body">
            <MiniCalendar
              cursor={calCursor()}
              items={calItems() ?? []}
              selected={calDay()}
              onPrev={() => shiftCal(-1)}
              onNext={() => shiftCal(1)}
              onToday={() => { const t = startOfDay(new Date()); setCalCursor(t); setCalDay(dayKeyOf(t)); }}
              onPick={setCalDay}
            />
            <div class="co-agenda">
              <header><h3>{readableDay(calDay())}</h3><span>{calAgenda().length} item{calAgenda().length === 1 ? "" : "s"}</span></header>
              <Show when={calAgenda().length} fallback={<p class="co-empty">Nothing scheduled. <button class="agenda-inline" onClick={() => openCalendarAt(calDay())}>Open calendar →</button></p>}>
                <ul>
                  <For each={calAgenda()}>{event =>
                    <li classList={{ [event.kind]: true, done: event.done }}>
                      <button onClick={() => openCalendarAt(event.date)}>
                        <span class="co-time">{calTime(event)}</span>
                        <strong>{event.title}</strong>
                        <Show when={event.label}><small class="co-label">{event.label}</small></Show>
                        <Show when={event.location}><small>{event.location}</small></Show>
                      </button>
                    </li>}</For>
                </ul>
              </Show>
            </div>
          </div>
        </section>

        {/* ── Secondary surfaces ── non-duplicative feeds only; agenda + open to-dos live solely in "Today & next" above ── */}
        <div class="dashboard-grid">
          <section class="ov-section">
            <header><h2>Assigned issues</h2><span class="ov-count">{data().assigned_issues.length}</span></header>
            <div class="ov-cards">
              <For each={data().assigned_issues}>{issue =>
                <article class="ov-card">
                  <strong class="ov-card-title">#{issue.number} {issue.title}</strong>
                  <div class="ov-tags">
                    <span class="ov-tag project"><span aria-hidden="true">▦</span> {issue.project_id}</span>
                    <Show when={issue.due_date}><span class="ov-tag due"><span aria-hidden="true">◷</span> {issue.due_date}</span></Show>
                  </div>
                </article>}</For>
              <Show when={!data().assigned_issues.length}><p class="ov-empty">No assigned open issues.</p></Show>
            </div>
          </section>

          <section class="ov-section">
            <header><h2>Inbox</h2><span class="ov-count">{data().unread_notifications.length}</span></header>
            <div class="ov-cards">
              <For each={data().unread_notifications}>{notification =>
                <article class="ov-card">
                  <strong class="ov-card-title">{notification.title}</strong>
                  <div class="ov-tags">
                    <span class="ov-tag event">{notification.event_type}</span>
                    <Show when={notification.body}><span class="ov-tag body">{notification.body}</span></Show>
                  </div>
                </article>}</For>
              <Show when={!data().unread_notifications.length}><p class="ov-empty">No unread notifications.</p></Show>
            </div>
          </section>

          <section class="ov-section">
            <header><h2>Absences</h2><span class="ov-count">{data().current_absences.length}</span></header>
            <div class="ov-cards">
              <For each={data().current_absences}>{absence =>
                <article class="ov-card">
                  <strong class="ov-card-title">{absence.profile_id}</strong>
                  <div class="ov-tags">
                    <span class="ov-tag reason">{absence.reason_type}</span>
                    <span class="ov-tag due"><span aria-hidden="true">◷</span> through {absence.date_to}</span>
                  </div>
                </article>}</For>
              <Show when={!data().current_absences.length}><p class="ov-empty">No approved current absences.</p></Show>
            </div>
          </section>
        </div>
      </>
    }</Show>
    <Show when={profileId()}><button class="dashboard-refresh" onClick={() => { refetch(); refetchProjects(); }}>Refresh dashboard</button></Show>
  </section>;
}
