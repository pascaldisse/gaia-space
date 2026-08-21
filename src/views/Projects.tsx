import { createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type Project } from "../api/platform";
import { currentUser, humanError, isWeb, profileId, projectId as sessionProject, setProjectId } from "../session";
import { linkProps, navigate, route } from "../router";
import Boards from "./Boards";
import "./Projects.css";

const newId = () => `project-${crypto.randomUUID()}`;
const empty = () => ({ name: "", key: "", description: "", deadline: "" });
export default function Projects() {
  // One destination: the project list IS the entry point, and an opened project
  // shows its boards (whose cards are its issues). No separate Issues/Boards tabs.
  const [form, setForm] = createSignal(empty()); const [error, setError] = createSignal("");
  const [items, { refetch }] = createResource(platformApi.projects);
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
      setForm(empty()); await refetch(); setProjectId(id); navigate({ view: "Project Steering", projectId: id });
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
  return <section class="resource-view projects-view"><header><h1>Projects</h1><p>Owned workspaces with deadlines and an archive you can reverse.</p></header><Show when={error()}><p class="error" role="alert">{error()}</p></Show><form class="project-form" onSubmit={save}><input placeholder="Project name" value={form().name} onInput={e=>setForm({...form(),name:e.currentTarget.value})}/><input placeholder="KEY" value={form().key} onInput={e=>setForm({...form(),key:e.currentTarget.value})}/><input type="date" aria-label="Project deadline" value={form().deadline} onInput={e=>setForm({...form(),deadline:e.currentTarget.value})}/><button class="primary">Create project</button></form><ul class="project-cards"><For each={items()}>{project=>{
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
