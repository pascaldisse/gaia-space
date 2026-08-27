import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import { personalApi, type CalendarItem, type Todo } from "../api/personal";
import { platformApi } from "../api/platform";
import { chatApi, type ChannelSummary, type MentionView } from "../api/chat";
import { profileId } from "../session";
import { linkProps, toSlug, type Route } from "../router";
import { dateKey, itemsOnDay, meetingIdOf, monthCells, startOfLocalDay } from "../calendar";
import "./HomeCalendar.css";

/** Home = one calm calendar. The month is the whole surface; the right column
 *  answers "what about today, what do I owe, who waits on me" — nothing else.
 *  Colour law: teal = action/open, amber = due soon/waiting, red = critical.
 *  No other colour carries meaning here. */

type Tone = "" | "teal" | "amber" | "red";

const LOCALE = "de-DE";
const WEEKDAYS = ["S", "M", "D", "M", "D", "F", "S"] as const;
const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;

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
const dayHeadline = (day: Date) => `${WEEKDAY_NAMES[day.getDay()]}, ${day.getDate()}. ${day.toLocaleDateString(LOCALE, { month: "long" })}`;
const monthTitle = (day: Date) => day.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });

/** Days between two local calendar days — the sign is what the pill reads. */
const daysUntil = (dueKey: string, today: Date) => {
  const [y, m, d] = dueKey.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfLocalDay(today).getTime()) / 86_400_000);
};

/** A todo's state, in the only three colours this app is allowed to mean anything with. */
const todoState = (todo: Todo, today: Date): { label: string; tone: Tone } => {
  if (!todo.due_date) return { label: "Offen", tone: "" };
  const delta = daysUntil(todo.due_date, today);
  if (delta < 0) return { label: "Überfällig", tone: "red" };
  if (delta === 0) return { label: "Offen", tone: "teal" };
  if (delta <= 2) return { label: "Bald fällig", tone: "amber" };
  return { label: "Geplant", tone: "" };
};

