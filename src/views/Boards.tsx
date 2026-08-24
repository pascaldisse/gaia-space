import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Board, type BoardColumn, type BoardCardSettings, type Issue, type Status } from "../api/issues";
import "./Boards.css";
import { ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import { projectId as sessionProject, setProjectId as setSessionProject, humanError, profiles, reloadProfiles } from "../session";

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
  const [newSwimlane, setNewSwimlane] = createSignal("");
  const [activeSwimlane, setActiveSwimlane] = createSignal<string>();
const [swimlaneGroup, setSwimlaneGroup] = createSignal<"none" | "assignee" | "creator" | "due_date">("none");
  const [openIssue, setOpenIssue] = createSignal<string>();
  const [menu, setMenu] = createSignal<{ column: BoardColumn; x: number; y: number }>();
  // Board chrome is a chip bar: every configuration control lives inside a popover
  // anchored to the chip that owns it, so the board itself is never pushed off screen
  // by a row of naked form fields. One popover may be open at a time.
  const [panel, setPanel] = createSignal<"board" | "sprint" | "lane" | "fields">();
  const [showBacklog, setShowBacklog] = createSignal(true);
  const togglePanel = (name: "board" | "sprint" | "lane" | "fields") => setPanel(open => open === name ? undefined : name);
  const dismiss = () => { setMenu(undefined); setPanel(undefined); };
  // Board-local selection deliberately survives column changes, so one bulk action
  // can span the full filtered board rather than only the visible column.
  const [selectedIssueIds, setSelectedIssueIds] = createSignal<string[]>([]);
  const [bulkColumnId, setBulkColumnId] = createSignal("");
  const [bulkSprintId, setBulkSprintId] = createSignal("");
  // Cards name their assignee — without the directory a card shows a raw profile id.
  if (!profiles()) void reloadProfiles().catch(() => undefined);

  const [boards, { refetch: reloadBoards }] = createResource(projectId, id => id ? planningApi.boards(id) : Promise.resolve([]));
  const [statuses, { refetch: reloadStatuses }] = createResource(projectId, id => id ? planningApi.statuses(id) : Promise.resolve([]));
  createEffect(() => { if (boards()?.length && !board()) setBoard(boards()![0]); if (board() && !boards()?.some(b => b.id === board()!.id)) setBoard(boards()?.[0]); });
  const [columns, { refetch: reloadColumns }] = createResource(() => board()?.id, id => id ? planningApi.columns(id) : Promise.resolve([]));
  const [sprints, { refetch: reloadSprints }] = createResource(() => board()?.id, id => id ? planningApi.sprints(id) : Promise.resolve([]));
  const [swimlanes, { refetch: reloadSwimlanes }] = createResource(() => [board()?.id, sprintId()] as const, ([id, sprint]) => id ? planningApi.swimlanes(id, sprint) : Promise.resolve([]));
  const [cardSettings, { refetch: reloadCardSettings }] = createResource(() => board()?.id, id => id ? planningApi.cardSettings(id) : Promise.resolve<BoardCardSettings>({ board_id: "", fields: [] }));
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
      setNewBoard(""); setPanel(undefined); setBoard(created);
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

  /** Column order is the board's reading order — persist the whole run so an
   *  interrupted reorder cannot leave two columns sharing one ordering. */
  const reorderColumns = async (fromId: string, toId: string) => {
    const list = [...(columns() ?? [])];
    const from = list.findIndex(c => c.id === fromId); const to = list.findIndex(c => c.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = list.splice(from, 1); list.splice(to, 0, moved);
    try {
      for (const [index, column] of list.entries()) if (column.ordering !== index) await planningApi.saveColumn({ ...column, ordering: index });
      reloadColumns();
    } catch (reason) { setError(humanError(reason)); }
  };
  const shiftColumn = async (column: BoardColumn, delta: number) => {
    setMenu(undefined);
    const list = columns() ?? []; const target = list[list.findIndex(c => c.id === column.id) + delta];
    if (target) await reorderColumns(column.id, target.id);
  };
  const lastColumnId = () => { const list = columns() ?? []; return list.length ? list[list.length - 1].id : undefined; };
  const [dragColumn, setDragColumn] = createSignal<string>();
  const [composeIn, setComposeIn] = createSignal<string>();
  const [cardTitle, setCardTitle] = createSignal("");
  const addCard = async (column: BoardColumn) => {
const project = projectId(); const b = board(); const title = cardTitle().trim();
if (!project || !b || !title) return;
try {
const statusId = (await ensureMapped(column)).status_ids[0] ?? "";
const issue = await planningApi.createIssue({ project_id: project, title, description: null, status_id: statusId || null, assignee_id: null, created_by: null, due_date: null, priority: null, archived: false });
await planningApi.move(b.id, issue.id, column.id, sprintId(), undefined, activeSwimlane());
setCardTitle(""); setComposeIn(undefined); await reloadStatuses(); reloadColumns(); reloadIssues(); setOpenIssue(issue.id);
} catch (reason) { setError(humanError(reason)); }
};
/** A column with no mapped status cannot hold work — give it one named after itself before the move. */
const ensureMapped = async (column: BoardColumn): Promise<BoardColumn> => {
if (column.status_ids.length) return column;
const statusId = await statusFor(column.name);
if (!statusId) return column;
const saved = await planningApi.saveColumn({ ...column, status_ids: [statusId] });
await reloadStatuses(); await reloadColumns();
return saved ?? { ...column, status_ids: [statusId] };
};
const move = async (issueId: string, columnId: string) => {
const b = board(); const column = columns()?.find(c => c.id === columnId); if (!b || !column) return;
try { await ensureMapped(column); await planningApi.move(b.id, issueId, columnId, sprintId(), undefined, activeSwimlane()); await reloadIssues(); }
catch (reason) { setError(humanError(reason)); }
};
const [dragOver, setDragOver] = createSignal<string>();
const onDrop = (event: DragEvent, column: BoardColumn) => { event.preventDefault(); setDragOver(undefined); const issueId = event.dataTransfer?.getData("text/issue-id"); if (issueId) void move(issueId, column.id); };
const cardsOf = (column: BoardColumn, laneIssues = issues() ?? []) => laneIssues.filter(issue => column.status_ids.includes(issue.status_id ?? ""));
const laneGroups = () => {
const label = (issue: Issue) => {
if (swimlaneGroup() === "assignee") return issue.assignee_ids?.length ? issue.assignee_ids.map(id => profiles()?.find(p => p.id === id)?.display_name || profiles()?.find(p => p.id === id)?.username || id).join(", ") : "Unassigned";
if (swimlaneGroup() === "creator") return issue.created_by ? profiles()?.find(p => p.id === issue.created_by)?.display_name || profiles()?.find(p => p.id === issue.created_by)?.username || issue.created_by : "No creator";
if (swimlaneGroup() === "due_date") return issue.due_date || "No due date";
return "All work";
};
const groups = new Map<string, Issue[]>();
for (const issue of issues() ?? []) { const name = label(issue); groups.set(name, [...(groups.get(name) ?? []), issue]); }
return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, laneIssues]) => ({ name, laneIssues }));
};
const selected = selectedIssueIds;
const toggleSelected = (id: string, checked: boolean) => setSelectedIssueIds(ids => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(value => value !== id));
const clearSelection = () => setSelectedIssueIds([]);
const bulkMove = async () => { const b = board(); const columnId = bulkColumnId(); if (!b || !columnId || !selected().length) return; try { await planningApi.bulkMove({ board_id: b.id, issue_ids: selected(), column_id: columnId, sprint_id: sprintId() ?? null, swimlane_id: activeSwimlane() ?? null }); clearSelection(); await reloadIssues(); } catch (reason) { setError(humanError(reason)); } };
const bulkSprint = async () => { const b = board(); if (!b || !selected().length) return; try { await planningApi.bulkSprint(b.id, selected(), bulkSprintId() || null); clearSelection(); await reloadIssues(); } catch (reason) { setError(humanError(reason)); } };
const bulkRemove = async () => { const b = board(); if (!b || !selected().length || !confirm(`Remove ${selected().length} selected issue(s) from this board?`)) return; try { await planningApi.bulkRemove(b.id, selected()); clearSelection(); await reloadIssues(); } catch (reason) { setError(humanError(reason)); } };
const addSwimlane = async () => {
  const b = board(); const name = newSwimlane().trim(); if (!b || !name) return;
  try { const lane = await planningApi.saveSwimlane({ board_id: b.id, sprint_id: sprintId() ?? null, name, is_default: !(swimlanes()?.length) }); setNewSwimlane(""); setPanel(undefined); await reloadSwimlanes(); if (lane?.id) setActiveSwimlane(lane.id); }
  catch (reason) { setError(humanError(reason)); }
};
const addSprint = async () => {
  const b = board(); const name = newSprint().trim(); if (!b || !name) return;
  try { const s = await planningApi.createSprint({ board_id: b.id, name, starts_on: null, ends_on: null, description: null }); setNewSprint(""); setPanel(undefined); setSprintId(s.id); reloadSprints(); }
  catch (reason) { setError(humanError(reason)); }
};
const sprintName = () => sprints()?.find(s => s.id === sprintId())?.name ?? "All issues";
return <section class="planning-view boards-view" onClick={dismiss} onKeyDown={event => { if (event.key === "Escape") dismiss(); }}>
    <header class="planning-head"><div><h1>Issue boards</h1><p>Columns map issue statuses. Drag a column header (or use ‹ ›) to reorder; right-click to rename or delete.</p></div><ProjectPicker onChange={id => { setProjectId(id); setBoard(undefined); setSprintId(undefined); }} /></header>
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>

    {/* Tier 1 — which board. Tabs carry the whole switch; creation is a popover. */}
    <div class="board-bar">
      <div class="board-tabs" role="tablist" aria-label="Boards">
        <For each={boards()}>{b => <button role="tab" aria-selected={board()?.id === b.id} classList={{ active: board()?.id === b.id }} onClick={() => { setBoard(b); setSprintId(undefined); setOpenIssue(undefined); }}>{b.name}</button>}</For>
        <Show when={!boards()?.length}><span class="bar-empty">No boards yet</span></Show>
      </div>
      <div class="chip-wrap" onClick={event => event.stopPropagation()}>
        <button class="chip chip-primary" aria-expanded={panel() === "board"} aria-haspopup="dialog" disabled={!projectId()} onClick={() => togglePanel("board")}><span class="chip-plus">＋</span> New board</button>
        <Show when={panel() === "board"}>
          <form class="popover" role="dialog" aria-label="New board" onSubmit={createBoard}>
            <label class="pop-field"><span>Name</span><input autofocus placeholder="New board name" value={newBoard()} onInput={e => setNewBoard(e.currentTarget.value)} /></label>
            <label class="pop-field"><span>Template</span>
              <select value={template()} onChange={e => setTemplate(e.currentTarget.value)} aria-label="Board template">
                <For each={Object.entries(TEMPLATES)}>{([key, value]) => <option value={key}>{value.label}</option>}</For>
              </select>
            </label>
            <div class="pop-actions"><button class="primary" disabled={!projectId() || !newBoard().trim()}>Create board</button><button type="button" class="ghost" onClick={() => setPanel(undefined)}>Cancel</button></div>
          </form>
        </Show>
      </div>
    </div>

    {/* Tier 2 — how this board is read: filters and display, one chip each. */}
    <Show when={board()}>
      <div class="board-viewbar" role="toolbar" aria-label="Board view">
        <div class="chip-group">
          <label class="chip chip-select" title={sprintName()}><span>Sprint</span>
            <select aria-label="Sprint" value={sprintId() ?? ""} onChange={e => setSprintId(e.currentTarget.value || undefined)}>
              <option value="">All issues</option>
              <For each={sprints()}>{s => <option value={s.id}>{s.name} · {s.state}</option>}</For>
            </select>
          </label>
          <div class="chip-wrap" onClick={event => event.stopPropagation()}>
            <button class="chip chip-icon" aria-label="New sprint" title="New sprint" aria-expanded={panel() === "sprint"} onClick={() => togglePanel("sprint")}>＋</button>
            <Show when={panel() === "sprint"}>
              <form class="popover" role="dialog" aria-label="New sprint" onSubmit={e => { e.preventDefault(); void addSprint(); }}>
                <label class="pop-field"><span>Sprint name</span><input autofocus placeholder="New sprint" value={newSprint()} onInput={e => setNewSprint(e.currentTarget.value)} /></label>
                <div class="pop-actions"><button class="primary" disabled={!newSprint().trim()}>Sprint</button><button type="button" class="ghost" onClick={() => setPanel(undefined)}>Cancel</button></div>
              </form>
            </Show>
          </div>
        </div>

        <div class="chip-group">
          <label class="chip chip-select"><span>Lane</span>
            <select aria-label="Swimlane" value={activeSwimlane() ?? ""} onChange={e => setActiveSwimlane(e.currentTarget.value || undefined)}><option value="">No swimlane</option><For each={swimlanes()}>{lane => <option value={lane.id}>{lane.name}{lane.is_default ? " · default" : ""}</option>}</For></select>
          </label>
          <div class="chip-wrap" onClick={event => event.stopPropagation()}>
            <button class="chip chip-icon" aria-label="New swimlane" title="New swimlane" aria-expanded={panel() === "lane"} onClick={() => togglePanel("lane")}>＋</button>
            <Show when={panel() === "lane"}>
              <form class="popover" role="dialog" aria-label="New swimlane" onSubmit={e => { e.preventDefault(); void addSwimlane(); }}>
                <label class="pop-field"><span>Lane name</span><input autofocus placeholder="New swimlane" value={newSwimlane()} onInput={e => setNewSwimlane(e.currentTarget.value)} /></label>
                <div class="pop-actions"><button class="primary" disabled={!newSwimlane().trim()}>Lane</button><button type="button" class="ghost" onClick={() => setPanel(undefined)}>Cancel</button></div>
              </form>
            </Show>
          </div>
        </div>

        <label class="chip chip-select"><span>Group</span>
          <select aria-label="Swimlane grouping" value={swimlaneGroup()} onChange={e => setSwimlaneGroup(e.currentTarget.value as "none" | "assignee" | "creator" | "due_date")}><option value="none">No grouping</option><option value="assignee">Assignee</option><option value="creator">Created by</option><option value="due_date">Due date</option></select>
        </label>

        <div class="chip-wrap" onClick={event => event.stopPropagation()}>
          <button class="chip" aria-expanded={panel() === "fields"} aria-haspopup="dialog" onClick={() => togglePanel("fields")}>Card fields <small>{cardSettings()?.fields?.length ?? 0}</small></button>
          <Show when={panel() === "fields"}>
            <div class="popover pop-list" role="dialog" aria-label="Card fields">
              <p class="pop-hint">What every card shows.</p>
              <For each={["priority", "due_date", "assignees", "checklists", "subitems"]}>{field =>
                <label class="pop-check"><input type="checkbox" checked={cardSettings()?.fields?.includes(field)} onChange={async event => { const settings = cardSettings(); if (!settings) return; const fields = event.currentTarget.checked ? [...settings.fields, field] : settings.fields.filter(value => value !== field); try { await planningApi.saveCardSettings({ ...settings, fields }); reloadCardSettings(); } catch (reason) { setError(humanError(reason)); } }} />{field.replace("_", " ")}</label>
              }</For>
            </div>
          </Show>
        </div>

        <button class="chip chip-toggle" classList={{ active: showBacklog() }} aria-pressed={showBacklog()} onClick={() => setShowBacklog(value => !value)}>Backlog</button>
      </div>
    </Show>

    <Show when={board()} fallback={<p class="hint pad">Create a board to start — it comes with columns ready to use.</p>}>{b => <>
      <Show when={selected().length}><div class="board-bulk-actions" aria-label="Bulk edit selected issues"><strong>{selected().length} selected</strong>
        <select aria-label="Move selected issues to column" value={bulkColumnId()} onChange={e => setBulkColumnId(e.currentTarget.value)}><option value="">Move to column…</option><For each={columns()}>{column => <option value={column.id}>{column.name}</option>}</For></select><button disabled={!bulkColumnId()} onClick={() => void bulkMove()}>Move selected</button>
        <select aria-label="Assign selected issues to sprint" value={bulkSprintId()} onChange={e => setBulkSprintId(e.currentTarget.value)}><option value="">Board backlog</option><For each={sprints()}>{sprint => <option value={sprint.id}>{sprint.name}</option>}</For></select><button onClick={() => void bulkSprint()}>Set sprint</button>
        <button class="danger" onClick={() => void bulkRemove()}>Remove from board</button><button class="ghost" onClick={clearSelection}>Clear</button>
      </div></Show>
      <div class="board-split" classList={{ "with-rail": showBacklog() || !!openIssue() }}>
        <div class="board-canvas">
        <Show when={laneGroups().length} fallback={<p class="hint pad">No issues in this board.</p>}>
<For each={laneGroups()}>{lane => <section class="swimlane-row">
<Show when={swimlaneGroup() !== "none"}><header><strong>{lane.name}</strong><small>{lane.laneIssues.length} issues</small></header></Show>
<div class="kanban">
          <For each={columns()}>{column =>
            <section classList={{ "board-column": true, "column-dragging": dragColumn() === column.id }} onContextMenu={event => { event.preventDefault(); setMenu({ column, x: event.clientX, y: event.clientY }); }}>
              <header class="column-head" draggable={true}
                onDragStart={event => { setDragColumn(column.id); event.dataTransfer?.setData("text/column-id", column.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDragColumn(undefined)}
                onDragOver={event => { if (dragColumn() && dragColumn() !== column.id) event.preventDefault(); }}
                onDrop={event => { event.preventDefault(); const from = event.dataTransfer?.getData("text/column-id") || dragColumn(); setDragColumn(undefined); if (from) void reorderColumns(from, column.id); }}>
                <div class="column-title"><h2>{column.name}</h2><small>{cardsOf(column, lane.laneIssues).length}</small></div>
                <div class="column-order">
                  <button class="column-move" aria-label={`Move ${column.name} left`} title="Move column left" disabled={(columns() ?? [])[0]?.id === column.id} onClick={event => { event.stopPropagation(); void shiftColumn(column, -1); }}>‹</button>
                  <button class="column-move" aria-label={`Move ${column.name} right`} title="Move column right" disabled={lastColumnId() === column.id} onClick={event => { event.stopPropagation(); void shiftColumn(column, 1); }}>›</button>
                </div>
                <button class="column-plus" aria-label={`Add issue to ${column.name}`} title="Add issue" onClick={() => { setComposeIn(column.id); setCardTitle(""); }}>+</button>
              </header>

              <Show when={composeIn() === column.id}>
                <form class="column-compose" onSubmit={e => { e.preventDefault(); void addCard(column); }}>
                  <input autofocus placeholder="Issue title" value={cardTitle()} onInput={e => setCardTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Escape") setComposeIn(undefined); }} />
                  <div class="column-compose-actions"><button class="primary" disabled={!cardTitle().trim()}>Add</button><button type="button" class="ghost" onClick={() => setComposeIn(undefined)}>Cancel</button></div>
                </form>
              </Show>

              <div class="cards" classList={{ "drop-target": dragOver() === column.id }}
                   onDragOver={event => { event.preventDefault(); setDragOver(column.id); }}
                   onDragLeave={() => { if (dragOver() === column.id) setDragOver(undefined); }}
                   onDrop={event => onDrop(event, column)}>
                <For each={cardsOf(column, lane.laneIssues)}>{issue =>
                  <IssueCard issue={issue} statuses={statuses()} fields={cardSettings()?.fields ?? []} active={openIssue() === issue.id} selected={selectedIssueIds().includes(issue.id)} onSelect={checked => toggleSelected(issue.id, checked)} onOpen={() => setOpenIssue(issue.id)}
                    targets={columns()?.filter(c => c.id !== column.id) ?? []} onMove={target => move(issue.id, target)} />
                }</For>
                <Show when={!cardsOf(column, lane.laneIssues).length}><p class="column-empty">No issues</p></Show>
              </div>
            </section>
          }</For>

          <section class="add-column">
            <input placeholder="Add a column" value={newColumn()} onInput={e => setNewColumn(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addColumn(); } }} />
            <button onClick={addColumn} disabled={!newColumn().trim()}>+ Add column</button>
          </section>
        </div>
</section>}</For>
</Show>
        <Show when={!columns()?.length}><p class="hint pad">This board has no columns yet — add one above.</p></Show>
        </div>

        {/* One right rail: the open card owns it, otherwise the backlog does. */}
        <Show when={openIssue() || showBacklog()}>
          <aside class="board-rail" onClick={event => event.stopPropagation()}>
            <Show when={openIssue()} fallback={<>
              <header class="rail-head"><h2>Backlog</h2><button class="chip chip-icon" aria-label="Hide backlog" title="Hide backlog" onClick={() => setShowBacklog(false)}>×</button></header>
              <div class="rail-body"><Backlog boardId={b().id} columns={columns() ?? []} sprintId={sprintId()} swimlaneId={activeSwimlane()} moved={reloadIssues} /></div>
            </>}>{id =>
              <IssueDetail issueId={id()} statuses={statuses()} onChanged={() => { reloadIssues(); }} onClose={() => setOpenIssue(undefined)} />
            }</Show>
          </aside>
        </Show>

        <Show when={menu()}>{context =>
          <div class="column-menu" style={{ left: `${context().x}px`, top: `${context().y}px` }} onClick={event => event.stopPropagation()}>
            <button onClick={() => renameColumn(context().column)}>Rename column</button>
            <button onClick={() => shiftColumn(context().column, -1)} disabled={(columns() ?? [])[0]?.id === context().column.id}>Move column left</button>
            <button onClick={() => shiftColumn(context().column, 1)} disabled={lastColumnId() === context().column.id}>Move column right</button>
            <details class="column-menu-map"><summary>Map statuses</summary>
              <For each={statuses()}>{status =>
                <label><input type="checkbox" checked={context().column.status_ids.includes(status.id)} onChange={e => mapStatus(context().column, status.id, e.currentTarget.checked)} /><i style={{ background: status.color }} />{status.name}</label>
              }</For>
            </details>
            <button class="danger" onClick={() => removeColumn(context().column)}>Delete column</button>
          </div>
        }</Show>

      </div>

      <details class="board-report">
        <summary>Matrix report</summary>
        <BoardMatrix issues={issues() ?? []} columns={columns() ?? []} statuses={statuses()} />
      </details>
    </>}</Show>
  </section>;
}

/** A card carries what the work actually is: who, when, and its to-do progress. */
function IssueCard(props: { issue: Issue; statuses?: Status[]; fields: string[]; active: boolean; selected: boolean; onSelect: (checked: boolean) => void; onOpen: () => void; targets: BoardColumn[]; onMove: (columnId: string) => void }) {
  const [detail] = createResource(() => props.issue.id, id => planningApi.issue(id));
  const [items] = createResource(() => detail()?.checklists?.[0]?.id, id => id ? planningApi.items(id) : Promise.resolve([]));
  const nameOf = (id: string) => { const p = profiles()?.find(x => x.id === id); return p ? (p.display_name || p.username) : id; };
  const people = () => props.issue.assignee_ids?.length ? props.issue.assignee_ids : (props.issue.assignee_id ? [props.issue.assignee_id] : []);
  const status = () => props.statuses?.find(s => s.id === props.issue.status_id);
  const doneCount = () => items()?.filter(i => i.item_done).length ?? 0;
  const overdue = () => !!props.issue.due_date && props.issue.due_date < new Date().toISOString().slice(0, 10);
  return <article classList={{ "issue-card": true, active: props.active }} role="button" tabindex="0"
      draggable={true}
      onDragStart={event => { event.dataTransfer?.setData("text/issue-id", props.issue.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }}
      onClick={() => props.onOpen()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(); } }}>
    <div class="card-top"><input aria-label={`Select issue #${props.issue.number}`} type="checkbox" checked={props.selected} onClick={event => event.stopPropagation()} onChange={event => props.onSelect(event.currentTarget.checked)} /><span class="issue-number">#{props.issue.number}</span><Show when={status()}>{s => <span class="card-status" style={{ background: s().color }} title={s().name} />}</Show></div>
    <strong class="card-title">{props.issue.title}</strong>
    <div class="card-meta">
      <Show when={props.fields.includes("priority") && props.issue.priority}>{p => <span class={`task-tag prio prio-${p().toLowerCase()}`}>{p()}</span>}</Show>
      <Show when={props.fields.includes("due_date") && props.issue.due_date}>{due => <span classList={{ "task-tag": true, due: true, overdue: overdue() }}>{due()}</span>}</Show>
      <For each={props.fields.includes("assignees") ? people() : []}>{id => <span class="task-tag assignee">{nameOf(id)}</span>}</For>
      <Show when={props.fields.includes("checklists") && items()?.length}><span class="task-tag checklist">☑ {doneCount()}/{items()!.length}</span></Show>
      <Show when={props.fields.includes("subitems") && detail()?.children?.length}><span class="task-tag sub">⊞ {detail()!.children.length}</span></Show>
    </div>
    <Show when={props.targets.length}>
      <div class="card-move"><For each={props.targets}>{target => <button title={`Move to ${target.name}`} onClick={event => { event.stopPropagation(); props.onMove(target.id); }}>→ {target.name}</button>}</For></div>
    </Show>
  </article>;
}

