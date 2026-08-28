import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { personalApi, type CalendarItem, type Todo } from "../api/personal";
import { platformApi } from "../api/platform";
import { chatApi, type ChannelSummary, type MentionView } from "../api/chat";
import { profileId } from "../session";
import { linkProps, toSlug, type Route } from "../router";
import { dateKey, itemsOnDay, meetingIdOf, monthCells, startOfLocalDay } from "../calendar";
import { type Tone, urgencyLabel, urgencyOf, urgencyTone } from "../statusTone";
import { MetricGrid, MetricTile } from "../components/blocks";
import "./HomeCalendar.css";

/** Home = one calm calendar. The month is the whole surface; the right column
 *  answers "what about today, what do I owe, who waits on me" — nothing else.
 *  Colour law: teal = action/open, amber = due soon/waiting, red = critical.
 *  No other colour carries meaning here. */

const LOCALE = "en-US";
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The visible month window, taken from the same 42 cells the grid renders, so the
 *  fetched range and the drawn range can never disagree. */
const monthWindow = (cursor: Date) => {
  const cells = monthCells(cursor);
  const start = cells[0];
  const end = new Date(cells[cells.length - 1]);
  end.setDate(end.getDate() + 1);
  return [start, end] as const;
};

const timeLabel = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
const dayHeadline = (day: Date) => `${WEEKDAY_NAMES[day.getDay()]}, ${day.toLocaleDateString(LOCALE, { month: "long" })} ${day.getDate()}`;
const monthTitle = (day: Date) => day.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });

/** This surface thinks in `Date` objects; the shared urgency rules think in
 *  `YYYY-MM-DD`. One conversion, here, rather than a second copy of the day maths. */
const todayKey = (today: Date) => dateKey(startOfLocalDay(today));

/** A todo's state. The pill states urgency and nothing else, so its words and its
 *  colour always agree — see `src/statusTone.ts` for the law. */
const todoState = (todo: Todo, today: Date): { label: string; tone: Tone } => {
  if (!todo.due_date) return { label: "Open", tone: "" };
  const urgency = urgencyOf(todo.due_date, todayKey(today), 2);
  if (urgency === "later") return { label: "Planned", tone: "" };
  return { label: urgencyLabel(urgency), tone: urgencyTone(urgency) };
};

const itemState = (item: CalendarItem, today: Date): { label: string; tone: Tone } => {
  if (item.kind === "meeting") return { label: "Meeting", tone: "teal" };
  if (item.kind === "deadline") {
    const key = item.date ?? dateKey(new Date(item.starts_at * 1000));
    // Amber means "due soon", so a deadline months out must not wear it: only a near
    // one is amber, a passed one is red, a distant one is quiet.
    const urgency = urgencyOf(key, todayKey(today), 2);
    return urgency === "overdue"
      ? { label: "Overdue", tone: urgencyTone(urgency) }
      : { label: "Deadline", tone: urgencyTone(urgency) };
  }
  if (item.kind === "task") return { label: "Task", tone: "" };
  return { label: item.kind === "blog" ? "Blog" : "Date", tone: "" };
};

function Row(props: { time?: string; title: string; sub?: string; label: string; tone?: Tone; to: Route }): JSX.Element {
  return <a class="clean-row" {...linkProps(props.to)}>
    <div class="clean-time">{props.time ?? ""}</div>
    <div class="clean-body">
      <div class="clean-title">{props.title}</div>
      <Show when={props.sub}><div class="clean-sub">{props.sub}</div></Show>
    </div>
    <span class="tag" classList={{ teal: props.tone === "teal", amber: props.tone === "amber", red: props.tone === "red" }}>{props.label}</span>
  </a>;
}