const itemState = (item: CalendarItem, today: Date): { label: string; tone: Tone } => {
  if (item.kind === "meeting") return { label: "Meeting", tone: "teal" };
  if (item.kind === "deadline") {
    const key = item.date ?? dateKey(new Date(item.starts_at * 1000));
    return daysUntil(key, today) < 0 ? { label: "Überfällig", tone: "red" } : { label: "Deadline", tone: "amber" };
  }
  if (item.kind === "task") return { label: "Aufgabe", tone: "" };
  return { label: item.kind === "blog" ? "Blog" : "Termin", tone: "" };
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
    return found?.name ? `#${found.name}` : "Direktnachricht";
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
  const todosCritical = createMemo(() => todos().filter(todo => todo.due_date && daysUntil(todo.due_date, today) < 0));
  const meetingsToday = createMemo(() => itemsOnDay(feed(), today).filter(item => item.kind === "meeting"));
  const highlighted = createMemo(() => [...todosCritical(), ...todos().filter(todo => todo.due_date && daysUntil(todo.due_date, today) > 0)].slice(0, 2));

  const shiftMonth = (amount: number) => { const next = new Date(cursor()); next.setDate(1); next.setMonth(next.getMonth() + amount); setCursor(startOfLocalDay(next)); };

  const summaryLine = () => [
    `${dayMeetings().length} ${dayMeetings().length === 1 ? "Meeting" : "Meetings"}`,
    `${dayTodos().length} ${dayTodos().length === 1 ? "Aufgabe" : "Aufgaben"}`,
    `${openMessagesOnDay()} offene ${openMessagesOnDay() === 1 ? "Nachricht" : "Nachrichten"}`,
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
          <h1>Kalender</h1>
          <p class="subtitle">Dein Tag, deine Aufgaben und offene Nachrichten</p>
        </div>
        <div class="header-metrics">
          <span class="metric-pill"><strong>{selectedDay().getDate()}</strong> ausgewählt</span>
          <Show when={!dashboard.loading && !items.error}>
            <span class="metric-pill"><strong>{meetingsToday().length}</strong> {meetingsToday().length === 1 ? "Meeting" : "Meetings"}</span>
          </Show>
          <Show when={!dashboard.loading && !dashboard.error}>
            <span class="metric-pill"><strong>{todosToday().length}</strong> Aufgaben heute</span>
          </Show>
        </div>
      </div>
    </header>

    <Show when={items.error}><p class="planning-error" role="alert">Termine konnten nicht geladen werden: {String(items.error)}</p></Show>
    <Show when={dashboard.error}><p class="planning-error" role="alert">Aufgaben konnten nicht geladen werden: {String(dashboard.error)}</p></Show>
    <Show when={channels.error || mentions.error}><p class="planning-error" role="alert">Offene Nachrichten konnten nicht geladen werden.</p></Show>
    <Show when={!profileId()}><p class="hint">Dein Profil wird noch geladen; der Kalender erscheint, sobald es bereit ist.</p></Show>

    <div class="premium-home">
      <section class="premium-month" aria-label="Monatsübersicht">
        <div class="month-head">
          <div class="month-title">{monthTitle(cursor())}</div>
          <div class="month-arrows">
            <button class="month-arrow" type="button" aria-label="Vorheriger Monat" onClick={() => shiftMonth(-1)}>‹</button>
            <button class="month-arrow" type="button" aria-label="Nächster Monat" onClick={() => shiftMonth(1)}>›</button>
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
        <Show when={items.loading}><p class="hint">Termine werden geladen…</p></Show>
      </section>

      <div class="premium-agenda">
        <section class="agenda-card main" aria-label="Ausgewählter Tag">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">{dayHeadline(selectedDay())}</div>
              <div class="agenda-sub">{summaryLine()}</div>
            </div>
          </div>
          <div class="agenda-section">
            <div class="section-title">Kalender</div>
            <Show when={loading() && !dayItems().length}><p class="hint">Wird geladen…</p></Show>
            <Show when={!loading() && !dayItems().length}><p class="empty-state">Keine Termine an diesem Tag.</p></Show>
            <For each={dayItems()}>{item => {
              const state = itemState(item, today);
              return <Row
                time={item.date && item.ends_at === null ? "Ganztägig" : timeLabel(item.starts_at)}
                title={item.title}
                sub={projectLabel(item.project_id)}
                label={state.label}
                tone={state.tone}
                to={itemRoute(item)}
              />;
            }}</For>
          </div>
          <div class="agenda-section">
            <div class="section-title">Heute fällig</div>
            <Show when={!loading() && !dayTodos().length}><p class="empty-state">Nichts fällig an diesem Tag.</p></Show>
            <For each={dayTodos()}>{todo => {
              const state = todoState(todo, today);
              return <Row time={dateKey(selectedDay()) === dateKey(today) ? "Heute" : ""} title={todo.content} sub={projectLabel(todo.project_id)} label={state.label} tone={state.tone} to={todoRoute(todo)} />;
            }}</For>
          </div>
        </section>

        <section class="agenda-card" aria-label="Meine Aufgaben">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">Meine Aufgaben</div>
              <div class="agenda-sub">Kleine Übersicht, kein zweites Dashboard</div>
            </div>
          </div>
          <div class="compact-stats">
            <div class="compact-stat"><strong>{todos().length}</strong><span>gesamt</span></div>
            <div class="compact-stat"><strong>{todosToday().length}</strong><span>heute</span></div>
            <div class="compact-stat" classList={{ critical: todosCritical().length > 0 }}><strong>{todosCritical().length}</strong><span>kritisch</span></div>
          </div>
          <Show when={dashboard.loading}><p class="hint">Aufgaben werden geladen…</p></Show>
          <Show when={!dashboard.loading && !highlighted().length}><p class="empty-state">Keine offenen Aufgaben mit Datum.</p></Show>
          <For each={highlighted()}>{todo => {
            const state = todoState(todo, today);
            return <Row title={todo.content} sub={projectLabel(todo.project_id)} label={state.label} tone={state.tone} to={todoRoute(todo)} />;
          }}</For>
        </section>

        <section class="agenda-card" aria-label="Offene Nachrichten">
          <div class="agenda-head">
            <div>
              <div class="agenda-title">Offene Nachrichten</div>
              <div class="agenda-sub">Nur Dinge, die Antwort brauchen</div>
            </div>
            <Show when={openMessages() > 0}><span class="tag teal">{openMessages()}</span></Show>
          </div>
          <Show when={mentions.loading || channels.loading}><p class="hint">Nachrichten werden geladen…</p></Show>
          <Show when={!mentions.loading && !channels.loading && !openMessages()}><p class="empty-state">Nichts wartet auf dich.</p></Show>
          <For each={waitingMentions().slice(0, 4)}>{mention =>
            <Row title={mention.text.trim().slice(0, 80) || "Erwähnung"} sub={mention.channel_name ? `#${mention.channel_name}` : channelLabel(mention.channel_id)} label="Antwort" tone="teal" to={{ view: "Chat", entityType: "channel", entityId: mention.channel_id }} />
          }</For>
          <For each={waitingDms().slice(0, 4)}>{channel =>
            <Row title={channel.name ?? "Direktnachricht"} sub={`${channel.unread_count} ungelesen`} label="Wartet" tone="amber" to={{ view: "Chat", entityType: "channel", entityId: channel.id }} />
          }</For>
        </section>
      </div>
    </div>
  </div>;
}