function Backlog(props: { boardId: string; columns: BoardColumn[]; sprintId?: string; swimlaneId?: string; moved: () => unknown }) {
  const [items, { refetch }] = createResource(() => planningApi.backlog(props.boardId));
  const [selected, setSelected] = createSignal<string[]>([]);
  const toggle = (id: string, checked: boolean) => setSelected(ids => checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id));
  const add = async (ids: string[]) => { const column = props.columns[0]; if (!column || !ids.length) return; await planningApi.bulkMove({ board_id: props.boardId, issue_ids: ids, column_id: column.id, sprint_id: props.sprintId ?? null, swimlane_id: props.swimlaneId ?? null }); setSelected([]); refetch(); props.moved(); };
  return <>
    <Show when={selected().length}><button disabled={!props.columns.length} onClick={() => void add(selected())}>Add {selected().length} selected to board</button></Show>
    <Show when={!items()?.length}><p class="hint">Nothing in the backlog.</p></Show>
    <For each={items()}>{issue => <div class="backlog-row"><input aria-label={`Select backlog issue #${issue.number}`} type="checkbox" checked={selected().includes(issue.id)} onChange={event => toggle(issue.id, event.currentTarget.checked)} /><span class="issue-number">#{issue.number}</span><strong>{issue.title}</strong><button disabled={!props.columns.length} onClick={() => void add([issue.id])}>Add to board</button></div>}</For>
  </>;
}

