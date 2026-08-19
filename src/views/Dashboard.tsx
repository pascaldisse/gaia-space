import { createResource, createSignal, For, Show } from "solid-js";
import { personalApi, type Todo } from "../api/personal";
import { dayKeyOf, monthGrid, normalizeCalendarItem, startOfDay, type CalendarItem } from "../calendar";
import MiniCalendar from "../components/MiniCalendar";
import { Icon } from "../components/Icon";
import { ProfilePicker } from "../components/Pickers";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { navigate } from "../router";
import { profileId } from "../session";
import "./Dashboard.css";

const DAY = 86_400_000;
const todayKey = () => dayKeyOf(startOfDay(new Date()));
const keyDate = (key: string) => new Date(`${key.slice(0, 10)}T00:00:00`);
const daysUntil = (key: string) => Math.round((keyDate(key).getTime() - keyDate(todayKey()).getTime()) / DAY);
const dayLabel = (key: string) => { const days = daysUntil(key); if (days === 0) return "Today"; if (days === 1) return "Tomorrow"; return keyDate(key).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }); };
const timeLabel = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dueLabel = (due: string) => { const days = daysUntil(due); if (days < 0) return `${Math.abs(days)}d overdue`; if (days === 0) return "Due today"; if (days === 1) return "Due tomorrow"; return `Due in ${days}d`; };

type TaskBucket = "overdue" | "today" | "soon";
const bucketFor = (due: string): TaskBucket | null => { const days = daysUntil(due); return days < 0 ? "overdue" : days === 0 ? "today" : days <= 7 ? "soon" : null; };
const taskSections: { key: TaskBucket; label: string }[] = [{ key: "overdue", label: "Overdue" }, { key: "today", label: "Today" }, { key: "soon", label: "Next 7 days" }];
const riskFor = (date: string) => { const days = daysUntil(date); return days < 0 ? "overdue" : days <= 7 ? "high" : days <= 30 ? "medium" : "low"; };
const riskLabel = (risk: string) => ({ overdue: "Overdue", high: "At risk", medium: "Approaching", low: "On track" })[risk] ?? "On track";

