import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type Project } from "../api/platform";
import { planningApi } from "../api/issues";
import { currentUser, humanError, isWeb, profileId, projectId as sessionProject, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import Boards from "./Boards";
import ProjectHome from "./ProjectHome";
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
export default function Projects() {
  // One destination: the project list IS the entry point, and an opened project
  // shows its boards (whose cards are its issues). No separate Issues/Boards tabs.
  const [form, setForm] = createSignal(empty()); const [error, setError] = createSignal("");
  const [keyTouched, setKeyTouched] = createSignal(false);
  const [items, { refetch }] = createResource(platformApi.projects);
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
      setForm(empty()); setKeyTouched(false); await refetch(); setProjectId(id); navigate({ view: "Project Steering", projectId: id });
    } catch (reason) { setError(humanError(reason)); }
  };
  const update = async (project: Project, patch: Partial<Project>) => { try { await platformApi.updateProject({ ...project, ...patch }); await refetch(); } catch (reason) { setError(humanError(reason)); } };
  // Who may move a deadline is the server's verdict; the UI merely stops offering a
  // control that would be refused. Desktop has no session, so the locally selected
  // profile is the identity there — the same rule the desktop authorizer applies.
  const actor = () => (isWeb() ? currentUser()?.profile_id ?? "" : profileId());
  const mayEditDeadline = (project: Project) =>
    (isWeb() && currentUser()?.role === "admin") || (!!actor() && project.created_by === actor());
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
  return <section class="resource-view projects-view"><header><h1>Projects</h1><p>Owned workspaces with deadlines and an archive you can reverse.</p></header><Show when={error()}><p class="error" role="alert">{error()}</p></Show><form class="project-form" onSubmit={save}><input placeholder="Project name" aria-label="Project name" value={form().name} onInput={e=>{const name=e.currentTarget.value;setForm({...form(),name,key:keyTouched()?form().key:deriveKey(name)});}}/><input placeholder="KEY" aria-label="Project key" maxlength="10" value={form().key} onInput={e=>{setKeyTouched(true);setForm({...form(),key:e.currentTarget.value.toUpperCase()});}}/><input placeholder="Description (optional)" aria-label="Project description" value={form().description} onInput={e=>setForm({...form(),description:e.currentTarget.value})}/><input type="date" aria-label="Project deadline" value={form().deadline} onInput={e=>setForm({...form(),deadline:e.currentTarget.value})}/><button class="primary">Create project</button></form>
    <Show when={countsFailed()}>{reason=><p class="error" role="alert">Open-issue counts are unavailable: {reason()}</p>}</Show>
    <Show when={live().length}>
      <div class="pf-summary">
        <div class="pf-metric"><span class="pf-metric-num">{live().length}</span><span class="pf-metric-lbl">Active projects</span></div>
        <div class="pf-metric"><span class="pf-metric-num">{countsFailed() ? "—" : openTotal()}</span><span class="pf-metric-lbl">Open issues</span></div>
        <div class="pf-metric"><span class="pf-metric-num">{withDeadline()}</span><span class="pf-metric-lbl">Carrying a deadline</span></div>
        <Show when={nextDeadline()} fallback={<div class="pf-metric"><span class="pf-metric-num">—</span><span class="pf-metric-lbl">Next deadline</span></div>}>{next=>{
          const target=()=>({view:"Projects",entityType:"project",entityId:next().id});
          return <a class="pf-metric pf-metric-link" href={linkProps(target()).href} onClick={event=>{linkProps(target()).onClick(event);setProjectId(next().id);}}>
            <span class="pf-metric-num sm">{next().deadline}</span><span class="pf-metric-lbl">Next: {next().name}</span>
          </a>;
        }}</Show>
      </div>
    </Show><ul class="project-cards"><For each={items()}>{project=>{
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
        <div class="project-card-head"><strong>{project.name}</strong><code>{project.key}</code></div>
        <Show when={project.description}><p>{project.description}</p></Show>
        <Show when={!counts.loading && !countsFailed()}>
          <p class="pf-open"><b>{openCount(project.id)}</b> open issues</p>
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
          <div class="row-actions"><a {...linkProps({view:"Project Tasks",projectId:project.id})}>Tasks</a><a {...linkProps({view:"Calendar",projectId:project.id})}>Calendar</a><button class="ghost" onClick={()=>void update(project,{archived:!project.archived})}>{project.archived ? "Restore" : "Archive"}</button></div>
        </div>
      </li>;
    }}</For></ul>
    <Show when={route().entityId && !openProject()}><p class="error" role="alert">This project does not exist or is unavailable.</p></Show><Show when={openProject()}>{project=>
      <section class="project-open">
        <header class="project-open-head"><h2>{project().name}<code>{project().key}</code></h2><a {...linkProps({view:"Project Tasks",projectId:project().id})}>Tasks</a><a {...linkProps({view:"Calendar",projectId:project().id})}>Calendar</a></header>
        <Boards/>
      </section>
    }</Show>
  </section>;
}