export default function HomeCalendar() {
  const today = startOfLocalDay(new Date());
  const [cursor, setCursor] = createSignal(startOfLocalDay(new Date()));
  const [selectedDay, setSelectedDay] = createSignal(startOfLocalDay(new Date()));

  const [organization] = createResource(() => platformApi.organization());
  const [projects] = createResource(() => platformApi.projects());
  const [dashboard] = createResource(() => profileId(), (owner: string) => personalApi.dashboard(owner));
  const [options] = createResource(() => profileId(), (owner: string) => personalApi.calendarOptions(owner));
  const [channels] = createResource(() => profileId(), (owner: string) => chatApi.listChannelsWithMeta(owner));
  const [mentions] = createResource(() => profileId(), (owner: string) => chatApi.listMentionsForProfile(owner, true));
  // Local day keys travel with the instants: a date-only task lands on the day it
  // was written as, never on the UTC day (same contract as views/Calendar.tsx).
  const [items] = createResource(
    () => { const [start, end] = monthWindow(cursor()); return [profileId(), Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000), dateKey(start), dateKey(end)] as const; },
    ([owner, from, to, fromKey, toKey]) => owner ? personalApi.calendar(owner, from, to, fromKey, toKey) : Promise.resolve([] as CalendarItem[]),
  );

  // Reading a failed resource inside render re-throws; the alert is the answer, and
  // the grid simply stays quiet.
  const feed = (): CalendarItem[] => {
    if (items.error) return [];
    const all = items() ?? [];
    return options()?.show_todos === false ? all.filter(item => item.kind !== "task") : all;
  };
  const todos = (): Todo[] => (dashboard.error ? [] : dashboard()?.open_todos ?? []);
  const loading = () => items.loading || dashboard.loading;

  const projectLabel = (id: string | null) => {
    const found = projects()?.find(project => project.id === id);
    return found ? `#${toSlug(found.name)}` : undefined;
  };
  const channelLabel = (id: string) => {
    const found = channels()?.find(channel => channel.id === id);
    return found?.name ? `#${found.name}` : "Direct message";
  };

  const cells = createMemo(() => monthCells(cursor()));
  const dayHasSomething = (day: Date) => itemsOnDay(feed(), day).length > 0 || todos().some(todo => todo.due_date === dateKey(day));

  const dayItems = createMemo(() => itemsOnDay(feed(), selectedDay()).slice().sort((a, b) => a.starts_at - b.starts_at));
  const dayMeetings = createMemo(() => dayItems().filter(item => item.kind === "meeting"));
  const dayTodos = createMemo(() => todos().filter(todo => todo.due_date === dateKey(selectedDay())));

  // "Needs an answer" is not "unread": a mention names you, an unread DM is a person
  // waiting. A busy public channel is neither, and is deliberately not listed.
  const waitingMentions = createMemo<MentionView[]>(() => (mentions.error ? [] : mentions() ?? []).filter(mention => !mention.read));
  const waitingDms = createMemo<ChannelSummary[]>(() => (channels.error ? [] : channels() ?? []).filter(channel => channel.content_type === "dm" && channel.unread_count > 0 && !channel.archived));
  const openMessages = createMemo(() => waitingMentions().length + waitingDms().length);
  // Day-scoped version of the same inbox, so the day summary stays about that day.
  const openMessagesOnDay = createMemo(() => {
    const key = dateKey(selectedDay());
    return waitingMentions().filter(mention => dateKey(new Date(mention.created_at * 1000)) === key).length
      + waitingDms().filter(channel => channel.last_message_at !== null && dateKey(new Date(channel.last_message_at * 1000)) === key).length;
  });

  const todosToday = createMemo(() => todos().filter(todo => todo.due_date === dateKey(today)));
  const todosCritical = createMemo(() => todos().filter(todo => urgencyOf(todo.due_date, todayKey(today)) === "overdue"));
  const meetingsToday = createMemo(() => itemsOnDay(feed(), today).filter(item => item.kind === "meeting"));
  const highlighted = createMemo(() => [...todosCritical(), ...todos().filter(todo => ["soon", "later"].includes(urgencyOf(todo.due_date, todayKey(today))))].slice(0, 2));

  const shiftMonth = (amount: number) => { const next = new Date(cursor()); next.setDate(1); next.setMonth(next.getMonth() + amount); setCursor(startOfLocalDay(next)); };

  const summaryLine = () => [
    `${dayMeetings().length} ${dayMeetings().length === 1 ? "Meeting" : "Meetings"}`,
    `${dayTodos().length} ${dayTodos().length === 1 ? "task" : "tasks"}`,
    `${openMessagesOnDay()} open ${openMessagesOnDay() === 1 ? "message" : "messages"}`,
  ].join(" · ");

  const itemRoute = (item: CalendarItem): Route => {
    if (item.kind === "meeting") return { view: "Calendar", entityType: "meeting", entityId: meetingIdOf(item) };
    if (item.kind === "deadline" && item.project_id) return { view: "Projects", entityType: "project", entityId: item.project_id };
    if (item.kind === "blog") return { view: "Blogs", entityType: "blog", entityId: item.source_id };
    return { view: "To-Do" };
  };
  const todoRoute = (todo: Todo): Route => (todo.project_id ? { view: "Project Tasks", projectId: todo.project_id } : { view: "To-Do" });

  return <div class="home-cal">
    <header class="home-cal-header">
      <div class="title-row">
        <div>
          <div class="kicker">{organization()?.name ?? "\u00a0"}</div>
          <h1>Calendar</h1>
          <p class="subtitle">Your day, your tasks and open messages</p>
        </div>
        <div class="header-metrics">
          <span class="metric-pill"><strong>{selectedDay().getDate()}</strong> selected</span>
          <Show when={!dashboard.loading && !items.error}>
            <span class="metric-pill"><strong>{meetingsToday().length}</strong> {meetingsToday().length === 1 ? "Meeting" : "Meetings"}</span>
          </Show>
          <Show when={!dashboard.loading && !dashboard.error}>
            <span class="metric-pill"><strong>{todosToday().length}</strong> tasks today</span>
          </Show>
        </div>
      </div>
    </header>

    <Show when={items.error}><p class="planning-error" role="alert">Dates could not be loaded: {String(items.error)}</p></Show>
    <Show when={dashboard.error}><p class="planning-error" role="alert">Tasks could not be loaded: {String(dashboard.error)}</p></Show>
    <Show when={channels.error || mentions.error}><p class="planning-error" role="alert">Open messages could not be loaded.</p></Show>
    <Show when={!profileId()}><p class="hint">Your profile is still loading; the calendar appears as soon as it is ready.</p></Show>

    <div class="premium-home">
      <section class="premium-month" aria-label="Month overview">
        <div class="month-head">
          <div class="month-title">{monthTitle(cursor())}</div>
          <div class="month-arrows">
            <button class="month-arrow" type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
            <button class="month-arrow" type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
          </div>
        </div>
        <div class="month-grid">
          <For each={WEEKDAYS}>{(letter, index) => <div class="weekday" aria-label={WEEKDAY_NAMES[index()]}>{letter}</div>}</For>
          <For each={cells()}>{day => {
            const outside = () => day.getMonth() !== cursor().getMonth();
            const isToday = () => dateKey(day) === dateKey(today);
            const isSelected = () => dateKey(day) === dateKey(selectedDay());
            return <button
              type="button"
              class="day"
              classList={{ outside: outside(), today: isToday(), selected: isSelected(), "has-event": dayHasSomething(day) }}
              aria-pressed={isSelected()}
              aria-label={dayHeadline(day)}
              onClick={() => setSelectedDay(startOfLocalDay(day))}
            >{day.getDate()}</button>;
          }}</For>
        </div>
        <Show when={items.loading}><p class="hint">Loading dates…</p></Show>
      </section>

      <div class="premium-agenda">
        <section class="agenda-card main" aria-label="Selected day">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">{dayHeadline(selectedDay())}</div>
              <div class="agenda-sub">{summaryLine()}</div>
            </div>
          </div>
          <div class="agenda-section">
            <div class="section-title">Calendar</div>
            <Show when={loading() && !dayItems().length}><p class="hint">Loading…</p></Show>
            <Show when={!loading() && !dayItems().length}><p class="empty-state">Nothing scheduled on this day.</p></Show>
            <For each={dayItems()}>{item => {
              const state = itemState(item, today);
              return <Row
                time={item.date && item.ends_at === null ? "All day" : timeLabel(item.starts_at)}
                title={item.title}
                sub={projectLabel(item.project_id)}
                label={state.label}
                tone={state.tone}
                to={itemRoute(item)}
              />;
            }}</For>
          </div>
          <div class="agenda-section">
            <div class="section-title">Due today</div>
            <Show when={!loading() && !dayTodos().length}><p class="empty-state">Nothing due on this day.</p></Show>
            <For each={dayTodos()}>{todo => {
              const state = todoState(todo, today);
              return <Row time={dateKey(selectedDay()) === dateKey(today) ? "Today" : ""} title={todo.content} sub={projectLabel(todo.project_id)} label={state.label} tone={state.tone} to={todoRoute(todo)} />;
            }}</For>
          </div>
        </section>

        <section class="agenda-card" aria-label="My tasks">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">My tasks</div>
              <div class="agenda-sub">A small overview, not a second dashboard</div>
            </div>
          </div>
          {/* THE REFERENCE TILE, NOW SHARED (stage 11, defect 2). This block was
              `.compact-stat`, the calmest tile in the app and therefore the one
              every other view should have been using. It is the shared
              MetricTile now — same hairline, same figure, same muted label — so
              Projects, Time off and the rails cannot drift from it again.
              `critical` was already zero-aware by hand; `tone="red"` says the
              same thing through the one rule (metricTone) that owns it. */}
          <MetricGrid label="My tasks at a glance" class="compact-stats">
            <MetricTile value={todos().length} label="total" />
            <MetricTile value={todosToday().length} label="today" />
            <MetricTile value={todosCritical().length} label="critical" tone="red" />
          </MetricGrid>
          <Show when={dashboard.loading}><p class="hint">Loading tasks…</p></Show>
          <Show when={!dashboard.loading && !highlighted().length}><p class="empty-state">No open tasks with a date.</p></Show>
          <For each={highlighted()}>{todo => {
            const state = todoState(todo, today);
            return <Row title={todo.content} sub={projectLabel(todo.project_id)} label={state.label} tone={state.tone} to={todoRoute(todo)} />;
          }}</For>
        </section>

        <section class="agenda-card" aria-label="Open messages">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">Open messages</div>
              <div class="agenda-sub">Only things that need an answer</div>
            </div>
            <Show when={openMessages() > 0}><span class="tag teal">{openMessages()}</span></Show>
          </div>
          <Show when={mentions.loading || channels.loading}><p class="hint">Loading messages…</p></Show>
          <Show when={!mentions.loading && !channels.loading && !openMessages()}><p class="empty-state">Nothing is waiting for you.</p></Show>
          <For each={waitingMentions().slice(0, 4)}>{mention =>
            <Row title={mention.text.trim().slice(0, 80) || "Mention"} sub={mention.channel_name ? `#${mention.channel_name}` : channelLabel(mention.channel_id)} label="Reply" tone="teal" to={{ view: "Chat", entityType: "channel", entityId: mention.channel_id }} />
          }</For>
          <For each={waitingDms().slice(0, 4)}>{channel =>
            <Row title={channel.name ?? "Direct message"} sub={`${channel.unread_count} unread`} label="Waiting" tone="amber" to={{ view: "Chat", entityType: "channel", entityId: channel.id }} />
          }</For>
        </section>
      </div>
    </div>
  </div>;
}
