import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { meetingsApi, type Meeting, type MeetingParticipant } from "../api/meetings";
import { localInput, meetingDraftError } from "../calendar";
import { ProfilePicker } from "../components/Pickers";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { humanError, isWeb, profileId } from "../session";
import { linkProps, useDeepLink } from "../router";
import CallPanel from "./CallPanel";
import "./Meetings.css";

type MeetingForm = Pick<Meeting, "title" | "description" | "starts_at" | "ends_at" | "rrule" | "location" | "organizer_id" | "channel_id">;

const epoch = (value: string) => Math.floor(Date.parse(value) / 1000);
const newForm = (): MeetingForm => {
  const start = Math.floor(Date.now() / 1000) + 3600;
  return { title: "", description: null, starts_at: start, ends_at: start + 3600, rrule: null, location: null, organizer_id: profileId() || null, channel_id: null };
};
const recurrenceLabel = (rrule: string | null) => {
  if (!rrule) return "Does not repeat";
  const frequency = rrule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1]?.toLowerCase();
  return frequency ? `Repeats ${frequency}` : "Custom recurrence";
};
const displayDate = (seconds: number) => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const recurrenceOptions = [
  ["", "Does not repeat"],
  ["FREQ=DAILY", "Daily"],
  ["FREQ=WEEKLY", "Weekly"],
  ["FREQ=MONTHLY", "Monthly"],
  ["FREQ=YEARLY", "Yearly"],
] as const;

