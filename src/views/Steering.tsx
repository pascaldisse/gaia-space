import { createResource, For, Show } from "solid-js";
import { planningApi } from "../api/issues";
import { personalApi } from "../api/personal";
import { linkProps, route } from "../router";
import { profileId } from "../session";
type Work={id:string;title:string;kind:"Issue"|"Task";due:string|null;unassigned?:boolean;number?:number};
const date=()=>new Date().toISOString().slice(0,10);
export default function Steering(){
 const project=()=>route().projectId??"";
 const [data]=createResource(()=>[project(),profileId()] as const,async ([id,profile])=>{if(!id||!profile)throw Error("Project context is unavailable.");const [issues,statuses,todos]=await Promise.all([planningApi.issues({project_id:id}),planningApi.statuses(id),personalApi.projectTodos(id,profile,true)]);const closed=new Set(statuses.filter(s=>s.resolved).map(s=>s.id));return [...issues.filter(i=>!i.archived&&!closed.has(i.status_id??"")).map(i=>({id:i.id,title:i.title,kind:"Issue" as const,due:i.due_date,unassigned:!i.assignee_id,number:i.number})),...todos.filter(t=>!t.done).map(t=>({id:t.id,title:t.content,kind:"Task" as const,due:t.due_date}))]});
 const rows=(items:Work[])=><ul><For each={items.slice(0,6)}>{item=><li><b>{item.kind}</b> <Show when={item.number}>{n=><span>#{n()} </span>}</Show><a {...linkProps(item.kind==="Issue"?{view:"Issues",entityType:"issue",entityId:item.id,projectId:project()}:{view:"Project Tasks",projectId:project()})}>{item.title}</a><Show when={item.due}>{d=><time> {d()}</time>}</Show></li>}</For></ul>;
 const work=()=>data()??[]; const bucket=(label:string,items:Work[])=><section class="steering-bucket"><h2>{label} <small>{items.length}</small></h2><Show when={items.length} fallback={<p>All clear.</p>}>{rows(items)}</Show></section>;
 return <section class="resource-view"><header><h1>Steering</h1><p>Project work requiring attention.</p></header><Show when={data.loading}><p>Loading project work…</p></Show><Show when={data.error}>{e=><p class="error" role="alert">Could not load Steering: {String(e())}</p>}</Show><Show when={data()}><div class="steering-grid">{bucket("Overdue",work().filter(x=>!!x.due&&x.due<date()))}{bucket("Due soon",work().filter(x=>!!x.due&&x.due>=date()&&x.due<=new Date(Date.now()+6048e5).toISOString().slice(0,10)))}{bucket("Unassigned",work().filter(x=>"unassigned" in x&&x.unassigned))}</div><section><h2>Current work</h2>{rows(work())}</section></Show></section>;
}
