import { createResource, createSignal, For, Show, onMount } from "solid-js";
import { TODO_CATEGORIES, personalApi, type Todo as TodoItem } from "../api/personal";
import "../components/paper.css";
import "./Todo.css";
import "./taskCards.css";
import PageHeader, { Chip } from "../components/PageHeader";
import SourceLink from "../components/SourceLink";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "../components/ContextMenu";
import DeleteButton from "../components/DeleteButton";
import TaskDrawer from "../components/TaskDrawer";
import TaskRowEdit, { focusTaskRow } from "../components/TaskRowEdit";
import { profileId, profiles, reloadProfiles, projects, reloadProjects } from "../session";
import { parseMarkdown } from "../markdownLite";
import { bandTone, deadlineBand, todayISO, urgencyOf } from "../statusTone";
import { humanError } from "../session";
import { Icon } from "../components/Icon";

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
  /** Done is folded away by default — it is the part of the list you are finished
   *  with, and it only ever grows. */
  const [showDone,setShowDone]=createSignal(false);
  const [todos,{refetch}]=createResource(profileId,id=>id?personalApi.todos(id,true):Promise.resolve([]));
  /* The project-member read, the assignable-people list and the project list moved
     WITH the editor into components/TaskRowEdit.tsx — including the rule that a
     refused member read is carried as a value and said out loud, never shown as
     "nobody". This view keeps only what its own rows and rail need. */
  const active=()=>profiles()?.filter(p=>!p.archived)??[];
  const nameOf=(id:string)=>{ const p=active().find(x=>x.id===id); return p?(p.display_name||p.username):id; };
  const projectName=(id:string)=>projects()?.find(project=>project.id===id)?.name??id;
  /** An unknown category still shows its stored value rather than vanishing: a row
   *  that silently drops a fact is worse than one that shows a word we did not plan. */
  const categoryLabel=(id:string)=>TODO_CATEGORIES.find(option=>option.id===id)?.label??id;
  /** THE QUIET LINE UNDER A TASK'S NAME, in the order it is read: what KIND of act,
   *  then where it lives, then who carries it, then what it is about.
   *
   *  The category leads because it is the one fact that says what sort of work this
   *  is — and it carries NO COLOUR. Both coloured things on this tile (the state mark
   *  and the due date) come from `deadlineBand()`/`urgencyOf()`; a category palette
   *  beside them would be a second colour rule on one card, and "what kind of work"
   *  would compete with "how late". One colour rule per tile. */
  const metaParts=(todo:TodoItem)=>{
    const parts:{cls:string;text:string}[]=[];
    if(todo.category) parts.push({cls:"task-tile-cat",text:categoryLabel(todo.category)});
    if(todo.project_id) parts.push({cls:"",text:projectName(todo.project_id)});
    if(todo.assignee_ids.length) parts.push({cls:"",text:todo.assignee_ids.map(nameOf).join(", ")});
    if(todo.notes) parts.push({cls:"",text:todo.notes.length>60?todo.notes.slice(0,60)+"…":todo.notes});
    return parts;
  };
  const complete=async(todo:TodoItem, done:boolean)=>{ try { await personalApi.setTodoCompletion(todo.id,done); refetch(); } catch(reason) { setError(humanError(reason)); } };

  /* ── EDIT AN EXISTING TASK: IN THE ROW ──────────────────────────────────────
     One row open at a time. The editor itself moved to components/TaskRowEdit.tsx
     UNCHANGED IN SUBSTANCE (same controls, same classes, same Save/Cancel), because
     the project and team surfaces now open the SAME editor with the same gesture.
     This surface keeps what is its own: which row is open, and where the focus goes
     when it closes. */
  const [editingId,setEditingId]=createSignal<string|null>(null);
  /** Which field the row editor opens on. Clicking the "add a description" hint
   *  must land the caret in the description, not in the title. */
  const [editIntent,setEditIntent]=createSignal<"title"|"notes">("title");
  // FOCUS RETURNS TO THE ROW ON CLOSE. Not to the element that opened it: closing
  // follows a re-read that replaces that button. The row is found again by task id.
  const startEdit=(todo:TodoItem,field:"title"|"notes"="title")=>{ setEditIntent(field); setEditingId(todo.id); setError(""); };
  const closeEdit=(id:string)=>{ setEditingId(null); focusTaskRow(id); };

  /* ── DELETING A TASK ────────────────────────────────────────────────────────
     THE OWNER RULE, quoted from the server, not invented here: the CREATOR
     (`profile_id`) may delete. A SHARED task — one bound to a project, or carried
     by somebody else — may NOT be deleted by the person it was put on: this list
     contains other people's tasks assigned to me, and removing one would delete
     THEIR work to clear MY list. Those rows get no button, and a reason instead.

     Two doors, one act and one question: the row's right-click menu (where people
     point at a task) and the opened task's own facts (below). Both open the
     ConfirmDialog; neither deletes on click. */
  const ownsTask=(todo:TodoItem)=>!!profileId()&&todo.profile_id===profileId();
  const [menu,setMenu]=createSignal<{x:number;y:number;items:ContextMenuItem[]}|null>(null);
  const [pendingDelete,setPendingDelete]=createSignal<TodoItem|null>(null);
  const [deleting,setDeleting]=createSignal(false);
  /* The row's old glyph buttons (+1d, +1w, → Ticket) are WORDS in this menu now.
     Nothing was dropped: postponing and converting are still one click away, they
     just no longer sit on every tile as unlabelled furniture. */
  const taskMenuItems=(todo:TodoItem):ContextMenuItem[]=>[
    { label:"Open", onSelect:()=>startEdit(todo) },
    ...(todo.done?[]:[
      { label:"Postpone by a day", onSelect:()=>void postpone(todo,1) },
      { label:"Postpone by a week", onSelect:()=>void postpone(todo,7) },
    ]),
    ...(!todo.done&&todo.project_id&&todo.source_entity_type!=="issue"
      ?[{ label:"Convert to ticket", onSelect:()=>void convert(todo) }]
      :[]),
    ...(ownsTask(todo)?[{ label:"Delete task…", danger:true, onSelect:()=>setPendingDelete(todo) }]:[]),
  ];
  const openTaskMenu=(event:MouseEvent,todo:TodoItem)=>{ event.preventDefault(); event.stopPropagation(); setMenu({x:event.clientX,y:event.clientY,items:taskMenuItems(todo)}); };
  const deleteTask=async()=>{
    const todo=pendingDelete(); if(!todo) return;
    setError(""); setDeleting(true);
    try {
      await personalApi.deleteTodo(todo.id,profileId());
      setPendingDelete(null); if(editingId()===todo.id) setEditingId(null);
      refetch();
    } catch(reason) {
      // This surface's one error line. A refusal is never swallowed.
      setError(humanError(reason)); setPendingDelete(null);
    } finally { setDeleting(false); }
  };

  const today=todayISO;
  const openTodos=()=>todos()?.filter(todo=>!todo.done)??[];
  // Overdue / due-soon come from the shared urgency rule, not from a local date
  // comparison — see `src/statusTone.ts`. "Due soon" here looks a week ahead.
  const overdue=()=>openTodos().filter(todo=>urgencyOf(todo.due_date,today(),7)==="overdue");
  const dueSoon=()=>openTodos().filter(todo=>["today","soon"].includes(urgencyOf(todo.due_date,today(),7)));
  const doneCount=()=>todos()?.filter(todo=>todo.done).length??0;
  // Today = due today or already overdue (an overdue task IS today's work); Later = a
  // future due date; No date = never scheduled. Every open task lands in exactly one.
  const todayList=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date<=today());
  const laterList=()=>openTodos().filter(todo=>todo.due_date&&todo.due_date>today());
  const somedayList=()=>openTodos().filter(todo=>!todo.due_date);
  /** Open work of any kind. Zero of it, with tasks on the list, is its own state:
   *  not 'nothing exists' and not 'a filter matched nothing' — 'you are finished'. */
  const openCount=()=>openTodos().length;
  /** True while an EmptyState on this surface is showing its own "New task". */
  const showsEmptyPrimary=()=>!!profileId()&&!todos.loading&&(!(todos()??[]).length||!openCount());
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
      {/* THE ONE ACT THAT REMOVES THE TASK travels INTO the editor's own row of
          buttons. It used to sit in a strip below the card, outside its border, so the
          opened task ended in a floating red button that belonged to nothing. */}
      <TaskRowEdit task={todo} advanced canEdit canComplete ownerName={nameOf(todo.profile_id)} focusField={editIntent()}
        onCancel={()=>closeEdit(todo.id)}
        onSaved={()=>{ closeEdit(todo.id); refetch(); }}
        onError={setError}
        danger={<DeleteButton
          label={`Delete ${todo.content}`}
          canDelete={ownsTask(todo)}
          deniedReason="Only the owner can delete this"
          onRequest={()=>setPendingDelete(todo)}/>}/>
    </div>
  </article>;
  /** THE TASK TILE — Knowledge's card, in the vocabulary of work: the check is the
   *  icon tile (the one thing you do without opening it), the name is bold, ONE quiet
   *  meta line carries project · people · origin, and the due date is the only fact
   *  that earns colour. Dragging it onto a project in the sidebar files it there. */
  const todoRow=(todo:TodoItem)=><Show when={editingId()===todo.id} fallback={
    <article
      class="task-tile"
      classList={{ done: todo.done }}
      draggable={!todo.done}
      onDragStart={event=>event.dataTransfer?.setData("application/x-gaia-task", JSON.stringify({ id: todo.id, title: todo.content }))}
      onContextMenu={event=>openTaskMenu(event,todo)}
    >
      {/* THE MARK SAYS THE STATE, NOT THE ACT. A tick on an open task reads as
          "already done"; an open task carries "!" and only a completed one wears the
          tick. The button still toggles completion — its label says so. */}
      <button
        type="button"
        class="task-tile-check"
        classList={{ [todo.done?"":bandTone(deadlineBand(todo.due_date,today()))]: !todo.done }}
        aria-label={`Mark ${todo.content} ${todo.done?"not done":"done"}`}
        aria-pressed={todo.done}
        onClick={()=>void complete(todo,!todo.done)}
      >
        <Icon name={todo.done?"check":"alert"} size={15} />
      </button>
      <button type="button" class="task-tile-body" data-task-row={todo.id} aria-label={`Edit ${todo.content}`} onClick={()=>startEdit(todo)}>
        <span class="task-tile-title">
          <Show when={todo.content_kind==="markdown"} fallback={todo.content}>{markdownBody(todo.content)}</Show>
        </span>
        {/* THE META LINE JOINS ITSELF. Every separator used to be placed by hand next
            to the fact it followed, so each new fact had to guess what might come
            before it — and got it wrong: a category with nothing after it printed
            "Review ·", and a task carrying only notes printed "· notes". Facts are
            collected first, then joined, so a dot can only ever appear BETWEEN two of
            them. */}
        <Show when={metaParts(todo).length}>
          <span class="task-tile-meta">
            <For each={metaParts(todo)}>{(part,index)=><>
              <Show when={index()>0}><span class="sep">·</span></Show>
              <span class={part.cls}>{part.text}</span>
            </>}</For>
          </span>
        </Show>
      </button>
      <span class="task-tile-edge">
        <Show when={todo.due_date}>{date=>{
          const tone=()=>urgencyOf(date(),today(),7);
          return <span class="task-due" classList={{ [tone()]: tone()!=="none" }}>{date()}</span>;
        }}</Show>
        {/* Outside the edit button on purpose: a link inside a button is neither
            valid nor clickable, and the origin must stay reachable. */}
        <Show when={todo.source_entity_type}>{kind=>
          <Show when={kind()==="message"} fallback={<span class="task-due">{kind()}</span>}>
            <SourceLink entityType={kind()} entityId={todo.source_entity_id!} />
          </Show>
        }</Show>
      </span>
      <button
        class="task-tile-menu"
        aria-label={`Actions for ${todo.content}`}
        title="Actions"
        onClick={event=>openTaskMenu(event,todo)}
      >⋯</button>
    </article>
  }>
    <div class="task-open">{editRow(todo)}</div>
  </Show>;
  return <section class="personal-view todo-view">
    <Show when={menu()}>{open=><ContextMenu x={open().x} y={open().y} items={open().items} onClose={()=>setMenu(null)}/>}</Show>
    <ConfirmDialog
      open={!!pendingDelete()}
      title="Delete task?"
      body={<><strong>{pendingDelete()?.content}</strong> is deleted, with its description, due date and assignees. This cannot be undone.</>}
      confirmLabel="Delete task"
      busy={deleting()}
      onConfirm={()=>void deleteTask()}
      onCancel={()=>setPendingDelete(null)}/>
    {/* L1: the shell owns identity. A disabled "Acting as" box in the corner of
        every load is still a second identity control (audit §3.1). */}
    {/* THREE TASK SURFACES, THREE SENTENCES (stage 12d). Each says WHOSE work and
        HOW WIDE, in that order, so no two can be confused:
          My tasks     — only yours, across every project.
          Team tasks   — everybody's, across every project you are in.
          Project Tasks— everybody's, in one project. */}
    {/* ONE ACTION, ONE PLACE. The header primary and the empty state's primary are
        the same act, so only one of them is ever drawn: while the surface is empty
        the empty state carries it (that is where the eye already is, and where the
        owner asked for it to be obvious), and the moment there is content the header
        takes it back. Two identical buttons on one screen is the defect this rule
        exists to prevent. */}
    {/* THE KNOWLEDGE SHAPE, in the vocabulary of work: header · one action row ·
        a head that says what you are looking at and what you can do with it ·
        sections of cards. The "At a glance" rail is GONE: four numbers in a box
        beside the list restated what the list already shows, and the two figures
        that carry a decision (how much is open, how much is late) now sit in the
        header as chips — where a number belongs. */}
    <PageHeader
      icon="check"
      title="My tasks"
      subline="Only your tasks — yours and what people put on you, across every project."
      chips={
        <Show when={!todos.loading && !!(todos() ?? []).length}>
          <Chip value={openCount()} label="open" />
          <Show when={overdue().length}><Chip value={overdue().length} label="overdue" tone="red" /></Show>
          <Show when={dueSoon().length}><Chip value={dueSoon().length} label="due in 7 days" tone="amber" /></Show>
        </Show>
      }
    />
    <Show when={error()}><p class="personal-error">{error()}</p></Show>

    <Show when={!showsEmptyPrimary()}>
      <nav class="documents-actionbar task-actionbar">
        {/* The word alone. An icon here would only decorate: unlike an upload, there
            is no second way to read "New task". */}
        <button type="button" class="primary doc-action-primary" onClick={()=>{setCreating(true);setError("")}}>New task</button>
        <button type="button" class="doc-action-secondary" onClick={()=>setShowDone(open=>!open)} aria-pressed={showDone()}>
          {showDone() ? "Hide done" : `Show done${doneCount()?` (${doneCount()})`:""}`}
        </button>
      </nav>
    </Show>

    <div class="task-board">
      <Show when={!profileId()}><p class="personal-empty">No profile selected — add one in Members.</p></Show>
      <Show when={!todos.loading && !!profileId() && !(todos() ?? []).length}>
        <EmptyState
          title="No tasks yet"
          hint="Your own list — personal to-dos, and anything assigned to you from a project."
          actions={<button type="button" class="primary" onClick={()=>setCreating(true)}>New task</button>}
        />
      </Show>
      {/* A SECTION WITH NOTHING IN IT IS NOT DRAWN — an empty section carries no
          information its own count does not already carry. */}
      <Show when={!openCount() && !!(todos() ?? []).length}>
        <EmptyState
          title="Nothing open"
          hint={doneList().length ? `Everything on your list is done — ${doneList().length} completed.` : undefined}
          actions={<button type="button" class="primary" onClick={()=>setCreating(true)}>New task</button>}
        />
      </Show>

      <Show when={openCount() > 0}>
        <div class="task-board-head">
          <span class="task-board-icon" aria-hidden="true"><Icon name="alert" size={24} /></span>
          <div class="task-board-headtext">
            <h2>Open work</h2>
            <p>Open a task to edit it, or drag it onto a project in the sidebar to file it there.</p>
          </div>
        </div>
      </Show>

      <For each={[
        { key: "today", label: "Today", rows: todayList() },
        { key: "later", label: "Later", rows: laterList() },
        { key: "someday", label: "No date", rows: somedayList() },
      ]}>
        {group => (
          <Show when={group.rows.length}>
            <p class="task-group-heading">{group.label}<span class="count">{group.rows.length}</span></p>
            <div class="task-grid" aria-label={`${group.label} tasks`}>
              <For each={group.rows}>{todoRow}</For>
            </div>
          </Show>
        )}
      </For>

      {/* Done is folded away by default: it is the part of the list you are finished
          with, and it grows forever. The count stays visible on the toggle. */}
      <Show when={showDone() && doneList().length}>
        <p class="task-group-heading">Done<span class="count">{doneList().length}</span></p>
        <div class="task-grid" aria-label="Completed tasks">
          <For each={doneList()}>{todoRow}</For>
        </div>
      </Show>
    </div>

    {/* THE SAME DRAWER the project and team surfaces open. `advanced` because this is
        the surface that has always carried the markdown switch and the source
        bookmark — the drawer does not grow fields anywhere they never existed. */}
    <Show when={creating()}><TaskDrawer advanced authorId={profileId()} onClose={()=>setCreating(false)} onSaved={()=>refetch()}/></Show>
  </section>;
}
