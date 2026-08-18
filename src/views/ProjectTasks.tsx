import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "./Todo.css";
import { profiles, projectId, projects, reloadProfiles, reloadProjects, humanError } from "../session";

// Project → Work → Tasks: personal tasks filed under the active project. This is a
// read-and-triage feed; it never touches Issues or Boards. Ownership/assignees stay
// intact — you can only tick a task done or unfile it from the project here.
export default function ProjectTasks() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(projectId,id=>id?personalApi.projectTodos(id,true):Promise.resolve([]));
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const ownerOf=(id:string)=>nameOf(id);
  const projectName=()=>projects()?.find(p=>p.id===projectId())?.name;
  const update=async(todo:TodoItem, patch:Partial<TodoItem>)=>{ try { await personalApi.updateTodo({...todo,...patch}); refetch(); } catch(reason) { setError(humanError(reason)); } };
  return <section class="personal-view"><header><div><h1>Tasks</h1><p>Personal tasks filed under {projectName()??"this project"}. Issues and boards are unaffected.</p></div></header>
    <Show when={error()}><p class="personal-error">{error()}</p></Show>
    <Show when={!projectId()}><p class="personal-empty">Select a project to see its tasks.</p></Show>
    <div class="todo-list">
      <Show when={projectId() && !todos()?.length}><p class="personal-empty">No tasks filed under this project yet. Add one from My tasks and pick this project.</p></Show>
      <For each={todos()}>{todo=><article classList={{"todo-row":true,done:todo.done}}>
        <input aria-label={`Mark ${todo.content} done`} type="checkbox" checked={todo.done} onChange={e=>update(todo,{done:e.currentTarget.checked})}/>
        <div>
          <strong>{todo.content}</strong>
          <small class="todo-owner">Owner: {ownerOf(todo.profile_id)}</small>
          <Show when={todo.due_date}><time>Due {todo.due_date}</time></Show>
          <Show when={todo.assignee_ids.length}><ul class="assignee-chips readonly"><For each={todo.assignee_ids}>{id=><li class="assignee-chip">{nameOf(id)}</li>}</For></ul></Show>
        </div>
        <button class="ghost" title="Remove from project" aria-label={`Remove ${todo.content} from project`} onClick={()=>update(todo,{project_id:null})}>Unfile</button>
      </article>}</For>
    </div>
  </section>;
}
