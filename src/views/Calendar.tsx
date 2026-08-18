import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import { meetingsApi } from "../api/meetings";
import { personalApi } from "../api/personal";
import { platformApi } from "../api/platform";
import { profileId, projectId, projects } from "../session";
import { requestedDate, requestDate } from "../nav";
import { buildCalendarItems, itemsOnDay, monthGrid, startOfDay, dayKeyOf, type CalendarItem } from "../calendar";
import "./Calendar.css";

const monthRange = (date:Date) => { const g = monthGrid(date); return [g[0], new Date(g[41].getFullYear(), g[41].getMonth(), g[41].getDate()+1)] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };
const kindLabel: Record<CalendarItem["kind"], string> = { meeting: "Meeting", task: "Task due", deadline: "Project deadline" };

// One Calendar module serves two IA destinations:
//   • scope "global"  — primary Calendar workspace: every meeting, task due date,
//                        and project deadline across the workspace.
//   • scope "project" — the project Planning tab: the same grid filtered to the
//                        active project (its deadline + its tasks), meetings kept
//                        as shared context. No data is dropped, only filtered.
export default function Calendar(props: { scope?: "global" | "project" }) {
  const scope = () => props.scope ?? "global";
  const [cursor,setCursor] = createSignal(startOfDay(new Date()));
  const [view,setView] = createSignal<"month"|"week">("month");
  const [selected,setSelected] = createSignal<CalendarItem>();
  const [selectedDay,setSelectedDay] = createSignal(dayKeyOf(startOfDay(new Date())));
  const range = () => view()==="month" ? monthRange(cursor()) : weekRange(cursor());

  // Fan out to the three calendar sources for the range, then merge into one
  // typed list. Any single source failing must not blank the calendar.
  const [items] = createResource(() => [range()[0].getTime()/1000, range()[1].getTime()/1000, scope(), projectId()] as const, async ([range_start,range_end,sc,pid]) => {
    const [occurrences,todos,allProjects] = await Promise.all([
      meetingsApi.occurrences(range_start,range_end).catch(()=>[]),
      (sc==="project" && pid ? personalApi.projectTodos(pid, true) : personalApi.todos(profileId(), true)).catch(()=>[]),
      platformApi.projects().catch(()=>[]),
    ]);
    const projectsForScope = sc==="project" && pid ? allProjects.filter(p => p.id===pid) : allProjects;
    return buildCalendarItems({ occurrences, todos, projects: projectsForScope });
  });

  // Deep-link: Overview mini-calendar sets a target day → jump the cursor there,
  // select the day, and clear the request so it fires once.
  createEffect(() => {
    const target = requestedDate();
    if (!target) return;
    const [y,m,d] = target.slice(0,10).split("-").map(Number);
    const day = new Date(y, (m||1)-1, d||1);
    setCursor(startOfDay(day));
    setSelectedDay(target.slice(0,10));
    setSelected(undefined);
    requestDate(undefined);
  });

  const shift = (amount:number) => { const next=new Date(cursor()); if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+7*amount); setCursor(next); };
  const goToday = () => { const t=startOfDay(new Date()); setCursor(t); setSelectedDay(dayKeyOf(t)); };
  const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) result.push(new Date(day)); return result; };
  const events = (day:Date) => itemsOnDay(items() ?? [], dayKeyOf(day));
  const dayAgenda = () => itemsOnDay(items() ?? [], selectedDay());
  const eventLabel = (event:CalendarItem) => event.allDay ? event.title : `${new Date(event.starts_at!*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} ${event.title}`;
  const pickDay = (day:Date) => { setSelectedDay(dayKeyOf(day)); setSelected(undefined); };
  const projectName = () => projects()?.find(p=>p.id===projectId())?.name;
  const readableDay = (key:string) => { const [y,m,d]=key.split("-").map(Number); return new Date(y,(m||1)-1,d||1).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}); };
  const timeRange = (e:CalendarItem) => `${new Date(e.starts_at!*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} – ${new Date(e.ends_at!*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;

  return <section class="calendar-view">
    <header class="calendar-head">
      <div>
        <h1>{scope()==="project" ? "Planning calendar" : "Calendar"}</h1>
        <p>{scope()==="project"
          ? <>Meetings, tasks, and the deadline for <strong>{projectName() ?? "this project"}</strong>. Your whole workspace lives in the top-nav Calendar.</>
          : "Every meeting, task due date, and project deadline across your workspace."}</p>
      </div>
      <div class="calendar-controls">
        <button onClick={()=>shift(-1)}>←</button>
        <strong>{cursor().toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong>
        <button onClick={()=>shift(1)}>→</button>
        <button class="cal-today" onClick={goToday}>Today</button>
        <div class="cal-viewtoggle">
          <button classList={{active:view()==="month"}} onClick={()=>setView("month")}>Month</button>
          <button classList={{active:view()==="week"}} onClick={()=>setView("week")}>Week</button>
        </div>
      </div>
    </header>
    <div class="calendar-legend"><span class="cal-key meeting">Meeting</span><span class="cal-key task">Task due</span><span class="cal-key deadline">Project deadline</span></div>
    <Show when={items.loading}><p class="cal-loading">Loading calendar…</p></Show>
    <div class="calendar-main">
      <div classList={{"calendar-grid":true,week:view()==="week"}}>
        <For each={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]}>{day=><strong class="calendar-weekday">{day}</strong>}</For>
        <For each={days()}>{day=>
          <article classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth(),selected:dayKeyOf(day)===selectedDay()}} onClick={()=>pickDay(day)}>
            <time>{day.getDate()}</time>
            <For each={events(day)}>{event=><button classList={{"calendar-event":true,[event.kind]:true,done:event.done}} onClick={(e)=>{e.stopPropagation();setSelectedDay(event.date);setSelected(event);}}>{eventLabel(event)}</button>}</For>
          </article>}
        </For>
      </div>
      <aside class="calendar-side">
        <header class="cal-side-head"><h2>{readableDay(selectedDay())}</h2><span>{dayAgenda().length} item{dayAgenda().length===1?"":"s"}</span></header>
        <Show when={dayAgenda().length} fallback={<p class="cal-side-empty">Nothing scheduled this day.</p>}>
          <ul class="cal-agenda">
            <For each={dayAgenda()}>{event=>
              <li classList={{[event.kind]:true,done:event.done,active:selected()?.id===event.id}}>
                <button onClick={()=>setSelected(event)}>
                  <span class="cal-agenda-time">{event.allDay ? (event.kind==="deadline"?"Deadline":"All day") : timeRange(event)}</span>
                  <strong>{event.title}</strong>
                  <Show when={event.label}><small class="cal-agenda-label">{event.label}</small></Show>
                  <Show when={event.location}><small>{event.location}</small></Show>
                </button>
              </li>}
            </For>
          </ul>
        </Show>
      </aside>
    </div>
    <Show when={selected()}>{event=>
      <aside class="calendar-detail">
        <div>
          <h2><span classList={{"cal-tag":true,[event().kind]:true}}>{kindLabel[event().kind]}</span> {event().title}</h2>
          <Show when={!event().allDay} fallback={<p>{readableDay(event().date)}{event().kind==="task"&&event().done?" · done":""}</p>}>
            <p>{new Date(event().starts_at!*1000).toLocaleString()} – {new Date(event().ends_at!*1000).toLocaleString()}</p>
          </Show>
          <Show when={event().label}><p>{event().label}</p></Show>
          <Show when={event().location}><p>{event().location}</p></Show>
        </div>
        <button onClick={()=>setSelected(undefined)}>Close</button>
      </aside>}
    </Show>
  </section>;
}
