import { createResource, createSignal, createEffect, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "./Todo.css";
import { ProfilePicker } from "../components/Pickers";
import { ProjectControl, DueDateControl, AssigneeControl } from "../components/TaskMeta";
import { profileId, profiles, reloadProfiles, projects, reloadProjects } from "../session";
import { humanError } from "../session";
import { requestedTodo, requestTodo } from "../nav";

const blank = () => ({ content:"", due_date:"", source_entity_type:"", source_entity_id:"", project_id:"", assignee_ids:[] as string[] });
export default function Todo() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  const [form,setForm]=createSignal(blank()); const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(profileId,id=>id?personalApi.todos(id,true):Promise.resolve([]));
  // Deep-link focus: when Overview asks for a specific task, scroll it into view
  // and flag it briefly once the list has rendered. Clear the request after use.
  const [focused,setFocused]=createSignal<string|undefined>();
  createEffect(()=>{ const id=requestedTodo(); const list=todos(); if(!id||!list) return; if(!list.some(t=>t.id===id)){ requestTodo(undefined); return; } requestTodo(undefined); setFocused(id); requestAnimationFrame(()=>{ const el=document.querySelector(`[data-todo-id="${id}"]`); el?.scrollIntoView({behavior:"smooth",block:"center"}); }); setTimeout(()=>setFocused(f=>f===id?undefined:f),2400); });
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const openProjects=()=>projects()?.filter(p=>!p.archived)??[];
  const projectName=(id:string|null)=>{ if(!id) return ""; const p=projects()?.find(x=>x.id===id); return p?p.name:id; };
  const addAssignee=(id:string)=>{ if(!id) return; const f=form(); if(f.assignee_ids.includes(id)) return; setForm({...f,assignee_ids:[...f.assignee_ids,id]}); };
  const removeAssignee=(id:string)=>{ const f=form(); setForm({...f,assignee_ids:f.assignee_ids.filter(x=>x!==id)}); };
  const save=async(e:SubmitEvent)=>{ e.preventDefault(); try { if(!profileId().trim()||!form().content.trim()) throw new Error("Pick a profile and enter task content."); const f=form(); if(Boolean(f.source_entity_type)!==Boolean(f.source_entity_id)) throw new Error("Source type and source ID must be supplied together."); await personalApi.createTodo({profile_id:profileId().trim(),content:f.content.trim(),due_date:f.due_date||null,done:false,source_entity_type:f.source_entity_type||null,source_entity_id:f.source_entity_id||null,project_id:f.project_id||null,assignee_ids:f.assignee_ids}); setForm(blank()); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const update=async(todo:TodoItem, patch:Partial<TodoItem>)=>{ try { await personalApi.updateTodo({...todo,...patch}); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const canSubmit=()=>Boolean(profileId().trim()&&form().content.trim());
  return <section class="personal-view todo-view"><header><div><h1>My tasks</h1><p>Personal tasks with optional bookmarks back to Space entities.</p></div><ProfilePicker/></header><Show when={error()}><p class="personal-error">{error()}</p></Show>

    <form class="task-composer" onSubmit={save}>
      <input class="composer-title" autofocus placeholder="What needs doing?" aria-label="Task title" value={form().content} onInput={e=>setForm({...form(),content:e.currentTarget.value})}/>
      <div class="composer-meta">
        <ProjectControl value={form().project_id} projects={openProjects().map(p=>({id:p.id,name:p.name,key:p.key}))} onChange={id=>setForm({...form(),project_id:id})}/>
        <DueDateControl value={form().due_date} onChange={iso=>setForm({...form(),due_date:iso})}/>
        <AssigneeControl value={form().assignee_ids} people={active().map(p=>({id:p.id,label:p.display_name||p.username,sub:`@${p.username}`}))} onToggle={id=>form().assignee_ids.includes(id)?removeAssignee(id):addAssignee(id)}/>
      </div>
      <div class="composer-actions"><button class="primary composer-submit" disabled={!canSubmit()}>Add task</button></div>
      <details class="composer-source"><summary>Source bookmark</summary><div class="composer-source-fields"><label class="todo-field"><span class="field-label">Entity type</span><input placeholder="issue, document…" value={form().source_entity_type} onInput={e=>setForm({...form(),source_entity_type:e.currentTarget.value})}/></label><label class="todo-field"><span class="field-label">Entity ID</span><input placeholder="Entity ID" value={form().source_entity_id} onInput={e=>setForm({...form(),source_entity_id:e.currentTarget.value})}/></label></div></details>
    </form>

    <div class="task-list"><Show when={!profileId()}><p class="personal-empty">No profile selected — add one in Members.</p></Show>
      <For each={todos()}>{todo=><article data-todo-id={todo.id} classList={{"task-card":true,done:todo.done,focused:focused()===todo.id}}>
        <input class="task-check" aria-label={`Mark ${todo.content} done`} type="checkbox" checked={todo.done} onChange={e=>update(todo,{done:e.currentTarget.checked})}/>
        <div class="task-body">
          <strong class="task-title">{todo.content}</strong>
          <div class="task-meta">
            <Show when={todo.due_date}><span class="task-tag due"><span aria-hidden="true">◷</span> {todo.due_date}</span></Show>
            <Show when={todo.project_id}><span class="task-tag project"><span aria-hidden="true">▦</span> {projectName(todo.project_id)}</span></Show>
            <Show when={todo.source_entity_type}><span class="task-tag source">{todo.source_entity_type}: {todo.source_entity_id}</span></Show>
            <For each={todo.assignee_ids}>{id=><span class="task-tag assignee">{nameOf(id)}</span>}</For>
          </div>
          <label class="task-project-edit"><span class="field-label">Project</span><select value={todo.project_id??""} onChange={e=>update(todo,{project_id:e.currentTarget.value||null})}><option value="">No project — personal</option><For each={openProjects()}>{p=><option value={p.id}>{p.name}</option>}</For></select></label>
        </div>
        <button class="ghost task-delete" title="Delete task" onClick={async()=>{try{await personalApi.deleteTodo(todo.id);refetch()}catch(reason){setError(humanError(reason))}}}>×</button>
      </article>}</For>
    </div>
  </section>;
}
