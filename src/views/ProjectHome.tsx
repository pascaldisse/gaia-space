import { createMemo, createResource, For, Show } from "solid-js";
import { api } from "../api";
import { projectId, projects, reloadProjects } from "../session";
import { ProjectPicker } from "../components/Pickers";
import { requestView } from "../nav";
import "./ProjectHome.css";

// Project Home — a human overview of one project built entirely from data that
// already exists (issues, boards, channels, docs, meetings, packages). No new
// backend surface; everything is filtered client-side by the active project.
export default function ProjectHome() {
  const project = createMemo(() => projects()?.find((p) => p.id === projectId()));
  void reloadProjects();

  const [data] = createResource(projectId, async (pid) => {
    if (!pid) return undefined;
    const [issues, boards, channels, documents, meetings, packages] = await Promise.all([
      api.listIssues(), api.listBoards(), api.listChannels(),
      api.listDocuments(), api.listMeetings(), api.listPackageRepositories(),
    ]);
    const channelIds = new Set(channels.filter((c) => c.project_id === pid).map((c) => c.id));
    const now = Date.now() / 1000;
    return {
      issues: issues.filter((i) => i.project_id === pid && !i.archived),
      boards: boards.filter((b) => b.project_id === pid && !b.archived),
      channels: channels.filter((c) => c.project_id === pid && !c.archived),
      documents: documents.filter((d) => d.container_type === "project" && d.container_id === pid && !d.archived),
      meetings: meetings
        .filter((m) => !m.archived && m.channel_id && channelIds.has(m.channel_id) && m.ends_at >= now)
        .sort((a, b) => a.starts_at - b.starts_at),
      packages: packages.filter((pk) => pk.project_id === pid && !pk.archived),
    };
  });

  // Optional project deadline, shown as a banner tinted by urgency.
  const deadline = createMemo(() => {
    const d = project()?.deadline;
    if (!d) return undefined;
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const days = Math.round((new Date(d + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86_400_000);
    const tone: "overdue" | "soon" | "ok" = d < today ? "overdue" : d <= soon ? "soon" : "ok";
    const note = days === 0 ? "due today" : days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : `in ${days} day${days === 1 ? "" : "s"}`;
    return { date: d, tone, note };
  });

  const stat = (label: string, value: number, view: string) =>
    <button class="ph-stat" onClick={() => requestView(view)}>
      <span class="ph-stat-num">{value}</span><span class="ph-stat-label">{label}</span>
    </button>;

  return <section class="ph-view">
    <header class="ph-head">
      <div class="ph-title">
        <div class="ph-mark">{(project()?.key ?? "··").slice(0, 2).toUpperCase()}</div>
        <div>
          <h1>{project()?.name ?? "Project Home"}</h1>
          <p>{project()?.description || "Your project at a glance — work, discussions, docs, and schedule in one place."}</p>
        </div>
      </div>
      <ProjectPicker/>
    </header>

    <Show when={!projectId()}><p class="ph-empty">No project selected — pick one above, or create one from Projects.</p></Show>

    <Show when={projectId()}>
      <Show when={data.loading}><p class="ph-muted">Loading project overview…</p></Show>
      <Show when={deadline()}>{info =>
        <button class="ph-deadline" classList={{ [info().tone]: true }} onClick={() => requestView("ProjectCalendar")}>
          <span class="ph-deadline-dot"/><span class="ph-deadline-label">Project deadline</span><time>{info().date}</time><em>{info().note}</em>
        </button>}
      </Show>

      <Show when={data()}>{d =>
        <>
          <div class="ph-stats">
            {stat("Open issues", d().issues.length, "Issues")}
            {stat("Boards", d().boards.length, "Boards")}
            {stat("Channels", d().channels.length, "Chat")}
            {stat("Documents", d().documents.length, "Docs")}
            {stat("Packages", d().packages.length, "Packages")}
          </div>

          <div class="ph-grid">
            <section class="ph-card">
              <div class="ph-card-head"><h2>Recent issues</h2><button class="ph-link" onClick={() => requestView("Issues")}>Open Tasks &amp; Boards →</button></div>
              <Show when={d().issues.length} fallback={<p class="ph-muted">No issues yet.</p>}>
                <ul class="ph-list">
                  <For each={d().issues.slice().sort((a, b) => b.number - a.number).slice(0, 6)}>{i =>
                    <li onClick={() => requestView("Issues")}><span class="ph-num">#{i.number}</span><strong>{i.title}</strong><Show when={i.due_date}><time>{i.due_date}</time></Show></li>}</For>
                </ul>
              </Show>
            </section>

            <section class="ph-card">
              <div class="ph-card-head"><h2>Upcoming meetings</h2><button class="ph-link" onClick={() => requestView("ProjectCalendar")}>Open Calendar →</button></div>
              <Show when={d().meetings.length} fallback={<p class="ph-muted">Nothing scheduled.</p>}>
                <ul class="ph-list">
                  <For each={d().meetings.slice(0, 5)}>{m =>
                    <li onClick={() => requestView("ProjectCalendar")}><strong>{m.title}</strong><small>{new Date(m.starts_at * 1000).toLocaleString()}{m.location ? ` · ${m.location}` : ""}</small></li>}</For>
                </ul>
              </Show>
            </section>

            <section class="ph-card">
              <div class="ph-card-head"><h2>Docs</h2><button class="ph-link" onClick={() => requestView("Docs")}>Open Docs →</button></div>
              <Show when={d().documents.length} fallback={<p class="ph-muted">No project docs yet.</p>}>
                <ul class="ph-list">
                  <For each={d().documents.slice(0, 6)}>{doc =>
                    <li onClick={() => requestView("Docs")}><strong>{doc.title}</strong><small>{doc.doc_type} · v{doc.version}</small></li>}</For>
                </ul>
              </Show>
            </section>

            <section class="ph-card">
              <div class="ph-card-head"><h2>Channels</h2><button class="ph-link" onClick={() => requestView("Chat")}>Open Chat →</button></div>
              <Show when={d().channels.length} fallback={<p class="ph-muted">No channels yet.</p>}>
                <ul class="ph-list">
                  <For each={d().channels.slice(0, 6)}>{c =>
                    <li onClick={() => requestView("Chat")}><strong>{c.name || "Untitled channel"}</strong><small>{c.content_type}</small></li>}</For>
                </ul>
              </Show>
            </section>
          </div>
        </>
      }</Show>
    </Show>
  </section>;
}
