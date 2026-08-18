import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "./Todo.css";
import "./work.css";
import { DueDateControl, AssigneeControl } from "../components/TaskMeta";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { profileId, profiles, projectId, projects, reloadProfiles, reloadProjects, humanError } from "../session";

// Project → Work → Tasks: the everyday action surface. Personal tasks filed
// under the active project — the things an owner does next. You create tasks
// straight onto this project (the project is fixed, never a free choice), then
// triage: tick done or unfile. It never touches Issues or the Board.
const blankDraft = () => ({ content:"", due_date:"", assignee_ids:[] as string[] });
export default function ProjectTasks() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(projectId,id=>id?personalApi.projectTodos(id,true):Promise.resolve([]));
  const [draft,setDraft]=createSignal(blankDraft());
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const ownerOf=(id:string)=>nameOf(id);
  const project=()=>projects()?.find(p=>p.id===projectId());
  const projectName=()=>project()?.name;
  const mark=()=>(project()?.key ?? "··").slice(0,2).toUpperCase();
  const open=()=>todos()?.filter(t=>!t.done)??[];
  const done=()=>todos()?.filter(t=>t.done)??[];
  const update=async(todo:TodoItem, patch:Partial<TodoItem>)=>{ try { await personalApi.updateTodo({...todo,...patch}); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const toggleAssignee=(id:string)=>{ const d=draft(); setDraft({...d,assignee_ids:d.assignee_ids.includes(id)?d.assignee_ids.filter(x=>x!==id):[...d.assignee_ids,id]}); };
  // The project is always the active project — it is never part of the form and
  // cannot be changed here, so a task can't slip onto the wrong project.
  const canAdd=()=>Boolean(projectId()&&profileId().trim()&&draft().content.trim());
  const add=async(e:SubmitEvent)=>{ e.preventDefault(); const pid=projectId(); if(!pid||!profileId().trim()||!draft().content.trim()) return; const d=draft(); try { await personalApi.createTodo({profile_id:profileId().trim(),content:d.content.trim(),due_date:d.due_date||null,done:false,source_entity_type:null,source_entity_id:null,project_id:pid,assignee_ids:d.assignee_ids}); setDraft(blankDraft()); refetch(); } catch(reason) { setError(humanError(reason)); } };

  const taskCard=(todo:TodoItem)=><article classList={{"task-card":true,done:todo.done}}>
    <input class="task-check" aria-label={`Mark ${todo.content} done`} type="checkbox" checked={todo.done} onChange={e=>update(todo,{done:e.currentTarget.checked})}/>
    <div class="task-body">
      <span class="task-title">{todo.content}</span>
      <div class="task-meta">
        <span class="task-tag assignee">Owner: {ownerOf(todo.profile_id)}</span>
        <Show when={todo.due_date}><span class="task-tag due">Due {todo.due_date}</span></Show>
        <For each={todo.assignee_ids}>{id=><span class="task-tag assignee">{nameOf(id)}</span>}</For>
      </div>
    </div>
    <button class="ghost task-delete" title="Remove from project" aria-label={`Remove ${todo.content} from project`} onClick={()=>update(todo,{project_id:null})}>Unfile</button>
  </article>;

  return <section class="personal-view todo-view">
    <header class="wk-head">
      <div class="wk-title">
        <div class="wk-mark">{mark()}</div>
        <div>
          <h1>Tasks</h1>
          <p>Your everyday to-dos for {projectName()??"this project"} — the things you do next. Issues and the board are unaffected.</p>
        </div>
      </div>
    </header>

    <Show when={error()}><p class="personal-error">{error()}</p></Show>

    <Show when={projectId()}>
      <form class="task-composer" onSubmit={add}>
        <input class="composer-title" placeholder="What needs doing for this project?" aria-label="Task title" value={draft().content} onInput={e=>setDraft({...draft(),content:e.currentTarget.value})}/>
        <div class="composer-meta">
          <div class="tm"><div class="tm-trigger tm-fixed" aria-label={`Project: ${projectName()??"active project"} (fixed)`}>
            <span class="tm-icon" aria-hidden="true"><Icon name="grid" size={16}/></span>
            <span class="tm-text"><span class="tm-label">Project</span><span class="tm-value">{projectName()??"Active project"}</span></span>
            <span class="tm-fixed-badge" aria-hidden="true"><Avatar class="tm-opt-badge" variant="project" name={projectName()??""}/></span>
          </div></div>
          <DueDateControl value={draft().due_date} onChange={iso=>setDraft({...draft(),due_date:iso})}/>
          <AssigneeControl value={draft().assignee_ids} people={active().map(p=>({id:p.id,label:p.display_name||p.username,sub:`@${p.username}`}))} onToggle={toggleAssignee}/>
        </div>
        <div class="composer-actions"><button class="primary composer-submit" disabled={!canAdd()}>Add to {projectName()??"project"}</button></div>
      </form>
    </Show>

    <Show when={!projectId()}>
      <div class="wk-empty">
        <div class="wk-empty-mark">✓</div>
        <h2>No project selected</h2>
        <p>Choose a project from the switcher above to see the tasks filed under it.</p>
      </div>
    </Show>

    <Show when={projectId()}>
      <Show when={todos.loading}><p class="wk-muted">Loading tasks…</p></Show>
      <Show when={!todos.loading && !todos()?.length}>
        <div class="wk-empty">
          <div class="wk-empty-mark">✓</div>
          <h2>No tasks here yet</h2>
          <p>Nothing is filed under {projectName()??"this project"} yet. Add your first one above — it lands straight on this project.</p>
        </div>
      </Show>

      <Show when={open().length}>
        <div class="task-list"><For each={open()}>{taskCard}</For></div>
      </Show>
      <Show when={done().length}>
        <details class="wk-done-group">
          <summary>{done().length} done</summary>
          <div class="task-list"><For each={done()}>{taskCard}</For></div>
        </details>
      </Show>
    </Show>
  </section>;
}
