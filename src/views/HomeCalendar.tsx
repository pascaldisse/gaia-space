import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { personalApi, type CalendarItem, type Todo } from "../api/personal";
import { platformApi } from "../api/platform";
import { chatApi } from "../api/chat";
import { profileId } from "../session";
import { linkProps, toSlug, type Route } from "../router";
import { dateKey, itemsOnDay, meetingIdOf, monthCells, startOfLocalDay } from "../calendar";
import { type Tone, urgencyLabel, urgencyOf, urgencyTone } from "../statusTone";
import { attentionCount, attentionLoading, needsYou } from "../attention";
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

/** One row for two kinds of thing. A calendar item leads with its TIME; a task has
 *  none, and a 58px column reserved for a time that will never come is why a task
 *  title started in the middle of the card. The column exists only when it is
 *  filled — same row, one lane fewer. */
function Row(props: { time?: string; title: string; sub?: string; label: string; tone?: Tone; to: Route }): JSX.Element {
  return <a class="clean-row" classList={{ timeless: !props.time }} {...linkProps(props.to)}>
    <Show when={props.time}>{time => <div class="clean-time">{time()}</div>}</Show>
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
    // `options` can REFUSE, and reading a failed resource re-throws into whatever
    // computation touches it — which kills that computation and freezes whatever it
    // had already rendered. That is why "Loading dates…" stood forever while the day
    // card underneath it showed real counts: the loading line's owner was dead, not
    // the data. A preference that could not be read is not a reason to stop drawing
    // a calendar, so it degrades to the default (show everything).
    const prefs = options.error ? undefined : options();
    return prefs?.show_todos === false ? all.filter(item => item.kind !== "task") : all;
  };
  const todos = (): Todo[] => (dashboard.error ? [] : dashboard()?.open_todos ?? []);
  const loading = () => items.loading || dashboard.loading;

  const projectLabel = (id: string | null) => {
    const found = projects()?.find(project => project.id === id);
    return found ? `#${toSlug(found.name)}` : undefined;
  };
  // The two chat resources stay for ONE reason: they are how this page still
  // knows chat is unreachable. The worklist itself comes from attention.ts,
  // which degrades a dead source to empty rather than to a lie.

  const cells = createMemo(() => monthCells(cursor()));
  const dayHasSomething = (day: Date) => itemsOnDay(feed(), day).length > 0 || todos().some(todo => todo.due_date === dateKey(day));

  const dayItems = createMemo(() => itemsOnDay(feed(), selectedDay()).slice().sort((a, b) => a.starts_at - b.starts_at));
  const dayMeetings = createMemo(() => dayItems().filter(item => item.kind === "meeting"));
  const dayTodos = createMemo(() => todos().filter(todo => todo.due_date === dateKey(selectedDay())));

  // THE ONE DEFINITION, READ NOT REBUILT (stage 12). This card used to count
  // unread mentions + unread DMs, while the rail badge summed unread over ALL
  // channels: two rules, one product, and a badge that said 2 while this card
  // said nothing. Both now read `src/attention.ts`, so they cannot disagree —
  // and no rule of Home's own may ever come back here.
  const waiting = createMemo(() => needsYou());
  const openMessages = attentionCount;
  // Day-scoped version of the same worklist, so the day summary stays about that day.
  const openMessagesOnDay = createMemo(() => {
    const key = dateKey(selectedDay());
    return waiting().filter(item => item.at > 0 && dateKey(new Date(item.at * 1000)) === key).length;
  });

  const todosToday = createMemo(() => todos().filter(todo => todo.due_date === dateKey(today)));
  const meetingsToday = createMemo(() => itemsOnDay(feed(), today).filter(item => item.kind === "meeting"));
  /** Open work, nearest deadline first; undated last. A glance shows the two that
   *  are closest and counts the rest — "+5 more" is information, five more rows are
   *  a second task list. */
  const openTodos = createMemo(() => todos().filter(todo => !todo.done));
  const soonest = createMemo(() =>
    [...openTodos()].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).slice(0, 2));
  const restCount = createMemo(() => Math.max(0, openTodos().length - soonest().length));

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
    <Show when={channels.error || mentions.error}><p class="planning-error" role="alert">Some of what needs you could not be loaded.</p></Show>
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

        {/* A CARD LIKE THE DAY CARD, not a scoreboard. "1 total / 0 today /
            0 critical" is three numbers to say "you have one task" — and next to a
            list that shows the task itself, the numbers add nothing. So the card
            shows the WORK, the heading is the way through to it, and the tile grid
            is gone. (The subline here used to read "A small overview, not a second
            dashboard" — an internal design note that had leaked into the product.) */}
      </div>

      {/* THE WORK SITS UNDER THE CALENDAR, not beside it. Stacked in the right rail
          these two cards ran longer than the month they were meant to accompany, and
          two task-shaped boxes in one column read as the same thing twice. Below, in
          their own row, each gets the width to show a row of work and the space to
          say what it is. */}
      <div class="home-work">
        <section class="agenda-card" aria-label="My tasks">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">My tasks</div>
              <div class="agenda-sub">All your open work, in one place</div>
            </div>
            <a class="home-head-link" {...linkProps({ view: "To-Do" })}>Open →</a>
          </div>
          <Show when={dashboard.loading}><p class="hint">Loading tasks…</p></Show>
          <Show when={!dashboard.loading && !openTodos().length}><p class="empty-state">Nothing open right now.</p></Show>
          {/* The nearest deadlines first, and only a couple of them: this is a glance,
              and a glance that scrolls is a list. The rest is a number, not a queue. */}
          <For each={soonest()}>{todo => {
            const state = todoState(todo, today);
            return <Row title={todo.content} sub={projectLabel(todo.project_id)} label={state.label} tone={state.tone} to={todoRoute(todo)} />;
          }}</For>
          <Show when={restCount() > 0}>
            <a class="home-more" {...linkProps({ view: "To-Do" })}>+{restCount()} more</a>
          </Show>
        </section>

        {/* RENAMED, because "Open messages" stopped being honest: this now
            covers mentions, DMs, entity channels, assigned work and review
            requests — everything the badge counts. Home stays a GLANCE: the
            first few rows and a link out, never the Activity view. */}
        <section class="agenda-card" aria-label="Needs you">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">Needs you</div>
              <div class="agenda-sub">Mentions, replies and work other people put on you</div>
            </div>
            <Show when={openMessages() > 0}><span class="tag teal">{openMessages()}</span></Show>
          </div>
          <Show when={attentionLoading() && !waiting().length}><p class="hint">Loading…</p></Show>
          <Show when={!attentionLoading() && !openMessages()}><p class="empty-state">Nothing is waiting for you.</p></Show>
          <For each={waiting().slice(0, 5)}>{item =>
            <Row title={item.title} sub={item.detail} label={item.action} tone={item.tone} to={item.route} />
          }</For>
          <Show when={waiting().length > 5}>
            <a class="home-more" {...linkProps({ view: "Inbox" })}>All {openMessages()} in the Inbox</a>
          </Show>
        </section>
      </div>
    </div>
  </div>;
}