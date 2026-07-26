import { createResource, createSignal, For, Show } from "solid-js";
import { meetingsApi, type MeetingOccurrence } from "../api/meetings";
import "./Calendar.css";

const startOfDay = (date:Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthRange = (date:Date) => { const first=new Date(date.getFullYear(),date.getMonth(),1); const start=new Date(first); start.setDate(1-first.getDay()); const end=new Date(start); end.setDate(end.getDate()+42); return [start,end] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };

export default function Calendar() {
  const [cursor,setCursor] = createSignal(startOfDay(new Date())); const [view,setView] = createSignal<"month"|"week">("month"); const [selected,setSelected] = createSignal<MeetingOccurrence>();
  const range = () => view()==="month" ? monthRange(cursor()) : weekRange(cursor());
  const [occurrences] = createResource(() => [range()[0].getTime()/1000,range()[1].getTime()/1000] as const, ([range_start,range_end]) => meetingsApi.occurrences(range_start,range_end));
  const shift = (amount:number) => { const next=new Date(cursor()); if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+7*amount); setCursor(next); };
  const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) result.push(new Date(day)); return result; };
  const events = (day:Date) => occurrences()?.filter(item => { const start=new Date(item.starts_at*1000); return start.getFullYear()===day.getFullYear() && start.getMonth()===day.getMonth() && start.getDate()===day.getDate(); }) ?? [];
  return <section class="calendar-view"><header class="calendar-head"><div><h1>Calendar</h1><p>Expanded meeting occurrences for your selected range.</p></div><div class="calendar-controls"><button onClick={()=>shift(-1)}>←</button><strong>{cursor().toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong><button onClick={()=>shift(1)}>→</button><button classList={{active:view()==="month"}} onClick={()=>setView("month")}>Month</button><button classList={{active:view()==="week"}} onClick={()=>setView("week")}>Week</button></div></header><Show when={occurrences.loading}><p>Loading calendar…</p></Show><div classList={{"calendar-grid":true,week:view()==="week"}}><For each={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]}>{day=><strong class="calendar-weekday">{day}</strong>}</For><For each={days()}>{day=><article classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth()}}><time>{day.getDate()}</time><For each={events(day)}>{event=><button class="calendar-event" onClick={()=>setSelected(event)}>{new Date(event.starts_at*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} {event.title}</button>}</For></article>}</For></div><Show when={selected()}>{event=><aside class="calendar-detail"><div><h2>{event().title}</h2><p>{new Date(event().starts_at*1000).toLocaleString()} – {new Date(event().ends_at*1000).toLocaleString()}</p><Show when={event().location}><p>{event().location}</p></Show></div><button onClick={()=>setSelected(undefined)}>Close</button></aside>}</Show></section>;
}
