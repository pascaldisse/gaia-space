import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "./Todo.css";
import "./work.css";
import { profiles, projectId, projects, reloadProfiles, reloadProjects, humanError } from "../session";

// Project → Work → Tasks: the everyday action surface. Personal tasks filed
// under the active project — the things an owner does next. This is a
// read-and-triage feed; it never touches Issues or the Board. Ownership/assignees
// stay intact — you can only tick a task done or unfile it from the project here.
export default function ProjectTasks() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(projectId,id=>id?personalApi.projectTodos(id,true):Promise.resolve([]));
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const ownerOf=(id:string)=>nameOf(id);
  const project=()=>projects()?.find(p=>p.id===projectId());
  const projectName=()=>project()?.name;
  const mark=()=>(project()?.key ?? "··").slice(0,2).toUpperCase();
  const open=()=>todos()?.filter(t=>!t.done)??[];
  const done=()=>todos()?.filter(t=>t.done)??[];
  const update=async(todo:TodoItem, patch:Partial<TodoItem>)=>{ try { await personalApi.updateTodo({...todo,...patch}); refetch(); } catch(reason) { setError(humanError(reason)); } };

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
          <p>Nothing is filed under {projectName()??"this project"}. Add a task from My tasks and pick this project to make it show up here.</p>
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
