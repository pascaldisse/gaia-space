import { createResource, createSignal, For, Show } from "solid-js";
import { personalApi, type CalendarItem } from "../api/personal";
import { profileId } from "../session";
import { route } from "../router";
import "./Calendar.css";

const startOfDay = (date:Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthRange = (date:Date) => { const first=new Date(date.getFullYear(),date.getMonth(),1); const start=new Date(first); start.setDate(1-first.getDay()); const end=new Date(start); end.setDate(end.getDate()+42); return [start,end] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };
const labels:Record<CalendarItem["kind"],string>={meeting:"Meeting",task:"Task",deadline:"Deadline"};

export default function Calendar() {
  const [cursor,setCursor] = createSignal(startOfDay(new Date())); const [view,setView] = createSignal<"month"|"week">("month"); const [selected,setSelected] = createSignal<CalendarItem>();
  const range = () => view()==="month" ? monthRange(cursor()) : weekRange(cursor());
  const [items] = createResource(() => [profileId(), range()[0].getTime()/1000, range()[1].getTime()/1000] as const, ([profile,range_start,range_end]) => profile ? personalApi.calendar(profile,range_start,range_end) : Promise.resolve([]));
  const scoped = () => { const project=route().projectId; return project ? (items() ?? []).filter(item=>item.project_id===project) : items() ?? []; };
  const shift = (amount:number) => { const next=new Date(cursor()); if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+7*amount); setCursor(next); };
  const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) result.push(new Date(day)); return result; };
  const events = (day:Date) => scoped().filter(item => { const start=new Date(item.starts_at*1000); return start.getFullYear()===day.getFullYear() && start.getMonth()===day.getMonth() && start.getDate()===day.getDate(); });
  return <section class="calendar-view"><header class="calendar-head"><div><h1>{route().projectId ? "Project calendar" : "Calendar"}</h1><p>Meetings, assigned task dates, and project deadlines visible to your session.</p></div><div class="calendar-controls"><button aria-label="Previous range" onClick={()=>shift(-1)}>←</button><strong>{cursor().toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong><button aria-label="Next range" onClick={()=>shift(1)}>→</button><button classList={{active:view()==="month"}} onClick={()=>setView("month")}>Month</button><button classList={{active:view()==="week"}} onClick={()=>setView("week")}>Week</button></div></header><Show when={items.loading}><p>Loading calendar…</p></Show><Show when={items.error}><p class="calendar-error" role="alert">Calendar failed to load: {String(items.error)}</p></Show><div classList={{"calendar-grid":true,week:view()==="week"}}><For each={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]}>{day=><strong class="calendar-weekday">{day}</strong>}</For><For each={days()}>{day=><article classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth()}}><time>{day.getDate()}</time><For each={events(day)}>{event=><button class={`calendar-event ${event.kind}`} onClick={()=>setSelected(event)}><span>{labels[event.kind]}</span> {event.title}</button>}</For></article>}</For></div><Show when={selected()}>{event=><aside class="calendar-detail"><div><h2>{event().title}</h2><p>{labels[event().kind]} · {new Date(event().starts_at*1000).toLocaleString()}</p></div><button onClick={()=>setSelected(undefined)}>Close</button></aside>}</Show></section>;
}
