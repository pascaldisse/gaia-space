import { createMemo, createResource, For, Show } from "solid-js";
import { api } from "../api";
import { planningApi, type Issue, type Status } from "../api/issues";
import { projectId, projects, profiles, reloadProfiles } from "../session";
import { requestView } from "../nav";
import "./Steering.css";

// Steering — the default project cockpit. Surfaces what needs a decision right
// now (overdue / due-soon / unassigned) alongside current work and the next
// meetings. Everything is derived from existing data (issues, statuses,
// meetings, channels); no new backend surface.
const DAY = 86_400;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Steering() {
  const project = createMemo(() => projects()?.find((p) => p.id === projectId()));
  void reloadProfiles();

  const [data] = createResource(projectId, async (pid) => {
    if (!pid) return undefined;
    const [issues, statuses, meetings, channels] = await Promise.all([
      planningApi.issues({ project_id: pid }), planningApi.statuses(pid),
      api.listMeetings(), api.listChannels(),
    ]);
    const resolved = new Set(statuses.filter((s) => s.resolved).map((s) => s.id));
    const active = issues.filter((i) => !i.archived && !resolved.has(i.status_id ?? ""));
    const today = todayStr();
    const soonCutoff = new Date(Date.now() + 7 * DAY * 1000).toISOString().slice(0, 10);
    const now = Date.now() / 1000;
    const channelIds = new Set(channels.filter((c) => c.project_id === pid).map((c) => c.id));

    const overdue = active.filter((i) => i.due_date && i.due_date < today).sort(byDue);
    const soon = active.filter((i) => i.due_date && i.due_date >= today && i.due_date <= soonCutoff).sort(byDue);
    const unassigned = active.filter((i) => !i.assignee_id).sort((a, b) => b.number - a.number);
    const currentWork = active.filter((i) => i.assignee_id).sort(byDue);
    const meetingsNext = meetings
      .filter((m) => !m.archived && m.channel_id && channelIds.has(m.channel_id) && m.ends_at >= now)
      .sort((a, b) => a.starts_at - b.starts_at)
      .slice(0, 5);

    return { statuses, overdue, soon, unassigned, currentWork, meetingsNext, activeCount: active.length };
  });

  const statusOf = (i: Issue, statuses: Status[]) => statuses.find((s) => s.id === i.status_id);
  const nameFor = (id: string | null) => profiles()?.find((p) => p.id === id)?.display_name || (id ? "—" : "Unassigned");

  const issueRow = (i: Issue, statuses: Status[], badge?: "overdue" | "soon" | "unassigned") =>
    <li onClick={() => requestView("Issues")}>
      <span class="st-num">#{i.number}</span>
      <strong>{i.title}</strong>
      <span class="st-status" style={{ background: statusOf(i, statuses)?.color ?? "#3d4a68" }}/>
      <span class="st-assignee">{nameFor(i.assignee_id)}</span>
      <Show when={i.due_date}><time classList={{ late: badge === "overdue" }}>{i.due_date}</time></Show>
    </li>;

  const actionCard = (title: string, list: Issue[], tone: "overdue" | "soon" | "unassigned", statuses: Status[]) =>
    <section class="st-action" classList={{ [tone]: true, empty: !list.length }}>
      <header><span class="st-dot"/><h3>{title}</h3><b>{list.length}</b></header>
      <Show when={list.length} fallback={<p class="st-clear">All clear</p>}>
        <ul class="st-list">
          <For each={list.slice(0, 6)}>{(i) => issueRow(i, statuses, tone)}</For>
        </ul>
        <Show when={list.length > 6}>
          <button class="st-more" onClick={() => requestView("Issues")}>+{list.length - 6} more →</button>
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
      <Show when={data()}>{d =>
        <>
          <div class="st-band">
            <span class="st-band-label">Action needed</span>
            <div class="st-actions">
              {actionCard("Overdue", d().overdue, "overdue", d().statuses)}
              {actionCard("Due soon", d().soon, "soon", d().statuses)}
              {actionCard("Unassigned", d().unassigned, "unassigned", d().statuses)}
            </div>
          </div>

          <div class="st-grid">
            <section class="st-card">
              <div class="st-card-head"><h2>Current work <small>{d().currentWork.length} active</small></h2><button class="st-link" onClick={() => requestView("Issues")}>Open Work →</button></div>
              <Show when={d().currentWork.length} fallback={<p class="st-muted">Nothing in flight — everything is unassigned or done.</p>}>
                <ul class="st-list">
                  <For each={d().currentWork.slice(0, 8)}>{(i) => issueRow(i, d().statuses)}</For>
                </ul>
              </Show>
            </section>

            <section class="st-card st-agenda">
              <div class="st-card-head"><h2>Upcoming agenda <small>{d().meetingsNext.length} scheduled</small></h2><button class="st-link st-cal" onClick={() => requestView("Calendar")}>Open calendar →</button></div>
              <Show when={d().meetingsNext.length} fallback={<p class="st-muted">Nothing scheduled — <button class="st-inline" onClick={() => requestView("Calendar")}>open the calendar →</button></p>}>
                <ul class="st-list agenda">
                  <For each={d().meetingsNext}>{(m) =>
                    <li onClick={() => requestView("Calendar")}><time>{new Date(m.starts_at * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {new Date(m.starts_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><strong>{m.title}</strong><Show when={m.location}><small>{m.location}</small></Show></li>}</For>
                </ul>
              </Show>
            </section>
          </div>
        </>
      }</Show>
    </Show>
  </section>;
}

const byDue = (a: Issue, b: Issue) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
