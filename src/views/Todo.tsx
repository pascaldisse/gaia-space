import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "./Todo.css";
import { ProfilePicker } from "../components/Pickers";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { profileId, profiles, reloadProfiles, projects, reloadProjects } from "../session";
import { humanError } from "../session";

const blank = () => ({ content:"", due_date:"", project_id:"", source_entity_type:"", source_entity_id:"", assignee_ids:[] as string[] });
export default function Todo() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  const [form,setForm]=createSignal(blank()); const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(profileId,id=>id?personalApi.todos(id,true):Promise.resolve([]));
  const [projectMembers]=createResource(()=>form().project_id,id=>id?personalApi.projectMemberIds(id):Promise.resolve([]));
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const projectName=(id:string)=>projects()?.find(project=>project.id===id)?.name??id;
  const personalTodos=()=>todos()?.filter(todo=>!todo.project_id)??[];
  const groupedTodos=()=>todos()?.filter(todo=>todo.project_id)??[];
  const addAssignee=(id:string)=>{ if(!id || !form().project_id) return; const f=form(); if(f.assignee_ids.includes(id)) return; setForm({...f,assignee_ids:[...f.assignee_ids,id]}); };
  const removeAssignee=(id:string)=>{ const f=form(); setForm({...f,assignee_ids:f.assignee_ids.filter(x=>x!==id)}); };
  const selectProject=(id:string)=>setForm({...form(),project_id:id,assignee_ids:id?form().assignee_ids:[]});
  const save=async(e:SubmitEvent)=>{ e.preventDefault(); try { if(!profileId().trim()||!form().content.trim()) throw new Error("Pick a profile and enter task content."); const f=form(); if(Boolean(f.source_entity_type)!==Boolean(f.source_entity_id)) throw new Error("Source type and source ID must be supplied together."); await personalApi.createTodo({profile_id:profileId().trim(),content:f.content.trim(),due_date:f.due_date||null,project_id:f.project_id||null,done:false,source_entity_type:f.source_entity_type||null,source_entity_id:f.source_entity_id||null,assignee_ids:f.assignee_ids}); setForm(blank()); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const complete=async(todo:TodoItem, done:boolean)=>{ try { await personalApi.setTodoCompletion(todo.id,done); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const today=()=>new Date().toISOString().slice(0,10);
  const inDays=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
  const openTodos=()=>todos()?.filter(todo=>!todo.done)??[];
  const overdue=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date<today());
  const dueSoon=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date>=today()&&todo.due_date<=inDays(7));
  const doneCount=()=>todos()?.filter(todo=>todo.done).length??0;
  const attention=()=>[...overdue(),...dueSoon()].sort((a,b)=>(a.due_date??"").localeCompare(b.due_date??"")).slice(0,5);
  const todoRow=(todo:TodoItem)=><article classList={{"task-card":true,done:todo.done}}>
    <input class="task-check" aria-label={`Mark ${todo.content} done`} type="checkbox" checked={todo.done} onChange={e=>complete(todo,e.currentTarget.checked)}/>
    <div class="task-body">
      <span class="task-title">{todo.content}</span>
      <Show when={todo.due_date||todo.project_id||todo.assignee_ids.length||todo.source_entity_type}>
        <div class="task-meta">
          <Show when={todo.due_date}>{date=><span class="task-tag due">{date()}</span>}</Show>
          <Show when={todo.project_id}>{id=><span class="task-tag project">{projectName(id())}</span>}</Show>
          <For each={todo.assignee_ids}>{id=><span class="task-tag assignee">{nameOf(id)}</span>}</For>
          <Show when={todo.source_entity_type}><span class="task-tag source">{todo.source_entity_type}: {todo.source_entity_id}</span></Show>
        </div>
      </Show>
    </div>
    <button class="ghost task-delete" title="Delete task" aria-label={`Delete ${todo.content}`} onClick={async()=>{try{await personalApi.deleteTodo(todo.id);refetch()}catch(reason){setError(humanError(reason))}}}>×</button>
  </article>;
  return <section class="personal-view todo-view">
    <WorkspaceHeader icon="check" title="My tasks" actions={<ProfilePicker locked/>}>Personal tasks and project work, scoped to the people attached to each project.</WorkspaceHeader>
    <Show when={error()}><p class="personal-error">{error()}</p></Show>
    <div class="view-cols todo-cols">
      <div class="view-main">
        <form class="task-composer" onSubmit={save}>
          <div class="composer-head"><span class="composer-head-label">New task</span></div>
          <input class="composer-title" autofocus placeholder="What needs doing?" value={form().content} onInput={e=>setForm({...form(),content:e.currentTarget.value})}/>
          <div class="composer-meta">
            <label class="todo-field"><span class="field-label">Project</span><select value={form().project_id} onChange={e=>selectProject(e.currentTarget.value)}><option value="">No project — personal</option><For each={(projects()??[]).filter(project=>!project.archived)}>{project=><option value={project.id}>{project.name}</option>}</For></select></label>
            <label class="todo-field"><span class="field-label">Due date</span><input type="date" value={form().due_date} onInput={e=>setForm({...form(),due_date:e.currentTarget.value})}/></label>
            <label class="todo-field"><span class="field-label">Assignees</span><select value="" disabled={!form().project_id} title={!form().project_id?"Select a project before assigning members":undefined} onChange={e=>{addAssignee(e.currentTarget.value);e.currentTarget.value="";}}><option value="">{form().project_id?"Add project member…":"Unassigned"}</option><For each={active().filter(p=>(projectMembers()??[]).includes(p.id)&&!form().assignee_ids.includes(p.id))}>{p=><option value={p.id}>{p.display_name||p.username}</option>}</For></select></label>
          </div>
          <Show when={form().project_id&&!projectMembers.loading&&!projectMembers()?.length}><p class="hint">This project has no members available for assignment.</p></Show>
          <Show when={form().assignee_ids.length}><ul class="assignee-chips"><For each={form().assignee_ids}>{id=><li class="assignee-chip">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={()=>removeAssignee(id)}>×</button></li>}</For></ul></Show>
          <details class="composer-source"><summary>Source bookmark</summary><div class="composer-source-fields"><input placeholder="Entity type (issue, document…)" value={form().source_entity_type} onInput={e=>setForm({...form(),source_entity_type:e.currentTarget.value})}/><input placeholder="Entity ID" value={form().source_entity_id} onInput={e=>setForm({...form(),source_entity_id:e.currentTarget.value})}/></div></details>
          <div class="composer-actions"><button class="primary composer-submit">Add task</button></div>
        </form>
        <Show when={!profileId()}><p class="personal-empty">No profile selected — add one in Members.</p></Show>
        <section class="task-list">
          <Show when={!personalTodos().length}><p class="personal-empty">No personal tasks.</p></Show>
          <For each={personalTodos()}>{todoRow}</For>
        </section>
        <Show when={groupedTodos().length}>
          <section class="task-list"><For each={groupedTodos()}>{todoRow}</For></section>
        </Show>
      </div>
      <aside class="view-rail todo-rail">
        <div class="rail-card">
          <h3>At a glance</h3>
          <div class="rail-metrics">
            <div class="rail-metric accent"><span class="rail-num">{openTodos().length}</span><span class="rail-lbl">Open</span></div>
            <div class="rail-metric warn"><span class="rail-num">{overdue().length}</span><span class="rail-lbl">Overdue</span></div>
            <div class="rail-metric"><span class="rail-num">{dueSoon().length}</span><span class="rail-lbl">Due in 7 days</span></div>
            <div class="rail-metric"><span class="rail-num">{doneCount()}</span><span class="rail-lbl">Done</span></div>
          </div>
        </div>
        <div class="rail-card">
          <h3>Needs attention<span class="rail-count">{attention().length}</span></h3>
          <Show when={attention().length} fallback={<p class="rail-empty">Nothing due in the next seven days.</p>}>
            <div class="rail-rows">
              <For each={attention()}>{todo=><div class="rail-item"><span class="rail-item-title">{todo.content}</span><span class="rail-item-sub">Due {todo.due_date}</span></div>}</For>
            </div>
          </Show>
        </div>
      </aside>
    </div>
  </section>;
}