/** A live cross-tab report deliberately derives from the same board query as the
 * board: changing a card immediately changes its cell, without a stale report copy. */
function BoardMatrix(props: { issues: Issue[]; columns: BoardColumn[]; statuses?: Status[] }) {
const [axis, setAxis] = createSignal<"assignee" | "priority">("assignee");
const statusName = (column: BoardColumn) => column.name;
const rowName = (issue: Issue) => axis() === "priority" ? (issue.priority ?? "No priority") : (issue.assignee_ids?.length ? issue.assignee_ids.map(id => profiles()?.find(p => p.id === id)?.display_name ?? id).join(", ") : "Unassigned");
const rows = () => [...new Set(props.issues.map(rowName))].sort((a, b) => a.localeCompare(b));
const inColumn = (issue: Issue, column: BoardColumn) => column.status_ids.includes(issue.status_id ?? "");
return <section class="board-matrix" aria-label="Board matrix report">
<label class="chip chip-select"><span>Rows</span> <select value={axis()} onChange={e => setAxis(e.currentTarget.value as "assignee" | "priority")}><option value="assignee">Assignee</option><option value="priority">Priority</option></select></label>
<Show when={props.issues.length} fallback={<p class="hint">No board issues for this matrix.</p>}>
<table><thead><tr><th>{axis() === "assignee" ? "Assignee" : "Priority"}</th><For each={props.columns}>{column => <th>{statusName(column)}</th>}</For><th>Total</th></tr></thead><tbody><For each={rows()}>{row => <tr><th>{row}</th><For each={props.columns}>{column => <td>{props.issues.filter(issue => rowName(issue) === row && inColumn(issue, column)).length}</td>}</For><td>{props.issues.filter(issue => rowName(issue) === row).length}</td></tr>}</For></tbody></table>
</Show>
</section>;
}
