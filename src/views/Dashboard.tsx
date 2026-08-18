import { createResource, For, Show } from "solid-js";
import { personalApi, type MeetingOccurrence } from "../api/personal";
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

export default function Dashboard() {
  const [dashboard, { refetch }] = createResource(profileId, id => id ? personalApi.dashboard(id) : Promise.resolve(undefined));
  return <section class="dashboard-view">
    <header>
      <div><h1>Overview</h1><p>Your work, calendar, notification feed, and organization availability.</p></div>
      <ProfilePicker/>
    </header>
    <Show when={dashboard.loading}><p class="dashboard-muted">Loading dashboard…</p></Show>
    <Show when={!profileId()}><p class="dashboard-empty">No profile selected — add one in Members.</p></Show>
    <Show when={dashboard()}>{data =>
      <>
        {/* prominent agenda hero — leads the Overview and links straight to the full calendar */}
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
    <Show when={profileId()}><button class="dashboard-refresh" onClick={() => refetch()}>Refresh dashboard</button></Show>
  </section>;
}
