import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "./Todo.css";
import { ProfilePicker } from "../components/Pickers";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import SourceLink from "../components/SourceLink";
import { AssigneeControl, DueDateControl, ProjectControl } from "../components/TaskMeta";
import { profileId, profiles, reloadProfiles, projects, reloadProjects } from "../session";
import { parseMarkdown } from "../markdownLite";
import { humanError } from "../session";

const blank = () => ({ content:"", notes:"", due_date:"", project_id:"", source_entity_type:"", source_entity_id:"", assignee_ids:[] as string[], content_kind:"text" as "text"|"markdown" });
// Tokens, never HTML: a task body can style itself but can never inject markup.
const markdownBody=(body:string)=><div class="task-markdown"><For each={parseMarkdown(body)}>{block=><p classList={{"task-md-line":true,"task-md-bullet":block.bullet}}><For each={block.tokens}>{token=>token.kind==="strong"?<strong>{token.text}</strong>:token.kind==="em"?<em>{token.text}</em>:token.kind==="code"?<code>{token.text}</code>:<>{token.text}</>}</For></p>}</For></div>;
type MemberLookup = { ids?: string[]; failed?: string };
export default function Todo() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  const [form,setForm]=createSignal(blank()); const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(profileId,id=>id?personalApi.todos(id,true):Promise.resolve([]));
  // A refused member read is carried as a value: the composer must say the list could
  // not be loaded, never quietly offer "nobody" as if the project were empty.
  const loadMembers=async(id:string):Promise<MemberLookup>=>{
    if(!id) return { ids: [] };
    try { return { ids: await personalApi.projectMemberIds(id) }; }
    catch(reason){ return { failed: humanError(reason) }; }
  };
  const [projectMembers]=createResource(()=>form().project_id,loadMembers);
  const idsOf=(value:MemberLookup|undefined)=>value&&"ids" in value?value.ids??[]:[];
  const failedOf=(value:MemberLookup|undefined)=>value&&"failed" in value?value.failed??"":"";
  const memberIds=()=>idsOf(projectMembers());
  const membersFailed=()=>failedOf(projectMembers());
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const projectName=(id:string)=>projects()?.find(project=>project.id===id)?.name??id;
  const addAssignee=(id:string)=>{ if(!id || !form().project_id) return; const f=form(); if(f.assignee_ids.includes(id)) return; setForm({...f,assignee_ids:[...f.assignee_ids,id]}); };
  // A person is on or off this task; the popover stays open so several can be picked.
  const toggleAssignee=(id:string)=>{ form().assignee_ids.includes(id) ? removeAssignee(id) : addAssignee(id); };
  // Assignable people are the project's members: the project decides who may carry
  // its work, and the server refuses anybody else.
  const assignableFrom=(ids:string[])=>active().filter(person=>ids.includes(person.id)).map(person=>({id:person.id,label:person.display_name||person.username,sub:person.username}));
  const assignable=()=>assignableFrom(memberIds());
  const selectableProjects=()=>(projects()??[]).filter(project=>!project.archived).map(project=>({id:project.id,name:project.name,key:project.key}));
  const removeAssignee=(id:string)=>{ const f=form(); setForm({...f,assignee_ids:f.assignee_ids.filter(x=>x!==id)}); };
  const selectProject=(id:string)=>setForm({...form(),project_id:id,assignee_ids:id?form().assignee_ids:[]});
  const save=async(e:SubmitEvent)=>{ e.preventDefault(); try { if(!profileId().trim()||!form().content.trim()) throw new Error("Pick a profile and enter task content."); const f=form(); if(Boolean(f.source_entity_type)!==Boolean(f.source_entity_id)) throw new Error("Source type and source ID must be supplied together."); await personalApi.createTodo({profile_id:profileId().trim(),content:f.content.trim(),due_date:f.due_date||null,project_id:f.project_id||null,done:false,source_entity_type:f.source_entity_type||null,source_entity_id:f.source_entity_id||null,notes:f.notes.trim()||null,assignee_ids:f.assignee_ids,content_kind:f.content_kind}); setForm(blank()); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const complete=async(todo:TodoItem, done:boolean)=>{ try { await personalApi.setTodoCompletion(todo.id,done); refetch(); } catch(reason) { setError(humanError(reason)); } };

  // ── edit an existing task (content/notes/due date/project/assignees/source) ──
  // One row editable at a time, same shape as the composer, reusing its own
  // controls so editing never looks like a second, different UI.
  const [editingId,setEditingId]=createSignal<string|null>(null);
  const [editForm,setEditForm]=createSignal(blank());
  const [editMembers]=createResource(()=>editForm().project_id,loadMembers);
  const editMemberIds=()=>idsOf(editMembers());
  const editMembersFailed=()=>failedOf(editMembers());
  const startEdit=(todo:TodoItem)=>{
    setEditingId(todo.id);
    setEditForm({ content:todo.content, notes:todo.notes??"", due_date:todo.due_date??"", project_id:todo.project_id??"", source_entity_type:todo.source_entity_type??"", source_entity_id:todo.source_entity_id??"", assignee_ids:[...todo.assignee_ids], content_kind:todo.content_kind??"text" });
    setError("");
  };
  const cancelEdit=()=>setEditingId(null);
  const selectEditProject=(id:string)=>setEditForm({...editForm(),project_id:id,assignee_ids:id?editForm().assignee_ids:[]});
  const addEditAssignee=(id:string)=>{ if(!id || !editForm().project_id) return; const f=editForm(); if(f.assignee_ids.includes(id)) return; setEditForm({...f,assignee_ids:[...f.assignee_ids,id]}); };
  const removeEditAssignee=(id:string)=>{ const f=editForm(); setEditForm({...f,assignee_ids:f.assignee_ids.filter(x=>x!==id)}); };
  const toggleEditAssignee=(id:string)=>{ editForm().assignee_ids.includes(id) ? removeEditAssignee(id) : addEditAssignee(id); };
  const saveEdit=async(todo:TodoItem)=>{
    try {
      const f=editForm();
      if(!f.content.trim()) throw new Error("Task content cannot be empty.");
      if(Boolean(f.source_entity_type)!==Boolean(f.source_entity_id)) throw new Error("Source type and source ID must be supplied together.");
      // Everything not in the edit form (id, profile_id, done…) survives untouched.
      await personalApi.updateTodo({...todo,content:f.content.trim(),notes:f.notes.trim()||null,due_date:f.due_date||null,project_id:f.project_id||null,source_entity_type:f.source_entity_type||null,source_entity_id:f.source_entity_id||null,assignee_ids:f.assignee_ids,content_kind:f.content_kind});
      setEditingId(null);
      refetch();
    } catch(reason) { setError(humanError(reason)); }
  };

  const today=()=>new Date().toISOString().slice(0,10);
  const inDays=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
  const openTodos=()=>todos()?.filter(todo=>!todo.done)??[];
  const overdue=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date<today());
  const dueSoon=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date>=today()&&todo.due_date<=inDays(7));
  const doneCount=()=>todos()?.filter(todo=>todo.done).length??0;
  const attention=()=>[...overdue(),...dueSoon()].sort((a,b)=>(a.due_date??"").localeCompare(b.due_date??"")).slice(0,5);
  // Today = due today or already overdue (an overdue task IS today's work); Later = a
  // future due date; No date = never scheduled. Every open task lands in exactly one.
  const todayList=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date<=today());
  const laterList=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date>today());
  const somedayList=()=>openTodos().filter(todo=>!todo.due_date);
  const doneList=()=>todos()?.filter(todo=>todo.done)??[];
  const postpone=async(todo:TodoItem,days:number)=>{ try { await personalApi.postponeTodo(todo.id,days); refetch(); } catch(reason) { setError(humanError(reason)); } };
  // Only a task that already belongs to a project can become that project's issue.
  const convert=async(todo:TodoItem)=>{ try { if(!todo.project_id) throw new Error("Give the task a project before converting it into an issue."); await personalApi.convertTodoToIssue(todo.id,todo.project_id); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const editRow=(todo:TodoItem)=><article class="task-card task-card-editing">
    <div class="task-body">
      <input class="composer-title" autofocus aria-label="Task title" value={editForm().content} onInput={e=>setEditForm({...editForm(),content:e.currentTarget.value})} onKeyDown={e=>{ if(e.key==="Escape") cancelEdit(); }}/>
      <div class="composer-meta tm-row">
        <ProjectControl value={editForm().project_id} projects={selectableProjects()} onChange={selectEditProject}/>
        <DueDateControl value={editForm().due_date} onChange={iso=>setEditForm({...editForm(),due_date:iso})}/>
        <AssigneeControl value={editForm().assignee_ids} people={assignableFrom(editMemberIds())} onToggle={toggleEditAssignee}
          disabled={!editForm().project_id} disabledReason="Select a project before assigning members"
          emptyNote={editMembersFailed()?`The project's members could not be loaded: ${editMembersFailed()}`:"This project has no members available for assignment."}/>
      </div>
      <Show when={editMembersFailed()}>{reason=><p class="personal-error" role="alert">The project's members could not be loaded: {reason()}</p>}</Show>
      <Show when={editForm().assignee_ids.length}><ul class="assignee-chips"><For each={editForm().assignee_ids}>{id=><li class="assignee-chip">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={()=>removeEditAssignee(id)}>×</button></li>}</For></ul></Show>
      <label class="todo-field todo-field-notes"><span class="field-label">Notes</span><textarea class="composer-notes" rows="3" placeholder="Context, links, hand-over notes" value={editForm().notes} onInput={e=>setEditForm({...editForm(),notes:e.currentTarget.value})}/></label>
      <label class="fld-check"><input type="checkbox" checked={editForm().content_kind==="markdown"} onChange={e=>setEditForm({...editForm(),content_kind:e.currentTarget.checked?"markdown":"text"})}/> Markdown body</label>
      <details class="composer-source" open={Boolean(editForm().source_entity_type||editForm().source_entity_id)}><summary>Source bookmark</summary><div class="composer-source-fields"><input placeholder="Entity type (issue, document…)" value={editForm().source_entity_type} onInput={e=>setEditForm({...editForm(),source_entity_type:e.currentTarget.value})}/><input placeholder="Entity ID" value={editForm().source_entity_id} onInput={e=>setEditForm({...editForm(),source_entity_id:e.currentTarget.value})}/></div></details>
      <div class="composer-actions task-edit-actions"><button type="button" class="ghost" onClick={cancelEdit}>Cancel</button><button type="button" class="primary composer-submit" onClick={()=>saveEdit(todo)}>Save</button></div>
    </div>
  </article>;
  const todoRow=(todo:TodoItem)=><Show when={editingId()===todo.id} fallback={<article classList={{"task-card":true,done:todo.done}}>
    <input class="task-check" aria-label={`Mark ${todo.content} done`} type="checkbox" checked={todo.done} onChange={e=>complete(todo,e.currentTarget.checked)}/>
    <button type="button" class="task-body task-body-edit" aria-label={`Edit ${todo.content}`} onClick={()=>startEdit(todo)}>
      <Show when={todo.content_kind==="markdown"} fallback={<span class="task-title">{todo.content}</span>}><span class="task-title">{markdownBody(todo.content)}</span></Show>
      <Show when={todo.notes}>{notes=><p class="task-notes">{notes()}</p>}</Show>
<Show when={todo.due_date||todo.project_id||todo.assignee_ids.length||todo.source_entity_type}>
        <div class="task-meta">
          <Show when={todo.due_date}>{date=><span class="task-tag due">{date()}</span>}</Show>
          <Show when={todo.project_id}>{id=><span class="task-tag project">{projectName(id())}</span>}</Show>
          <For each={todo.assignee_ids}>{id=><span class="task-tag assignee">{nameOf(id)}</span>}</For>
        </div>
      </Show>
    </button>
    {/* Outside the edit button on purpose: a link inside a button is not clickable
        (and not valid), and the origin must stay reachable, not editable-by-accident. */}
    <Show when={todo.source_entity_type}>{kind=><span class="task-meta task-source-row">
      <Show when={kind()==="message"} fallback={<span class="task-tag source">{kind()}: {todo.source_entity_id}</span>}>
        <SourceLink entityType={kind()} entityId={todo.source_entity_id!} />
      </Show>
    </span>}</Show>
    <div class="task-row-actions">
      <Show when={!todo.done}>
        <button type="button" class="ghost small" title="Postpone by one day" aria-label={`Postpone ${todo.content} by a day`} onClick={()=>postpone(todo,1)}>+1d</button>
        <button type="button" class="ghost small" title="Postpone by a week" aria-label={`Postpone ${todo.content} by a week`} onClick={()=>postpone(todo,7)}>+1w</button>
        <Show when={todo.project_id&&todo.source_entity_type!=="issue"}>
          <button type="button" class="ghost small" title="Convert to issue" aria-label={`Convert ${todo.content} to an issue`} onClick={()=>convert(todo)}>→ Issue</button>
        </Show>
      </Show>
      <button class="ghost task-delete" title="Delete task" aria-label={`Delete ${todo.content}`} onClick={async()=>{try{await personalApi.deleteTodo(todo.id);refetch()}catch(reason){setError(humanError(reason))}}}>×</button>
    </div>
  </article>}>
    {editRow(todo)}
  </Show>;
  return <section class="personal-view todo-view">
    <WorkspaceHeader icon="check" title="My tasks" actions={<ProfilePicker locked/>}>Personal tasks and project work, scoped to the people attached to each project.</WorkspaceHeader>
    <Show when={error()}><p class="personal-error">{error()}</p></Show>
    <div class="view-cols todo-cols">
      <div class="view-main">
        <form class="task-composer" onSubmit={save}>
          <div class="composer-head"><span class="composer-head-label">New task</span></div>
          <input class="composer-title" autofocus placeholder="What needs doing?" value={form().content} onInput={e=>setForm({...form(),content:e.currentTarget.value})}/>
          <div class="composer-meta tm-row">
            <ProjectControl value={form().project_id} projects={selectableProjects()} onChange={selectProject}/>
            <DueDateControl value={form().due_date} onChange={iso=>setForm({...form(),due_date:iso})}/>
            <AssigneeControl value={form().assignee_ids} people={assignable()} onToggle={toggleAssignee}
              disabled={!form().project_id} disabledReason="Select a project before assigning members"
              emptyNote={membersFailed()?`The project's members could not be loaded: ${membersFailed()}`:"This project has no members available for assignment."}/>
          </div>
          <Show when={membersFailed()}>{reason=><p class="personal-error" role="alert">The project's members could not be loaded: {reason()}</p>}</Show>
          <Show when={form().project_id&&!projectMembers.loading&&!membersFailed()&&!memberIds().length}><p class="hint">This project has no members available for assignment.</p></Show>
          <Show when={form().assignee_ids.length}><ul class="assignee-chips"><For each={form().assignee_ids}>{id=><li class="assignee-chip">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={()=>removeAssignee(id)}>×</button></li>}</For></ul></Show>
          <label class="todo-field todo-field-notes"><span class="field-label">Notes</span><textarea class="composer-notes" rows="3" placeholder="Context, links, hand-over notes" value={form().notes} onInput={e=>setForm({...form(),notes:e.currentTarget.value})}/></label>
          <label class="fld-check"><input type="checkbox" checked={form().content_kind==="markdown"} onChange={e=>setForm({...form(),content_kind:e.currentTarget.checked?"markdown":"text"})}/> Markdown body</label>
<details class="composer-source"><summary>Source bookmark</summary><div class="composer-source-fields"><input placeholder="Entity type (issue, document…)" value={form().source_entity_type} onInput={e=>setForm({...form(),source_entity_type:e.currentTarget.value})}/><input placeholder="Entity ID" value={form().source_entity_id} onInput={e=>setForm({...form(),source_entity_id:e.currentTarget.value})}/></div></details>
          <div class="composer-actions"><button class="primary composer-submit">Add task</button></div>
        </form>
        <Show when={!profileId()}><p class="personal-empty">No profile selected — add one in Members.</p></Show>
        <section class="task-list">
          <h3 class="task-group-title">Today<span class="rail-count">{todayList().length}</span></h3>
          <Show when={todayList().length} fallback={<p class="personal-empty">Nothing due today.</p>}><For each={todayList()}>{todoRow}</For></Show>
        </section>
        <section class="task-list">
          <h3 class="task-group-title">Later<span class="rail-count">{laterList().length}</span></h3>
          <Show when={laterList().length} fallback={<p class="personal-empty">Nothing scheduled ahead.</p>}><For each={laterList()}>{todoRow}</For></Show>
        </section>
        <Show when={somedayList().length}>
          <section class="task-list">
            <h3 class="task-group-title">No date<span class="rail-count">{somedayList().length}</span></h3>
            <For each={somedayList()}>{todoRow}</For>
          </section>
        </Show>
        <Show when={doneList().length}>
          <section class="task-list">
            <h3 class="task-group-title">Done<span class="rail-count">{doneList().length}</span></h3>
            <For each={doneList()}>{todoRow}</For>
          </section>
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
