import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { personalApi, type CalendarItem } from "../api/personal";
import { platformApi } from "../api/platform";
import { calendarsApi } from "../api/calendar-feeds";
import { meetingsApi, type Meeting, type MeetingParticipant } from "../api/meetings";
import CallPanel from "./CallPanel";
import { humanError, isWeb, profileId } from "../session";
import { linkProps, route, useDeepLink } from "../router";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { ProfilePicker } from "../components/Pickers";
import { dateKey, dayRange, itemsOnDay, kindLabels, localInput, meetingIdOf, meetingDraftError, taskDraftError, deadlineDraftError, scheduleDays, scheduleRange, SCHEDULE_DAYS, type QuickKind } from "../calendar";
import "./Calendar.css";
import "./Meetings.css";
const startOfDay = (date:Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthRange = (date:Date) => { const first=new Date(date.getFullYear(),date.getMonth(),1); const start=new Date(first); start.setDate(1-first.getDay()); const end=new Date(start); end.setDate(end.getDate()+42); return [start,end] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };
const epoch = (value:string) => Date.parse(value) / 1000;
const atHour = (day:Date, hour:number) => { const at=new Date(day); at.setHours(hour,0,0,0); return Math.floor(at.getTime()/1000); };
const quickKinds:QuickKind[] = ["meeting","task","deadline"];
/** One time surface: the calendar shows meetings, task dates and deadlines,
*  and meetings are created, edited and answered here — there is no second
*  "Meetings" destination to keep in sync. */
export default function Calendar() {
const [cursor,setCursor] = createSignal(startOfDay(new Date()));
const [view,setView] = createSignal<"month"|"week"|"day"|"schedule">("month");
const [selectedDay,setSelectedDay] = createSignal(startOfDay(new Date()));
const [selected,setSelected] = createSignal<CalendarItem>();
const [composerDay,setComposerDay] = createSignal<Date>();
const [quickKind,setQuickKind] = createSignal<QuickKind>("meeting");
const [form,setForm] = createSignal({ title:"", starts_at:"", ends_at:"", location:"", rrule:"" });
const [taskForm,setTaskForm] = createSignal({ title:"", day:"" });
const [deadlineForm,setDeadlineForm] = createSignal({ project_id:"", day:"" });
const [error,setError] = createSignal("");
const [calendarFilter,setCalendarFilter] = createSignal("all");
const [targetProfile,setTargetProfile] = createSignal("");
const [targetLocation,setTargetLocation] = createSignal("");
const [notice,setNotice] = createSignal("");
const [invitee,setInvitee] = createSignal("");
const range = () => { const at=cursor(); switch (view()) { case "month": return monthRange(at); case "week": return weekRange(at); case "day": return dayRange(at); case "schedule": return scheduleRange(at); } };
// The day window is sent as local day keys as well as instants: date-only items are
// calendar days, and their day must not be re-derived from a UTC instant (H4).
const [items,{refetch}] = createResource(() => { const [start,end]=range(); return [profileId(), targetProfile(), targetLocation(), Math.floor(start.getTime()/1000), Math.floor(end.getTime()/1000), dateKey(start), dateKey(end)] as const; },
  ([profile,target_profile,target_location,range_start,range_end,start_key,end_key]) => profile ? personalApi.calendar(profile,range_start,range_end,start_key,end_key,target_profile||undefined,target_location||undefined) : Promise.resolve([]));
const [meetings,{refetch:reloadMeetings}] = createResource(() => profileId(), profile => profile ? meetingsApi.list(profile) : Promise.resolve([]));
const [projects] = createResource(() => platformApi.projects());
const [calendars] = createResource(() => profileId(), owner => owner ? calendarsApi.list(owner) : Promise.resolve([]));
const [options,{refetch:reloadOptions}] = createResource(() => profileId(), owner => owner ? personalApi.calendarOptions(owner) : Promise.resolve(undefined));
const updateOptions = async (patch:Record<string,boolean|number>) => { const current=options(); if (!current) return; try { await personalApi.saveCalendarOptions({...current,...patch}); reloadOptions(); } catch (reason) { setError(humanError(reason)); } };
const meetingOf = (item:CalendarItem|undefined) => item?.kind==="meeting" ? meetings()?.find(m=>m.id===meetingIdOf(item)) : undefined;
const [draft,setDraft] = createSignal<Meeting>();
const [participants,{refetch:reloadParticipants}] = createResource(() => draft()?.id, id => id ? meetingsApi.participants(id, profileId()) : Promise.resolve([]));
// Reading `items()` after a failed load re-throws inside the render; the visible
// alert is the answer for that case, and the grid stays empty rather than crashing.
const loaded = () => { if (items.error) return []; return items() ?? []; };
const scoped = () => { const project=route().projectId; const base=project ? loaded().filter(item=>item.project_id===project) : loaded(); const selected=calendarFilter(); const filtered=selected==="all" ? base : base.filter(item=>item.calendar_id===null || item.calendar_id===selected); const prefs=options(); return filtered.filter(item => (!prefs?.show_todos || item.kind!=="task") && (!prefs?.working_hours_only || item.kind!=="meeting" || (()=>{const hour=new Date(item.starts_at*1000).getHours();return hour>=prefs.working_hours_start&&hour<prefs.working_hours_end;})())); };
// Each view steps by its own span: a month, a week, a day, or a schedule window.
const shift = (amount:number) => { const next=new Date(cursor()); const step={month:0,week:7,day:1,schedule:SCHEDULE_DAYS} as const; if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+step[view() as "week"|"day"|"schedule"]*amount); setCursor(next); if(view()==="day") setSelectedDay(next); };
const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) if(options()?.show_weekends!==false || (day.getDay()!==0&&day.getDay()!==6)) result.push(new Date(day)); return result; };
const events = (day:Date) => itemsOnDay(scoped(), day);
const agenda = createMemo(() => itemsOnDay(scoped(), selectedDay()));
const schedule = createMemo(() => scheduleDays(scoped(), cursor()));
const weekdayHeads = () => view()==="day" ? [cursor().toLocaleDateString(undefined,{weekday:"short"})] : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
// Only projects the session may still give a first deadline to are offered here;
// existing deadlines are edited in Projects, where the whole project is in view.
const deadlineProjects = () => (projects() ?? []).filter(project => !project.archived && !project.deadline && (project.created_by === profileId()));
const openComposer = (day:Date, kind:QuickKind="meeting") => {
  setSelected(undefined); setDraft(undefined); setSelectedDay(day); setComposerDay(day); setQuickKind(kind); setNotice("");
  setForm({ title:"", starts_at:localInput(atHour(day,10)), ends_at:localInput(atHour(day,11)), location:"", rrule:"" });
  setTaskForm({ title:"", day:dateKey(day) });
  setDeadlineForm({ project_id:"", day:dateKey(day) });
};
const openEvent = (item:CalendarItem) => { setComposerDay(undefined); setSelected(item); setDraft(meetingOf(item)); };
useDeepLink("meeting", (id) => { const found=meetings()?.find(m=>m.id===id); if (found && draft()?.id!==id) { setDraft(found); setSelected({id:found.id,source_id:found.id,kind:"meeting",title:found.title,starts_at:found.starts_at,ends_at:found.ends_at,project_id:null,calendar_id:null,date:null}); } }, () => { setDraft(undefined); setSelected(undefined); });
const create = async (event:SubmitEvent) => {
event.preventDefault();
setError(""); setNotice("");
try {
const f=form(); const invalid=meetingDraftError(f);
if (invalid) throw new Error(invalid);
const starts_at=epoch(f.starts_at), ends_at=epoch(f.ends_at);
// Organizer is always the acting account — the server rebinds it anyway.
const meeting:Meeting={id:crypto.randomUUID(),title:f.title.trim(),description:null,starts_at,ends_at,rrule:f.rrule.trim()||null,location:f.location.trim()||null,organizer_id:profileId()||null,channel_id:null,archived:false};
await meetingsApi.create(meeting);
setComposerDay(undefined); setDraft(meeting); setSelected({id:meeting.id,source_id:meeting.id,kind:"meeting",title:meeting.title,starts_at,ends_at,project_id:null,calendar_id:null,date:null});
reloadMeetings(); refetch();
} catch (reason) { setError(humanError(reason)); }
};
const createTask = async (event:SubmitEvent) => {
event.preventDefault();
setError(""); setNotice("");
try {
const f=taskForm(); const invalid=taskDraftError(f);
if (invalid) throw new Error(invalid);
const owner=profileId();
if (!owner) throw new Error("Select a profile before creating a task.");
// The server rebinds the owner from the session; due_date stays a calendar day.
await personalApi.createTodo({ profile_id:owner, content:f.title.trim(), notes:null, due_date:f.day, project_id:null, done:false, source_entity_type:null, source_entity_id:null, assignee_ids:[], content_kind:"text" });
setComposerDay(undefined); setNotice(`Task added for ${f.day}.`); refetch();
} catch (reason) { setError(humanError(reason)); }
};
const createDeadline = async (event:SubmitEvent) => {
event.preventDefault();
setError(""); setNotice("");
try {
const f=deadlineForm(); const invalid=deadlineDraftError(f);
if (invalid) throw new Error(invalid);
// Narrow command: the project's other fields are never part of this write.
await platformApi.setProjectDeadline(f.project_id, f.day, isWeb() ? null : profileId());
setComposerDay(undefined); setNotice(`Deadline set for ${f.day}.`); refetch();
} catch (reason) { setError(humanError(reason)); }
};
const save = async () => { const item=draft(); if (!item) return; try { await meetingsApi.update(item); reloadMeetings(); refetch(); } catch (reason) { setError(humanError(reason)); } };
const archive = async () => { const item=draft(); if (!item) return; try { await meetingsApi.archive(item.id,true); setDraft(undefined); setSelected(undefined); reloadMeetings(); refetch(); } catch (reason) { setError(humanError(reason)); } };
const invite = async () => { const item=draft(); if (!item || !invitee().trim()) return; try { await meetingsApi.invite(item.id, invitee().trim()); setInvitee(""); reloadParticipants(); } catch (reason) { setError(humanError(reason)); } };
const rsvp = async (participant:MeetingParticipant, status:MeetingParticipant["status"]) => { try { await meetingsApi.rsvp(participant.meeting_id, participant.profile_id, status); reloadParticipants(); } catch (reason) { setError(humanError(reason)); } };
const itemHref = (item:CalendarItem) => item.kind==="meeting" ? linkProps({view:"Calendar",entityType:"meeting",entityId:meetingIdOf(item)}) : item.kind==="deadline" && item.project_id ? linkProps({view:"Projects",projectId:item.project_id}) : linkProps({view:"Todo"});
return <section class="calendar-view">
<WorkspaceHeader icon="calendar-nav" title={route().projectId ? "Project calendar" : "Calendar"} actions={<div class="calendar-controls">
<button aria-label="Previous range" onClick={()=>shift(-1)}>←</button>
<strong>{cursor().toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong>
<button aria-label="Next range" onClick={()=>shift(1)}>→</button>
<button class="cal-today" onClick={()=>{const today=startOfDay(new Date()); setCursor(today); setSelectedDay(today);}}>Today</button>
<div class="cal-viewtoggle" role="group" aria-label="Calendar range">
<button classList={{active:view()==="month"}} aria-pressed={view()==="month"} onClick={()=>setView("month")}>Month</button>
<button classList={{active:view()==="week"}} aria-pressed={view()==="week"} onClick={()=>setView("week")}>Week</button>
<button classList={{active:view()==="day"}} aria-pressed={view()==="day"} onClick={()=>{setView("day");setCursor(selectedDay());}}>Day</button>
<button classList={{active:view()==="schedule"}} aria-pressed={view()==="schedule"} onClick={()=>setView("schedule")}>Schedule</button>
</div>
<button class="primary" onClick={()=>openComposer(selectedDay())}>New meeting</button>
</div>}>Meetings, assigned task dates, and project deadlines visible to your session. Pick a day to see its agenda or add to it.</WorkspaceHeader>
<ul class="calendar-legend" aria-label="Event kinds">
<For each={quickKinds}>{kind=><li class={`cal-key ${kind}`}>{kindLabels[kind]}</li>}</For>
</ul>
<div class="calendar-filters"><Show when={options()}>{prefs=><fieldset class="calendar-options"><legend>Display</legend><label><input type="checkbox" checked={prefs().show_weekends} onChange={e=>void updateOptions({show_weekends:e.currentTarget.checked})}/> Weekends</label><label><input type="checkbox" checked={prefs().working_hours_only} onChange={e=>void updateOptions({working_hours_only:e.currentTarget.checked})}/> Working hours</label><label><input type="checkbox" checked={prefs().show_todos} onChange={e=>void updateOptions({show_todos:e.currentTarget.checked})}/> Tasks</label></fieldset>}</Show><ProfilePicker label="Member calendar" value={targetProfile() || profileId()} onChange={id=>setTargetProfile(id===profileId()?"":id)}/><label class="calendar-filter">Location <input aria-label="Location calendar" value={targetLocation()} onInput={event=>setTargetLocation(event.currentTarget.value)} placeholder="All locations"/></label><Show when={(calendars() ?? []).length}><label class="calendar-filter">Calendar <select aria-label="Calendar filter" value={calendarFilter()} onChange={event=>setCalendarFilter(event.currentTarget.value)}><option value="all">All calendars</option><For each={calendars() ?? []}>{calendar=><option value={calendar.id}>{calendar.name}</option>}</For></select></label></Show></div>
<Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show>
<Show when={notice()}><p class="calendar-notice" role="status">{notice()}</p></Show>
<div class="calendar-main">
<div>
<Show when={view()==="schedule"}>
<div class="cal-schedule" role="list" aria-label="Schedule">
{/* Empty days are not rows: a schedule lists what is scheduled. */}
<Show when={schedule().length} fallback={<p class="cal-side-empty">Nothing scheduled in the next {SCHEDULE_DAYS} days.</p>}>
<For each={schedule()}>{row=><section class="cal-schedule-day" role="listitem">
<h3><time datetime={row.key}>{row.day.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})}</time></h3>
<For each={row.items}>{event=><button class={`calendar-event ${event.kind}`} onClick={()=>{setSelectedDay(row.day);openEvent(event);}}><span class={`cal-tag ${event.kind}`}>{kindLabels[event.kind]}</span> {event.title}</button>}</For>
</section>}</For>
</Show>
</div>
</Show>
<Show when={view()!=="schedule"}>
<div classList={{"calendar-grid":true,week:view()==="week",day:view()==="day"}} role="grid" aria-label="Calendar days">
<For each={weekdayHeads()}>{day=><strong class="calendar-weekday" role="columnheader">{day}</strong>}</For>
<For each={days()}>{day=><article role="gridcell" tabindex={dateKey(day)===dateKey(selectedDay())?0:-1} aria-selected={dateKey(day)===dateKey(selectedDay())}
  aria-label={day.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
  classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth(),selected:dateKey(day)===dateKey(selectedDay())}}
  onClick={()=>{setSelectedDay(day);setComposerDay(undefined);}}
  onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelectedDay(day);setComposerDay(undefined);} if(e.key==="n"||e.key==="N"){e.preventDefault();openComposer(day);} }}
  onDblClick={()=>openComposer(day)}>
