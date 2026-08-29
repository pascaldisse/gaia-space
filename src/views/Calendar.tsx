import { createMemo, createResource, createSignal, createUniqueId, onCleanup, onMount, For, Show, type JSX } from "solid-js";
import { personalApi, type CalendarItem } from "../api/personal";
import { platformApi } from "../api/platform";
import { calendarsApi } from "../api/calendar-feeds";
import { meetingsApi, type Meeting, type MeetingParticipant } from "../api/meetings";
import CallPanel from "./CallPanel";
import { humanError, isWeb, profileId } from "../session";
import { linkProps, route, useDeepLink } from "../router";
import PageHeader from "../components/PageHeader";
import { ProfilePicker } from "../components/Pickers";
import { GhostPill, PillMenu } from "../components/controls";
import SourceLink from "../components/SourceLink";
import DateField from "../components/DateField";
import DateTimeField from "../components/DateTimeField";
import { dateKey, dayRange, itemsOnDay, kindLabels, localInput, meetingIdOf, meetingDraftError, taskDraftError, deadlineDraftError, scheduleDays, scheduleRange, SCHEDULE_DAYS, UI_LOCALE, WEEKDAY_LETTERS, WEEKDAY_NAMES, type QuickKind } from "../calendar";
import "../components/paper.css";
import "./Calendar.css";
import "./Meetings.css";
const startOfDay = (date:Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthRange = (date:Date) => { const first=new Date(date.getFullYear(),date.getMonth(),1); const start=new Date(first); start.setDate(1-first.getDay()); const end=new Date(start); end.setDate(end.getDate()+42); return [start,end] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };
const epoch = (value:string) => Date.parse(value) / 1000;
const atHour = (day:Date, hour:number) => { const at=new Date(day); at.setHours(hour,0,0,0); return Math.floor(at.getTime()/1000); };
const quickKinds:QuickKind[] = ["meeting","task","deadline"];

/** "View options" — the one quiet popover this view keeps.
 *
 *  It replaced a bordered `.calendar-filters` card that stacked a `Display`
 *  fieldset next to captioned fields. Display toggles are set once and then
 *  forgotten; they do not earn a permanent line above the calendar, but they
 *  must stay reachable, so they live one click away behind a GhostPill.
 *
 *  Keyboard contract, same as components/TaskMeta.tsx: Escape closes and hands
 *  focus back to the trigger, a click outside closes, and the trigger states
 *  what it owns (`aria-haspopup`, `aria-expanded`, `aria-controls`).
 *
 *  OPEN/CLOSE IS OWNED BY THE VIEW, not by this component — found by probing
 *  the running app: `PageHeader`'s `actions` is a prop expression, so the whole
 *  action lane is re-created whenever a resource it reads settles. A signal
 *  living inside this component was therefore reset to `false` between the
 *  click and the next frame, and the popover never appeared. State that must
 *  survive a re-creation lives in the surrounding view. */
function ViewOptions(props:{ label:string; open:boolean; setOpen:(open:boolean)=>void; children:JSX.Element }) {
  const open = () => props.open;
  const setOpen = (value:boolean) => props.setOpen(value);
  const menuId = createUniqueId();
  let root!:HTMLDivElement;
  // The trigger is read off the DOM rather than through a `ref` prop: GhostPill
  // renders either a <button> or an <a> and does not declare one.
  const trigger = () => root?.querySelector<HTMLButtonElement>("button.ghost-pill") ?? undefined;
  onMount(() => {
    const away = (event:MouseEvent) => { if (open() && !root.contains(event.target as Node)) setOpen(false); };
    const key = (event:KeyboardEvent) => { if (event.key==="Escape" && open()) { event.stopPropagation(); setOpen(false); trigger()?.focus(); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    onCleanup(() => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); });
  });
  return <div class="cal-viewopts" ref={root}>
    <GhostPill aria-haspopup="dialog" aria-expanded={open()} aria-controls={menuId} onClick={()=>props.setOpen(!props.open)}>{props.label}</GhostPill>
    <Show when={open()}>
      <div class="cal-viewopts-menu" id={menuId} role="dialog" aria-label={props.label}>{props.children}</div>
    </Show>
  </div>;
}
/** One time surface: the calendar shows meetings, task dates and deadlines,
*  and meetings are created, edited and answered here — there is no second
*  "Meetings" destination to keep in sync.
*
*  The month grid is NOT shared as a component with views/HomeCalendar.tsx, on
*  purpose. Home renders 42 `<button class="day">` pills — a day picker, with no
*  content inside a cell. This renders `<article role="gridcell">` cells that
*  carry events, a per-day add affordance, roving-tabindex keyboard handling and
*  three further shapes (week, day, schedule) off the same element. A component
*  covering both would take a mode flag and two a11y contracts, i.e. a rewrite of
*  the thing it was meant to de-duplicate. What actually drifted between the two
*  was the LOOK, and that is shared — in Calendar.css's space-light section and
*  components/paper.css, both written against HomeCalendar.css. */
export default function Calendar(props: { projectId?: string } = {}) {
// Scoping precedence: explicit prop (embedded, e.g. the channel workspace's "Calendar"
// tab) > URL. Everything below reads this one accessor, never route().projectId directly.
const scopeProjectId = () => props.projectId || route().projectId;
// The kicker names the SCOPE: the project when the calendar is project-scoped,
// otherwise the organisation (PageHeader's default when kicker is undefined).
const scopeName = () => { const id=scopeProjectId(); if (!id) return undefined; return (projects() ?? []).find(project=>project.id===id)?.name ?? undefined; };
const [cursor,setCursor] = createSignal(startOfDay(new Date()));
const [view,setView] = createSignal<"month"|"week"|"day"|"schedule">("month");
const [selectedDay,setSelectedDay] = createSignal(startOfDay(new Date()));
const [selected,setSelected] = createSignal<CalendarItem>();
const [composerDay,setComposerDay] = createSignal<Date>();
const [quickKind,setQuickKind] = createSignal<QuickKind>("meeting");
const [form,setForm] = createSignal({ title:"", starts_at:"", ends_at:"", location:"", rrule:"", visibility:"participants" as Meeting["visibility"], modification_preference:"organizer-only" as Meeting["modification_preference"] });
const [taskForm,setTaskForm] = createSignal({ title:"", day:"" });
const [deadlineForm,setDeadlineForm] = createSignal({ project_id:"", day:"" });
const [error,setError] = createSignal("");
const [calendarFilter,setCalendarFilter] = createSignal("all");
const [targetProfile,setTargetProfile] = createSignal("");
const [targetLocation,setTargetLocation] = createSignal("");
const [notice,setNotice] = createSignal("");
const [viewOptionsOpen,setViewOptionsOpen] = createSignal(false);
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
// Same law as `loaded()` below, learned the hard way here: reading a FAILED
// resource re-throws inside whatever computation touches it. `calendarOptions`
// fails whenever the session cannot name an actor, and every read of it sat in
// a render path — so one failing preferences call took the whole calendar with
// it (it took down the View options popover the moment it was opened). Display
// preferences are a nicety; their absence must degrade to "defaults", never to
// a broken page.
const prefs = () => { if (options.error) return undefined; return options(); };
const updateOptions = async (patch:Record<string,boolean|number>) => { const current=prefs(); if (!current) return; try { await personalApi.saveCalendarOptions({...current,...patch}); reloadOptions(); } catch (reason) { setError(humanError(reason)); } };
const meetingOf = (item:CalendarItem|undefined) => item?.kind==="meeting" ? meetings()?.find(m=>m.id===meetingIdOf(item)) : undefined;
const [draft,setDraft] = createSignal<Meeting>();
const [participants,{refetch:reloadParticipants}] = createResource(() => draft()?.id, id => id ? meetingsApi.participants(id, profileId()) : Promise.resolve([]));
// Reading `items()` after a failed load re-throws inside the render; the visible
// alert is the answer for that case, and the grid stays empty rather than crashing.
const loaded = () => { if (items.error) return []; return items() ?? []; };
const scoped = () => { const project=scopeProjectId(); const base=project ? loaded().filter(item=>item.project_id===project) : loaded(); const selected=calendarFilter(); const filtered=selected==="all" ? base : base.filter(item=>item.calendar_id===null || item.calendar_id===selected); const active=prefs(); return filtered.filter(item => (active?.show_todos !== false || item.kind!=="task") && (!active?.working_hours_only || item.kind!=="meeting" || (()=>{const hour=new Date(item.starts_at*1000).getHours();return hour>=active.working_hours_start&&hour<active.working_hours_end;})())); };
// Each view steps by its own span: a month, a week, a day, or a schedule window.
const shift = (amount:number) => { const next=new Date(cursor()); const step={month:0,week:7,day:1,schedule:SCHEDULE_DAYS} as const; if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+step[view() as "week"|"day"|"schedule"]*amount); setCursor(next); if(view()==="day") setSelectedDay(next); };
const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) if(prefs()?.show_weekends!==false || (day.getDay()!==0&&day.getDay()!==6)) result.push(new Date(day)); return result; };
const events = (day:Date) => itemsOnDay(scoped(), day);
const agenda = createMemo(() => itemsOnDay(scoped(), selectedDay()));
const schedule = createMemo(() => scheduleDays(scoped(), cursor()));
// One letter, not three: the month grid must read as quietly as the Home calendar,
// which is the reference. The full name still reaches assistive tech via aria-label.
const weekdayHeads = () => view()==="day"
  ? [{ letter: WEEKDAY_LETTERS[cursor().getDay()], name: WEEKDAY_NAMES[cursor().getDay()] }]
  : WEEKDAY_LETTERS.map((letter,index) => ({ letter, name: WEEKDAY_NAMES[index] }));
