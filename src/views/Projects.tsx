import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import { MetricGrid, MetricTile } from "../components/blocks";
import EmptyState from "../components/EmptyState";
import { GhostPill } from "../components/controls";
import { platformApi, type Project } from "../api/platform";
import { planningApi } from "../api/issues";
import { personalApi } from "../api/personal";
import { chatApi } from "../api/chat";
import { currentUser, humanError, isWeb, profileId, profiles, reloadProfiles, setProjectId } from "../session";
import { linkProps, navigate, type Route } from "../router";
import { deadlineTone, metricTone } from "../statusTone";
import "../components/paper.css";
import "../components/WorkItemDrawer.css";
import "./Projects.css";
import "./Portfolio.css";

/** ── /projects IS A LIST ──────────────────────────────────────────────────────
 *
 *  The owner's words: *"The Projects area should be a LIST of the projects that are
 *  running. Clicking a project gives you an expanded overview."*
 *
 *  THREE THINGS LEFT THIS PAGE and are named here so nobody wonders where they went:
 *
 *    the embedded BOARD    -> the opened project's Dev tab (`/projects/<id>/dev`)
 *    the MATRIX REPORT     -> travels with the board (it is a Disclosure inside
 *                             views/Boards.tsx), so it is on the Dev tab too
 *    the ACCESS disclosure -> the opened project's Settings, beside "Members and
 *                             project roles", which is the same subject
 *
 *  All three were administration of ONE project rendered on the list of EVERY
 *  project. They belong to the project you opened, not to the list of all of them.
 *
 *  WHAT A ROW SHOWS is only what tells you whether the project is healthy: open
 *  tasks, open tickets, unread messages, the deadline and the lead. Colour follows
 *  `src/statusTone.ts` and runs through `metricTone`, so **a count of 0 carries no
 *  tone** — a quiet project must not look like a warning.
 *
 *  A ROW IS A LINK. One click, a real `href`, keyboard reachable, middle-clickable.
 *  Not a double-click target: a double-click is invisible to a first-time reader and
 *  unreachable from the keyboard, so it cannot be the only way into the main object
 *  of the page. */

