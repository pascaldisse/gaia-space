import { createMemo, createResource, For, Show } from "solid-js";
import { planningApi } from "../api/issues";
import { personalApi } from "../api/personal";
import { chatApi } from "../api/chat";
import { documentsApi } from "../api/documents";
import { meetingsApi } from "../api/meetings";
import { pipelinesApi } from "../api/pipelines";
import { linkProps, route, type Route } from "../router";
import { humanError, profileId, projects, setProjectId } from "../session";
import PageHeader from "../components/PageHeader";
import { projectName } from "../orgScope";
import "./Steering.css";
import "./ProjectHome.css";
type Work={id:string;title:string;kind:"Ticket"|"Task";due:string|null;unassigned?:boolean;number?:number};
const date=()=>new Date().toISOString().slice(0,10);
// A deadline is a date, never a timestamp: the tone and the human note are computed
// from `YYYY-MM-DD` strings only, so no timezone can move the day.
export const DEADLINE_SOON_DAYS = 7;
export function deadlineTone(deadline: string, today = date(), soonDays = DEADLINE_SOON_DAYS) {
  const days = Math.round((Date.parse(deadline + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);
  const tone: "overdue" | "soon" | "ok" = days < 0 ? "overdue" : days <= soonDays ? "soon" : "ok";
  const note = days === 0 ? "due today"
    : days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue`
    : `in ${days} day${days === 1 ? "" : "s"}`;
  return { tone, note, days };
}
export default function Steering(){
 const project=()=>route().projectId??"";
 const [data]=createResource(()=>[project(),profileId()] as const,async ([id,profile])=>{if(!id||!profile)throw Error("Project context is unavailable.");const [issues,statuses,todos]=await Promise.all([planningApi.issues({project_id:id}),planningApi.statuses(id),personalApi.projectTodos(id,profile,true)]);const closed=new Set(statuses.filter(s=>s.resolved).map(s=>s.id));return [...issues.filter(i=>!i.archived&&!closed.has(i.status_id??"")).map(i=>({id:i.id,title:i.title,kind:"Ticket" as const,due:i.due_date,unassigned:!i.assignee_id,number:i.number})),...todos.filter(t=>!t.done).map(t=>({id:t.id,title:t.content,kind:"Task" as const,due:t.due_date}))]});
 // The project at a glance: how much of each surface this project actually holds.
 // Every number comes from an existing list command filtered by project — no new
 // server surface, and a refusal is carried as a value so it reaches the screen as
 // an ERROR rather than as a comforting zero.
 const [glance]=createResource(()=>[project(),profileId()] as const,async ([id,profile])=>{
  if(!id||!profile) return { failed: "Project context is unavailable." } as const;
  try {
   const [issues,statuses,boards,channels,documents,meetings,packages]=await Promise.all([
    planningApi.issues({project_id:id}),
    planningApi.statuses(id),
    planningApi.boards(id),
    chatApi.listChannelsWithMeta(profile),
    documentsApi.listDocuments(),
    meetingsApi.list(profile),
    pipelinesApi.listPackageRepositories(),
   ]);
   const closed=new Set(statuses.filter(s=>s.resolved).map(s=>s.id));
   const projectChannels=channels.filter(c=>c.project_id===id&&!c.archived);
   const channelIds=new Set(projectChannels.map(c=>c.id));
   const now=Date.now()/1000;
   return { counts: {
    issues:issues.filter(i=>!i.archived&&!closed.has(i.status_id??"")).length,
    boards:boards.filter(b=>!b.archived).length,
    channels:projectChannels.length,
    documents:documents.filter(d=>d.container_type==="project"&&d.container_id===id&&!d.archived).length,
    // Upcoming only: a meeting that already ended is not something to steer towards.
    meetings:meetings.filter(m=>!m.archived&&m.channel_id&&channelIds.has(m.channel_id)&&m.ends_at>=now).length,
    packages:packages.filter(p=>p.project_id===id&&!p.archived).length,
   } } as const;
  } catch(reason){ return { failed: humanError(reason) } as const; }
 });
 const glanceFailed=()=>{const value=glance();return value&&"failed" in value?value.failed:"";};
 const counts=()=>{const value=glance();return value&&"counts" in value?value.counts:undefined;};
 const current=createMemo(()=>projects()?.find(p=>p.id===project()));
 const deadline=createMemo(()=>{const value=current()?.deadline;return value?{date:value,...deadlineTone(value)}:undefined;});
 // Each stat is a real link to the surface it counts; following it also moves the
 // session's active project, so desktop (which has no URL) lands in the same place.
 const stat=(label:string,value:number|undefined,target:Route)=>{
  const props=linkProps(target);
  return <a class="ph-stat" href={props.href} onClick={event=>{props.onClick(event);setProjectId(project());}}>
   <span class="ph-stat-num">{value??"—"}</span><span class="ph-stat-label">{label}</span>
  </a>;
 };
 const rows=(items:Work[])=><ul><For each={items.slice(0,6)}>{item=><li><b>{item.kind}</b> <Show when={item.number}>{n=><span>#{n()} </span>}</Show><a {...linkProps(item.kind==="Ticket"?{view:"Issues",entityType:"issue",entityId:item.id,projectId:project()}:{view:"Project Tasks",projectId:project()})}>{item.title}</a><Show when={item.due}>{d=><time> {d()}</time>}</Show></li>}</For></ul>;
 const work=()=>data()??[]; const bucket=(label:string,items:Work[])=><section class="steering-bucket"><h2>{label} <small>{items.length}</small></h2><Show when={items.length} fallback={<p>All clear.</p>}>{rows(items)}</Show></section>;
 return <section class="resource-view"><PageHeader kicker={projectName(project())} title="Steering" subline="Work requiring attention" />
  <Show when={deadline()}>{info=>
   <a class="st-deadline" classList={{[info().tone]:true}} {...linkProps({view:"Calendar",projectId:project()})}>
    <span class="st-deadline-dot"/><span class="st-deadline-label">Project deadline</span><time>{info().date}</time><em>{info().note}</em>
   </a>}
  </Show>
  <Show when={glance.loading}><p class="st-muted">Loading the project overview…</p></Show>
  <Show when={glanceFailed()}>{reason=><p class="error" role="alert">Could not load the project overview: {reason()}</p>}</Show>
  <Show when={counts()}>{value=>
   <div class="ph-stats">
    {stat("Open tickets",value().issues,{view:"Issues",projectId:project()})}
    {stat("Boards",value().boards,{view:"Boards",projectId:project()})}
    {stat("Channels",value().channels,{view:"Chat",projectId:project()})}
    {stat("Documents",value().documents,{view:"Documents",projectId:project()})}
    {stat("Upcoming meetings",value().meetings,{view:"Calendar",projectId:project()})}
    {stat("Packages",value().packages,{view:"Packages",projectId:project()})}
   </div>}
  </Show>
  <Show when={data.loading}><p>Loading project work…</p></Show><Show when={data.error}>{e=><p class="error" role="alert">Could not load Steering: {String(e())}</p>}</Show><Show when={data()}><div class="steering-grid">{bucket("Overdue",work().filter(x=>!!x.due&&x.due<date()))}{bucket("Due soon",work().filter(x=>!!x.due&&x.due>=date()&&x.due<=new Date(Date.now()+6048e5).toISOString().slice(0,10)))}{bucket("Unassigned",work().filter(x=>"unassigned" in x&&x.unassigned))}</div><section><h2>Current work</h2>{rows(work())}</section></Show></section>;
}
