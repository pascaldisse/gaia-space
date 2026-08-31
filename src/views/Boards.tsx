import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { urgencyOf } from "../statusTone";
import { planningApi, type Board, type BoardColumn, type BoardCardSettings, type Issue, type Status } from "../api/issues";
import "./Boards.css";
import { ProjectPicker } from "../components/Pickers";
import IssueDetail from "./IssueDetail";
import PageHeader, { useEmbedded } from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import { GhostPill, PillMenu, PillSelect } from "../components/controls";
import { Disclosure } from "../components/blocks";
import EmptyState from "../components/EmptyState";
import { linkProps } from "../router";
import { projectName } from "../orgScope";
import { projectId as sessionProject, setProjectId as setSessionProject, humanError, profiles, reloadProfiles } from "../session";

/** Board templates — a new board is usable immediately, Trello-shaped. */
const TEMPLATES: Record<string, { label: string; columns: string[] }> = {
  kanban: { label: "Kanban — To do · In progress · Done", columns: ["To do", "In progress", "Done"] },
  scrum: { label: "Scrum — Backlog · To do · In progress · Review · Done", columns: ["Backlog", "To do", "In progress", "Review", "Done"] },
  blank: { label: "Blank — no columns", columns: [] },
};
const STATUS_COLOR: Record<string, string> = { "To do": "#7f8da6", Backlog: "#6d7c99", "In progress": "#00c2a8", Review: "#c4a9e6", Done: "#8fd6a2" };

