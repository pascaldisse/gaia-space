import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Board, type BoardColumn, type Issue, type Status } from "../api/issues";
import "./Boards.css";
import { ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import { projectId as sessionProject, setProjectId as setSessionProject, humanError, profiles } from "../session";

/** Board templates — a new board is usable immediately, Trello-shaped. */
const TEMPLATES: Record<string, { label: string; columns: string[] }> = {
  kanban: { label: "Kanban — To do · In progress · Done", columns: ["To do", "In progress", "Done"] },
  scrum: { label: "Scrum — Backlog · To do · In progress · Review · Done", columns: ["Backlog", "To do", "In progress", "Review", "Done"] },
  blank: { label: "Blank — no columns", columns: [] },
};
const STATUS_COLOR: Record<string, string> = { "To do": "#7f8da6", Backlog: "#6d7c99", "In progress": "#00c2a8", Review: "#c4a9e6", Done: "#8fd6a2" };

export default function Boards() {
  const projectId = sessionProject; const setProjectId = setSessionProject;
  const [board, setBoard] = createSignal<Board>();
  const [sprintId, setSprintId] = createSignal<string>();
  const [error, setError] = createSignal("");
  const [newBoard, setNewBoard] = createSignal("");
  const [template, setTemplate] = createSignal("kanban");
  const [newColumn, setNewColumn] = createSignal("");
  const [newSprint, setNewSprint] = createSignal("");
  const [openIssue, setOpenIssue] = createSignal<string>();
  const [menu, setMenu] = createSignal<{ column: BoardColumn; x: number; y: number }>();

  const [boards, { refetch: reloadBoards }] = createResource(projectId, id => id ? planningApi.boards(id) : Promise.resolve([]));
  const [statuses, { refetch: reloadStatuses }] = createResource(projectId, id => id ? planningApi.statuses(id) : Promise.resolve([]));
  createEffect(() => { if (boards()?.length && !board()) setBoard(boards()![0]); if (board() && !boards()?.some(b => b.id === board()!.id)) setBoard(boards()?.[0]); });
  const [columns, { refetch: reloadColumns }] = createResource(() => board()?.id, id => id ? planningApi.columns(id) : Promise.resolve([]));
  const [sprints, { refetch: reloadSprints }] = createResource(() => board()?.id, id => id ? planningApi.sprints(id) : Promise.resolve([]));
  const [issues, { refetch: reloadIssues }] = createResource(() => [board()?.id, sprintId()] as const, ([id, sprint]) => id ? planningApi.boardIssues(id, sprint) : Promise.resolve([]));

  /** Ensure a status of this name exists in the project; return its id. */
  const statusFor = async (name: string): Promise<string | undefined> => {
    const existing = statuses()?.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const project = projectId(); if (!project) return undefined;
    const created = await planningApi.createStatus({ project_id: project, name, color: STATUS_COLOR[name] ?? "var(--accent)", resolved: name === "Done" });
    return created?.id;
  };

  const createBoard = async (event: SubmitEvent) => {
    event.preventDefault();
    const project = projectId(); const name = newBoard().trim();
    if (!project || !name) return;
    try {
      const created = await planningApi.createBoard({ project_id: project, name, backlog_type: "MANUAL", archived: false });
      setNewBoard(""); setBoard(created);
      // A board with no columns cannot hold work: lay the chosen template down now.
      for (const columnName of TEMPLATES[template()].columns) {
        const statusId = await statusFor(columnName);
        await planningApi.saveColumn({ board_id: created.id, name: columnName, status_ids: statusId ? [statusId] : [] });
      }
      await reloadStatuses(); reloadBoards(); reloadColumns();
    } catch (reason) { setError(humanError(reason)); }
  };

  const addColumn = async () => {
    const b = board(); const name = newColumn().trim(); if (!b || !name) return;
    try { const statusId = await statusFor(name); await planningApi.saveColumn({ board_id: b.id, name, status_ids: statusId ? [statusId] : [] }); setNewColumn(""); await reloadStatuses(); reloadColumns(); }
    catch (reason) { setError(humanError(reason)); }
  };
  const removeColumn = async (column: BoardColumn) => {
    setMenu(undefined);
    if (!confirm(`Delete the column "${column.name}"? Its issues stay in the project.`)) return;
    try { await planningApi.deleteColumn(column.id); reloadColumns(); } catch (reason) { setError(humanError(reason)); }
  };
  const renameColumn = async (column: BoardColumn) => {
    setMenu(undefined);
    const name = prompt("Column name", column.name)?.trim(); if (!name || name === column.name) return;
    try { await planningApi.saveColumn({ ...column, name }); reloadColumns(); } catch (reason) { setError(humanError(reason)); }
  };
  const mapStatus = async (column: BoardColumn, statusId: string, checked: boolean) => {
    try { await planningApi.saveColumn({ ...column, status_ids: checked ? [...column.status_ids, statusId] : column.status_ids.filter(id => id !== statusId) }); reloadColumns(); }
    catch (reason) { setError(humanError(reason)); }
  };

  const [composeIn, setComposeIn] = createSignal<string>();
  const [cardTitle, setCardTitle] = createSignal("");
  const addCard = async (column: BoardColumn) => {
    const project = projectId(); const b = board(); const title = cardTitle().trim();
    if (!project || !b || !title) return;
    try {
      let statusId = column.status_ids[0];
      if (!statusId) { statusId = await statusFor(column.name) ?? ""; if (statusId) await planningApi.saveColumn({ ...column, status_ids: [statusId] }); }
      const issue = await planningApi.createIssue({ project_id: project, title, description: null, status_id: statusId || null, assignee_id: null, created_by: null, due_date: null, archived: false });
      await planningApi.move(b.id, issue.id, column.id, sprintId());
      setCardTitle(""); setComposeIn(undefined); await reloadStatuses(); reloadColumns(); reloadIssues(); setOpenIssue(issue.id);
    } catch (reason) { setError(humanError(reason)); }
  };
  const move = async (issueId: string, columnId: string) => { const b = board(); if (!b) return; try { await planningApi.move(b.id, issueId, columnId, sprintId()); reloadIssues(); } catch (reason) { setError(humanError(reason)); } };

  const cardsOf = (column: BoardColumn) => issues()?.filter(issue => column.status_ids.includes(issue.status_id ?? "")) ?? [];

  return <section class="planning-view boards-view" onClick={() => setMenu(undefined)}>
    <header class="planning-head"><div><h1>Issue boards</h1><p>Columns map issue statuses. Right-click a column to rename or delete it.</p></div><ProjectPicker onChange={id => { setProjectId(id); setBoard(undefined); setSprintId(undefined); }} /></header>
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>

    <div class="board-toolbar">
      <form onSubmit={createBoard} class="board-create">
        <input placeholder="New board name" value={newBoard()} onInput={e => setNewBoard(e.currentTarget.value)} />
        <select value={template()} onChange={e => setTemplate(e.currentTarget.value)} aria-label="Board template">
          <For each={Object.entries(TEMPLATES)}>{([key, value]) => <option value={key}>{value.label}</option>}</For>
        </select>
        <button class="primary" disabled={!projectId() || !newBoard().trim()}>Create board</button>
      </form>
      <div class="board-tabs"><For each={boards()}>{b => <button classList={{ active: board()?.id === b.id }} onClick={() => { setBoard(b); setSprintId(undefined); setOpenIssue(undefined); }}>{b.name}</button>}</For></div>
      <Show when={board()}>
        <select value={sprintId() ?? ""} onChange={e => setSprintId(e.currentTarget.value || undefined)}>
          <option value="">All board issues</option>
          <For each={sprints()}>{s => <option value={s.id}>{s.name} · {s.state}</option>}</For>
        </select>
        <div class="inline-form"><input placeholder="New sprint" value={newSprint()} onInput={e => setNewSprint(e.currentTarget.value)} /><button onClick={async () => { const b = board(); if (!b || !newSprint().trim()) return; try { const s = await planningApi.createSprint({ board_id: b.id, name: newSprint().trim(), starts_on: null, ends_on: null, description: null }); setNewSprint(""); setSprintId(s.id); reloadSprints(); } catch (reason) { setError(humanError(reason)); } }}>Sprint</button></div>
      </Show>
    </div>

    <Show when={board()} fallback={<p class="hint pad">Create a board to start — it comes with columns ready to use.</p>}>{b =>
      <div class="board-split">
        <div class="kanban">
          <For each={columns()}>{column =>
            <section class="board-column" onContextMenu={event => { event.preventDefault(); setMenu({ column, x: event.clientX, y: event.clientY }); }}>
              <header class="column-head">
                <div class="column-title"><h2>{column.name}</h2><small>{cardsOf(column).length}</small></div>
                <button class="column-plus" aria-label={`Add issue to ${column.name}`} title="Add issue" onClick={() => { setComposeIn(column.id); setCardTitle(""); }}>+</button>
              </header>

              <Show when={composeIn() === column.id}>
                <form class="column-compose" onSubmit={e => { e.preventDefault(); void addCard(column); }}>
                  <input autofocus placeholder="Issue title" value={cardTitle()} onInput={e => setCardTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Escape") setComposeIn(undefined); }} />
                  <div class="column-compose-actions"><button class="primary" disabled={!cardTitle().trim()}>Add</button><button type="button" class="ghost" onClick={() => setComposeIn(undefined)}>Cancel</button></div>
                </form>
              </Show>

              <div class="cards">
                <For each={cardsOf(column)}>{issue =>
                  <IssueCard issue={issue} statuses={statuses()} active={openIssue() === issue.id} onOpen={() => setOpenIssue(issue.id)}
                    targets={columns()?.filter(c => c.id !== column.id) ?? []} onMove={target => move(issue.id, target)} />
                }</For>
                <Show when={!cardsOf(column).length}><p class="column-empty">No issues</p></Show>
              </div>
            </section>
          }</For>

          <section class="add-column">
            <input placeholder="Add a column" value={newColumn()} onInput={e => setNewColumn(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addColumn(); } }} />
            <button onClick={addColumn} disabled={!newColumn().trim()}>+ Add column</button>
          </section>
        </div>

        <Show when={openIssue()}>{id =>
          <IssueDetail issueId={id()} statuses={statuses()} onChanged={() => { reloadIssues(); }} onClose={() => setOpenIssue(undefined)} />
        }</Show>

        <Show when={menu()}>{context =>
          <div class="column-menu" style={{ left: `${context().x}px`, top: `${context().y}px` }} onClick={event => event.stopPropagation()}>
            <button onClick={() => renameColumn(context().column)}>Rename column</button>
            <details class="column-menu-map"><summary>Map statuses</summary>
              <For each={statuses()}>{status =>
                <label><input type="checkbox" checked={context().column.status_ids.includes(status.id)} onChange={e => mapStatus(context().column, status.id, e.currentTarget.checked)} /><i style={{ background: status.color }} />{status.name}</label>
              }</For>
            </details>
            <button class="danger" onClick={() => removeColumn(context().column)}>Delete column</button>
          </div>
        }</Show>

        <Show when={!columns()?.length}><p class="hint pad">This board has no columns yet — add one above.</p></Show>
        <section class="backlog"><h2>Backlog</h2><Backlog boardId={b().id} columns={columns() ?? []} sprintId={sprintId()} moved={reloadIssues} /></section>
      </div>
    }</Show>
  </section>;
}

/** A card carries what the work actually is: who, when, and its to-do progress. */
function IssueCard(props: { issue: Issue; statuses?: Status[]; active: boolean; onOpen: () => void; targets: BoardColumn[]; onMove: (columnId: string) => void }) {
  const [detail] = createResource(() => props.issue.id, id => planningApi.issue(id));
  const [items] = createResource(() => detail()?.checklists?.[0]?.id, id => id ? planningApi.items(id) : Promise.resolve([]));
  const assignee = () => { const id = props.issue.assignee_id; if (!id) return undefined; const p = profiles()?.find(x => x.id === id); return p ? (p.display_name || p.username) : id; };
  const status = () => props.statuses?.find(s => s.id === props.issue.status_id);
  const doneCount = () => items()?.filter(i => i.item_done).length ?? 0;
  const overdue = () => !!props.issue.due_date && props.issue.due_date < new Date().toISOString().slice(0, 10);
  return <article classList={{ "issue-card": true, active: props.active }} role="button" tabindex="0"
      onClick={() => props.onOpen()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(); } }}>
    <div class="card-top"><span class="issue-number">#{props.issue.number}</span><Show when={status()}>{s => <span class="card-status" style={{ background: s().color }} title={s().name} />}</Show></div>
    <strong class="card-title">{props.issue.title}</strong>
    <div class="card-meta">
      <Show when={props.issue.due_date}>{due => <span classList={{ "task-tag": true, due: true, overdue: overdue() }}>{due()}</span>}</Show>
      <Show when={assignee()}>{name => <span class="task-tag assignee">{name()}</span>}</Show>
      <Show when={items()?.length}><span class="task-tag checklist">☑ {doneCount()}/{items()!.length}</span></Show>
      <Show when={detail()?.children?.length}><span class="task-tag sub">⊞ {detail()!.children.length}</span></Show>
    </div>
    <Show when={props.targets.length}>
      <div class="card-move"><For each={props.targets}>{target => <button title={`Move to ${target.name}`} onClick={event => { event.stopPropagation(); props.onMove(target.id); }}>→ {target.name}</button>}</For></div>
    </Show>
  </article>;
}

function Backlog(props: { boardId: string; columns: BoardColumn[]; sprintId?: string; moved: () => unknown }) {
  const [items, { refetch }] = createResource(() => planningApi.backlog(props.boardId));
  const add = async (id: string) => { const target = props.columns[0]; if (!target) return; await planningApi.move(props.boardId, id, target.id, props.sprintId); refetch(); props.moved(); };
  return <>
    <Show when={!items()?.length}><p class="hint">Nothing in the backlog.</p></Show>
    <For each={items()}>{issue => <div class="backlog-row"><span class="issue-number">#{issue.number}</span><strong>{issue.title}</strong><button disabled={!props.columns.length} onClick={() => add(issue.id)}>Add to board</button></div>}</For>
  </>;
}