export default function Dashboard() {
  const [dashboard, { refetch: refetchDashboard }] = createResource(profileId, id => id ? personalApi.dashboard(id) : Promise.resolve(undefined));
  const [cursor, setCursor] = createSignal(startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = createSignal(todayKey());
  const [calendar, { refetch: refetchCalendar }] = createResource(() => [profileId(), cursor().getTime()] as const, async ([id]) => {
    if (!id) return [] as CalendarItem[];
    const grid = monthGrid(cursor());
    const rangeStart = grid[0].getTime() / 1000;
    const monthEnd = new Date(grid[41].getFullYear(), grid[41].getMonth(), grid[41].getDate() + 1).getTime();
    const rollingEnd = startOfDay(new Date()).getTime() + 91 * DAY;
    const items = await personalApi.calendar(id, rangeStart, Math.max(monthEnd, rollingEnd) / 1000);
    return items.map(normalizeCalendarItem);
  });

  const actionTasks = () => taskSections.map(section => ({ ...section, items: (dashboard()?.open_todos ?? []).filter(todo => todo.due_date && bucketFor(todo.due_date) === section.key).sort((a, b) => a.due_date!.localeCompare(b.due_date!)) })).filter(section => section.items.length);
  const actionTaskCount = () => actionTasks().reduce((sum, section) => sum + section.items.length, 0);
  const deadlines = () => (calendar() ?? []).filter(item => item.kind === "deadline" && item.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date));
  const meetings = () => (calendar() ?? []).filter(item => item.kind === "meeting" && item.starts_at >= Date.now() / 1000).sort((a, b) => a.starts_at - b.starts_at).slice(0, 5);
  const upcoming = () => (calendar() ?? []).filter(item => item.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || a.starts_at - b.starts_at).slice(0, 8);
  const upcomingGroups = () => upcoming().reduce<{ day: string; items: CalendarItem[] }[]>((groups, item) => { const group = groups.find(entry => entry.day === item.date); if (group) group.items.push(item); else groups.push({ day: item.date, items: [item] }); return groups; }, []);
  const shiftMonth = (amount: number) => { const next = new Date(cursor()); next.setMonth(next.getMonth() + amount); setCursor(startOfDay(next)); };
  const complete = async (todo: Todo) => { await personalApi.setTodoCompletion(todo.id, true); refetchDashboard(); refetchCalendar(); };

  return <section class="dashboard-view">
    <WorkspaceHeader icon="home" title="Overview" actions={<ProfilePicker locked/>}>Your work, calendar, notification feed, and organization availability.</WorkspaceHeader>
    <Show when={dashboard.loading || calendar.loading}><p class="dashboard-muted">Loading overview…</p></Show>
    <Show when={!profileId()}><p class="dashboard-empty">No profile selected — add one in Members.</p></Show>
    <Show when={dashboard()}>{data => <>
      <section class="today-next"><div class="tn-head"><div class="tn-title"><span class="tn-icon"><Icon name="target" size={20}/></span><div><h2>Today &amp; next</h2><p>Your actionable items across tasks, project deadlines, and the calendar</p></div></div></div><div class="tn-grid">
        <article class="tn-col tn-tasks"><header><h3>Tasks to action <span>{actionTaskCount()}</span></h3><button class="tn-link" onClick={() => navigate("To-Do")}>Open My tasks →</button></header><Show when={actionTaskCount()} fallback={<p class="tn-empty">Nothing due in the next 7 days. You’re clear.</p>}><For each={actionTasks()}>{section => <div class="tn-tasksec"><span class="tn-seclabel" classList={{ [section.key]: true }}>{section.label} <em>{section.items.length}</em></span><ul><For each={section.items}>{todo => <li><input class="tn-check-box" type="checkbox" aria-label={`Complete ${todo.content}`} onChange={() => complete(todo)}/><button class="tn-task-body" onClick={() => navigate("To-Do")}><strong>{todo.content}</strong><small classList={{ overdue: section.key === "overdue" }}>{dueLabel(todo.due_date!)}</small></button></li>}</For></ul></div>}</For></Show></article>
        <article class="tn-col tn-risk"><header><h3>Project deadlines <span>{deadlines().length}</span></h3><button class="tn-link" onClick={() => navigate("Projects")}>Portfolio →</button></header><Show when={deadlines().length} fallback={<p class="tn-empty">No project deadlines in the calendar range.</p>}><ul class="tn-risklist"><For each={deadlines()}>{deadline => { const risk = riskFor(deadline.date); return <li onClick={() => navigate("Projects")}><span class="tn-riskdot" classList={{ [risk]: true }}/><span class="tn-risk-body"><strong>{deadline.title}</strong><small>{dueLabel(deadline.date)}</small></span><span class="tn-riskbadge" classList={{ [risk]: true }}>{riskLabel(risk)}</span></li>; }}</For></ul></Show></article>
        <article class="tn-col tn-agenda"><header><h3>Agenda <span>{meetings().length}</span></h3><button class="tn-link" onClick={() => navigate("Calendar")}>Open calendar →</button></header><Show when={meetings().length} fallback={<p class="tn-empty">Nothing scheduled next.</p>}><ul class="tn-agendalist"><For each={meetings()}>{meeting => <li><span class="tn-when"><time>{dayLabel(meeting.date)}</time><time class="tn-hour">{timeLabel(meeting.starts_at)}</time></span><span class="tn-meet-body"><strong>{meeting.title}</strong></span><button class="tn-meet-btn ghost" onClick={() => navigate("Calendar")}>Open</button></li>}</For></ul></Show></article>
      </div></section>
      <section class="cal-overview"><div class="co-head"><div class="co-title"><span class="co-icon"><Icon name="calendar" size={20}/></span><div><h2>Calendar</h2><p>Meetings, task due dates, and project deadlines at a glance</p></div></div><button class="tn-link" onClick={() => navigate("Calendar")}>Open calendar →</button></div><div class="co-body"><MiniCalendar cursor={cursor()} items={calendar() ?? []} selected={selectedDay()} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} onToday={() => { const today = startOfDay(new Date()); setCursor(today); setSelectedDay(dayKeyOf(today)); }} onPick={setSelectedDay}/><div class="co-agenda"><header><h3>Upcoming</h3><span>{upcoming().length} item{upcoming().length === 1 ? "" : "s"}</span></header><Show when={upcoming().length} fallback={<p class="co-empty">Nothing upcoming. <button class="agenda-inline" onClick={() => navigate("Calendar")}>Open calendar →</button></p>}><ul><For each={upcomingGroups()}>{group => <><li class="co-daygroup"><span class="co-dayhead">{dayLabel(group.day)}</span></li><For each={group.items}>{item => <li classList={{ [item.kind]: true, done: item.done }}><button onClick={() => navigate("Calendar")}><span class="co-time">{item.allDay ? (item.kind === "deadline" ? "Deadline" : "All day") : timeLabel(item.starts_at)}</span><strong>{item.title}</strong></button></li>}</For></>}</For></ul></Show></div></div></section>
      <div class="dashboard-grid"><section class="ov-section"><header><h2>Assigned issues</h2><span class="ov-count">{data().assigned_issues.length}</span></header><div class="ov-cards"><For each={data().assigned_issues}>{issue => <article class="ov-card"><strong class="ov-card-title">#{issue.number} {issue.title}</strong><div class="ov-tags"><span class="ov-tag project">▦ {issue.project_id}</span><Show when={issue.due_date}><span class="ov-tag due">◷ {issue.due_date}</span></Show></div></article>}</For><Show when={!data().assigned_issues.length}><p class="ov-empty">No assigned open issues.</p></Show></div></section><section class="ov-section"><header><h2>Inbox</h2><span class="ov-count">{data().unread_notifications.length}</span></header><div class="ov-cards"><For each={data().unread_notifications}>{notification => <article class="ov-card"><strong class="ov-card-title">{notification.title}</strong><div class="ov-tags"><span class="ov-tag event">{notification.event_type}</span><Show when={notification.body}><span class="ov-tag body">{notification.body}</span></Show></div></article>}</For><Show when={!data().unread_notifications.length}><p class="ov-empty">No unread notifications.</p></Show></div></section><section class="ov-section"><header><h2>Absences</h2><span class="ov-count">{data().current_absences.length}</span></header><div class="ov-cards"><For each={data().current_absences}>{absence => <article class="ov-card"><strong class="ov-card-title">{absence.profile_id}</strong><div class="ov-tags"><span class="ov-tag reason">{absence.reason_type}</span><span class="ov-tag due">◷ through {absence.date_to}</span></div></article>}</For><Show when={!data().current_absences.length}><p class="ov-empty">No approved current absences.</p></Show></div></section></div>
    </>}</Show>
    <Show when={profileId()}><button class="dashboard-refresh" onClick={() => { refetchDashboard(); refetchCalendar(); }}>Refresh dashboard</button></Show>
  </section>;
}