export default function Meetings() {
  const [meetings, { refetch }] = createResource(() => profileId(), (id) => id ? meetingsApi.list(id) : Promise.resolve([]));
  const [selected, setSelected] = createSignal<Meeting>();
  const [form, setForm] = createSignal<MeetingForm>(newForm());
  const [query, setQuery] = createSignal("");
  const [showHistory, setShowHistory] = createSignal(false);
  const [invitee, setInvitee] = createSignal("");
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [participants, { refetch: reloadParticipants }] = createResource(
    () => [selected()?.id, profileId()] as const,
    ([meetingId, personId]) => meetingId && personId ? meetingsApi.participants(meetingId, personId) : Promise.resolve([]),
  );
  const availabilityProfiles = createMemo(() => [...new Set([selected()?.organizer_id, ...((participants() ?? []).filter((participant) => participant.status !== "declined").map((participant) => participant.profile_id))].filter((id): id is string => Boolean(id)))]);
  const [availability, { refetch: reloadAvailability }] = createResource(
    () => [selected()?.starts_at, selected()?.ends_at, selected()?.id, availabilityProfiles()] as const,
    ([startsAt, endsAt, meetingId, people]) => startsAt && endsAt ? meetingsApi.availability(startsAt, endsAt, people, meetingId) : Promise.resolve(undefined),
  );
  const visibleMeetings = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase();
    const now = Math.floor(Date.now() / 1000);
    return (meetings() ?? [])
      .filter((meeting) => !meeting.archived && (showHistory() || meeting.ends_at >= now))
      .filter((meeting) => !needle || [meeting.title, meeting.description, meeting.location, meeting.organizer_id].some((value) => value?.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => a.starts_at - b.starts_at);
  });
  const setFormField = <K extends keyof MeetingForm>(field: K, value: MeetingForm[K]) => setForm({ ...form(), [field]: value });
  const setMeetingField = <K extends keyof Meeting>(field: K, value: Meeting[K]) => {
    const meeting = selected();
    if (meeting) setSelected({ ...meeting, [field]: value });
  };
  const validate = (meeting: Pick<Meeting, "title" | "starts_at" | "ends_at" | "location" | "rrule">) => meetingDraftError({
    title: meeting.title,
    starts_at: localInput(meeting.starts_at),
    ends_at: localInput(meeting.ends_at),
    location: meeting.location ?? "",
    rrule: meeting.rrule ?? "",
  });
  const selectMeeting = (meeting: Meeting) => {
    setError("");
    setNotice("");
    setSelected({ ...meeting });
  };
  const create = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const draft = form();
      const meeting: Meeting = {
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        description: draft.description?.trim() || null,
        starts_at: draft.starts_at,
        ends_at: draft.ends_at,
        rrule: draft.rrule?.trim() || null,
        location: draft.location?.trim() || null,
        organizer_id: draft.organizer_id || profileId() || null,
        channel_id: draft.channel_id || null,
        archived: false,
      };
      const invalid = validate(meeting);
      if (invalid) throw new Error(invalid);
      await meetingsApi.create(meeting);
      setSelected(meeting);
      setForm(newForm());
      setNotice("Meeting created. Add participants or open it on the calendar.");
      await refetch();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const save = async () => {
    const meeting = selected();
    if (!meeting) return;
    setError("");
    setNotice("");
    try {
      const invalid = validate(meeting);
      if (invalid) throw new Error(invalid);
      await meetingsApi.update(meeting);
      setNotice("Meeting saved.");
      await refetch();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const archive = async () => {
    const meeting = selected();
    if (!meeting) return;
    setError("");
    try {
      await meetingsApi.archive(meeting.id, true);
      setSelected(undefined);
      setNotice("Meeting archived.");
      await refetch();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const invite = async () => {
    const meeting = selected();
    const person = invitee().trim();
    if (!meeting || !person) return;
    setError("");
    try {
      await meetingsApi.invite(meeting.id, person);
      setInvitee("");
      await reloadParticipants();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  const rsvp = async (participant: MeetingParticipant, status: MeetingParticipant["status"]) => {
    setError("");
    try {
      await meetingsApi.rsvp(participant.meeting_id, participant.profile_id, status);
      await reloadParticipants();
      await reloadAvailability();
    } catch (reason) {
      setError(humanError(reason));
    }
  };

  const reserveRoom = async (roomId: string) => {
    const meeting = selected();
    if (!meeting) return;
    setError("");
    try {
      await meetingsApi.reserveRoom(meeting.id, roomId);
      setMeetingField("location", availability()?.rooms.find((room) => room.id === roomId)?.name ?? null);
      setNotice("Room reserved.");
      await reloadAvailability();
      await refetch();
    } catch (reason) {
      setError(humanError(reason));
    }
  };
  useDeepLink("meeting", (id) => {
    const found = meetings()?.find((meeting) => meeting.id === id);
    if (found) selectMeeting(found);
  }, () => setSelected(undefined));

  return <section class="meetings-view">
    <WorkspaceHeader icon="calendar-nav" title="Meetings" actions={<a class="meeting-calendar-link" {...linkProps({ view: "Calendar" })}>Open calendar</a>}>
      Schedule single or recurring meetings, manage attendance, and use Calendar for the shared schedule.
    </WorkspaceHeader>
    <Show when={error()}><p class="meeting-error" role="alert">{error()}</p></Show>
    <Show when={notice()}><p class="meeting-notice" role="status">{notice()}</p></Show>

    <div class="meetings-layout">
      <aside class="meeting-create">
        <form onSubmit={create} aria-label="New meeting">
          <div class="mc-head"><h2>New meeting</h2><p>Set the time, participants, and recurrence for this series.</p></div>
          <div class="mc-field"><label for="meeting-title">Title</label><input id="meeting-title" aria-label="Meeting title" class="mc-title-input" required placeholder="Weekly product review" value={form().title} onInput={(event) => setFormField("title", event.currentTarget.value)}/></div>
          <div class="mc-field"><label for="meeting-description">Description</label><textarea id="meeting-description" aria-label="Meeting description" placeholder="Agenda, preparation, or joining details" value={form().description ?? ""} onInput={(event) => setFormField("description", event.currentTarget.value || null)}/></div>
          <div class="mc-field mc-when"><div><label for="meeting-start">Start</label><input id="meeting-start" type="datetime-local" required value={localInput(form().starts_at)} onInput={(event) => setFormField("starts_at", epoch(event.currentTarget.value))}/></div><div><label for="meeting-end">End</label><input id="meeting-end" type="datetime-local" required value={localInput(form().ends_at)} onInput={(event) => setFormField("ends_at", epoch(event.currentTarget.value))}/></div></div>
          <div class="mc-field"><label for="meeting-location">Location</label><input id="meeting-location" placeholder="Room, video link, or hybrid details" value={form().location ?? ""} onInput={(event) => setFormField("location", event.currentTarget.value || null)}/></div>
          <div class="mc-field mc-organizer"><ProfilePicker label="Organizer" identity value={form().organizer_id ?? profileId()} onChange={(id) => setFormField("organizer_id", id)}/></div>
          <div class="mc-field"><label for="meeting-repeat">Repeat</label><select id="meeting-repeat" value={form().rrule ?? ""} onChange={(event) => setFormField("rrule", event.currentTarget.value || null)}><For each={recurrenceOptions}>{([value, label]) => <option value={value}>{label}</option>}</For></select><span class="mc-hint">For a bounded or custom series, enter an RRULE below.</span></div>
          <div class="mc-field"><label for="meeting-rrule">RRULE</label><input id="meeting-rrule" aria-label="RRULE recurrence" placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8" value={form().rrule ?? ""} onInput={(event) => setFormField("rrule", event.currentTarget.value || null)}/></div>
          <button class="primary mc-submit">Create meeting</button>
        </form>
      </aside>

      <main class="meeting-list" aria-label="Meetings">
        <div class="meeting-list-head"><div><h2>{showHistory() ? "All meetings" : "Upcoming meetings"}</h2><p>{visibleMeetings().length} visible</p></div><button type="button" onClick={() => setShowHistory(!showHistory())}>{showHistory() ? "Hide history" : "Show history"}</button></div>
        <input class="meeting-filter" type="search" aria-label="Filter meetings" placeholder="Filter by title, place, or organizer" value={query()} onInput={(event) => setQuery(event.currentTarget.value)}/>
        <Show when={meetings.loading}><p class="meeting-empty" role="status">Loading meetings…</p></Show>
        <Show when={!meetings.loading && !visibleMeetings().length}><p class="meeting-empty">No meetings match this view.</p></Show>
        <div class="meeting-rows"><For each={visibleMeetings()}>{(meeting) => <button type="button" classList={{ "meeting-row": true, active: selected()?.id === meeting.id }} onClick={() => selectMeeting(meeting)}><strong>{meeting.title}</strong><time datetime={new Date(meeting.starts_at * 1000).toISOString()}>{displayDate(meeting.starts_at)}</time><span>{meeting.location || "No location"} · {recurrenceLabel(meeting.rrule)}</span></button>}</For></div>
      </main>

      <aside class="meeting-detail" aria-label="Meeting details">
        <Show when={selected()} fallback={<div class="meeting-empty"><h2>Meeting details</h2><p>Select a meeting to edit it, manage RSVPs, or open it on Calendar.</p></div>}>
          {(meeting) => <>
            <div class="detail-actions"><a class="meeting-permalink" {...linkProps({ view: "Calendar", entityType: "meeting", entityId: meeting().id })}>Open on calendar</a><button type="button" onClick={save}>Save</button><button type="button" class="danger" onClick={archive}>Archive</button></div>
            <label>Title<input class="meeting-title" value={meeting().title} onInput={(event) => setMeetingField("title", event.currentTarget.value)}/></label>
            <label>Description<textarea value={meeting().description ?? ""} onInput={(event) => setMeetingField("description", event.currentTarget.value || null)}/></label>
            <div class="meeting-detail-when"><label>Start<input type="datetime-local" value={localInput(meeting().starts_at)} onInput={(event) => setMeetingField("starts_at", epoch(event.currentTarget.value))}/></label><label>End<input type="datetime-local" value={localInput(meeting().ends_at)} onInput={(event) => setMeetingField("ends_at", epoch(event.currentTarget.value))}/></label></div>
            <label>Location<input value={meeting().location ?? ""} onInput={(event) => setMeetingField("location", event.currentTarget.value || null)}/></label>
            <label>RRULE<input placeholder="FREQ=WEEKLY;COUNT=4" value={meeting().rrule ?? ""} onInput={(event) => setMeetingField("rrule", event.currentTarget.value || null)}/></label>
            <section class="rsvp"><div class="section-heading"><div><h3>Participants</h3><p>Invite people and record their response.</p></div></div><div class="inline-form"><ProfilePicker label="Participant" value={invitee()} onChange={setInvitee}/><button type="button" onClick={invite}>Invite</button></div><Show when={participants.loading}><p class="meeting-empty">Loading participants…</p></Show><For each={participants()}>{(participant) => <div class="participant"><span>{participant.profile_id}</span><select aria-label={`RSVP for ${participant.profile_id}`} value={participant.status} onChange={(event) => rsvp(participant, event.currentTarget.value as MeetingParticipant["status"])}><option value="invited">Invited</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select></div>}</For></section>
            <section class="meeting-availability"><div class="section-heading"><div><h3>Availability</h3><p>Room and attendee conflicts for this meeting time.</p></div><button type="button" onClick={() => reloadAvailability()}>Refresh</button></div><Show when={availability.loading}><p class="meeting-empty">Checking availability…</p></Show><For each={availability()?.conflicts ?? []}>{(conflict) => <p class="availability-conflict">{conflict.message}</p>}</For><Show when={!availability.loading && !((availability()?.conflicts ?? []).length)}><p class="availability-clear">No room, meeting, or absence conflicts.</p></Show><div class="room-suggestions"><For each={availability()?.suggestions ?? []}>{(room) => <button type="button" class="room-suggestion" onClick={() => reserveRoom(room.id)}>{room.name}<small>{room.location || "Room"}{room.equipment.length ? ` · ${room.equipment.join(", ")}` : ""}</small></button>}</For></div><Show when={!availability.loading && !((availability()?.suggestions ?? []).length)}><p class="meeting-empty">No available rooms to suggest.</p></Show></section>
            <Show when={!isWeb()}><CallPanel meeting={meeting()} identity={profileId()} displayName={profileId()}/></Show>
          </>}
        </Show>
      </aside>
    </div>
  </section>;
}
