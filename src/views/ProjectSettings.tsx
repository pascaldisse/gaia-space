import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"; import { platformApi } from "../api/platform"; import { personalApi } from "../api/personal"; import { currentUser, humanError, profileId, profiles, projects, reloadProfiles, reloadProjects, setProjectId } from "../session"; import { navigate, route } from "../router";

/** Who is on this project. Membership is what makes somebody assignable, so it
 *  has to be editable here — otherwise a project is stuck with its creator. */
function ProjectMembers(props:{projectId:string; owner:string|null; allowed:boolean}){
  const [error,setError]=createSignal("");
  const [members,{mutate,refetch}]=createResource(()=>props.projectId,id=>id?personalApi.projectMemberIds(id):Promise.resolve([]));
  if(!profiles()) void reloadProfiles().catch(()=>undefined);
  const nameOf=(id:string)=>{const p=profiles()?.find(x=>x.id===id);return p?(p.display_name||p.username):id;};
  const candidates=()=>(profiles()??[]).filter(p=>!p.archived&&!(members()??[]).includes(p.id));
  const add=async(id:string)=>{ if(!id) return; try{ mutate(await personalApi.addProjectMember(props.projectId,id)); }catch(e){ setError(humanError(e)); void refetch(); } };
  const remove=async(id:string)=>{ try{ mutate(await personalApi.removeProjectMember(props.projectId,id)); }catch(e){ setError(humanError(e)); void refetch(); } };
  return <section><h2>Members</h2><p class="hint">Only members of a project can be assigned to its issues and tasks.</p>
    <Show when={error()}><p class="error" role="alert">{error()}</p></Show>
    <Show when={members()?.length} fallback={<p class="hint">Nobody is on this project yet.</p>}>
      <ul class="assignee-chips"><For each={members()}>{id=>
        <li class="assignee-chip">{nameOf(id)}<Show when={props.allowed&&id!==props.owner}><button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={()=>void remove(id)}>×</button></Show></li>
      }</For></ul>
    </Show>
    <Show when={props.allowed}>
      <label>Add a member<select value="" aria-label="Add project member" onChange={e=>{const id=e.currentTarget.value;e.currentTarget.value="";void add(id);}}>
        <option value="">Add somebody…</option>
        <For each={candidates()}>{p=><option value={p.id}>{p.display_name||p.username}</option>}</For>
      </select></label>
    </Show>
  </section>;
}
export default function ProjectSettings(){const id=()=>route().projectId??"";const project=createMemo(()=>projects()?.find(x=>x.id===id()));const [name,setName]=createSignal(""),[description,setDescription]=createSignal(""),[deadline,setDeadline]=createSignal(""),[error,setError]=createSignal(""),[busy,setBusy]=createSignal(false),[confirm,setConfirm]=createSignal(false);createEffect(()=>{const p=project();setName(p?.name??"");setDescription(p?.description??"");setDeadline(p?.deadline??"")});const allowed=()=>!!project()&&(currentUser()?.role==="admin"||project()!.created_by===profileId());const save=async()=>{const p=project();if(!p||!allowed())return;try{if(!name().trim())throw Error("A project needs a name.");setBusy(true);await platformApi.updateProject({...p,name:name().trim(),description:description().trim()||null,deadline:deadline()||null});await reloadProjects()}catch(e){setError(humanError(e))}finally{setBusy(false)}};const archive=async()=>{const p=project();if(!p||!allowed())return;try{setBusy(true);await platformApi.updateProject({...p,archived:true});setProjectId("");navigate("Projects")}catch(e){setError(humanError(e))}finally{setBusy(false)}};return <section class="resource-view"><header><h1>Project settings</h1><p>{project()?.name??"Project unavailable"}</p></header><Show when={!project()}><p class="error" role="alert">This project does not exist or is unavailable.</p></Show><Show when={project()}><Show when={error()}><p class="error" role="alert">{error()}</p></Show><Show when={!allowed()}><p class="hint" role="status">Only the project owner or an administrator can change these settings.</p></Show><label>Name<input disabled={!allowed()} value={name()} onInput={e=>setName(e.currentTarget.value)}/></label><label>Description<textarea disabled={!allowed()} value={description()} onInput={e=>setDescription(e.currentTarget.value)}/></label><label>Deadline<input disabled={!allowed()} type="date" value={deadline()} onInput={e=>setDeadline(e.currentTarget.value)}/></label><p>Key: <code>{project()!.key}</code></p><button class="primary" disabled={!allowed()||busy()} onClick={save}>Save changes</button><ProjectMembers projectId={id()} owner={project()!.created_by} allowed={allowed()}/><Show when={allowed()}><section><h2>Archive project</h2><p>It remains recoverable; nothing is deleted.</p><Show when={confirm()} fallback={<button onClick={()=>setConfirm(true)}>Archive project</button>}><button disabled={busy()} class="danger" onClick={archive}>Confirm archive</button></Show></section></Show></Show></section>}
