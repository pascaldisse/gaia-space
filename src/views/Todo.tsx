import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { personalApi, type Todo as TodoItem } from "../api/personal";
import "../components/paper.css";
import "./Todo.css";
import PageHeader from "../components/PageHeader";
import SourceLink from "../components/SourceLink";
import EmptyState from "../components/EmptyState";
import TaskDrawer from "../components/TaskDrawer";
import TaskRowEdit, { focusTaskRow } from "../components/TaskRowEdit";
import { profileId, profiles, reloadProfiles, projects, reloadProjects } from "../session";
import { parseMarkdown } from "../markdownLite";
import { todayISO, urgencyOf } from "../statusTone";
import { humanError } from "../session";
import { MetricGrid, MetricTile } from "../components/blocks";

// Tokens, never HTML: a task body can style itself but can never inject markup.
const markdownBody=(body:string)=><div class="task-markdown"><For each={parseMarkdown(body)}>{block=><p classList={{"task-md-line":true,"task-md-bullet":block.bullet}}><For each={block.tokens}>{token=>token.kind==="strong"?<strong>{token.text}</strong>:token.kind==="em"?<em>{token.text}</em>:token.kind==="code"?<code>{token.text}</code>:<>{token.text}</>}</For></p>}</For></div>;
/* The rail's coloured numbers used to be hard-coded classes, then a local
   `metricClass` helper. Both are gone: the shared MetricTile applies `metricTone`
   itself, so "0 Overdue" cannot be red no matter what a caller passes. */
