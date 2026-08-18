import { createResource, createSignal, For, Show } from "solid-js";
import { meetingsApi } from "../api/meetings";
import { personalApi } from "../api/personal";
import { platformApi } from "../api/platform";
import { profileId } from "../session";
import { buildCalendarItems, itemsOnDay, type CalendarItem } from "../calendar";
import "./Calendar.css";

const startOfDay = (date:Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthRange = (date:Date) => { const first=new Date(date.getFullYear(),date.getMonth(),1); const start=new Date(first); start.setDate(1-first.getDay()); const end=new Date(start); end.setDate(end.getDate()+42); return [start,end] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };
const dayKey = (date:Date) => { const pad=(n:number)=>String(n).padStart(2,"0"); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; };
const kindLabel: Record<CalendarItem["kind"], string> = { meeting: "Meeting", task: "Task due", deadline: "Project deadline" };

export default function Calendar() {
  const [cursor,setCursor] = createSignal(startOfDay(new Date())); const [view,setView] = createSignal<"month"|"week">("month"); const [selected,setSelected] = createSignal<CalendarItem>();
  const range = () => view()==="month" ? monthRange(cursor()) : weekRange(cursor());
  // One resource fans out to the three calendar sources for the selected range, then
  // merges them into a single typed list. Meetings stay timed; task due dates and
  // project deadlines are all-day. Any one source failing must not blank the calendar.
  const [items] = createResource(() => [range()[0].getTime()/1000,range()[1].getTime()/1000] as const, async ([range_start,range_end]) => {
    const [occurrences,todos,projects] = await Promise.all([
      meetingsApi.occurrences(range_start,range_end).catch(()=>[]),
      personalApi.todos(profileId(), true).catch(()=>[]),
      platformApi.projects().catch(()=>[]),
    ]);
    return buildCalendarItems({ occurrences, todos, projects });
  });
  const shift = (amount:number) => { const next=new Date(cursor()); if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+7*amount); setCursor(next); };
  const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) result.push(new Date(day)); return result; };
  const events = (day:Date) => itemsOnDay(items() ?? [], dayKey(day));
  const eventLabel = (event:CalendarItem) => event.allDay ? event.title : `${new Date(event.starts_at!*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} ${event.title}`;
  return <section class="calendar-view"><header class="calendar-head"><div><h1>Calendar</h1><p>Meetings, task due dates, and project deadlines for your selected range.</p></div><div class="calendar-controls"><button onClick={()=>shift(-1)}>←</button><strong>{cursor().toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong><button onClick={()=>shift(1)}>→</button><button classList={{active:view()==="month"}} onClick={()=>setView("month")}>Month</button><button classList={{active:view()==="week"}} onClick={()=>setView("week")}>Week</button></div></header>
    <div class="calendar-legend"><span class="cal-key meeting">Meeting</span><span class="cal-key task">Task due</span><span class="cal-key deadline">Project deadline</span></div>
    <Show when={items.loading}><p>Loading calendar…</p></Show><div classList={{"calendar-grid":true,week:view()==="week"}}><For each={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]}>{day=><strong class="calendar-weekday">{day}</strong>}</For><For each={days()}>{day=><article classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth()}}><time>{day.getDate()}</time><For each={events(day)}>{event=><button classList={{"calendar-event":true,[event.kind]:true,done:event.done}} onClick={()=>setSelected(event)}>{eventLabel(event)}</button>}</For></article>}</For></div>
    <Show when={selected()}>{event=><aside class="calendar-detail"><div><h2><span classList={{"cal-tag":true,[event().kind]:true}}>{kindLabel[event().kind]}</span> {event().title}</h2><Show when={!event().allDay} fallback={<p>{event().date}{event().kind==="task"&&event().done?" · done":""}</p>}><p>{new Date(event().starts_at!*1000).toLocaleString()} – {new Date(event().ends_at!*1000).toLocaleString()}</p></Show><Show when={event().label}><p>{event().label}</p></Show><Show when={event().location}><p>{event().location}</p></Show></div><button onClick={()=>setSelected(undefined)}>Close</button></aside>}</Show></section>;
}