<time datetime={dateKey(day)}>{day.getDate()}</time>
<button class="calendar-day-add" aria-label={`Add to ${day.toDateString()}`} title="Add to this day" onClick={e=>{e.stopPropagation();openComposer(day);}}>+</button>
<For each={events(day)}>{event=><button class={`calendar-event ${event.kind}`} onClick={e=>{e.stopPropagation();setSelectedDay(day);openEvent(event);}}><span class={`cal-tag ${event.kind}`}>{kindLabels[event.kind]}</span> {event.title}</button>}</For>
</article>}</For>
</div>
</Show>
</div>
<aside class="calendar-side" aria-label="Selected day">
<div class="cal-side-head">
<h2>{selectedDay().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})}</h2>
<div class="cal-side-head-actions"><span>{agenda().length} item{agenda().length===1?"":"s"}</span></div>
</div>
{/* Loading, failure and "nothing scheduled" are three different answers and are
    never collapsed into one empty list (H7). */}
<Show when={!items.loading} fallback={<p class="cal-loading" role="status">Loading the day…</p>}>
<Show when={!items.error} fallback={<p class="calendar-error" role="alert">This day could not be loaded: {humanError(items.error)}</p>}>
<Show when={agenda().length} fallback={<p class="cal-side-empty">Nothing scheduled on this day.</p>}>
<ul class="cal-agenda">
<For each={agenda()}>{item=><li classList={{[item.kind]:true,active:selected()?.id===item.id}}>
<button onClick={()=>openEvent(item)}>
<span class="cal-agenda-time">{kindLabels[item.kind]}{item.kind==="meeting" ? ` · ${new Date(item.starts_at*1000).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}` : item.date ? ` · ${item.date}` : ""}</span>
<strong>{item.title}</strong>
</button>
<Show when={item.kind!=="external"}><a class="cal-agenda-link" {...itemHref(item)}>Open</a></Show>
</li>}</For>
</ul>
</Show>
</Show>
</Show>
<button class="cal-side-add" onClick={()=>openComposer(selectedDay())}>Add to this day</button>
</aside>
</div>
<Show when={composerDay()}>{day=>
<aside class="calendar-detail meeting-create">
<div class="calendar-kind-picker" role="tablist" aria-label="What to create">
<For each={quickKinds}>{kind=><button role="tab" type="button" aria-selected={quickKind()===kind} classList={{active:quickKind()===kind}} onClick={()=>setQuickKind(kind)}>{kindLabels[kind]}</button>}</For>
</div>
<Show when={quickKind()==="meeting"}>
<form onSubmit={create} aria-label="New meeting">
<h2>New meeting — {day().toLocaleDateString()}</h2>
<input autofocus placeholder="Title" aria-label="Meeting title" value={form().title} onInput={e=>setForm({...form(),title:e.currentTarget.value})}/>
<label>Start<input type="datetime-local" value={form().starts_at} onInput={e=>setForm({...form(),starts_at:e.currentTarget.value})}/></label>
<label>End<input type="datetime-local" value={form().ends_at} onInput={e=>setForm({...form(),ends_at:e.currentTarget.value})}/></label>
<label>Location<input value={form().location} onInput={e=>setForm({...form(),location:e.currentTarget.value})}/></label>
<label>Repeat<input placeholder="RRULE, e.g. FREQ=WEEKLY;COUNT=4" value={form().rrule} onInput={e=>setForm({...form(),rrule:e.currentTarget.value})}/></label>
<div class="detail-actions"><button class="primary">Create meeting</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
</form>
</Show>
<Show when={quickKind()==="task"}>
<form onSubmit={createTask} aria-label="New task">
<h2>New task — {day().toLocaleDateString()}</h2>
<input autofocus placeholder="What needs doing?" aria-label="Task title" value={taskForm().title} onInput={e=>setTaskForm({...taskForm(),title:e.currentTarget.value})}/>
<label>Due<input type="date" value={taskForm().day} onInput={e=>setTaskForm({...taskForm(),day:e.currentTarget.value})}/></label>
<div class="detail-actions"><button class="primary">Add task</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
</form>
</Show>
<Show when={quickKind()==="deadline"}>
<form onSubmit={createDeadline} aria-label="New project deadline">
<h2>Project deadline — {day().toLocaleDateString()}</h2>
<label>Project<select aria-label="Project" value={deadlineForm().project_id} onChange={e=>setDeadlineForm({...deadlineForm(),project_id:e.currentTarget.value})}>
<option value="">Select a project…</option>
<For each={deadlineProjects()}>{project=><option value={project.id}>{project.name}</option>}</For>
</select></label>
<label>Date<input type="date" value={deadlineForm().day} onInput={e=>setDeadlineForm({...deadlineForm(),day:e.currentTarget.value})}/></label>
<p class="hint">Only projects you own that have no deadline yet are listed — edit an existing deadline in Projects.</p>
<div class="detail-actions"><button class="primary">Set deadline</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
</form>
</Show>
</aside>
}</Show>
<Show when={composerDay()?undefined:selected()}>{event=>
<aside class="calendar-detail">
<Show when={draft()} fallback={<div><h2>{event().title}</h2><p><span class={`cal-tag ${event().kind}`}>{kindLabels[event().kind]}</span> {event().date ?? new Date(event().starts_at*1000).toLocaleString()}</p><Show when={event().kind==="external"}><p class="hint">Synced from a connected calendar (read-only) — edit it at the source; see Settings to manage the connection.</p></Show><Show when={event().kind!=="meeting"&&event().kind!=="external"}><p class="hint">Open the owning view to edit this item.</p></Show><Show when={event().kind!=="external"}><a {...itemHref(event())}>Open this item</a></Show><button onClick={()=>setSelected(undefined)}>Close</button></div>}>
{item=><div class="meeting-detail">
<div class="detail-actions"><button onClick={save}>Save</button><button class="danger" onClick={archive}>Archive</button><button onClick={()=>{setSelected(undefined);setDraft(undefined)}}>Close</button></div>
<input class="meeting-title" value={item().title} onInput={e=>setDraft({...item(),title:e.currentTarget.value})}/>
<label>Start<input type="datetime-local" value={localInput(item().starts_at)} onInput={e=>setDraft({...item(),starts_at:epoch(e.currentTarget.value)})}/></label>
<label>End<input type="datetime-local" value={localInput(item().ends_at)} onInput={e=>setDraft({...item(),ends_at:epoch(e.currentTarget.value)})}/></label>
<label>Location<input value={item().location??""} onInput={e=>setDraft({...item(),location:e.currentTarget.value||null})}/></label>
<label>Repeat<input value={item().rrule??""} onInput={e=>setDraft({...item(),rrule:e.currentTarget.value||null})}/></label>
<a class="meeting-permalink" {...linkProps({view:"Calendar",entityType:"meeting",entityId:item().id})}>Link to this meeting</a>
<section class="rsvp">
<h3>Participants</h3>
<div class="inline-form"><ProfilePicker label="" value={invitee()} onChange={setInvitee}/><button onClick={invite}>Invite</button></div>
<For each={participants()}>{participant=><div class="participant"><span>{participant.profile_id}</span><select value={participant.status} onChange={e=>rsvp(participant,e.currentTarget.value as MeetingParticipant["status"])}><option value="invited">Invited</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select></div>}</For>
</section>
<Show when={!isWeb()}><CallPanel meeting={item()} identity={profileId()} displayName={profileId()}/></Show>
</div>}
</Show>
</aside>
}</Show>
</section>;
}