export default function Todo() {
  onMount(()=>{ void reloadProfiles(); void reloadProjects(); });
  /* ONE CREATION ACT, ONE SHAPE (stage 20). The always-open inline composer is gone:
     it was ~180px of form standing between the reader and the list on the surface the
     owner named first ("This left area bothers me on Tasks"). NOTHING it could do was
     lost — title, project, due date, assignees, notes, the markdown switch and the
     source bookmark are all in the drawer (`advanced` turns the last two on, and My
     tasks is the only surface that ever had them). Editing an existing task did NOT
     move: it still happens in place, in the row (`.task-card-editing`, below). */
  const [creating,setCreating]=createSignal(false); const [error,setError]=createSignal("");
  const [todos,{refetch}]=createResource(profileId,id=>id?personalApi.todos(id,true):Promise.resolve([]));
  /* The project-member read, the assignable-people list and the project list moved
     WITH the editor into components/TaskRowEdit.tsx — including the rule that a
     refused member read is carried as a value and said out loud, never shown as
     "nobody". This view keeps only what its own rows and rail need. */
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const projectName=(id:string)=>projects()?.find(project=>project.id===id)?.name??id;
  const complete=async(todo:TodoItem, done:boolean)=>{ try { await personalApi.setTodoCompletion(todo.id,done); refetch(); } catch(reason) { setError(humanError(reason)); } };

  /* ── EDIT AN EXISTING TASK: IN THE ROW ──────────────────────────────────────
     One row open at a time. The editor itself moved to components/TaskRowEdit.tsx
     UNCHANGED IN SUBSTANCE (same controls, same classes, same Save/Cancel), because
     the project and team surfaces now open the SAME editor with the same gesture.
     This surface keeps what is its own: which row is open, and where the focus goes
     when it closes. */
  const [editingId,setEditingId]=createSignal<string|null>(null);
  // FOCUS RETURNS TO THE ROW ON CLOSE. Not to the element that opened it: closing
  // follows a re-read that replaces that button. The row is found again by task id.
  const startEdit=(todo:TodoItem)=>{ setEditingId(todo.id); setError(""); };
  const closeEdit=(id:string)=>{ setEditingId(null); focusTaskRow(id); };

  const today=todayISO;
  const openTodos=()=>todos()?.filter(todo=>!todo.done)??[];
  // Overdue / due-soon come from the shared urgency rule, not from a local date
  // comparison — see `src/statusTone.ts`. "Due soon" here looks a week ahead.
  const overdue=()=>openTodos().filter(todo=>urgencyOf(todo.due_date,today(),7)==="overdue");
  const dueSoon=()=>openTodos().filter(todo=>["today","soon"].includes(urgencyOf(todo.due_date,today(),7)));
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
  const convert=async(todo:TodoItem)=>{ try { if(!todo.project_id) throw new Error("Give the task a project before converting it into a ticket."); await personalApi.convertTodoToIssue(todo.id,todo.project_id); refetch(); } catch(reason) { setError(humanError(reason)); } };
  const editRow=(todo:TodoItem)=><article class="task-card task-card-editing">
    <div class="task-body">
      {/* My tasks is the surface that has always carried the markdown switch and the
          source bookmark, so it is the one that asks for them (`advanced`).
          This is the caller's OWN list, so the caller owns every row in it — the
          server's owner rule (TodoOwnerWrite) is satisfied by construction here. */}
      <TaskRowEdit task={todo} advanced canEdit canComplete ownerName={nameOf(todo.profile_id)}
        onCancel={()=>closeEdit(todo.id)}
        onSaved={()=>{ closeEdit(todo.id); refetch(); }}
        onError={setError}/>
    </div>
  </article>;
  const todoRow=(todo:TodoItem)=><Show when={editingId()===todo.id} fallback={<article classList={{"task-card":true,done:todo.done}}>
    <input class="task-check" aria-label={`Mark ${todo.content} done`} type="checkbox" checked={todo.done} onChange={e=>complete(todo,e.currentTarget.checked)}/>
    <button type="button" class="task-body task-body-edit" data-task-row={todo.id} aria-label={`Edit ${todo.content}`} onClick={()=>startEdit(todo)}>
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
          <button type="button" class="ghost small" title="Convert to ticket" aria-label={`Convert ${todo.content} to a ticket`} onClick={()=>convert(todo)}>→ Ticket</button>
        </Show>
      </Show>
      <button class="ghost task-delete" title="Delete task" aria-label={`Delete ${todo.content}`} onClick={async()=>{try{await personalApi.deleteTodo(todo.id);refetch()}catch(reason){setError(humanError(reason))}}}>×</button>
    </div>
  </article>}>
    {editRow(todo)}
  </Show>;
  return <section class="personal-view todo-view">
    {/* L1: the shell owns identity. A disabled "Acting as" box in the corner of
        every load is still a second identity control (audit §3.1). */}
    {/* THREE TASK SURFACES, THREE SENTENCES (stage 12d). Each says WHOSE work and
        HOW WIDE, in that order, so no two can be confused:
          My tasks     — only yours, across every project.
          Team tasks   — everybody's, across every project you are in.
          Project Tasks— everybody's, in one project. */}
    <PageHeader title="My tasks" subline="Only your tasks — yours and what people put on you, across every project." actions={
      <button type="button" class="primary" onClick={()=>{setCreating(true);setError("")}}>New task</button>
    }/>
    <Show when={error()}><p class="personal-error">{error()}</p></Show>
    <div class="view-cols todo-cols">
      <div class="view-main">
        <Show when={!profileId()}><p class="personal-empty">No profile selected — add one in Members.</p></Show>
        {/* NOTHING YET, for the whole surface: the same primary the header carries,
            opening the same drawer. */}
        <Show when={!todos.loading && !!profileId() && !(todos() ?? []).length}>
          <EmptyState
            title="No tasks yet"
            hint="Your own list — personal to-dos, and anything assigned to you from a project."
            actions={<button type="button" class="primary" onClick={()=>setCreating(true)}>New task</button>}
          />
        </Show>
        {/* Per-section lines stay QUIET: with tasks in other sections and the primary
            in the header, a call to action here would fire on every filter of
            the calendar the person is already reading. */}
        <Show when={!!(todos() ?? []).length}>
        <section class="task-list">
          <h3 class="task-group-title">Today<span class="rail-count">{todayList().length}</span></h3>
          <Show when={todayList().length} fallback={<p class="personal-empty">Nothing due today.</p>}><For each={todayList()}>{todoRow}</For></Show>
        </section>
        <section class="task-list">
          <h3 class="task-group-title">Later<span class="rail-count">{laterList().length}</span></h3>
          <Show when={laterList().length} fallback={<p class="personal-empty">Nothing scheduled ahead.</p>}><For each={laterList()}>{todoRow}</For></Show>
        </section>
        </Show>
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
          {/* ONE TILE (stage 11, defect 2): `.rail-metric` was a fourth tile shape.
              Colour law: overdue is critical (red), not merely waiting (amber), and
              "due in 7 days" IS the amber case. A count of 0 carries no tone at all —
              MetricTile runs every tone through metricTone, so the hand-rolled
              `metricClass` helper is no longer needed here. */}
          <MetricGrid label="Tasks at a glance" class="pairs">
            <MetricTile value={openTodos().length} label="Open" tone="teal" />
            <MetricTile value={overdue().length} label="Overdue" tone="red" />
            <MetricTile value={dueSoon().length} label="Due in 7 days" tone="amber" />
            <MetricTile value={doneCount()} label="Done" />
          </MetricGrid>
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
    {/* THE SAME DRAWER the project and team surfaces open. `advanced` because this is
        the surface that has always carried the markdown switch and the source
        bookmark — the drawer does not grow fields anywhere they never existed. */}
    <Show when={creating()}><TaskDrawer advanced authorId={profileId()} onClose={()=>setCreating(false)} onSaved={()=>refetch()}/></Show>
  </section>;
}
