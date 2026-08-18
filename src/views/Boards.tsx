import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Board, type BoardColumn } from "../api/issues";
import "./Boards.css";
import "./work.css";
import { projectId as sessionProject, projects, humanError } from "../session";

// Project → Work → Board: the status-flow surface. The daily working surface is
// just columns + cards + move. Column plumbing (statuses ↔ columns, add/remove
// columns, boards, sprints) lives behind a discreet "Configure board" panel so
// it never competes with the everyday act of moving work along.
export default function Boards() {
  const projectId=sessionProject; const [board,setBoard]=createSignal<Board>(); const [sprintId,setSprintId]=createSignal<string>(); const [error,setError]=createSignal(""); const [newBoard,setNewBoard]=createSignal(""); const [newColumn,setNewColumn]=createSignal(""); const [newSprint,setNewSprint]=createSignal(""); const [configuring,setConfiguring]=createSignal(false);
  const project=()=>projects()?.find(p=>p.id===projectId());
  const mark=()=>(project()?.key ?? "··").slice(0,2).toUpperCase();
  const [boards,{refetch:reloadBoards}]=createResource(projectId,id=>id?planningApi.boards(id):Promise.resolve([]));
  const [statuses]=createResource(projectId,id=>id?planningApi.statuses(id):Promise.resolve([]));
  createEffect(()=>{projectId();setSprintId(undefined)}); // reset sprint when the active project switches
  createEffect(()=>{if(boards()?.length&&!board())setBoard(boards()![0]); if(board()&&!boards()?.some(b=>b.id===board()!.id))setBoard(boards()?.[0])});
  const [columns,{refetch:reloadColumns}]=createResource(()=>board()?.id,id=>id?planningApi.columns(id):Promise.resolve([]));
  const [sprints,{refetch:reloadSprints}]=createResource(()=>board()?.id,id=>id?planningApi.sprints(id):Promise.resolve([]));
  const [issues,{refetch:reloadIssues}]=createResource(()=>[board()?.id,sprintId()] as const,([id,sprint])=>id?planningApi.boardIssues(id,sprint):Promise.resolve([]));
  const createBoard=async(e:SubmitEvent)=>{e.preventDefault();if(!projectId()||!newBoard().trim())return;try{const b=await planningApi.createBoard({project_id:projectId(),name:newBoard().trim(),backlog_type:"MANUAL",archived:false});setNewBoard("");setBoard(b);reloadBoards()}catch(e){setError(humanError(e))}};
  const createColumn=async()=>{const b=board();if(!b||!newColumn().trim())return;try{await planningApi.saveColumn({board_id:b.id,name:newColumn().trim(),status_ids:[]});setNewColumn("");reloadColumns()}catch(e){setError(humanError(e))}};
  const createSprint=async()=>{const b=board();if(!b||!newSprint().trim())return;try{const s=await planningApi.createSprint({board_id:b.id,name:newSprint().trim(),starts_on:null,ends_on:null,description:null});setNewSprint("");setSprintId(s.id);reloadSprints()}catch(e){setError(humanError(e))}};
  const mapStatus=async(column:BoardColumn,statusId:string,checked:boolean)=>{try{await planningApi.saveColumn({...column,status_ids:checked?[...column.status_ids,statusId]:column.status_ids.filter(id=>id!==statusId)});reloadColumns()}catch(e){setError(humanError(e))}};
  const move=async(issueId:string,columnId:string)=>{const b=board();if(!b)return;try{await planningApi.move(b.id,issueId,columnId,sprintId());reloadIssues()}catch(e){setError(humanError(e))}};

  return <section class="planning-view boards-view">
    <header class="wk-head">
      <div class="wk-title">
        <div class="wk-mark">{mark()}</div>
        <div>
          <h1>Board</h1>
          <p>Move work across status columns to see how the project is flowing. Dragging a card to a new column changes its status.</p>
        </div>
      </div>
      <Show when={board()}>
        <div class="wk-head-actions">
          <button class="ghost" classList={{active:configuring()}} title="Add columns, map statuses, manage boards and sprints" onClick={()=>setConfiguring(v=>!v)}>{configuring()?"Done configuring":"Configure board"}</button>
        </div>
      </Show>
    </header>

    <Show when={error()}><p class="planning-error">{error()}</p></Show>

    {/* Daily toolbar: pick a board, scope to a sprint, launch — no plumbing here. */}
    <Show when={boards()?.length}>
      <div class="board-toolbar">
        <div class="board-tabs"><For each={boards()}>{b=><button classList={{active:board()?.id===b.id}} onClick={()=>{setBoard(b);setSprintId(undefined)}}>{b.name}</button>}</For></div>
        <Show when={board()&&sprints()?.length}>
          <select value={sprintId()??""} onChange={e=>setSprintId(e.currentTarget.value||undefined)}><option value="">All board work</option><For each={sprints()}>{s=><option value={s.id}>{s.name} · {s.state}</option>}</For></select>
        </Show>
        <For each={sprints()?.filter(s=>s.state==="PLANNED")}>{s=><button class="ghost" title="Launch sprint" onClick={async()=>{await planningApi.launchSprint(s.id);setSprintId(s.id);reloadSprints();reloadIssues()}}>Launch {s.name}</button>}</For>
      </div>
    </Show>

    {/* First-run / empty board: premium, no developer language. */}
    <Show when={boards.loading}><p class="wk-muted">Loading boards…</p></Show>
    <Show when={!boards.loading && projectId() && !boards()?.length}>
      <div class="wk-empty">
        <div class="wk-empty-mark">▦</div>
        <h2>No board yet</h2>
        <p>A board turns statuses into columns so you can watch work move from start to done. Create your first one to get going.</p>
        <form class="wk-empty-form" onSubmit={createBoard}>
          <input placeholder="Board name (e.g. Delivery)" value={newBoard()} onInput={e=>setNewBoard(e.currentTarget.value)}/>
          <button class="primary" disabled={!newBoard().trim()}>Create board</button>
        </form>
      </div>
    </Show>
    <Show when={!projectId()}>
      <div class="wk-empty">
        <div class="wk-empty-mark">▦</div>
        <h2>No project selected</h2>
        <p>Choose a project from the switcher above to open its board.</p>
      </div>
    </Show>

    <Show when={board()}>{b=><>
      {/* Discreet configuration surface — kept out of the daily flow. */}
      <Show when={configuring()}>
        <div class="board-config">
          <div class="bc-section">
            <h3>Boards</h3>
            <div class="board-tabs"><For each={boards()}>{bd=><button classList={{active:board()?.id===bd.id}} onClick={()=>setBoard(bd)}>{bd.name}</button>}</For></div>
            <form class="inline-form" onSubmit={createBoard}><input placeholder="New board name" value={newBoard()} onInput={e=>setNewBoard(e.currentTarget.value)}/><button class="primary" disabled={!newBoard().trim()}>Add board</button></form>
          </div>
          <div class="bc-section">
            <h3>Columns &amp; statuses</h3>
            <p class="hint">Each column shows the issues in the statuses you map to it.</p>
            <div class="bc-columns">
              <For each={columns()}>{column=><div class="bc-column">
                <header><strong>{column.name}</strong><button class="ghost" title="Delete column" onClick={async()=>{await planningApi.deleteColumn(column.id);reloadColumns()}}>×</button></header>
                <div class="column-mapping"><For each={statuses()}>{status=><label><input type="checkbox" checked={column.status_ids.includes(status.id)} onChange={e=>mapStatus(column,status.id,e.currentTarget.checked)}/><i style={{background:status.color}}/>{status.name}</label>}</For></div>
              </div>}</For>
              <div class="add-column"><input placeholder="Column name" value={newColumn()} onInput={e=>setNewColumn(e.currentTarget.value)}/><button onClick={createColumn}>Add column</button></div>
            </div>
          </div>
          <div class="bc-section">
            <h3>Sprints</h3>
            <div class="inline-form"><input placeholder="New sprint name" value={newSprint()} onInput={e=>setNewSprint(e.currentTarget.value)}/><button onClick={createSprint}>Add sprint</button></div>
          </div>
        </div>
      </Show>

      {/* Daily working surface: clean columns + cards + move. */}
      <Show when={columns()?.length} fallback={<div class="wk-empty"><div class="wk-empty-mark">▦</div><h2>No columns yet</h2><p>Add columns and map statuses to them so work has somewhere to flow.</p><button class="primary" onClick={()=>setConfiguring(true)}>Configure board</button></div>}>
        <div class="kanban">
          <For each={columns()}>{column=><section class="board-column">
            <header><div><h2>{column.name}</h2><small>{issues()?.filter(i=>column.status_ids.includes(i.status_id??"")).length??0} in flow</small></div></header>
            <div class="cards">
              <For each={issues()?.filter(issue=>column.status_ids.includes(issue.status_id??""))}>{issue=><article class="issue-card"><span>#{issue.number}</span><strong>{issue.title}</strong><Show when={issue.due_date}><small>{issue.due_date}</small></Show><div class="card-move"><For each={columns()?.filter(c=>c.id!==column.id)}>{target=><button title={`Move to ${target.name}`} onClick={()=>move(issue.id,target.id)}>→ {target.name}</button>}</For></div></article>}</For>
              <Show when={!issues()?.filter(i=>column.status_ids.includes(i.status_id??"")).length}><p class="column-empty">Nothing here</p></Show>
            </div>
          </section>}</For>
        </div>
        <section class="backlog"><h2>Backlog</h2><Backlog boardId={b().id} columns={columns()??[]} sprintId={sprintId()} moved={reloadIssues}/></section>
      </Show>
    </>}</Show>
  </section>;
}
function Backlog(props:{boardId:string;columns:BoardColumn[];sprintId?:string;moved:()=>unknown}) { const [items,{refetch}]=createResource(()=>planningApi.backlog(props.boardId)); const add=async(id:string)=>{const target=props.columns[0];if(!target)return;await planningApi.move(props.boardId,id,target.id,props.sprintId);refetch();props.moved()};return <div class="backlog-items"><Show when={props.columns.length} fallback={<p class="hint">Add a mapped column before adding backlog issues.</p>}><Show when={!items()?.length}><p class="hint">Backlog is empty — everything is already on the board.</p></Show><For each={items()}>{item=><div><span>#{item.number}</span> {item.title}<button onClick={()=>add(item.id)}>Add to board</button></div>}</For></Show></div> }
