import { createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type Project } from "../api/platform";
import { humanError, profileId, setProjectId } from "../session";
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
      const id=newId(); await platformApi.createProject({ id, name:input.name.trim(), key:input.key.trim().toUpperCase(), description:input.description.trim() || null, deadline:input.deadline || null, created_by:profileId() || null, archived:false });
      setForm(empty()); await refetch(); setProjectId(id); navigate({view:"Project Steering",projectId:id});
    } catch (reason) { setError(humanError(reason)); }
  };
  const update = async (project: Project, patch: Partial<Project>) => { try { await platformApi.updateProject({ ...project, ...patch }); await refetch(); } catch (reason) { setError(humanError(reason)); } };
  const openId = () => route().entityId;
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
          <label>Deadline <input type="date" value={project.deadline ?? ""} onChange={e=>void update(project,{deadline:e.currentTarget.value || null})}/></label>
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
