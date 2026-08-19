import { createResource, createSignal, For, Show } from "solid-js";
import { personalApi, type CalendarItem } from "../api/personal";
import { meetingsApi, type Meeting, type MeetingParticipant } from "../api/meetings";
import CallPanel from "./CallPanel";
import { humanError, isWeb, profileId } from "../session";
import { linkProps, route, useDeepLink } from "../router";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { ProfilePicker } from "../components/Pickers";
import "./Calendar.css";
import "./Meetings.css";

const startOfDay = (date:Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const monthRange = (date:Date) => { const first=new Date(date.getFullYear(),date.getMonth(),1); const start=new Date(first); start.setDate(1-first.getDay()); const end=new Date(start); end.setDate(end.getDate()+42); return [start,end] as const; };
const weekRange = (date:Date) => { const start=startOfDay(date); start.setDate(start.getDate()-start.getDay()); const end=new Date(start); end.setDate(end.getDate()+7); return [start,end] as const; };
const labels:Record<CalendarItem["kind"],string>={meeting:"Meeting",task:"Task",deadline:"Deadline"};
const localInput = (seconds:number) => new Date(seconds * 1000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const epoch = (value:string) => Date.parse(value) / 1000;
const atHour = (day:Date, hour:number) => { const at=new Date(day); at.setHours(hour,0,0,0); return Math.floor(at.getTime()/1000); };

/** One time surface: the calendar shows meetings, task dates and deadlines,
 *  and meetings are created, edited and answered here — there is no second
 *  "Meetings" destination to keep in sync. */
export default function Calendar() {
  const [cursor,setCursor] = createSignal(startOfDay(new Date()));
  const [view,setView] = createSignal<"month"|"week">("month");
  const [selected,setSelected] = createSignal<CalendarItem>();
  const [composerDay,setComposerDay] = createSignal<Date>();
  const [form,setForm] = createSignal({ title:"", starts_at:"", ends_at:"", location:"", rrule:"" });
  const [error,setError] = createSignal("");
  const [invitee,setInvitee] = createSignal("");

  const range = () => view()==="month" ? monthRange(cursor()) : weekRange(cursor());
  const [items,{refetch}] = createResource(() => [profileId(), range()[0].getTime()/1000, range()[1].getTime()/1000] as const, ([profile,range_start,range_end]) => profile ? personalApi.calendar(profile,range_start,range_end) : Promise.resolve([]));
  const [meetings,{refetch:reloadMeetings}] = createResource(() => meetingsApi.list());
  const meetingOf = (item:CalendarItem|undefined) => item?.kind==="meeting" ? meetings()?.find(m=>m.id===item.id) : undefined;
  const [draft,setDraft] = createSignal<Meeting>();
  const [participants,{refetch:reloadParticipants}] = createResource(() => draft()?.id, id => id ? meetingsApi.participants(id) : Promise.resolve([]));

  const scoped = () => { const project=route().projectId; return project ? (items() ?? []).filter(item=>item.project_id===project) : items() ?? []; };
  const shift = (amount:number) => { const next=new Date(cursor()); if(view()==="month") next.setMonth(next.getMonth()+amount); else next.setDate(next.getDate()+7*amount); setCursor(next); };
  const days = () => { const [start,end]=range(); const result:Date[]=[]; for(const day=new Date(start);day<end;day.setDate(day.getDate()+1)) result.push(new Date(day)); return result; };
  const events = (day:Date) => scoped().filter(item => { const start=new Date(item.starts_at*1000); return start.getFullYear()===day.getFullYear() && start.getMonth()===day.getMonth() && start.getDate()===day.getDate(); });

  const openComposer = (day:Date) => { setSelected(undefined); setDraft(undefined); setComposerDay(day); setForm({ title:"", starts_at:localInput(atHour(day,10)), ends_at:localInput(atHour(day,11)), location:"", rrule:"" }); };
  const openEvent = (item:CalendarItem) => { setComposerDay(undefined); setSelected(item); setDraft(meetingOf(item)); };
  useDeepLink("meeting", (id) => { const found=meetings()?.find(m=>m.id===id); if (found && draft()?.id!==id) { setDraft(found); setSelected({id:found.id,kind:"meeting",title:found.title,starts_at:found.starts_at,ends_at:found.ends_at,project_id:null}); } }, () => { setDraft(undefined); setSelected(undefined); });

  const create = async (event:SubmitEvent) => {
    event.preventDefault();
    try {
      const f=form(); const starts_at=epoch(f.starts_at), ends_at=epoch(f.ends_at);
      if (!f.title.trim() || !Number.isFinite(starts_at) || !Number.isFinite(ends_at)) throw new Error("Title, start, and end are required.");
      if (ends_at <= starts_at) throw new Error("The meeting has to end after it starts.");
      // Organizer is always the acting account — the server rebinds it anyway.
      const meeting:Meeting={id:crypto.randomUUID(),title:f.title.trim(),description:null,starts_at,ends_at,rrule:f.rrule.trim()||null,location:f.location.trim()||null,organizer_id:profileId()||null,channel_id:null,archived:false};
      await meetingsApi.create(meeting);
      setComposerDay(undefined); setDraft(meeting); setSelected({id:meeting.id,kind:"meeting",title:meeting.title,starts_at,ends_at,project_id:null});
      reloadMeetings(); refetch();
    } catch (reason) { setError(humanError(reason)); }
  };
  const save = async () => { const item=draft(); if (!item) return; try { await meetingsApi.update(item); reloadMeetings(); refetch(); } catch (reason) { setError(humanError(reason)); } };
  const archive = async () => { const item=draft(); if (!item) return; try { await meetingsApi.archive(item.id,true); setDraft(undefined); setSelected(undefined); reloadMeetings(); refetch(); } catch (reason) { setError(humanError(reason)); } };
  const invite = async () => { const item=draft(); if (!item || !invitee().trim()) return; try { await meetingsApi.invite(item.id, invitee().trim()); setInvitee(""); reloadParticipants(); } catch (reason) { setError(humanError(reason)); } };
  const rsvp = async (participant:MeetingParticipant, status:MeetingParticipant["status"]) => { try { await meetingsApi.rsvp(participant.meeting_id, participant.profile_id, status); reloadParticipants(); } catch (reason) { setError(humanError(reason)); } };

  return <section class="calendar-view">
    <WorkspaceHeader icon="□" title={route().projectId ? "Project calendar" : "Calendar"} actions={<div class="calendar-controls">
      <button aria-label="Previous range" onClick={()=>shift(-1)}>←</button>
      <strong>{cursor().toLocaleDateString(undefined,{month:"long",year:"numeric"})}</strong>
      <button aria-label="Next range" onClick={()=>shift(1)}>→</button>
      <button classList={{active:view()==="month"}} onClick={()=>setView("month")}>Month</button>
      <button classList={{active:view()==="week"}} onClick={()=>setView("week")}>Week</button>
      <button class="primary" onClick={()=>openComposer(startOfDay(new Date()))}>New meeting</button>
    </div>}>Meetings, assigned task dates, and project deadlines visible to your session. Click a day to schedule.</WorkspaceHeader>
    <Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show>
    <Show when={items.loading}><p>Loading calendar…</p></Show>
    <Show when={items.error}><p class="calendar-error" role="alert">Calendar failed to load: {String(items.error)}</p></Show>
    <div classList={{"calendar-grid":true,week:view()==="week"}}>
      <For each={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]}>{day=><strong class="calendar-weekday">{day}</strong>}</For>
      <For each={days()}>{day=><article classList={{"calendar-day":true,muted:view()==="month"&&day.getMonth()!==cursor().getMonth()}} onDblClick={()=>openComposer(day)}>
        <time>{day.getDate()}</time>
        <button class="calendar-day-add" aria-label={`Schedule a meeting on ${day.toDateString()}`} title="Schedule a meeting" onClick={()=>openComposer(day)}>+</button>
        <For each={events(day)}>{event=><button class={`calendar-event ${event.kind}`} onClick={()=>openEvent(event)}><span>{labels[event.kind]}</span> {event.title}</button>}</For>
      </article>}</For>
    </div>

    <Show when={composerDay()}>{day=>
      <aside class="calendar-detail meeting-create">
        <form onSubmit={create}>
          <h2>New meeting — {day().toLocaleDateString()}</h2>
          <input autofocus placeholder="Title" value={form().title} onInput={e=>setForm({...form(),title:e.currentTarget.value})}/>
          <label>Start<input type="datetime-local" value={form().starts_at} onInput={e=>setForm({...form(),starts_at:e.currentTarget.value})}/></label>
          <label>End<input type="datetime-local" value={form().ends_at} onInput={e=>setForm({...form(),ends_at:e.currentTarget.value})}/></label>
          <label>Location<input value={form().location} onInput={e=>setForm({...form(),location:e.currentTarget.value})}/></label>
          <label>Repeat<input placeholder="RRULE, e.g. FREQ=WEEKLY;COUNT=4" value={form().rrule} onInput={e=>setForm({...form(),rrule:e.currentTarget.value})}/></label>
          <div class="detail-actions"><button class="primary">Create meeting</button><button type="button" onClick={()=>setComposerDay(undefined)}>Cancel</button></div>
        </form>
      </aside>
    }</Show>

    <Show when={composerDay()?undefined:selected()}>{event=>
      <aside class="calendar-detail">
        <Show when={draft()} fallback={<div><h2>{event().title}</h2><p>{labels[event().kind]} · {new Date(event().starts_at*1000).toLocaleString()}</p><Show when={event().kind!=="meeting"}><p class="hint">Open the owning view to edit this item.</p></Show><button onClick={()=>setSelected(undefined)}>Close</button></div>}>
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
