import { createEffect, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { personalApi, type Follow } from "../api/personal";
import { platformApi } from "../api/platform";
import { calendarEntries, dateKey } from "../calendar";
import MiniCalendar from "../components/MiniCalendar";
import { ProfilePicker } from "../components/Pickers";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { DASHBOARD_WIDGETS, hiddenWidgets, loadDashboardPrefs, toggleWidget, widgetVisible } from "../dashboardPrefs";
import { navigate } from "../router";
import { humanError, profileId } from "../session";
import "./Dashboard.css";

const UPCOMING_DAYS = 91;
const AGENDA_LIMIT = 5;
const UPCOMING_LIMIT = 8;

const dayStart = (date = new Date()) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const stamp = (date: Date) => Math.floor(date.getTime() / 1000);
const dayLabel = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const timeLabel = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Dashboard() {
  const [cursor, setCursor] = createSignal(dayStart());
  const [selected, setSelected] = createSignal<Date>();
  const [actionError, setActionError] = createSignal("");
  const bounds = () => {
    const from = dayStart();
    const to = new Date(from);
    to.setDate(to.getDate() + UPCOMING_DAYS);
    return [stamp(from), stamp(to), dateKey(from), dateKey(to)] as const;
  };
  createEffect(() => { void loadDashboardPrefs(profileId()); });
const [dashboard, { refetch: refetchDashboard }] = createResource(
    profileId,
    (id) => (id ? personalApi.dashboard(id) : Promise.resolve(undefined)),
  );
  const [follows, { refetch: refetchFollows }] = createResource(profileId, id => id ? personalApi.follows(id) : Promise.resolve([]));
  const [followProfiles] = createResource(platformApi.profiles);
  const [followTeams] = createResource(platformApi.teams);
  const followsSubject = (kind: Follow["subject_type"], id: string) => !!(follows() ?? []).find(f => f.subject_type === kind && f.subject_id === id);
  const toggleFollow = async (subject_type: Follow["subject_type"], subject_id: string) => { const profile_id=profileId(); if (!profile_id) return; const existing=(follows() ?? []).find(f=>f.subject_type===subject_type&&f.subject_id===subject_id); try { if(existing) await personalApi.deleteFollow(existing); else await personalApi.saveFollow({profile_id,subject_type,subject_id}); await refetchFollows(); } catch(error) { setActionError(humanError(error)); } };
  const [calendar, { refetch: refetchCalendar }] = createResource(
    () => [profileId(), ...bounds()] as const,
    ([id, from, to, fromDay, toDay]) =>
      id
        ? personalApi.calendar(id, from, to, fromDay, toDay)
        : Promise.resolve([]),
  );

  const items = () => calendarEntries(calendar() ?? []);
  const future = () => items().filter((item) => item.starts_at >= stamp(dayStart()));
  const selectedItems = () => {
    const day = selected();
    return day ? items().filter((item) => item.day === dateKey(day)) : future();
  };
  const move = (months: number) => {
    const next = new Date(cursor());
    next.setMonth(next.getMonth() + months);
    setCursor(next);
  };
  const complete = async (id: string, done: boolean) => {
    setActionError("");
    try {
      await personalApi.setTodoCompletion(id, done);
      refetchDashboard();
      refetchCalendar();
    } catch (error) {
      setActionError(humanError(error));
    }
  };
  const failure = () => dashboard.error || calendar.error;
  const refresh = () => {
    setActionError("");
    refetchDashboard();
    refetchCalendar();
  };

  return (
    <section class="dashboard-view">
      <WorkspaceHeader icon="home" title="Overview" actions={<ProfilePicker locked />}>
        Your work, calendar, notification feed, and organization availability.
      </WorkspaceHeader>
      <Show when={actionError()}>
        <p class="dashboard-error" role="alert">{actionError()}</p>
      </Show>
      <Show when={!failure() && (dashboard.loading || calendar.loading)}>
        <p class="dashboard-muted" role="status">Loading overview…</p>
      </Show>
      <Show when={failure()}>
        <p class="dashboard-error" role="alert">Overview failed to load: {humanError(failure())}</p>
      </Show>
      <Show when={!profileId()}>
        <p class="dashboard-empty">No profile selected — add one in Members.</p>
      </Show>
      <Show when={!failure() && dashboard()}>
        {(data) => <>
          <details class="dashboard-customize">
            <summary>Customize widgets<Show when={hiddenWidgets().length}><span class="dc-count">{hiddenWidgets().length} hidden</span></Show></summary>
            <div class="dc-options"><For each={DASHBOARD_WIDGETS}>{(widget) =>
              <label class="dc-option">
                <input type="checkbox" checked={widgetVisible(widget.id)} aria-label={`Show ${widget.label}`} onChange={() => toggleWidget(widget.id)} />
                <span>{widget.label}</span>
              </label>
            }</For></div>
          </details>
          <Show when={widgetVisible("today")}>
          <section class="today-next">
            <header class="tn-head">
              <div class="tn-title">
                <span class="tn-icon">◷</span>
                <div><h2>Today & next</h2><p>Work requiring your attention.</p></div>
              </div>
            </header>
            <div class="tn-grid">
              <section class="tn-col tn-tasks">
                <header><h3>Tasks to action <span>{data().open_todos.length}</span></h3><button type="button" class="tn-link" onClick={() => navigate("To-Do")}>Open</button></header>
                <For each={data().open_todos.slice(0, AGENDA_LIMIT)}>{(todo) =>
                  <div class="tn-tasksec"><label>
                    <input class="tn-check-box" type="checkbox" checked={todo.done} aria-label={`Mark ${todo.content} done`} onChange={(event) => void complete(todo.id, event.currentTarget.checked)} />
                    <button class="tn-task-body" onClick={() => navigate("To-Do")}><strong>{todo.content}</strong><small>{todo.due_date ? `Due ${todo.due_date}` : "No due date"}</small></button>
                  </label></div>
                }</For>
                <Show when={!data().open_todos.length}><p class="tn-empty">No open tasks.</p></Show>
              </section>
              <section class="tn-col tn-risk">
                <header><h3>Project deadlines</h3><button type="button" class="tn-link" onClick={() => navigate("Projects")}>Open</button></header>
                <ul class="tn-risklist"><For each={future().filter((item) => item.kind === "deadline").slice(0, AGENDA_LIMIT)}>{(item) =>
                  <li><button type="button" onClick={() => navigate("Projects")}><i class="tn-riskdot high" /><span class="tn-risk-body"><strong>{item.title}</strong><small>{dayLabel(item.starts_at)}</small></span><b class="tn-riskbadge high">Due</b></button></li>
                }</For></ul>
                <Show when={!future().some((item) => item.kind === "deadline")}><p class="tn-empty">No upcoming deadlines.</p></Show>
              </section>
              <section class="tn-col tn-agenda">
                <header><h3>Agenda</h3><button type="button" class="tn-link" onClick={() => navigate("Calendar")}>Open</button></header>
                <ul class="tn-agendalist"><For each={future().filter((item) => item.kind === "meeting").slice(0, AGENDA_LIMIT)}>{(item) =>
                  <li><span class="tn-when"><time>{dayLabel(item.starts_at)}</time><small class="tn-hour">{timeLabel(item.starts_at)}</small></span><span class="tn-meet-body"><strong>{item.title}</strong></span><button type="button" class="tn-meet-btn ghost" onClick={() => navigate("Calendar")}>Open</button></li>
                }</For></ul>
                <Show when={!future().some((item) => item.kind === "meeting")}><p class="tn-empty">No upcoming meetings.</p></Show>
              </section>
            </div>
          </section>
          </Show>

          <Show when={widgetVisible("calendar")}>
          <section class="calendar-overview">
            <header class="co-head"><div class="co-title"><span class="co-icon">□</span><div><h2>Calendar</h2><p>Your rolling schedule.</p></div></div></header>
            <div class="co-body">
              <MiniCalendar cursor={cursor()} items={items()} selected={selected()} onPrev={() => move(-1)} onNext={() => move(1)} onToday={() => { setCursor(dayStart()); setSelected(undefined); }} onPick={setSelected} />
              <aside class="co-agenda">
                <header><h3>{selected() ? dayLabel(stamp(selected()!)) : "Upcoming"}</h3><span>{selected() ? "Selected day" : `${UPCOMING_DAYS} days`}</span></header>
                <ul><For each={selectedItems().slice(0, UPCOMING_LIMIT)}>{(item) =>
                  <li class={item.kind}><button type="button" onClick={() => navigate(item.kind === "deadline" ? "Projects" : item.kind === "task" ? "To-Do" : "Calendar")}><time class="co-time">{dayLabel(item.starts_at)}</time><strong>{item.title}</strong></button></li>
                }</For></ul>
                <Show when={!selectedItems().length}><p class="co-empty">{selected() ? "Nothing scheduled on this day." : "Nothing scheduled in the next 91 days."}</p></Show>
              </aside>
            </div>
          </section>
          </Show>

          <section class="ov-section"><header><h2>Following</h2><span class="ov-count">{follows()?.length ?? 0}</span></header><div class="ov-cards"><p class="ov-empty">Follow people and teams to personalize your overview signals.</p><For each={(followProfiles() ?? []).filter(p => p.id !== profileId() && !p.archived).slice(0, 6)}>{person => <button class="ghost" aria-pressed={followsSubject("profile", person.id)} onClick={() => void toggleFollow("profile", person.id)}>{followsSubject("profile", person.id) ? "Following" : "Follow"} {person.display_name}</button>}</For><For each={(followTeams() ?? []).filter(team => !team.archived).slice(0, 6)}>{team => <button class="ghost" aria-pressed={followsSubject("team", team.id)} onClick={() => void toggleFollow("team", team.id)}>{followsSubject("team", team.id) ? "Following" : "Follow"} {team.name}</button>}</For></div></section>
<div class="dashboard-grid">
            <Show when={widgetVisible("issues")}><DashboardSection title="Assigned issues" count={data().assigned_issues.length} empty="No issues assigned to you yet." target="Issues">
              <For each={data().assigned_issues}>{(issue) => <article class="ov-card"><strong class="ov-card-title">#{issue.number} {issue.title}</strong><Show when={issue.due_date}><span class="ov-tag due">Due {issue.due_date}</span></Show></article>}</For>
            </DashboardSection></Show>
            <Show when={widgetVisible("inbox")}><DashboardSection title="Inbox" count={data().unread_notifications.length} empty="Your inbox is clear." target="Inbox">
              <For each={data().unread_notifications}>{(notice) => <article class="ov-card"><strong class="ov-card-title">{notice.title}</strong><Show when={notice.body}><p>{notice.body}</p></Show></article>}</For>
            </DashboardSection></Show>
            <Show when={widgetVisible("absences")}><DashboardSection title="Absences" count={data().current_absences.length} empty="Nobody is away right now." target="Absences">
              <For each={data().current_absences}>{(absence) => <article class="ov-card"><strong class="ov-card-title">{absence.profile_id}</strong><span class="ov-tag reason">{absence.reason_type}</span></article>}</For>
            </DashboardSection></Show>
          </div>
        </>}
      </Show>
      <Show when={profileId()}><button type="button" class="dashboard-refresh" onClick={refresh}>Refresh dashboard</button></Show>
    </section>
  );
}

function DashboardSection(props: { title: string; count: number; empty: string; target: string; children: JSX.Element }) {
  return <section class="ov-section">
    <header><h2>{props.title}</h2><span class="ov-count">{props.count}</span></header>
    <div class="ov-cards"><Show when={props.count} fallback={<p class="ov-empty">{props.empty}</p>}>{props.children}</Show></div>
    <button class="tn-link ov-open" onClick={() => navigate(props.target)}>Open</button>
  </section>;
}