const newId = () => `project-${crypto.randomUUID()}`;
const empty = () => ({ name: "", key: "", description: "", deadline: "" });
// The key follows the name until somebody edits the key by hand; from then on the
// field is theirs. Length is a parameter, not a magic number scattered in the view.
export const KEY_LENGTH = 5;
export const deriveKey = (name: string, length = KEY_LENGTH) =>
  name.replace(/[^a-zA-Z0-9]/g, "").slice(0, length).toUpperCase();
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Projects() {
  const [form, setForm] = createSignal(empty());
  const [error, setError] = createSignal("");
  const [keyTouched, setKeyTouched] = createSignal(false);
  /* Creating a project is an ACT, not a permanent band across the top of the list.
     The four fields live in a drawer behind the header primary. */
  const [createOpen, setCreateOpen] = createSignal(false);
  const [items, { refetch }] = createResource(platformApi.projects);
  if (!profiles()) void reloadProfiles().catch(() => undefined);
  const leadName = (id: string) => {
    const person = profiles()?.find((item) => item.id === id);
    return person?.display_name || person?.username || id;
  };
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();

  // ── the health signals ────────────────────────────────────────────────────
  // Every figure for EVERY row comes from ONE read, grouped client-side. A per-card
  // fetch would be N round trips for N projects. Each refusal is carried as a VALUE,
  // never thrown: a denied read has to reach the screen as an error while the rest of
  // the list keeps working.
  const [counts] = createResource<{ open: Map<string, number> } | { failed: string }>(async () => {
    try {
      const [issues, statuses] = await Promise.all([planningApi.issues({}), planningApi.statuses()]);
      const resolved = new Set(statuses.filter((status) => status.resolved).map((status) => status.id));
      const open = new Map<string, number>();
      for (const issue of issues) {
        if (issue.archived || resolved.has(issue.status_id ?? "")) continue;
        open.set(issue.project_id, (open.get(issue.project_id) ?? 0) + 1);
      }
      return { open };
    } catch (reason) { return { failed: humanError(reason) }; }
  });
  const countsFailed = () => { const value = counts(); return value && "failed" in value ? value.failed : ""; };
  const openMap = () => { const value = counts(); return value && "open" in value ? value.open : undefined; };
  const openCount = (id: string) => openMap()?.get(id) ?? 0;

  /** Running TASKS per project. `teamTodos` is the one cross-project read that already
   *  exists (every member's running project work, wherever the caller is a member), so
   *  no new server surface is needed and this can never disagree with Team Tasks. */
  const [taskCounts] = createResource(actingProfileId, async (id) => {
    const by = new Map<string, number>();
    if (!id) return by;
    // A REFUSAL IS A VALUE, NEVER A THROW — the same law the ticket read above obeys.
    // A decoration on a row must never be able to blank the row it decorates, so a
    // failing (or unavailable) count degrades to "no figure", not to an error page.
    try {
      const todos = await personalApi.teamTodos(id, false);
      if (!Array.isArray(todos)) return by;
      for (const todo of todos) {
        if (todo.done || !todo.project_id) continue;
        by.set(todo.project_id, (by.get(todo.project_id) ?? 0) + 1);
      }
    } catch { /* no figure, and the list keeps working */ }
    return by;
  });
  const taskCount = (id: string) => taskCounts()?.get(id) ?? 0;

  /** UNREAD in a project's channels — the one signal that says a project is talking
   *  to you right now. Same read the shell's Chats badge uses. */
  const [unreadCounts] = createResource(actingProfileId, async (id) => {
    const by = new Map<string, number>();
    if (!id) return by;
    try {
      const list = await chatApi.listChannelsWithMeta(id);
      if (!Array.isArray(list)) return by;
      for (const channel of list) {
        if (channel.archived || !channel.project_id) continue;
        by.set(channel.project_id, (by.get(channel.project_id) ?? 0) + (channel.unread_count || 0));
      }
    } catch { /* no badge, and the list keeps working */ }
    return by;
  });
  const unreadCount = (id: string) => unreadCounts()?.get(id) ?? 0;

  const live = createMemo(() => (items() ?? []).filter((project) => !project.archived));
  const openTotal = createMemo(() => {
    let sum = 0; const by = openMap();
    if (by) for (const value of by.values()) sum += value;
    return sum;
  });
  const withDeadline = createMemo(() => live().filter((project) => project.deadline).length);
  const nextDeadline = createMemo(() => live()
    .filter((project) => project.deadline && project.deadline >= todayISO())
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""))[0]);

  /** THE destination of a row: the project workspace, on its overview. */
  const openRoute = (id: string): Route => ({ view: "Project Workspace", projectId: id });

  const save = async (event: SubmitEvent) => {
    event.preventDefault(); const input = form();
    try {
      if (!input.name.trim() || !input.key.trim()) throw new Error("Project name and key are required.");
      // Owner: web lets the session mint it; desktop has no session, so the locally
      // selected profile is the only identity there — send it or the row is ownerless.
      const owner = isWeb() ? null : (profileId() || null);
      if (!isWeb() && !owner) throw new Error("Select a profile before creating a project.");
      const id = newId();
      await platformApi.createProject({ id, name: input.name.trim(), key: input.key.trim().toUpperCase(), description: input.description.trim() || null, deadline: input.deadline || null, archived: false }, owner);
      // A fresh project opens in its own workspace, and the selection follows so
      // desktop (which has no URL) lands on the same project.
      setForm(empty()); setKeyTouched(false); setCreateOpen(false);
      await refetch(); setProjectId(id); navigate(openRoute(id));
    } catch (reason) { setError(humanError(reason)); }
  };
  const update = async (project: Project, patch: Partial<Project>) => {
    try { await platformApi.updateProject({ ...project, ...patch }); await refetch(); }
    catch (reason) { setError(humanError(reason)); }
  };
  // Who may move a deadline is the SERVER's verdict; the UI merely stops offering a
  // control that would be refused. Desktop has no session, so the locally selected
  // profile is the identity there — the same rule the desktop authorizer applies.
  const actor = () => (isWeb() ? currentUser()?.profile_id ?? "" : profileId());
  const mayEditDeadline = (project: Project) =>
    (isWeb() && currentUser()?.role === "GlobalAdmin") || (!!actor() && project.created_by === actor());
  // Per-project write state: idle -> saving -> saved | failed, keyed by project id so
  // two rows never share one spinner or one error.
  const [deadlineState, setDeadlineState] = createSignal<Record<string, { status: "saving" | "saved" | "failed"; message?: string }>>({});
  const deadlineStatus = (id: string) => deadlineState()[id];
  const writeDeadline = async (project: Project, next: string | null) => {
    // A date input yields `YYYY-MM-DD` and is stored verbatim: no Date object is
    // constructed on this path, so no timezone can shift the day.
    const value = next && next.trim() ? next.trim() : null;
    if (value === (project.deadline ?? null)) return;
    // A date input can emit `change` twice for one edit (fill + blur, or a repeated
    // key). The second carries the value the first already replaced and would come
    // back as a stale-write refusal, so a write in flight for this project swallows it.
    if (deadlineStatus(project.id)?.status === "saving") return;
    setDeadlineState({ ...deadlineState(), [project.id]: { status: "saving" } });
    try {
      const desktopActor = isWeb() ? null : actor() || null;
      if (project.deadline === null || project.deadline === undefined)
        await platformApi.setProjectDeadline(project.id, value, desktopActor);
      else
        await platformApi.updateProjectDeadline(project.id, project.deadline, value, desktopActor);
      await refetch();
      setDeadlineState({ ...deadlineState(), [project.id]: { status: "saved" } });
    } catch (reason) {
      // The stored value is the truth: reload it so the input never keeps a date the
      // server refused, and say why in the same place the control lives.
      await refetch();
      setDeadlineState({ ...deadlineState(), [project.id]: { status: "failed", message: humanError(reason) } });
    }
  };

  return <section class="resource-view projects-view">
    <PageHeader
      title="Projects"
      subline="The projects that are running, and whether each one is healthy"
      chips={<Show when={live().length}><Chip value={live().length} label="active" /></Show>}
      actions={<button type="button" class="primary" onClick={() => setCreateOpen(true)}>New project</button>}
    />
    <Show when={error()}><p class="error" role="alert">{error()}</p></Show>
    <Show when={createOpen()}>
      <div class="wid-root">
        <div class="wid-backdrop" aria-hidden="true" onClick={() => setCreateOpen(false)} />
        <aside class="wid-panel" role="dialog" aria-modal="true" aria-label="New project" onKeyDown={event => { if (event.key === "Escape") setCreateOpen(false); }}>
          <header class="wid-head"><h2>New project</h2><p>A project carries the tickets, boards, tasks and documents of one piece of work.</p></header>
          {/* Captions belong INSIDE a drawer: here they are the only thing that says
              what an empty field wants. */}
          <form class="wid-form project-form" onSubmit={save}>
            <label class="wid-field"><span>Name</span><input class="wid-input" autofocus placeholder="Project name" aria-label="Project name" value={form().name} onInput={e => { const name = e.currentTarget.value; setForm({ ...form(), name, key: keyTouched() ? form().key : deriveKey(name) }); }} /></label>
            <label class="wid-field"><span>Key</span><input class="wid-input" placeholder="KEY" aria-label="Project key" maxlength="10" value={form().key} onInput={e => { setKeyTouched(true); setForm({ ...form(), key: e.currentTarget.value.toUpperCase() }); }} /></label>
            <label class="wid-field"><span>Description <em>optional</em></span><input class="wid-input" placeholder="What this project is" aria-label="Project description" value={form().description} onInput={e => setForm({ ...form(), description: e.currentTarget.value })} /></label>
            <label class="wid-field"><span>Deadline <em>optional</em></span><input class="wid-input" type="date" aria-label="Project deadline" value={form().deadline} onInput={e => setForm({ ...form(), deadline: e.currentTarget.value })} /></label>
            <footer class="wid-actions"><button type="button" class="wid-btn" onClick={() => setCreateOpen(false)}>Cancel</button><button class="wid-btn wid-primary">Create project</button></footer>
          </form>
        </aside>
      </div>
    </Show>
    <Show when={countsFailed()}>{reason => <p class="error" role="alert">Open-ticket counts are unavailable: {reason()}</p>}</Show>

    <Show when={live().length}>
      <MetricGrid label="Portfolio at a glance">
        <MetricTile value={live().length} label="Active projects" />
        <MetricTile value={countsFailed() ? "—" : openTotal()} label="Open tickets" tone="teal" />
        <MetricTile value={withDeadline()} label="Carrying a deadline" />
        <Show when={nextDeadline()} fallback={<MetricTile value="—" label="Next deadline" small />}>{next => {
          const target = () => openRoute(next().id);
          return <MetricTile
            small
            value={next().deadline}
            label={`Next: ${next().name}`}
            href={linkProps(target()).href}
            onClick={(event: MouseEvent) => { linkProps(target()).onClick(event as MouseEvent & { currentTarget: HTMLAnchorElement }); setProjectId(next().id); }}
          />;
        }}</Show>
      </MetricGrid>
    </Show>

    {/* NOTHING YET vs FILTERED: this list has no filters at all, so an empty result
        can only be an empty workspace — the only honest offer is creation. */}
    <Show when={!items.loading && !items()?.length}>
      <EmptyState
        title="No projects yet"
        hint="A project carries the tickets, boards, tasks and documents of one piece of work."
        actions={<button type="button" class="primary" onClick={() => setCreateOpen(true)}>New project</button>}
      />
    </Show>

    <ul class="project-cards"><For each={items()}>{project => {
      const due = () => (project.deadline ? deadlineTone(project.deadline) : undefined);
      return <li classList={{ "project-card": true, archived: project.archived }}>
        {/* THE ROW IS THE LINK. One anchor over the identifying part of the card, so
            a single click opens the project and the keyboard reaches it by tabbing.
            The controls below (deadline, archive) sit OUTSIDE it: a control nested in
            a link is a control you cannot press without navigating. */}
        <a
          class="project-open-link"
          {...linkProps(openRoute(project.id))}
          onClick={(event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
            linkProps(openRoute(project.id)).onClick(event);
            setProjectId(project.id);
          }}
        >
          <div class="project-card-head">
            <strong>{project.name}</strong>
            <code>{project.key}</code>
            {/* LAW: lead is PURELY INFORMATIONAL — a name on a row, read-only here,
                gating nothing. Editing it lives in Project settings. */}
            <Show when={project.lead_id}>{lead => <span class="project-lead-chip" title="Project lead (informational)">Lead: {leadName(lead())}</span>}</Show>
          </div>
          <Show when={project.description}><p>{project.description}</p></Show>
          {/* THE HEALTH LINE. Every chip is one fact and one element; zero carries no
              tone, so a calm project reads calm. */}
          <div class="project-health">
            <Show when={!counts.loading && !countsFailed()}>
              <span class="paper-pill" classList={{ [metricTone(openCount(project.id), "teal") || "untoned"]: true }}>
                <b>{openCount(project.id)}</b> open tickets
              </span>
            </Show>
            <Show when={!taskCounts.loading}>
              <span class="paper-pill" classList={{ [metricTone(taskCount(project.id), "teal") || "untoned"]: true }}>
                <b>{taskCount(project.id)}</b> open tasks
              </span>
            </Show>
            <Show when={unreadCount(project.id) > 0}>
              <span class="paper-pill" classList={{ [metricTone(unreadCount(project.id), "teal") || "untoned"]: true }}>
                <b>{unreadCount(project.id)}</b> unread
              </span>
            </Show>
            {/* A deadline earns amber/red only when it is actually near or past — and
                `deadlineTone` is the single place that decides, never this view. */}
            <Show when={due()}>{info => (
              <span class="paper-pill" classList={{ [info().colour || "untoned"]: true }}>
                Due {project.deadline} · {info().note}
              </span>
            )}</Show>
          </div>
        </a>

        {/* A FACT IS NOT AN ACTION: the deadline control and Archive live OUTSIDE the
            row link, in their own quiet action row. */}
        <div class="project-deadline">
          <Show
            when={mayEditDeadline(project)}
            fallback={<p class="deadline-readonly">Deadline <span>{project.deadline ?? "none"}</span></p>}
          >
            <label>Deadline <input
              type="date"
              aria-label={`Deadline for ${project.name}`}
              value={project.deadline ?? ""}
              disabled={deadlineStatus(project.id)?.status === "saving"}
              onChange={e => void writeDeadline(project, e.currentTarget.value || null)}
            /></label>
            <Show when={project.deadline}>
              <button
                class="ghost"
                aria-label={`Clear deadline for ${project.name}`}
                disabled={deadlineStatus(project.id)?.status === "saving"}
                onClick={() => void writeDeadline(project, null)}
              >Clear</button>
            </Show>
          </Show>
          <Show when={deadlineStatus(project.id)?.status === "saving"}><span class="hint" role="status">Saving deadline…</span></Show>
          <Show when={deadlineStatus(project.id)?.status === "saved"}><span class="hint" role="status">Deadline saved</span></Show>
          <Show when={deadlineStatus(project.id)?.status === "failed"}><span class="error" role="alert">{deadlineStatus(project.id)?.message}</span></Show>
        </div>
        <div class="project-card-foot">
          <div class="row-actions">
            <GhostPill {...linkProps({ view: "Project Workspace", projectId: project.id, tab: "tasks" })}>Tasks</GhostPill>
            <GhostPill {...linkProps({ view: "Project Workspace", projectId: project.id, tab: "calendar" })}>Calendar</GhostPill>
            <GhostPill onClick={() => void update(project, { archived: !project.archived })}>{project.archived ? "Restore" : "Archive"}</GhostPill>
          </div>
        </div>
      </li>;
    }}</For></ul>
  </section>;
}
