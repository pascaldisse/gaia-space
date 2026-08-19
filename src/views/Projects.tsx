import { createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type Project } from "../api/platform";
import { humanError, profileId, setProjectId } from "../session";
import { linkProps } from "../router";

const newId = () => `project-${crypto.randomUUID()}`;
const empty = () => ({ name: "", key: "", description: "", deadline: "" });
export default function Projects() {
  const [form, setForm] = createSignal(empty()); const [error, setError] = createSignal("");
  const [items, { refetch }] = createResource(platformApi.projects);
  const save = async (event: SubmitEvent) => {
    event.preventDefault(); const input = form();
    try {
      if (!input.name.trim() || !input.key.trim()) throw new Error("Project name and key are required.");
      await platformApi.createProject({ id:newId(), name:input.name.trim(), key:input.key.trim().toUpperCase(), description:input.description.trim() || null, deadline:input.deadline || null, created_by:profileId() || null, archived:false });
      setForm(empty()); await refetch();
    } catch (reason) { setError(humanError(reason)); }
  };
  const update = async (project: Project, patch: Partial<Project>) => { try { await platformApi.updateProject({ ...project, ...patch }); await refetch(); } catch (reason) { setError(humanError(reason)); } };
  return <section class="resource-view"><header><h1>Projects</h1><p>Owned workspaces with deadlines and an archive you can reverse.</p></header><Show when={error()}><p class="error" role="alert">{error()}</p></Show><form class="project-form" onSubmit={save}><input placeholder="Project name" value={form().name} onInput={e=>setForm({...form(),name:e.currentTarget.value})}/><input placeholder="KEY" value={form().key} onInput={e=>setForm({...form(),key:e.currentTarget.value})}/><input type="date" aria-label="Project deadline" value={form().deadline} onInput={e=>setForm({...form(),deadline:e.currentTarget.value})}/><button class="primary">Create project</button></form><ul class="resource-list"><For each={items()}>{project=><li classList={{ archived:project.archived }}><a class="row-link" {...linkProps({view:"Projects",entityType:"project",entityId:project.id})} onClick={event=>{ const props=linkProps({view:"Projects",entityType:"project",entityId:project.id}); props.onClick(event); setProjectId(project.id); }}><strong>{project.name}</strong><code>{project.key}</code></a><p>{project.description}</p><label>Deadline <input type="date" value={project.deadline ?? ""} onChange={e=>void update(project,{deadline:e.currentTarget.value || null})}/></label><div class="row-actions"><a {...linkProps({view:"Project Tasks",projectId:project.id})}>Tasks</a><a {...linkProps({view:"Calendar",projectId:project.id})}>Calendar</a><button class="ghost" onClick={()=>void update(project,{archived:!project.archived})}>{project.archived ? "Restore" : "Archive"}</button></div></li>}</For></ul></section>;
}
