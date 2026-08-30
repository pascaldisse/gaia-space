import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "../components/ContextMenu";
import { Icon } from "../components/Icon";
import DateField from "../components/DateField";
import ContentHead from "../components/ContentHead";
import { PillMenu } from "../components/controls";
import { platformApi, type Project } from "../api/platform";
import { planningApi } from "../api/issues";
import { personalApi } from "../api/personal";
import { chatApi } from "../api/chat";
import { currentUser, humanError, isWeb, profileId, profiles, reloadProfiles, setProjectId } from "../session";
import { linkProps, navigate, type Route } from "../router";
import { bandTone, deadlineBand, deadlineTone, metricTone } from "../statusTone";
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
const empty = () => ({ name: "", description: "", deadline: "" });
/** ── THE KEY IS A FACT, NOT A QUESTION ────────────────────────────────────────
 *  Nothing in the product identifies anything BY the key: a ticket reads `#42`
 *  (Issues.tsx, IssueDetail.tsx), never `DEMO-42`. The key only decorated a card and
 *  padded a picker label. But the column is `TEXT NOT NULL UNIQUE`, so it cannot
 *  simply go: it is DERIVED from the name at creation, and the operator may still
 *  edit it in Project settings, where it is a real operator field.
 *  Length is a parameter, not a magic number scattered in the view. */
export const KEY_LENGTH = 5;
export const deriveKey = (name: string, length = KEY_LENGTH) =>
  name.replace(/[^a-zA-Z0-9]/g, "").slice(0, length).toUpperCase();
/** UNIQUE OR THE INSERT IS REFUSED. Two projects may share a name, so the derived key
 *  is counted up (`ORBITAL`, `ORBITAL2`, …) against the keys that ACTUALLY EXIST —
 *  read, never guessed. A name with no letters or digits at all still needs a key,
 *  hence the fallback. */
export const FALLBACK_KEY = "PROJ";
export const uniqueKey = (name: string, taken: Iterable<string>) => {
  const used = new Set(Array.from(taken, value => value.toUpperCase()));
  const base = deriveKey(name) || FALLBACK_KEY;
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
};

/** A CARD MUST ALWAYS FIT IN THE WINDOW (the owner's rule, verbatim). A description is
 *  free text and there is no length the server refuses, so the card refuses instead:
 *  the note is cut at a WORD boundary and ends in an ellipsis. CSS clamps it to two
 *  lines as well — the character limit keeps the DOM honest, the clamp keeps a single
 *  very long word from widening the card. Nothing is lost: the full text is on the
 *  project itself. */