// "Today" is a ring on the date chip, the same signal Home uses; it is derived
// per render so a session left open overnight does not keep ringing yesterday.
const today = () => startOfDay(new Date());
// Only projects the session may still give a first deadline to are offered here;
// existing deadlines are edited in Projects, where the whole project is in view.
// The location filter matches `meetings.location` exactly on the server, so the
// options are the locations that ACTUALLY occur on meetings — every entry is
// guaranteed to select something. The old free-text field could only be used by
// someone who already knew the string; the value set is unchanged.
const locationOptions = createMemo(() => [...new Set((meetings() ?? []).map(meeting=>meeting.location?.trim()).filter((location):location is string => !!location))].sort((a,b)=>a.localeCompare(b)));
const deadlineProjects = () => (projects() ?? []).filter(project => !project.archived && !project.deadline && (project.created_by === profileId()));
const openComposer = (day:Date, kind:QuickKind="meeting") => {
  setSelected(undefined); setDraft(undefined); setSelectedDay(day); setComposerDay(day); setQuickKind(kind); setNotice("");
  setForm({ title:"", starts_at:localInput(atHour(day,10)), ends_at:localInput(atHour(day,11)), location:"", rrule:"", visibility:"participants", modification_preference:"organizer-only" });
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
const meeting:Meeting={id:crypto.randomUUID(),title:f.title.trim(),description:null,starts_at,ends_at,rrule:f.rrule.trim()||null,location:f.location.trim()||null,organizer_id:profileId()||null,channel_id:null,visibility:f.visibility,modification_preference:f.modification_preference,archived:false,video_provider:null,video_room_id:null,join_url:null,video_status:"scheduled",video_started_at:null,video_ended_at:null,video_ended_by:null,source_entity_type:null,source_entity_id:null};
await meetingsApi.create(meeting);
const channel_id = await meetingsApi.attachChannel(meeting.id);
const created = { ...meeting, channel_id };
setComposerDay(undefined); setDraft(created); setSelected({id:created.id,source_id:created.id,kind:"meeting",title:created.title,starts_at,ends_at,project_id:null,calendar_id:null,date:null});
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
{/* FILTERS ARE THE HEADER LANE, not a card of their own. Each one's VALUE is
    its label ("Jannes", "All locations"), so no caption floats above a field
    and the row reads like Development's. Names live in `aria-label`. */}
<PageHeader kicker={scopeName()} icon="calendar" title={scopeProjectId() ? "Project calendar" : "Calendar"}
subline={scopeProjectId() ? "This project's meetings, deadlines and time off on one grid" : "Every meeting, deadline and absence on one grid"} />
{/* THE ACTION ROW. New meeting MAKES something, so it leads on the left; every
    picker only changes whose/which calendar you are looking at, so they sit at
    the far end together with the view options. */}
<nav class="page-actionbar" aria-label="Calendar actions">
<button type="button" class="primary" onClick={()=>openComposer(selectedDay())}>New meeting</button>
<span class="actionbar-view-controls">
<ProfilePicker label="Member calendar" labelHidden value={targetProfile() || profileId()} onChange={id=>setTargetProfile(id===profileId()?"":id)}/>
{/* The product's OWN open state, not the operating system's: a native select
    draws its list in a system layer no CSS reaches, which is why these filters
    looked redesigned until the moment they were clicked. */}
<PillMenu
  label="Location calendar"
  value={targetLocation()}
  onChange={setTargetLocation}
  options={[{ value: "", label: "All locations" }, ...locationOptions().map(location => ({ value: location, label: location }))]}
/>
<Show when={(calendars() ?? []).length}>
<PillMenu
  label="Calendar filter"
  value={calendarFilter()}
  onChange={setCalendarFilter}
  options={[{ value: "all", label: "All calendars" }, ...(calendars() ?? []).map(calendar => ({ value: calendar.id, label: calendar.name }))]}
/>
</Show>
{/* WHY THE LEGEND IS IN HERE AND NOT UNDER THE TITLE.
    It is a lookup table, consulted once and then never again — and only for
    the month grid, because the agenda, the schedule and the detail pane all
    print the kind as a word next to the dot. Something read once must not
    hold a permanent line above the calendar; it also must not be deleted,
    because three hues are not self-evident on first sight. So it keeps every
    word, one click away, in the popover that already answers "how is this
    calendar shown?". */}
<ViewOptions label="View options" open={viewOptionsOpen()} setOpen={setViewOptionsOpen}>
<Show when={prefs()} fallback={<p class="cal-viewopts-note">Display preferences could not be loaded; showing the defaults.</p>}>{prefs=><fieldset class="calendar-options"><legend>Show</legend><label><input type="checkbox" checked={prefs().show_weekends} onChange={e=>void updateOptions({show_weekends:e.currentTarget.checked})}/> Weekends</label><label><input type="checkbox" checked={prefs().working_hours_only} onChange={e=>void updateOptions({working_hours_only:e.currentTarget.checked})}/> Working hours</label><label><input type="checkbox" checked={prefs().show_todos} onChange={e=>void updateOptions({show_todos:e.currentTarget.checked})}/> Tasks</label></fieldset>}</Show>
<p class="cal-viewopts-title" id="cal-legend-title">Colours</p>
<ul class="calendar-legend" aria-labelledby="cal-legend-title">
<For each={quickKinds}>{kind=><li class={`cal-key ${kind}`}>{kindLabels[kind]}</li>}</For>
</ul>
</ViewOptions>
</span>
</nav>
{/* ONE CLUSTER, not two orphans (stage 11, defect 1). The switcher chooses the
    SHAPE of the period and the navigation chooses WHICH period — two halves of
    one question, so they sit on one lane separated by a hairline instead of
    being flung to opposite edges. `header-edge` opts the lane into the
    header-edge rule in controls.css: one silhouette, teal only for the active
    member. */}
<div class="calendar-controls cal-toolbar header-edge">
<div class="cal-viewtoggle" role="group" aria-label="Calendar range">
<button classList={{active:view()==="month"}} aria-pressed={view()==="month"} onClick={()=>setView("month")}>Month</button>
<button classList={{active:view()==="week"}} aria-pressed={view()==="week"} onClick={()=>setView("week")}>Week</button>
<button classList={{active:view()==="day"}} aria-pressed={view()==="day"} onClick={()=>{setView("day");setCursor(selectedDay());}}>Day</button>
<button classList={{active:view()==="schedule"}} aria-pressed={view()==="schedule"} onClick={()=>setView("schedule")}>Schedule</button>
</div>
<span class="cal-toolbar-div" aria-hidden="true"/>
<div class="cal-nav">
<button class="icon-button" type="button" aria-label="Previous range" title="Previous range" onClick={()=>shift(-1)}><span aria-hidden="true">‹</span></button>
<strong>{cursor().toLocaleDateString(UI_LOCALE,{month:"long",year:"numeric"})}</strong>
<button class="icon-button" type="button" aria-label="Next range" title="Next range" onClick={()=>shift(1)}><span aria-hidden="true">›</span></button>
<GhostPill class="cal-today" onClick={()=>{const today=startOfDay(new Date()); setCursor(today); setSelectedDay(today);}}>Today</GhostPill>
</div>
</div>
<Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show>
<Show when={notice()}><p class="calendar-notice" role="status">{notice()}</p></Show>
<div class="calendar-main">
<div>
<Show when={view()==="schedule"}>
<div class="cal-schedule" role="list" aria-label="Schedule">
{/* Empty days are not rows: a schedule lists what is scheduled. */}
<Show when={schedule().length} fallback={<p class="cal-side-empty">Nothing scheduled in the next {SCHEDULE_DAYS} days.</p>}>
<For each={schedule()}>{row=><section class="cal-schedule-day" role="listitem">
<h3><time datetime={row.key}>{row.day.toLocaleDateString(UI_LOCALE,{weekday:"long",day:"numeric",month:"long"})}</time></h3>
<For each={row.items}>{event=><button class={`calendar-event ${event.kind}`} onClick={()=>{setSelectedDay(row.day);openEvent(event);}}><span class={`cal-tag ${event.kind}`}>{kindLabels[event.kind]}</span> {event.title}</button>}</For>
</section>}</For>
</Show>
</div>
</Show>
<Show when={view()!=="schedule"}>
<div classList={{"calendar-grid":true,week:view()==="week",day:view()==="day"}} role="grid" aria-label="Calendar days">
<For each={weekdayHeads()}>{day=><strong class="calendar-weekday" role="columnheader" aria-label={day.name}>{day.letter}</strong>}</For>
<For each={days()}>{day=><article role="gridcell" tabindex={dateKey(day)===dateKey(selectedDay())?0:-1} aria-selected={dateKey(day)===dateKey(selectedDay())}
  aria-label={day.toLocaleDateString(UI_LOCALE,{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
  classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth(),today:dateKey(day)===dateKey(today()),selected:dateKey(day)===dateKey(selectedDay())}}
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
<h2>{selectedDay().toLocaleDateString(UI_LOCALE,{weekday:"long",day:"numeric",month:"long"})}</h2>
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
<span class="cal-agenda-time">{kindLabels[item.kind]}{item.kind==="meeting" ? ` · ${new Date(item.starts_at*1000).toLocaleTimeString(UI_LOCALE,{hour:"2-digit",minute:"2-digit"})}` : item.date ? ` · ${item.date}` : ""}</span>
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
<h2>New meeting — {day().toLocaleDateString(UI_LOCALE)}</h2>
{/* The title carries a caption like every other field in this form; the
    aria-label stays, because it is the name tests and assistive tech use. */}
<label>Title<input autofocus placeholder="What is the meeting about?" aria-label="Meeting title" value={form().title} onInput={e=>setForm({...form(),title:e.currentTarget.value})}/></label>
{/* Divs, not labels: a day is chosen with a button now (see components/DateField).
    The draft still carries the same `YYYY-MM-DDTHH:mm` strings, so meetingDraftError
    keeps deciding whether the end really follows the start. */}
<div class="cal-field"><span>Start</span><DateTimeField label="Start" value={form().starts_at} onChange={value=>setForm({...form(),starts_at:value})} clearable={false}/></div>
<div class="cal-field"><span>End</span><DateTimeField label="End" value={form().ends_at} onChange={value=>setForm({...form(),ends_at:value})} clearable={false}/></div>
<label>Location<input value={form().location} onInput={e=>setForm({...form(),location:e.currentTarget.value})}/></label>
<label>Visibility<select value={form().visibility} onChange={e=>setForm({...form(),visibility:e.currentTarget.value as Meeting["visibility"]})}><option value="participants">Participants</option><option value="private">Private</option><option value="public">Public</option></select></label>
<label>Who can edit?<select value={form().modification_preference} onChange={e=>setForm({...form(),modification_preference:e.currentTarget.value as Meeting["modification_preference"]})}><option value="organizer-only">Organizer only</option><option value="participants">Participants</option></select></label>
<label>Repeat<input placeholder="RRULE, e.g. FREQ=WEEKLY;COUNT=4" value={form().rrule} onInput={e=>setForm({...form(),rrule:e.currentTarget.value})}/></label>
<div class="detail-actions"><button class="primary">Create meeting</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
</form>
</Show>
<Show when={quickKind()==="task"}>
<form onSubmit={createTask} aria-label="New task">
<h2>New task — {day().toLocaleDateString(UI_LOCALE)}</h2>
<label>Title<input autofocus placeholder="What needs doing?" aria-label="Task title" value={taskForm().title} onInput={e=>setTaskForm({...taskForm(),title:e.currentTarget.value})}/></label>
<div class="cal-field"><span>Due</span><DateField label="Due" value={taskForm().day} onChange={value=>setTaskForm({...taskForm(),day:value})} clearable={false}/></div>
<div class="detail-actions"><button class="primary">Add task</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
</form>
</Show>
<Show when={quickKind()==="deadline"}>
<form onSubmit={createDeadline} aria-label="New project deadline">
<h2>Project deadline — {day().toLocaleDateString(UI_LOCALE)}</h2>
<label>Project<select aria-label="Project" value={deadlineForm().project_id} onChange={e=>setDeadlineForm({...deadlineForm(),project_id:e.currentTarget.value})}>
<option value="">Select a project…</option>
<For each={deadlineProjects()}>{project=><option value={project.id}>{project.name}</option>}</For>
</select></label>
<div class="cal-field"><span>Date</span><DateField label="Date" value={deadlineForm().day} onChange={value=>setDeadlineForm({...deadlineForm(),day:value})} clearable={false}/></div>
<p class="hint">Only projects you own that have no deadline yet are listed — edit an existing deadline in Projects.</p>
<div class="detail-actions"><button class="primary">Set deadline</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
</form>
</Show>
</aside>
}</Show>
<Show when={composerDay()?undefined:selected()}>{event=>
<aside class="calendar-detail">
<Show when={draft()} fallback={<div><h2>{event().title}</h2><p><span class={`cal-tag ${event().kind}`}>{kindLabels[event().kind]}</span> {event().date ?? new Date(event().starts_at*1000).toLocaleString(UI_LOCALE)}</p><Show when={event().kind==="external"}><p class="hint">Synced from a connected calendar (read-only) — edit it at the source; see Settings to manage the connection.</p></Show><Show when={event().kind!=="meeting"&&event().kind!=="external"}><p class="hint">Open the owning view to edit this item.</p></Show><Show when={event().kind!=="external"}><a {...itemHref(event())}>Open this item</a></Show><button onClick={()=>setSelected(undefined)}>Close</button></div>}>
{item=><div class="meeting-detail">
<div class="detail-actions"><button onClick={save}>Save</button><button class="danger" onClick={archive}>Archive</button><button onClick={()=>{setSelected(undefined);setDraft(undefined)}}>Close</button></div>
<label>Title<input class="meeting-title" aria-label="Meeting title" value={item().title} onInput={e=>setDraft({...item(),title:e.currentTarget.value})}/></label>
<div class="cal-field"><span>Start</span><DateTimeField label="Start" value={localInput(item().starts_at)} onChange={value=>setDraft({...item(),starts_at:epoch(value)})} clearable={false}/></div>
<div class="cal-field"><span>End</span><DateTimeField label="End" value={localInput(item().ends_at)} onChange={value=>setDraft({...item(),ends_at:epoch(value)})} clearable={false}/></div>
<label>Location<input value={item().location??""} onInput={e=>setDraft({...item(),location:e.currentTarget.value||null})}/></label>
<label>Visibility<select value={item().visibility} onChange={e=>setDraft({...item(),visibility:e.currentTarget.value as Meeting["visibility"]})}><option value="participants">Participants</option><option value="private">Private</option><option value="public">Public</option></select></label>
<label>Who can edit?<select value={item().modification_preference} onChange={e=>setDraft({...item(),modification_preference:e.currentTarget.value as Meeting["modification_preference"]})}><option value="organizer-only">Organizer only</option><option value="participants">Participants</option></select></label>
<label>Repeat<input value={item().rrule??""} onInput={e=>setDraft({...item(),rrule:e.currentTarget.value||null})}/></label>
<label>Call status<select aria-label="Call status" value={item().video_status} disabled={item().video_status !== "scheduled"} onChange={e=>setDraft({...item(),video_status:e.currentTarget.value as Meeting["video_status"]})}><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label>
<Show when={item().video_room_id}>{room=><p class="hint" data-meeting-room>Call room: {room()} · {item().join_url}</p>}</Show>
{/* A date arranged in a channel leads back to the message that arranged it. */}
<Show when={item().source_entity_type==="message"&&item().source_entity_id}>{id=><p class="meeting-source">From message: <SourceLink entityType="message" entityId={id() as string}/></p>}</Show>
<a class="meeting-permalink" {...linkProps({view:"Calendar",entityType:"meeting",entityId:item().id})}>Link to this meeting</a><Show when={item().channel_id} fallback={<button onClick={async()=>{ try { const channel_id=await meetingsApi.attachChannel(item().id); setDraft({...item(),channel_id}); reloadMeetings(); } catch(reason) { setError(humanError(reason)); } }}>Attach discussion</button>}><a {...linkProps({view:"Chat",entityType:"channel",entityId:item().channel_id!})}>Open discussion</a></Show>
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