export default function Boards() {
  /* EMBEDDED (audit §3.5): mounted inside a project surface the scope is already
     decided, so the host's project wins over the session one and the picker that
     would ask for it again is not rendered. Standalone, nothing changes. */
  const embedded = useEmbedded();
  const projectId = () => embedded()?.projectId || sessionProject();
  const setProjectId = setSessionProject;
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
    if (!confirm(`Delete the column "${column.name}"? Its tickets stay in the project.`)) return;
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
if (swimlaneGroup() === "creator") return issue.created_by ? profiles()?.find(p => p.id === issue.created_by)?.display_name || profiles()?.find(p => p.id === issue.created_by)?.username || issue.created_by : "No creator";
if (swimlaneGroup() === "due_date") return issue.due_date || "No due date";
return "All work";
};
const assigneeLabel = (id: string) => profiles()?.find(p => p.id === id)?.display_name || profiles()?.find(p => p.id === id)?.username || id;
const groups = new Map<string, Issue[]>();
for (const issue of issues() ?? []) {
const names = swimlaneGroup() === "assignee"
? (issue.assignee_ids?.length ? issue.assignee_ids.map(assigneeLabel) : ["Unassigned"])
: [label(issue)];
for (const name of names) groups.set(name, [...(groups.get(name) ?? []), issue]);
}
// An empty board still has columns to show and cards to add to them — a board
// with zero issues must not hide the whole kanban, only report each column empty.
if (!groups.size) groups.set(swimlaneGroup() === "none" ? "All work" : "No issues yet", []);
return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, laneIssues]) => ({ name, laneIssues }));
};
const selected = selectedIssueIds;
const toggleSelected = (id: string, checked: boolean) => setSelectedIssueIds(ids => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(value => value !== id));
const clearSelection = () => setSelectedIssueIds([]);
const bulkMove = async () => { const b = board(); const columnId = bulkColumnId(); if (!b || !columnId || !selected().length) return; try { await planningApi.bulkMove({ board_id: b.id, issue_ids: selected(), column_id: columnId, sprint_id: sprintId() ?? null, swimlane_id: activeSwimlane() ?? null }); clearSelection(); await reloadIssues(); } catch (reason) { setError(humanError(reason)); } };
const bulkSprint = async () => { const b = board(); if (!b || !selected().length) return; try { await planningApi.bulkSprint(b.id, selected(), bulkSprintId() || null); clearSelection(); await reloadIssues(); } catch (reason) { setError(humanError(reason)); } };
const bulkRemove = async () => { const b = board(); if (!b || !selected().length || !confirm(`Remove ${selected().length} selected ticket(s) from this board?`)) return; try { await planningApi.bulkRemove(b.id, selected()); clearSelection(); await reloadIssues(); } catch (reason) { setError(humanError(reason)); } };
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
const sprintName = () => sprints()?.find(s => s.id === sprintId())?.name ?? "All tickets";
return <section class="planning-view boards-view" onClick={dismiss} onKeyDown={event => { if (event.key === "Escape") dismiss(); }}>
    <PageHeader
      kicker={projectName(projectId())}
      icon="columns"
      title="Ticket boards"
      subline={embedded() ? undefined : "Columns map ticket statuses"}
    />
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>

    {/* THE ACTION ROW (PageHeader.css `.page-actionbar`). What MAKES something is on
        the left — a board, a sprint, a swimlane, each opening its own popover — and
        WHICH BOARD you are reading, plus which project, is at the right end. The old
        `.board-bar` was the same row with a hairline of its own under the header's:
        two separators for one introduction. */}
    <nav class="page-actionbar" aria-label="Board actions" onClick={event => event.stopPropagation()}>
      {/* ONE ACTION, ONE PLACE: with no board yet the lead below carries
          "New board", so the row does not draw it twice. */}
      <Show when={board()}>
        <div class="chip-wrap">
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
        {/* A sprint and a swimlane are MADE, so they are acts and live here with the
            board. Their pickers stayed below, on the view bar, where they belong:
            those choose what you look at. */}
        <div class="chip-wrap">
          <button class="chip" aria-haspopup="dialog" aria-expanded={panel() === "sprint"} onClick={() => togglePanel("sprint")}><span class="chip-plus">＋</span> New sprint</button>
          <Show when={panel() === "sprint"}>
            <form class="popover" role="dialog" aria-label="New sprint" onSubmit={e => { e.preventDefault(); void addSprint(); }}>
              <label class="pop-field"><span>Sprint name</span><input autofocus placeholder="New sprint" value={newSprint()} onInput={e => setNewSprint(e.currentTarget.value)} /></label>
              <div class="pop-actions"><button class="primary" disabled={!newSprint().trim()}>Sprint</button><button type="button" class="ghost" onClick={() => setPanel(undefined)}>Cancel</button></div>
            </form>
          </Show>
        </div>
        <div class="chip-wrap">
          <button class="chip" aria-haspopup="dialog" aria-expanded={panel() === "lane"} onClick={() => togglePanel("lane")}><span class="chip-plus">＋</span> New swimlane</button>
          <Show when={panel() === "lane"}>
            <form class="popover" role="dialog" aria-label="New swimlane" onSubmit={e => { e.preventDefault(); void addSwimlane(); }}>
              <label class="pop-field"><span>Lane name</span><input autofocus placeholder="New swimlane" value={newSwimlane()} onInput={e => setNewSwimlane(e.currentTarget.value)} /></label>
              <div class="pop-actions"><button class="primary" disabled={!newSwimlane().trim()}>Lane</button><button type="button" class="ghost" onClick={() => setPanel(undefined)}>Cancel</button></div>
            </form>
          </Show>
        </div>
      </Show>
      <span class="actionbar-view-controls">
        <Show when={boards()?.length}>
          <div class="board-tabs" role="tablist" aria-label="Boards">
            <For each={boards()}>{b => <button role="tab" aria-selected={board()?.id === b.id} classList={{ active: board()?.id === b.id }} onClick={() => { setBoard(b); setSprintId(undefined); setOpenIssue(undefined); }}>{b.name}</button>}</For>
            {/* The full "no board in this project yet" lead with its primary is drawn
                below; a second bare label in the tab strip only repeated it. */}
          </div>
        </Show>
        <Show when={!embedded()}>
          <ProjectPicker labelHidden onChange={id => { setProjectId(id); setBoard(undefined); setSprintId(undefined); }} />
        </Show>
      </span>
    </nav>
    {/* What this surface carries, above the things themselves. */}
    <ContentHead icon="columns" title="Boards" line="Columns are ticket statuses: move a card and the ticket's status moves with it." />

    {/* Tier 2 — how this board is read: filters and display, one chip each. */}
    <Show when={board()}>
      <div class="board-viewbar" role="toolbar" aria-label="Board view">
        <div class="chip-group">
          {/* L4: the VALUE is the label — "All tickets", "No swimlane", "No grouping"
              already read as the caption they used to carry above them. */}
          <PillSelect class="chip chip-select" title={sprintName()} label="Sprint" value={sprintId() ?? ""} onChange={value => setSprintId(value || undefined)}>
            <option value="">All tickets</option>
            <For each={sprints()}>{s => <option value={s.id}>{s.name} · {s.state}</option>}</For>
          </PillSelect>
        </div>

        <div class="chip-group">
          {/* The two ＋ buttons that used to hang off these pickers are acts, so they
              moved up to the action row. What is left here only chooses. */}
          <PillSelect class="chip chip-select" label="Swimlane" value={activeSwimlane() ?? ""} onChange={value => setActiveSwimlane(value || undefined)}>
            <option value="">No swimlane</option><For each={swimlanes()}>{lane => <option value={lane.id}>{lane.name}{lane.is_default ? " · default" : ""}</option>}</For>
          </PillSelect>
        </div>

        {/* Four fixed words that will never grow — PillMenu, so the open list is
           ours. Sprint and Swimlane above stay native: those are project data,
           they grow without bound, and the platform popup handles a long list
           better than anything we would hand-build. */}
        <PillMenu class="chip chip-select" label="Swimlane grouping" value={swimlaneGroup()} onChange={value => setSwimlaneGroup(value as "none" | "assignee" | "creator" | "due_date")}
          options={[
            { value: "none", label: "No grouping" },
            { value: "assignee", label: "Assignee" },
            { value: "creator", label: "Created by" },
            { value: "due_date", label: "Due date" },
          ]} />

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

    {/* NOTHING YET. The board is created for THIS project — the picker in the
        header already fixed it — so the primary opens the creation popover
        directly instead of asking again. */}
    <Show when={board()} fallback={<EmptyState
      title="No board in this project yet"
      hint="A board comes with its columns ready to use — tickets move across them."
      actions={<>
        <button type="button" class="primary" disabled={!projectId()} onClick={event => { event.stopPropagation(); togglePanel("board"); }}>New board</button>
        <GhostPill {...linkProps({ view: "Issues", projectId: projectId() })}>Open tickets</GhostPill>
      </>}
    />}>{b => <>
      <Show when={selected().length}><div class="board-bulk-actions" aria-label="Bulk edit selected tickets"><strong>{selected().length} selected</strong>
        <PillSelect label="Move selected tickets to column" value={bulkColumnId()} onChange={setBulkColumnId}><option value="">Move to column…</option><For each={columns()}>{column => <option value={column.id}>{column.name}</option>}</For></PillSelect><button disabled={!bulkColumnId()} onClick={() => void bulkMove()}>Move selected</button>
        <PillSelect label="Assign selected tickets to sprint" value={bulkSprintId()} onChange={setBulkSprintId}><option value="">Board backlog</option><For each={sprints()}>{sprint => <option value={sprint.id}>{sprint.name}</option>}</For></PillSelect><button onClick={() => void bulkSprint()}>Set sprint</button>
        <button class="danger" onClick={() => void bulkRemove()}>Remove from board</button><button class="ghost" onClick={clearSelection}>Clear</button>
      </div></Show>
      <div class="board-split" classList={{ "with-rail": showBacklog() || !!openIssue() }}>
        <div class="board-canvas">
        {/* NOTHING YET on this board — tickets exist in the project and are put
            ON a board from the backlog, which is exactly what the primary opens. */}
        <Show when={laneGroups().length} fallback={<EmptyState
          title="No tickets on this board yet"
          hint="Tickets reach a board from the backlog, or by being filed straight into a column."
          actions={<>
            <button type="button" class="primary" onClick={event => { event.stopPropagation(); setShowBacklog(true); }}>Open backlog</button>
            <GhostPill {...linkProps({ view: "Issues", projectId: projectId() })}>New ticket</GhostPill>
          </>}
        />}>
<For each={laneGroups()}>{lane => <section class="swimlane-row">
<Show when={swimlaneGroup() !== "none"}><header><strong>{lane.name}</strong><small>{lane.laneIssues.length} tickets</small></header></Show>
<div class="kanban">
          <For each={columns()}>{column =>
            <section classList={{ "board-column": true, "column-dragging": dragColumn() === column.id }} onContextMenu={event => { event.preventDefault(); setMenu({ column, x: event.clientX, y: event.clientY }); }}>
              {/* The old header paragraph explained column handling. It now lives on
                  the thing it explains, where it is actually needed. */}
              <header class="column-head" draggable={true} title="Drag to reorder · right-click to rename or delete"
                onDragStart={event => { setDragColumn(column.id); event.dataTransfer?.setData("text/column-id", column.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => setDragColumn(undefined)}
                onDragOver={event => { if (dragColumn() && dragColumn() !== column.id) event.preventDefault(); }}
                onDrop={event => { event.preventDefault(); const from = event.dataTransfer?.getData("text/column-id") || dragColumn(); setDragColumn(undefined); if (from) void reorderColumns(from, column.id); }}>
                <div class="column-title"><h2>{column.name}</h2><small>{cardsOf(column, lane.laneIssues).length}</small></div>
                <div class="column-order">
                  <button class="column-move" aria-label={`Move ${column.name} left`} title="Move column left" disabled={(columns() ?? [])[0]?.id === column.id} onClick={event => { event.stopPropagation(); void shiftColumn(column, -1); }}>‹</button>
                  <button class="column-move" aria-label={`Move ${column.name} right`} title="Move column right" disabled={lastColumnId() === column.id} onClick={event => { event.stopPropagation(); void shiftColumn(column, 1); }}>›</button>
                </div>
                <button class="column-plus" aria-label={`Add ticket to ${column.name}`} title="Add ticket" onClick={() => { setComposeIn(column.id); setCardTitle(""); }}>+</button>
              </header>

              <Show when={composeIn() === column.id}>
                <form class="column-compose" onSubmit={e => { e.preventDefault(); void addCard(column); }}>
                  <input autofocus placeholder="Ticket title" value={cardTitle()} onInput={e => setCardTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Escape") setComposeIn(undefined); }} />
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
                <Show when={!cardsOf(column, lane.laneIssues).length}><p class="column-empty">No tickets</p></Show>
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
        {/* The "Add a column" field is drawn right beside this, so the line only
            has to point at it — a second create button would be noise. */}
        <Show when={!columns()?.length}><EmptyState title="This board has no columns yet" hint="Add one with the field above — a column maps one or more ticket statuses." /></Show>
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

      {/* ONE DISCLOSURE IDIOM (stage 11, defect 5): sentence case, one hairline,
          one chevron — the same block the Access panel below it uses. */}
      <Disclosure class="board-report" title="Matrix report">
        <BoardMatrix issues={issues() ?? []} columns={columns() ?? []} statuses={statuses()} />
      </Disclosure>
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
  // One urgency model for the whole product; a local date comparison here drifted
  // from the shared law the moment "due soon" was added to it.
  const overdue = () => urgencyOf(props.issue.due_date) === "overdue";
  return <article classList={{ "issue-card": true, active: props.active }} role="button" tabindex="0"
      draggable={true}
      onDragStart={event => { event.dataTransfer?.setData("text/issue-id", props.issue.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"; }}
      onClick={() => props.onOpen()} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(); } }}>
    <div class="card-top"><input aria-label={`Select ticket #${props.issue.number}`} type="checkbox" checked={props.selected} onClick={event => event.stopPropagation()} onChange={event => props.onSelect(event.currentTarget.checked)} /><span class="issue-number">#{props.issue.number}</span><Show when={status()}>{s => <span class="card-status" style={{ background: s().color }} title={s().name} />}</Show></div>
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
    {/* The backlog is a DERIVED list — every ticket of the project that is not on
       this board. There is nothing to create here and nothing to un-filter, so it
       states the fact and stops. */}
    <Show when={!items()?.length}><EmptyState variant="no-match" title="Every ticket is already on this board." /></Show>
    <For each={items()}>{issue => <div class="backlog-row"><input aria-label={`Select backlog ticket #${issue.number}`} type="checkbox" checked={selected().includes(issue.id)} onChange={event => toggle(issue.id, event.currentTarget.checked)} /><span class="issue-number">#{issue.number}</span><strong>{issue.title}</strong><button disabled={!props.columns.length} onClick={() => void add([issue.id])}>Add to board</button></div>}</For>
  </>;
}

/** A live cross-tab report deliberately derives from the same board query as the
 * board: changing a card immediately changes its cell, without a stale report copy. */
function BoardMatrix(props: { issues: Issue[]; columns: BoardColumn[]; statuses?: Status[] }) {
const [axis, setAxis] = createSignal<"assignee" | "priority">("assignee");
const statusName = (column: BoardColumn) => column.name;
const assigneeName = (id: string) => profiles()?.find(p => p.id === id)?.display_name ?? id;
const rows = () => axis() === "priority"
? [...new Set(props.issues.map(issue => issue.priority ?? "No priority"))].sort((a, b) => a.localeCompare(b))
: [...new Set(props.issues.flatMap(issue => issue.assignee_ids?.length ? issue.assignee_ids : [""]))].sort((a, b) => assigneeName(a || "Unassigned").localeCompare(assigneeName(b || "Unassigned")));
const rowLabel = (row: string) => axis() === "priority" ? row : (row ? assigneeName(row) : "Unassigned");
const includesRow = (issue: Issue, row: string) => axis() === "priority"
? (issue.priority ?? "No priority") === row
: row ? issue.assignee_ids.includes(row) : !issue.assignee_ids.length;
const inColumn = (issue: Issue, column: BoardColumn) => column.status_ids.includes(issue.status_id ?? "");
return <section class="board-matrix" aria-label="Board matrix report">
<PillMenu class="chip chip-select" label="Rows" value={axis()} onChange={value => setAxis(value as "assignee" | "priority")}
  options={[{ value: "assignee", label: "Rows: Assignee" }, { value: "priority", label: "Rows: Priority" }]} />
<Show when={props.issues.length} fallback={<EmptyState variant="no-match" title="No board tickets to report on yet." />}>
<table><thead><tr><th>{axis() === "assignee" ? "Assignee" : "Priority"}</th><For each={props.columns}>{column => <th>{statusName(column)}</th>}</For><th>Total</th></tr></thead><tbody><For each={rows()}>{row => <tr><th>{rowLabel(row)}</th><For each={props.columns}>{column => <td>{props.issues.filter(issue => includesRow(issue, row) && inColumn(issue, column)).length}</td>}</For><td>{props.issues.filter(issue => includesRow(issue, row)).length}</td></tr>}</For></tbody></table>
</Show>
</section>;
}