export const DESCRIPTION_MAX = 96;
export const shortDescription = (text: string | null | undefined, max = DESCRIPTION_MAX): string => {
  const value = (text ?? "").trim();
  if (value.length <= max) return value;
  // Cut one character short of the limit so the ellipsis fits INSIDE it, then walk
  // back to the last space. A word boundary that never comes (one long word) falls
  // back to the hard cut rather than returning the whole string.
  const cut = value.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max / 2 ? cut.slice(0, boundary) : cut).trimEnd()}\u2026`;
};

/** WHO IS ON THE PROJECT, decided while the project is being decided. One entry per
 *  chosen person; `roleId` is empty until somebody picks a role, and stays empty when
 *  the workspace has no roles to pick (the role menu is then not drawn at all — an
 *  empty menu is a promise the workspace cannot keep). */
type MemberDraft = { id: string; roleId: string };

export default function Projects() {
  const [form, setForm] = createSignal(empty());
  const [draftMembers, setDraftMembers] = createSignal<MemberDraft[]>([]);
  const [error, setError] = createSignal("");
  /* Creating a project is an ACT, not a permanent band across the top of the list.
     The four fields live in a drawer behind the header primary. */
  const [createOpen, setCreateOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [portfolioFilter, setPortfolioFilter] = createSignal<"all" | "attention" | "due">("all");
  const [showArchived, setShowArchived] = createSignal(false);
  const [items, { refetch }] = createResource(platformApi.projects);
  if (!profiles()) void reloadProfiles().catch(() => undefined);
  const leadName = (id: string) => {
    const person = profiles()?.find((item) => item.id === id);
    return person?.display_name || person?.username || id;
  };
  const actingProfileId = () => currentUser()?.profile_id ?? profileId();
  /* The SAME roles ProjectSettings' member panel offers, assigned with the SAME command
     (create_role_assignment, scope "project"). Two surfaces, one vocabulary. */
  const [orgRoles] = createResource(platformApi.roles);
  const assignableRoles = () => (orgRoles() ?? []).filter(role => !role.archived);
  const personName = (id: string) => {
    const person = profiles()?.find(item => item.id === id);
    return person?.display_name || person?.username || id;
  };
  /* "You are in the project by creating it": the creator is a member already and is
     never offered — the same rule the meeting drawer's participant field keeps. */
  const invitable = () => (profiles() ?? []).filter(person => !person.archived && person.id !== (actingProfileId() || ""));
  const addableMembers = () => invitable().filter(person => !draftMembers().some(member => member.id === person.id));
  const addMember = (id: string) => { if (id && !draftMembers().some(member => member.id === id)) setDraftMembers([...draftMembers(), { id, roleId: "" }]); };
  const removeMember = (id: string) => setDraftMembers(draftMembers().filter(member => member.id !== id));
  const setMemberRole = (id: string, roleId: string) => setDraftMembers(draftMembers().map(member => member.id === id ? { ...member, roleId } : member));
  const closeCreate = () => { setCreateOpen(false); setDraftMembers([]); };

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

  /** The card's ONE coloured fact, decided in statusTone and nowhere else: teal beyond a
   *  week, amber inside it, red today/tomorrow/past, and nothing at all without a date.
   *  Archived work is finished, so it stays quiet — the same rule the card's mark obeys. */
  const dueTone = (project: Project) => (project.archived ? "" : bandTone(deadlineBand(project.deadline)));

  const live = createMemo(() => (items() ?? []).filter((project) => !project.archived));
  /** The empty state below carries "New project" itself; while it is on screen the
   *  action row must not draw a second one (src/views/one-action-one-place.test.tsx). */
  const showsEmptyPrimary = () => !items.loading && !items()?.length;
  /** The portfolio stays useful after it grows: find by name/key, then narrow to
      projects asking for attention or carrying a live deadline. */
  const visibleProjects = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    return (items() ?? []).filter((project) => {
      if (project.archived && !showArchived()) return false;
      if (needle && !`${project.name} ${project.key} ${project.description ?? ""}`.toLocaleLowerCase().includes(needle)) return false;
      if (portfolioFilter() === "attention")
        return openCount(project.id) > 0 || taskCount(project.id) > 0 || unreadCount(project.id) > 0 || !!(project.deadline && deadlineTone(project.deadline).colour);
      if (portfolioFilter() === "due") return !!(project.deadline && deadlineTone(project.deadline).colour);
      return true;
    });
  });

  /** THE destination of a row: the project workspace, on its overview. */
  const openRoute = (id: string): Route => ({ view: "Project Workspace", projectId: id });

  const save = async (event: SubmitEvent) => {
    event.preventDefault(); const input = form();
    try {
      if (!input.name.trim()) throw new Error("A project needs a name.");
      // The keys in hand may be stale (another person created a project a minute ago),
      // so the uniqueness check reads the list again and only falls back to the
      // loaded one if that read is unavailable.
      const existing = await platformApi.projects().catch(() => items() ?? []);
      const key = uniqueKey(input.name, existing.map(project => project.key));
      // Owner: web lets the session mint it; desktop has no session, so the locally
      // selected profile is the only identity there — send it or the row is ownerless.
      const owner = isWeb() ? null : (profileId() || null);
      if (!isWeb() && !owner) throw new Error("Select a profile before creating a project.");
      const id = newId();
      await platformApi.createProject({ id, name: input.name.trim(), key, description: input.description.trim() || null, deadline: input.deadline || null, archived: false }, owner);
      /* MEMBERSHIP IS WRITTEN AFTER THE PROJECT EXISTS: both commands need a project
         id, which only create_project mints. A refused membership or role must never
         be reported as a failed creation — the project IS there — so every refusal is
         collected by name and said out loud instead. */
      const failures: string[] = [];
      for (const member of draftMembers()) {
        try {
          await personalApi.addProjectMember(id, member.id);
          if (member.roleId)
            await platformApi.createAssignment({ role_id: member.roleId, profile_id: member.id, scope_type: "project", scope_id: id });
        } catch (reason) { failures.push(`${personName(member.id)}: ${humanError(reason)}`); }
      }
      setForm(empty()); setDraftMembers([]); setCreateOpen(false);
      await refetch();
      if (failures.length) {
        // The project stands; the list stays put so the reason can be read and fixed
        // in the project's settings.
        setError(`Project created, but not everybody could be added — ${failures.join("; ")}`);
        return;
      }
      setError("");
      // A fresh project opens in its own workspace, and the selection follows so
      // desktop (which has no URL) lands on the same project.
      setProjectId(id); navigate(openRoute(id));
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
  /** Which card has its deadline editor open. The date field is an ACT, not a fact, so
   *  it is not drawn until somebody asks for it — through the pill or the menu. */
  const [editingDeadline, setEditingDeadline] = createSignal<string | null>(null);
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
      // The act is finished: the field folds away and the card is a card again.
      setEditingDeadline(null);
    } catch (reason) {
      // The stored value is the truth: reload it so the input never keeps a date the
      // server refused, and say why in the same place the control lives.
      await refetch();
      setDeadlineState({ ...deadlineState(), [project.id]: { status: "failed", message: humanError(reason) } });
    }
  };

  /* ── ACTS ON A PROJECT, WHERE THE PROJECT IS LISTED ────────────────────────
     The workspace header carries the delete for the project you are IN. This list
     is where people point AT a project, so the same act is on its right-click menu
     — the identical gesture the channel list already answers (SpaceShell).

     THE OWNER RULE: `created_by === actingProfileId`. A non-owner's menu simply has
     no Delete entry; a disabled red word teases an act nobody can have. And the menu
     never deletes — it opens the question. */
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [pendingDelete, setPendingDelete] = createSignal<Project | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  const ownsProject = (project: Project) => !!actor() && project.created_by === actor();
  /* THE CARD CARRIES NO FOOTER. Archive/Restore and the deadline used to sit on every
     card as furniture: a way OUT of the project standing beside the way IN, and a bare
     date field under a card nobody was editing. They are acts on a project, so they live
     where every other act on a listed project already lives — the right-click menu.
     Order: the way in, then the acts, then the irreversible one, last and red. */
  const menuItems = (project: Project): ContextMenuItem[] => [
    { label: "Open", onSelect: () => { setProjectId(project.id); navigate(openRoute(project.id)); } },
    ...(mayEditDeadline(project)
      ? [
          { label: project.deadline ? "Change deadline…" : "Set deadline…", onSelect: () => setEditingDeadline(project.id) },
          ...(project.deadline ? [{ label: "Clear deadline", onSelect: () => void writeDeadline(project, null) }] : []),
        ]
      : []),
    { label: project.archived ? "Restore" : "Archive", onSelect: () => void update(project, { archived: !project.archived }) },
    ...(ownsProject(project)
      ? [{ label: "Delete project…", danger: true, onSelect: () => setPendingDelete(project) }]
      : []),
  ];
  const openMenu = (event: MouseEvent, project: Project) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items: menuItems(project) });
  };
  const deleteProject = async () => {
    const project = pendingDelete();
    if (!project) return;
    setError(""); setDeleting(true);
    try {
      await platformApi.deleteProject(project.id, actingProfileId() ?? "");
      setPendingDelete(null);
      await refetch();
    } catch (reason) {
      // The list's own error line, the same one every other refusal lands in.
      setError(humanError(reason));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return <section class="resource-view projects-view">
    <Show when={menu()}>
      {(open) => <ContextMenu x={open().x} y={open().y} items={open().items} onClose={() => setMenu(null)} />}
    </Show>
    <ConfirmDialog
      open={!!pendingDelete()}
      title="Delete project?"
      body={
        <>
          <strong>{pendingDelete()?.name}</strong> is deleted for everyone, with its tasks, tickets,
          calendar entries and knowledge. This cannot be undone.
        </>
      }
      confirmLabel="Delete project"
      busy={deleting()}
      onConfirm={() => void deleteProject()}
      onCancel={() => setPendingDelete(null)}
    />
    <PageHeader
      icon="layers"
      title="Projects"
      subline="The projects that are running, and whether each one is healthy"
      chips={<Show when={live().length}><Chip value={live().length} label="active" /></Show>}
    />
    {/* THE ACTION ROW. Creation left, everything that only changes what you see at the
       far end — the portfolio toolbar used to be a second lane of its own below. */}
    <nav class="page-actionbar" aria-label="Project actions">
      {/* ONE ACTION, ONE PLACE: while the empty state offers New project, the row does not. */}
      <Show when={!showsEmptyPrimary()}>
        <button type="button" class="primary" onClick={() => setCreateOpen(true)}>New project</button>
      </Show>
      <Show when={live().length}>
        <span class="actionbar-view-controls portfolio-toolbar" aria-label="Project filters">
          <input class="portfolio-search" type="search" aria-label="Search projects" placeholder="Search projects" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          <span class="portfolio-filters" role="group" aria-label="Filter projects">
            <button type="button" classList={{ active: portfolioFilter() === "all" }} onClick={() => setPortfolioFilter("all")}>All projects</button>
            <button type="button" classList={{ active: portfolioFilter() === "attention" }} onClick={() => setPortfolioFilter("attention")}>Needs attention</button>
            <button type="button" classList={{ active: portfolioFilter() === "due" }} onClick={() => setPortfolioFilter("due")}>Due soon</button>
          </span>
          <button type="button" class="portfolio-archive-toggle" classList={{ active: showArchived() }} onClick={() => setShowArchived((shown) => !shown)}>{showArchived() ? "Hide archived" : "Show archived"}</button>
        </span>
      </Show>
    </nav>
    <Show when={error()}><p class="error" role="alert">{error()}</p></Show>
    {/* A NEW PROJECT IS MADE WHERE IT WILL LIVE. It used to be a panel sliding in from
        the right — a different place and a different shape for the thing the list right
        below already shows. The form stands at the head of the list instead, in the
        same paper the cards are made of, exactly as a task is created in its own list. */}
    <Show when={createOpen()}>
      <section class="project-create" aria-label="New project" onKeyDown={event => { if (event.key === "Escape") closeCreate(); }}>
        <header class="project-create-head"><h2>New project</h2><p>A project carries the tickets, boards, tasks and documents of one piece of work.</p></header>
      <form class="wid-form project-form project-create-form" onSubmit={save}>
        <label class="wid-field"><span>Name</span><input class="wid-input" autofocus placeholder="Project name" aria-label="Project name" value={form().name} onInput={e => setForm({ ...form(), name: e.currentTarget.value })} /></label>
        {/* NO KEY FIELD: nobody is asked for an identifier the product never shows.
        It is derived from the name (unique against the projects that exist) and
        stays editable in Project settings, where it is an operator's field. */}
        <label class="wid-field"><span>Description <em>optional</em></span><input class="wid-input" placeholder="What this project is" aria-label="Project description" value={form().description} onInput={e => setForm({ ...form(), description: e.currentTarget.value })} /></label>
        <div class="wid-field"><span>Deadline <em>optional</em></span><DateField label="Project deadline" value={form().deadline} onChange={value => setForm({ ...form(), deadline: value })} /></div>
        {/* MEMBERS, in the order a person decides: what the project is, then who is
        on it, then Create. Chosen exactly the way a meeting's participants are
        chosen — one menu, one pill per person, × to take them off again. The
        role beside each pill is the SAME vocabulary and the SAME command the
        project's settings use, so both surfaces can never disagree. */}
        <div class="wid-field project-members-field">
          <span>Members <em>optional</em></span>
          <PillMenu
        label="Add project member"
        value=""
        placeholder={invitable().length ? "Add someone…" : "No other profiles yet"}
        disabled={!addableMembers().length}
        options={addableMembers().map(person => ({ value: person.id, label: person.display_name || person.username }))}
        onChange={addMember}
          />
          <Show when={draftMembers().length}>
        <ul class="project-members" aria-label="Project members">
          <For each={draftMembers()}>{member =>
            <li class="project-member">
          <span class="project-member-name">{personName(member.id)}</span>
          {/* NO ROLE MENU WITHOUT ROLES: an empty menu, or an invented
              "Member" role, would both be a lie about this workspace. */}
          <Show when={assignableRoles().length}>
            <PillMenu
              label={`Role for ${personName(member.id)}`}
              value={member.roleId}
              placeholder="No role"
              options={[{ value: "", label: "No role" }, ...assignableRoles().map(role => ({ value: role.id, label: role.name }))]}
              onChange={roleId => setMemberRole(member.id, roleId)}
            />
          </Show>
          <button type="button" class="project-member-remove" aria-label={`Remove ${personName(member.id)}`} onClick={() => removeMember(member.id)}>×</button>
            </li>
          }</For>
        </ul>
          </Show>
          <span class="project-members-hint">You are on this project because you create it.</span>
        </div>
        {/* The drawer's own button classes went with the drawer: out here the acts are
            the product's ordinary buttons, so they obey the one button rule. */}
        <footer class="wid-actions">
          <button type="button" onClick={closeCreate}>Cancel</button>
          <button class="primary">Create project</button>
        </footer>
      </form>
      </section>
    </Show>
    {/* What the grid below carries, and what a card is good for. */}
    <ContentHead
      icon="layers"
      title={portfolioFilter() === "attention" ? "Needs attention" : portfolioFilter() === "due" ? "Due soon" : "All projects"}
      line={portfolioFilter() === "attention" ? "Projects with open work, unread messages or a deadline in sight."
        : portfolioFilter() === "due" ? "Projects whose deadline is near or already past."
        : "Open a project to work in it — its chats, tasks, calendar and knowledge live inside."} />

    <Show when={countsFailed()}>{reason => <p class="error" role="alert">Open-ticket counts are unavailable: {reason()}</p>}</Show>


    {/* NOTHING YET vs FILTERED: this list has no filters at all, so an empty result
        can only be an empty workspace — the only honest offer is creation. */}
    <Show when={!items.loading && !items()?.length}>
      <EmptyState
        title="No projects yet"
        hint="A project carries the tickets, boards, tasks and documents of one piece of work."
        actions={<button type="button" class="primary" onClick={() => setCreateOpen(true)}>New project</button>}
      />
    </Show>

    <Show when={visibleProjects().length} fallback={
      <Show when={!items.loading && items()?.length}>
        <p class="portfolio-no-results">No projects match these filters.</p>
      </Show>
    }>
    <ul class="project-cards"><For each={visibleProjects()}>{project => {
      return <li classList={{ "project-card": true, archived: project.archived }} onContextMenu={(event) => openMenu(event, project)}>
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
            {/* The same tile the Knowledge card carries, with the same glyph the rail
                uses for Projects — the card and the way here wear one mark. */}
            {/* AND IT SAYS HOW MUCH ROOM IS LEFT. The same three bands a task's mark
                uses (statusTone.deadlineBand): teal beyond a week, amber inside it,
                red today/tomorrow/past. A project with no deadline stays grey — the
                mark never invents one. Archived work is finished and stays quiet. */}
            <span
              class="project-card-icon"
              classList={{ [project.archived ? "" : bandTone(deadlineBand(project.deadline))]: !project.archived }}
              aria-hidden="true"
            ><Icon name="layers" size={20} /></span>
            {/* THE KEY IS NOT ON THE CARD: it answered no question anybody asked.
                It remains searchable (visibleProjects) and editable in settings. */}
            <strong>{project.name}</strong>
            {/* LAW: lead is PURELY INFORMATIONAL — a name on a row, read-only here,
                gating nothing. Editing it lives in Project settings. */}
            <Show when={project.lead_id}>{lead => <span class="project-lead-chip" title="Who is responsible for this project (informational)">Responsible: {leadName(lead())}</span>}</Show>
          </div>
          {/* ONE SHORT NOTE, or none at all — an absent description leaves no empty line
              and no placeholder. */}
          <Show when={shortDescription(project.description)}>{note => <p class="project-card-note">{note()}</p>}</Show>
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
          </div>
        </a>

        {/* THE DEADLINE IS A PILL, exactly as it is on a task tile (.task-due): one
            fact, at the card's edge, coloured ONLY by bandTone(deadlineBand(…)) — teal
            beyond a week, amber inside it, red today/tomorrow/past, and NO colour at all
            without a date. It sits outside the row link because for somebody who may
            move it, it is also the way in: a control nested in a link cannot be pressed
            without navigating. Whoever may not move it gets the same pill as plain fact. */}
        <span class="project-card-edge">
          <Show
            when={mayEditDeadline(project) && !project.archived}
            fallback={
              <span class="project-due" classList={{ [dueTone(project) || "untoned"]: true }}>
                {project.deadline ? `Due ${project.deadline}` : "No deadline"}
              </span>
            }
          >
            <button
              type="button"
              class="project-due editable"
              classList={{ [dueTone(project) || "untoned"]: true }}
              aria-label={`${project.deadline ? "Change" : "Set"} deadline for ${project.name}`}
              aria-expanded={editingDeadline() === project.id}
              onClick={() => setEditingDeadline(id => (id === project.id ? null : project.id))}
            >{project.deadline ? `Due ${project.deadline}` : "No deadline"}</button>
          </Show>
        </span>

        {/* A FACT IS NOT AN ACTION: the date field appears only once somebody asks for
            it (the pill, or "Set deadline…" in the card's menu). The write's own status
            stays where the control was, even after it closes. */}
        <div class="project-deadline">
          <Show when={mayEditDeadline(project) && editingDeadline() === project.id}>
            {/* One control, the product's own: picking a day writes it, and the
                popover's own Clear removes it — the separate Clear button beside the
                field was a second way to say the same thing. */}
            <DateField
              label={`Deadline for ${project.name}`}
              value={project.deadline ?? ""}
              disabled={deadlineStatus(project.id)?.status === "saving"}
              onChange={value => void writeDeadline(project, value || null)}
            />
            <button class="ghost" type="button" onClick={() => setEditingDeadline(null)}>Done</button>
          </Show>
          <Show when={deadlineStatus(project.id)?.status === "saving"}><span class="hint" role="status">Saving deadline…</span></Show>
          <Show when={deadlineStatus(project.id)?.status === "saved"}><span class="hint" role="status">Deadline saved</span></Show>
          <Show when={deadlineStatus(project.id)?.status === "failed"}><span class="error" role="alert">{deadlineStatus(project.id)?.message}</span></Show>
        </div>
        {/* NO FOOTER. "Tasks" and "Calendar" were two sub-destinations standing beside
            the card that IS the way into the project, which turned a card into a
            navigation bar; both surfaces are one click further in, and nothing can be
            reached only from here. Archive/Restore moved to the card's menu, where the
            other acts on a listed project already are. */}
      </li>;
    }}</For></ul>
    </Show>
  </section>;
}
