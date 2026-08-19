import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Board, type BoardColumn } from "../api/issues";
import "./Boards.css";
import { ProjectPicker } from "../components/Pickers";
import { projectId as sessionProject, setProjectId as setSessionProject, humanError } from "../session";

export default function Boards() {
  const projectId=sessionProject; const setProjectId=setSessionProject; const [board,setBoard]=createSignal<Board>(); const [sprintId,setSprintId]=createSignal<string>(); const [error,setError]=createSignal(""); const [newBoard,setNewBoard]=createSignal(""); const [newColumn,setNewColumn]=createSignal(""); const [newSprint,setNewSprint]=createSignal("");
  const [boards,{refetch:reloadBoards}]=createResource(projectId,id=>id?planningApi.boards(id):Promise.resolve([]));
  const [statuses,{refetch:reloadStatuses}]=createResource(projectId,id=>id?planningApi.statuses(id):Promise.resolve([]));
  createEffect(()=>{if(boards()?.length&&!board())setBoard(boards()![0]); if(board()&&!boards()?.some(b=>b.id===board()!.id))setBoard(boards()?.[0])});
  const [columns,{refetch:reloadColumns}]=createResource(()=>board()?.id,id=>id?planningApi.columns(id):Promise.resolve([]));
  const [sprints,{refetch:reloadSprints}]=createResource(()=>board()?.id,id=>id?planningApi.sprints(id):Promise.resolve([]));
  const [issues,{refetch:reloadIssues}]=createResource(()=>[board()?.id,sprintId()] as const,([id,sprint])=>id?planningApi.boardIssues(id,sprint):Promise.resolve([]));
  const createBoard=async(e:SubmitEvent)=>{e.preventDefault();if(!projectId()||!newBoard().trim())return;try{const b=await planningApi.createBoard({project_id:projectId(),name:newBoard().trim(),backlog_type:"MANUAL",archived:false});setNewBoard("");setBoard(b);reloadBoards()}catch(e){setError(humanError(e))}};
  const createColumn=async()=>{const b=board();if(!b||!newColumn().trim())return;try{await planningApi.saveColumn({board_id:b.id,name:newColumn().trim(),status_ids:[]});setNewColumn("");reloadColumns()}catch(e){setError(humanError(e))}};
  const createSprint=async()=>{const b=board();if(!b||!newSprint().trim())return;try{const s=await planningApi.createSprint({board_id:b.id,name:newSprint().trim(),starts_on:null,ends_on:null,description:null});setNewSprint("");setSprintId(s.id);reloadSprints()}catch(e){setError(humanError(e))}};
  const mapStatus=async(column:BoardColumn,statusId:string,checked:boolean)=>{try{await planningApi.saveColumn({...column,status_ids:checked?[...column.status_ids,statusId]:column.status_ids.filter(id=>id!==statusId)});reloadColumns()}catch(e){setError(humanError(e))}};
  // A board is inert until the project has statuses: columns map statuses, and
  // cards are the issues sitting in those statuses. Offer the standard three
  // rather than leaving the user with silent empty columns.
  const seedStatuses=async()=>{const project=projectId();if(!project)return;try{
    const wanted=[{name:"To do",color:"#7f8da6",resolved:false},{name:"In progress",color:"#00c2a8",resolved:false},{name:"Done",color:"#8fd6a2",resolved:true}];
    const made=[] as string[];
    for(const s of wanted){const created=await planningApi.createStatus({project_id:project,...s});made.push(created?.id??"")}
    await reloadStatuses();
    // Map them onto existing columns in order, so the board works immediately.
    const cols=columns()??[];
    for(let i=0;i<cols.length&&i<made.length;i++){ if(!cols[i].status_ids.length&&made[i]) await planningApi.saveColumn({...cols[i],status_ids:[made[i]]}); }
    reloadColumns();reloadIssues();
  }catch(e){setError(humanError(e))}};
  // Create work where the work lives: a column composes an issue directly,
  // in that column's first status, and puts it on this board (and sprint).
  const [composeIn,setComposeIn]=createSignal<string>();
  const [cardTitle,setCardTitle]=createSignal("");
  const addCard=async(column:BoardColumn)=>{
    const project=projectId(); const b=board(); const title=cardTitle().trim();
    if(!project||!b||!title) return;
    try{
      const issue=await planningApi.createIssue({project_id:project,title,description:null,status_id:column.status_ids[0]??null,assignee_id:null,created_by:null,due_date:null,archived:false});
      await planningApi.move(b.id,issue.id,column.id,sprintId());
      setCardTitle(""); setComposeIn(undefined); reloadIssues();
    }catch(e){setError(humanError(e))}
  };
  const move=async(issueId:string,columnId:string)=>{const b=board();if(!b)return;try{await planningApi.move(b.id,issueId,columnId,sprintId());reloadIssues()}catch(e){setError(humanError(e))}};
  return <section class="planning-view boards-view"><header class="planning-head"><div><h1>Issue boards</h1><p>Columns map one or more issue statuses. Moving a card changes its status.</p></div><ProjectPicker onChange={id=>{setProjectId(id);setBoard(undefined);setSprintId(undefined)}}/></header><Show when={error()}><p class="planning-error">{error()}</p></Show><div class="board-toolbar"><form onSubmit={createBoard}><input placeholder="New board name" value={newBoard()} onInput={e=>setNewBoard(e.currentTarget.value)}/><button class="primary" disabled={!projectId() || !newBoard().trim()} title={!projectId() ? "Wait for a project to load or select one" : undefined}>Create board</button></form><div class="board-tabs"><For each={boards()}>{b=><button classList={{active:board()?.id===b.id}} onClick={()=>{setBoard(b);setSprintId(undefined)}}>{b.name}</button>}</For></div><Show when={board()}>{_b=><><select value={sprintId()??""} onChange={e=>setSprintId(e.currentTarget.value||undefined)}><option value="">All board issues</option><For each={sprints()}>{s=><option value={s.id}>{s.name} · {s.state}</option>}</For></select><div class="inline-form"><input placeholder="New sprint" value={newSprint()} onInput={e=>setNewSprint(e.currentTarget.value)}/><button onClick={createSprint}>Sprint</button></div><For each={sprints()?.filter(s=>s.state==="PLANNED")}>{s=><button class="ghost" title="Launch sprint" onClick={async()=>{await planningApi.launchSprint(s.id);setSprintId(s.id);reloadSprints();reloadIssues()}}>Launch {s.name}</button>}</For></>}</Show></div><Show when={board()} fallback={<p class="hint pad">Enter a project ID, then create or select a board.</p>}>{b=><><Show when={statuses()!==undefined&&!statuses()?.length}><p class="hint pad">This project has no issue statuses yet, so columns cannot hold cards. <button class="primary" onClick={seedStatuses}>Create To do / In progress / Done</button></p></Show><div class="kanban"><For each={columns()}>{column=><section class="board-column"><header><div><h2>{column.name}</h2><small>{column.status_ids.length} statuses</small></div><button class="ghost" onClick={async()=>{await planningApi.deleteColumn(column.id);reloadColumns()}}>×</button></header><div class="column-mapping"><For each={statuses()}>{status=><label><input type="checkbox" checked={column.status_ids.includes(status.id)} onChange={e=>mapStatus(column,status.id,e.currentTarget.checked)}/><i style={{background:status.color}}/>{status.name}</label>}</For></div><div class="column-add"><Show when={composeIn()===column.id} fallback={<button class="ghost column-add-trigger" title={column.status_ids.length?undefined:"Map a status to this column first"} disabled={!column.status_ids.length} onClick={()=>{setComposeIn(column.id);setCardTitle("")}}>+ Add issue</button>}>
              <form onSubmit={e=>{e.preventDefault();void addCard(column)}}><input autofocus placeholder="Issue title" value={cardTitle()} onInput={e=>setCardTitle(e.currentTarget.value)} onKeyDown={e=>{if(e.key==="Escape")setComposeIn(undefined)}}/><button class="primary" disabled={!cardTitle().trim()}>Add</button><button type="button" class="ghost" onClick={()=>setComposeIn(undefined)}>×</button></form>
            </Show></div><div class="cards"><For each={issues()?.filter(issue=>column.status_ids.includes(issue.status_id??""))}>{issue=><article class="issue-card"><span>#{issue.number}</span><strong>{issue.title}</strong><Show when={issue.due_date}><small>{issue.due_date}</small></Show><div class="card-move"><For each={columns()?.filter(c=>c.id!==column.id)}>{target=><button title={`Move to ${target.name}`} onClick={()=>move(issue.id,target.id)}>→ {target.name}</button>}</For></div></article>}</For></div></section>}</For><section class="add-column"><input placeholder="Column name" value={newColumn()} onInput={e=>setNewColumn(e.currentTarget.value)}/><button onClick={createColumn}>Add column</button></section></div><section class="backlog"><h2>Backlog</h2><Backlog boardId={b().id} columns={columns()??[]} sprintId={sprintId()} moved={reloadIssues}/></section></>}</Show></section>;
}
function Backlog(props:{boardId:string;columns:BoardColumn[];sprintId?:string;moved:()=>unknown}) { const [items,{refetch}]=createResource(()=>planningApi.backlog(props.boardId)); const add=async(id:string)=>{const target=props.columns[0];if(!target)return;await planningApi.move(props.boardId,id,target.id,props.sprintId);refetch();props.moved()};return <div class="backlog-items"><Show when={props.columns.length} fallback={<p class="hint">Add a mapped column before adding backlog issues.</p>}><For each={items()}>{item=><div><span>#{item.number}</span> {item.title}<button onClick={()=>add(item.id)}>Add to board</button></div>}</For></Show></div> }
