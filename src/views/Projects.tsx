import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import PageHeader, { Chip, EmbeddedScopeProvider } from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { GhostPill, PillSelect } from "../components/controls";
import { platformApi, type Project } from "../api/platform";
import { planningApi } from "../api/issues";
import { currentUser, humanError, isWeb, profileId, profiles, projectId as sessionProject, reloadProfiles, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import Boards from "./Boards";
import "../components/paper.css";
import "../components/WorkItemDrawer.css";
import "./Projects.css";
import "./Portfolio.css";

const newId = () => `project-${crypto.randomUUID()}`;
const empty = () => ({ name: "", key: "", description: "", deadline: "" });
// The key follows the name until somebody edits the key by hand; from then on the
// field is theirs. Length is a parameter, not a magic number scattered in the view.
export const KEY_LENGTH = 5;
export const deriveKey = (name: string, length = KEY_LENGTH) =>
  name.replace(/[^a-zA-Z0-9]/g, "").slice(0, length).toUpperCase();
const todayISO = () => new Date().toISOString().slice(0, 10);
// Project roles: the per-project half of the role model (V92). A role is either
// minted from an organization template (inheriting its name+kind) or named here;
// a team binding gives a whole team that role. Every refusal the server can raise
// (foreign project, archived role, missing right) lands in this panel's own error
// line, so it can never be mistaken for a failure of the project card above it.
function ProjectRoles(props: { projectId: string }) {
  const [panelError, setPanelError] = createSignal("");
  const [templates] = createResource(platformApi.projectRoleTemplates);
  const [teams] = createResource(platformApi.teams);
  const [roles, rolesResource] = createResource(() => props.projectId, id => platformApi.projectRoles(id));
  const [bindings, bindingsResource] = createResource(() => props.projectId, id => platformApi.projectTeamRoles(id));
  const [templateId, setTemplateId] = createSignal("");
  const [roleName, setRoleName] = createSignal("");
  const [teamId, setTeamId] = createSignal("");
  const [bindRoleId, setBindRoleId] = createSignal("");
  const liveRoles = createMemo(() => (roles() ?? []).filter(role => !role.archived));
  const liveTemplates = createMemo(() => (templates() ?? []).filter(template => !template.archived));
  const roleName_ = (id: string) => (roles() ?? []).find(role => role.id === id)?.name ?? id;
  const teamName = (id: string) => (teams() ?? []).find(team => team.id === id)?.name ?? id;
  const guard = async (work: () => Promise<unknown>) => {
    setPanelError("");
    try { await work(); } catch (reason) { setPanelError(humanError(reason)); }
  };
  const addRole = (event: SubmitEvent) => {
    event.preventDefault();
    // Name is optional only when a template supplies one — the same rule the server keeps.
    void guard(async () => {
      const template = templateId() || null;
      const name = roleName().trim();
      if (!template && !name) throw new Error("Pick a template or name the role.");
      await platformApi.createProjectRole({ project_id: props.projectId, template_id: template, name: name || null });
      setRoleName(""); setTemplateId("");
      await rolesResource.refetch();
    });
  };
  const bind = (event: SubmitEvent) => {
    event.preventDefault();
    void guard(async () => {
      if (!teamId() || !bindRoleId()) throw new Error("Pick a team and a role.");
      await platformApi.assignProjectTeamRole(props.projectId, teamId(), bindRoleId());
      await bindingsResource.refetch();
    });
  };
  // Access is administration, not daily work: it stays folded away under the board
  // and says in its own summary how much is configured, so nobody opens it to look.
  return <details class="project-access">
    <summary><span>Access</span><small>{liveRoles().length} roles · {(bindings() ?? []).length} team bindings</small></summary>
    <div class="project-access-body">
    <section class="project-roles">
    <h3>Roles</h3>
    <Show when={panelError()}><p class="error" role="alert">{panelError()}</p></Show>
    <form class="project-role-form" onSubmit={addRole}>
      {/* L4: the resting option says what the control is for, so the caption above
          it was a second copy of the same word. */}
      <PillSelect label="Role template" value={templateId()} onChange={setTemplateId}>
        <option value="">No template (name it below)</option>
        <For each={liveTemplates()}>{template=><option value={template.id}>{template.name} ({template.role_kind})</option>}</For>
      </PillSelect>
      <input placeholder="Role name (optional with a template)" aria-label="Project role name" value={roleName()} onInput={e=>setRoleName(e.currentTarget.value)}/>
      <button class="primary">Add role</button>
    </form>
    {/* The "Add role" form is directly above: the line points at it instead of
        drawing a second button for the same command. */}
    <Show when={!roles()?.length}><EmptyState title="No project roles yet" hint="Add one above — from a template, or with a name of your own." /></Show>
    <ul class="project-role-list"><For each={roles()}>{role=>
      <li classList={{ archived: role.archived }}>
        <strong>{role.name}</strong> <code>{role.role_kind}</code>
        <Show when={role.template_id}><span class="hint"> from template</span></Show>
        <button class="ghost" onClick={()=>void guard(async()=>{ await platformApi.archiveProjectRole(role.id, !role.archived); await rolesResource.refetch(); })}>
          {role.archived ? "Restore" : "Archive"}
        </button>
      </li>
    }</For></ul>
    <h3>Team bindings</h3>
    <form class="project-role-form" onSubmit={bind}>
      <PillSelect label="Team" value={teamId()} onChange={setTeamId}>
        <option value="">Select a team</option>
        <For each={(teams() ?? []).filter(team=>!team.archived)}>{team=><option value={team.id}>{team.name}</option>}</For>
      </PillSelect>
      <PillSelect label="Project role" value={bindRoleId()} onChange={setBindRoleId}>
        <option value="">Select a role</option>
        <For each={liveRoles()}>{role=><option value={role.id}>{role.name}</option>}</For>
      </PillSelect>
      <button class="primary">Bind team</button>
    </form>
    <Show when={!bindings()?.length}><EmptyState title="No team carries a role in this project yet" hint="Bind a team to a role with the form above." /></Show>
    <ul class="project-role-list"><For each={bindings()}>{binding=>
      <li>
        <strong>{teamName(binding.team_id)}</strong> → {roleName_(binding.project_role_id)}
        <button class="ghost" onClick={()=>void guard(async()=>{ await platformApi.removeProjectTeamRole(binding.project_id, binding.team_id, binding.project_role_id); await bindingsResource.refetch(); })}>Remove</button>
      </li>
    }</For></ul>
    </section>
    </div>
  </details>;
}
export default function Projects() {
  // One destination: the project list IS the entry point, and an opened project
  // shows its boards (whose cards are its issues). No separate Issues/Boards tabs.
  const [form, setForm] = createSignal(empty()); const [error, setError] = createSignal("");
  const [keyTouched, setKeyTouched] = createSignal(false);
  /* L3: creating a project is an ACT, not a permanent band across the top of the
     list. The four fields live in a drawer behind the header primary; the surface
     shows the projects, which is what the page is for. */
  const [createOpen, setCreateOpen] = createSignal(false);
  const [items, { refetch }] = createResource(platformApi.projects);
  if (!profiles()) void reloadProfiles().catch(() => undefined);
  const leadName = (id: string) => { const person = profiles()?.find(item => item.id === id); return person?.display_name || person?.username || id; };
  // Open-issue counts for EVERY card come from one issue read plus one status read,
  // grouped client-side. A per-card fetch would be N round trips for N projects.
  // The refusal is carried as a value, not as a thrown resource: a denied read has to
  // reach the screen as an error, while the rest of the list keeps working.
  const [counts] = createResource<{ open: Map<string, number> } | { failed: string }>(async () => {
    try {
      const [issues, statuses] = await Promise.all([planningApi.issues({}), planningApi.statuses()]);
      const resolved = new Set(statuses.filter(status => status.resolved).map(status => status.id));
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
  // Summary strip: every number is read off the project/issue data already loaded,
  // so the strip can never disagree with the cards below it.
  const live = createMemo(() => (items() ?? []).filter(project => !project.archived));
  const openTotal = createMemo(() => {
    let sum = 0; const by = openMap();
    if (by) for (const value of by.values()) sum += value;
    return sum;
  });
  const withDeadline = createMemo(() => live().filter(project => project.deadline).length);
  const nextDeadline = createMemo(() => live()
    .filter(project => project.deadline && project.deadline >= todayISO())
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""))[0]);
  const save = async (event: SubmitEvent) => {
    event.preventDefault(); const input = form();
    try {
      if (!input.name.trim() || !input.key.trim()) throw new Error("Project name and key are required.");
      // Owner: web lets the session mint it; desktop has no session, so the
      // locally selected profile is the only identity there — send it or the
      // row is created ownerless.
      const owner = isWeb() ? null : (profileId() || null);
      if (!isWeb() && !owner) throw new Error("Select a profile before creating a project.");
      const id = newId();
      await platformApi.createProject({ id, name:input.name.trim(), key:input.key.trim().toUpperCase(), description:input.description.trim() || null, deadline:input.deadline || null, archived:false }, owner);
      // A freshly created project opens where its work begins, and the selection
      // follows so desktop (which has no URL) lands on the same project.
      setForm(empty()); setKeyTouched(false); setCreateOpen(false); await refetch(); setProjectId(id); navigate({ view: "Project Steering", projectId: id });
    } catch (reason) { setError(humanError(reason)); }
  };
  const update = async (project: Project, patch: Partial<Project>) => { try { await platformApi.updateProject({ ...project, ...patch }); await refetch(); } catch (reason) { setError(humanError(reason)); } };
  // Who may move a deadline is the server's verdict; the UI merely stops offering a
  // control that would be refused. Desktop has no session, so the locally selected
  // profile is the identity there — the same rule the desktop authorizer applies.
  const actor = () => (isWeb() ? currentUser()?.profile_id ?? "" : profileId());
  const mayEditDeadline = (project: Project) =>
    (isWeb() && currentUser()?.role === "GlobalAdmin") || (!!actor() && project.created_by === actor());
  // Per-project write state: idle -> saving -> saved | failed. Keyed by project id so two
  // cards never share one spinner or one error.
  const [deadlineState, setDeadlineState] = createSignal<Record<string, { status: "saving" | "saved" | "failed"; message?: string }>>({});
  const deadlineStatus = (id: string) => deadlineState()[id];
  const writeDeadline = async (project: Project, next: string | null) => {
    // A date input yields `YYYY-MM-DD` and is stored verbatim: no Date object is
    // constructed anywhere on this path, so no timezone can shift the day.
    const value = next && next.trim() ? next.trim() : null;
    if (value === (project.deadline ?? null)) return;
    // A date input can emit `change` twice for one edit (fill + blur, or a repeated key).
    // The second one would carry the value the first has already replaced and come back as
    // a stale-write refusal, so a write in flight for this project swallows it.
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
  const openId = () => route().entityId || sessionProject();
  const openProject = () => items()?.find(p => p.id === openId());
  return <section class="resource-view projects-view">
    <PageHeader
      title="Projects"
      subline="Owned workspaces and their deadlines"
      chips={<Show when={live().length}><Chip value={live().length} label="active" /></Show>}
      actions={<button type="button" class="primary" onClick={()=>setCreateOpen(true)}>New project</button>}
    />
    <Show when={error()}><p class="error" role="alert">{error()}</p></Show>
    <Show when={createOpen()}>
      <div class="wid-root">
        <div class="wid-backdrop" aria-hidden="true" onClick={()=>setCreateOpen(false)} />
        <aside class="wid-panel" role="dialog" aria-modal="true" aria-label="New project" onKeyDown={event=>{ if(event.key==="Escape") setCreateOpen(false); }}>
          <header class="wid-head"><h2>New project</h2><p>A project carries the tickets, boards, tasks and documents of one piece of work.</p></header>
          {/* Captions belong INSIDE a drawer (audit §3.3): here they are the only
              thing that says what an empty field wants. */}
          <form class="wid-form project-form" onSubmit={save}>
            <label class="wid-field"><span>Name</span><input class="wid-input" autofocus placeholder="Project name" aria-label="Project name" value={form().name} onInput={e=>{const name=e.currentTarget.value;setForm({...form(),name,key:keyTouched()?form().key:deriveKey(name)});}}/></label>
            <label class="wid-field"><span>Key</span><input class="wid-input" placeholder="KEY" aria-label="Project key" maxlength="10" value={form().key} onInput={e=>{setKeyTouched(true);setForm({...form(),key:e.currentTarget.value.toUpperCase()});}}/></label>
            <label class="wid-field"><span>Description <em>optional</em></span><input class="wid-input" placeholder="What this project is" aria-label="Project description" value={form().description} onInput={e=>setForm({...form(),description:e.currentTarget.value})}/></label>
            <label class="wid-field"><span>Deadline <em>optional</em></span><input class="wid-input" type="date" aria-label="Project deadline" value={form().deadline} onInput={e=>setForm({...form(),deadline:e.currentTarget.value})}/></label>
            <footer class="wid-actions"><button type="button" class="wid-btn" onClick={()=>setCreateOpen(false)}>Cancel</button><button class="wid-btn wid-primary">Create project</button></footer>
          </form>
        </aside>
      </div>
    </Show>
    <Show when={countsFailed()}>{reason=><p class="error" role="alert">Open-ticket counts are unavailable: {reason()}</p>}</Show>
    <Show when={live().length}>
      <div class="pf-summary">
        <div class="pf-metric"><span class="pf-metric-num">{live().length}</span><span class="pf-metric-lbl">Active projects</span></div>
        <div class="pf-metric"><span class="pf-metric-num">{countsFailed() ? "—" : openTotal()}</span><span class="pf-metric-lbl">Open tickets</span></div>
        <div class="pf-metric"><span class="pf-metric-num">{withDeadline()}</span><span class="pf-metric-lbl">Carrying a deadline</span></div>
        <Show when={nextDeadline()} fallback={<div class="pf-metric"><span class="pf-metric-num">—</span><span class="pf-metric-lbl">Next deadline</span></div>}>{next=>{
          const target=()=>({view:"Projects",entityType:"project",entityId:next().id});
          return <a class="pf-metric pf-metric-link" href={linkProps(target()).href} onClick={event=>{linkProps(target()).onClick(event);setProjectId(next().id);}}>
            <span class="pf-metric-num sm">{next().deadline}</span><span class="pf-metric-lbl">Next: {next().name}</span>
          </a>;
        }}</Show>
      </div>
    </Show>
    {/* NOTHING YET vs FILTERED: this list has no filters at all, so an empty
        result can only be an empty workspace — the only honest offer is creation,
        and it opens the same drawer the header primary opens. */}
    <Show when={!items.loading && !items()?.length}>
      <EmptyState
        title="No projects yet"
        hint="A project carries the tickets, boards, tasks and documents of one piece of work."
        actions={<button type="button" class="primary" onClick={()=>setCreateOpen(true)}>New project</button>}
      />
    </Show>
    <ul class="project-cards"><For each={items()}>{project=>{
      const open=(event:MouseEvent)=>{
        // The whole card selects the project — except where a real control lives
        // (deadline field, archive button, the per-project links).
        if((event.target as HTMLElement).closest("input,button,a,label")) return;
        const props=linkProps({view:"Projects",entityType:"project",entityId:project.id});
        props.onClick(event as unknown as MouseEvent & { currentTarget: HTMLAnchorElement });
        setProjectId(project.id);
      };
      return <li classList={{ "project-card":true, archived:project.archived, active:openId()===project.id }}
            role="button" tabindex="0" aria-pressed={openId()===project.id}
            onClick={open}
            onKeyDown={event=>{ if(event.key==="Enter"||event.key===" "){ event.preventDefault(); open(event as unknown as MouseEvent); } }}>
        {/* LAW: lead is PURELY INFORMATIONAL — a name on a card, read-only here, and it
            gates nothing. Editing it lives in Project settings (owner-or-admin). */}
        <div class="project-card-head"><strong>{project.name}</strong><code>{project.key}</code><Show when={project.lead_id}>{lead => <span class="project-lead-chip" title="Project lead (informational)">Lead: {leadName(lead())}</span>}</Show></div>
        <Show when={project.description}><p>{project.description}</p></Show>
        <Show when={!counts.loading && !countsFailed()}>
          <p class="pf-open"><b>{openCount(project.id)}</b> open tickets</p>
        </Show>
        <div class="project-card-foot">
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
                onChange={e=>void writeDeadline(project, e.currentTarget.value || null)}
              /></label>
              <Show when={project.deadline}>
                <button
                  class="ghost"
                  aria-label={`Clear deadline for ${project.name}`}
                  disabled={deadlineStatus(project.id)?.status === "saving"}
                  onClick={()=>void writeDeadline(project, null)}
                >Clear</button>
              </Show>
            </Show>
            <Show when={deadlineStatus(project.id)?.status === "saving"}><span class="hint" role="status">Saving deadline…</span></Show>
            <Show when={deadlineStatus(project.id)?.status === "saved"}><span class="hint" role="status">Deadline saved</span></Show>
            <Show when={deadlineStatus(project.id)?.status === "failed"}><span class="error" role="alert">{deadlineStatus(project.id)?.message}</span></Show>
          </div>
          {/* L4: three bare teal text links were not readable as buttons, and
              Archive must never wear the action colour. All three are ghost pills. */}
          <div class="row-actions"><GhostPill {...linkProps({view:"Project Tasks",projectId:project.id})}>Tasks</GhostPill><GhostPill {...linkProps({view:"Calendar",projectId:project.id})}>Calendar</GhostPill><GhostPill onClick={()=>void update(project,{archived:!project.archived})}>{project.archived ? "Restore" : "Archive"}</GhostPill></div>
        </div>
      </li>;
    }}</For></ul>
    <Show when={route().entityId && !openProject()}><p class="error" role="alert">This project does not exist or is unavailable.</p></Show><Show when={openProject()}>{project=>
      <section class="project-open">
        <header class="project-open-head"><h2>{project().name}<code>{project().key}</code></h2><GhostPill {...linkProps({view:"Project Tasks",projectId:project().id})}>Tasks</GhostPill><GhostPill {...linkProps({view:"Calendar",projectId:project().id})}>Calendar</GhostPill></header>
        {/* THE DOUBLE HEADING (audit §3.5): the panel above has just named this
            project, so the board mounted under it is a GUEST — no second h1, no
            picker for a scope this surface already decided. */}
        <EmbeddedScopeProvider scope={{ host: project().name, projectId: project().id }}>
          <Boards/>
        </EmbeddedScopeProvider>
        <ProjectRoles projectId={project().id}/>
      </section>
    }</Show>
  </section>;
}
