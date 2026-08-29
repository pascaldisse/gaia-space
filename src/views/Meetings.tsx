import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { hasMeetingLink, meetingLinkError, meetingsApi, openMeetingLink, type Meeting, type MeetingParticipant } from "../api/meetings";
import { localInput, meetingDraftError, UI_LOCALE} from "../calendar";
import { ProfilePicker } from "../components/Pickers";
import DateTimeField from "../components/DateTimeField";
import MeetingDrawer, { type MeetingForm } from "../components/MeetingDrawer";
import PageHeader, { Chip } from "../components/PageHeader";
import { SectionHeading } from "../components/blocks";
import { Icon } from "../components/Icon";
import { GhostPill, PillSelect, QuietSearch } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { humanError, isWeb, profileId } from "../session";
import { linkProps, useDeepLink } from "../router";
import CallPanel from "./CallPanel";
import "./Meetings.css";

// MeetingForm now lives beside the drawer that owns the composer; re-exported
// shape, same fields, so nothing about the create payload changed.

/** ── DOES MEETINGS DESERVE TO BE ITS OWN SURFACE? YES — AND NOT AS A CALENDAR ──
 *
 *  The question is fair, because Calendar already lists meetings and owns the day
 *  detail and the day composer. Asked honestly: what does this surface do that
 *  Calendar does not?
 *
 *    RSVP / attendance  invite a person, record invited/accepted/declined
 *    ROOMS              filter by equipment, reserve, resolve booking overlaps
 *    AVAILABILITY       attendee + room conflicts for a chosen time, suggestions
 *    SERIES             the RRULE that makes a meeting recurring
 *    HISTORY            meetings that have already ended
 *
 *  None of that is a date on a grid, and none of it fits a day cell. Calendar
 *  answers WHEN something is; this surface answers WHO IS COMING, WHERE IT SITS,
 *  and DOES IT REPEAT. So it is not a duplicate — it is the MANAGEMENT surface.
 *
 *  It only LOOKED like a duplicate because it presented itself as one: a bare
 *  `Meetings` title with no subline, and a list card headed `Upcoming meetings`
 *  above a plain filter box — i.e. a worse second agenda. The restructure below
 *  changes nothing about what it does and everything about what it says it is:
 *  the header names attendance/rooms/series as the job, the chips count the
 *  management work outstanding, and the scope control offers `Upcoming` vs
 *  `All & history` instead of a lone `Show history` toggle button.
 *
 *  Every capability stays reachable: scheduling (`New meeting` -> MeetingDrawer),
 *  recurrence (drawer + the detail pane's RRULE), RSVP/attendance and rooms (the
 *  detail pane), history (the scope pill), and `Open calendar` in the header. */

const epoch = (value: string) => Math.floor(Date.parse(value) / 1000);
const newForm = (): MeetingForm => {
  const start = Math.floor(Date.now() / 1000) + 3600;
  return { title: "", description: null, starts_at: start, ends_at: start + 3600, rrule: null, location: null, organizer_id: profileId() || null, channel_id: null, visibility: "participants", modification_preference: "organizer-only", meeting_url: null };
};
/** ── JOIN ─────────────────────────────────────────────────────────────────────
 *  One affordance, two implementations, because the two runtimes differ in ONE
 *  respect that matters: in the desktop app `window.open` opens the address inside
 *  the webview — a browser with no URL bar, no Google session and no camera
 *  permission prompt — so the desktop hands the URL to the operating system's
 *  default browser (`tauri-plugin-opener`). In the web build a link is already a
 *  link and needs no plugin. Anything without a valid link renders NOTHING here:
 *  a Join button that leads nowhere is worse than no button. */
function JoinLink(props: { meeting: Meeting; class?: string; onError: (message: string) => void }) {
  const url = () => props.meeting.meeting_url!.trim();
  return <Show when={hasMeetingLink(props.meeting)}>
    <Show
      when={isWeb()}
      fallback={<button type="button" class={props.class ?? "meeting-join"} title={url()}
        onClick={() => { void openMeetingLink(url()).catch((reason) => props.onError(humanError(reason))); }}>Join</button>}
    >
      <a class={props.class ?? "meeting-join"} href={url()} target="_blank" rel="noopener" title={url()}>Join</a>
    </Show>
  </Show>;
}
const recurrenceLabel = (rrule: string | null) => {
  if (!rrule) return "Does not repeat";
  const frequency = rrule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/)?.[1]?.toLowerCase();
  return frequency ? `Repeats ${frequency}` : "Custom recurrence";
};
const displayDate = (seconds: number) => new Date(seconds * 1000).toLocaleString(UI_LOCALE, { dateStyle: "medium", timeStyle: "short" });

export default function Meetings() {
  const [meetings, { refetch }] = createResource(() => profileId(), (id) => id ? meetingsApi.list(id) : Promise.resolve([]));
  const [selected, setSelected] = createSignal<Meeting>();
  const [form, setForm] = createSignal<MeetingForm>(newForm());
  // The composer is an act you opt into, not furniture the surface wears.
  const [composing, setComposing] = createSignal(false);
  // Invitees named before the meeting exists; sent once create() mints an id.
  const [draftInvitees, setDraftInvitees] = createSignal<string[]>([]);
  const [query, setQuery] = createSignal("");
  const [showHistory, setShowHistory] = createSignal(false);
  const [invitee, setInvitee] = createSignal("");
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [equipmentFilter, setEquipmentFilter] = createSignal("");
  const [roomId, setRoomId] = createSignal("");
  const [rooms] = createResource(() => meetingsApi.rooms());
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
  /* The chips count only what this surface can honestly know from the meetings it
     already loaded — no extra fetch, no invented metric. Tone follows the law:
     teal = open/actionable (still to come), amber = due soon (starts today), and
     `Chip` runs every value through `metricTone`, so a 0 carries no colour. A
     recurring-series count is a fact rather than a call to act, so it is untoned. */
  const liveMeetings = createMemo(() => (meetings() ?? []).filter((meeting) => !meeting.archived));
  const upcomingCount = createMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return liveMeetings().filter((meeting) => meeting.ends_at >= now).length;
  });
  const todayCount = createMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = Math.floor(start.getTime() / 1000);
    return liveMeetings().filter((meeting) => meeting.starts_at >= from && meeting.starts_at < from + 86400).length;
  });
  const seriesCount = createMemo(() => liveMeetings().filter((meeting) => meeting.rrule).length);
  /* Which empty state is truthful: a narrowed view that excluded everything is a
     `no-match` (offer to widen), an unnarrowed empty view is `nothing yet` (offer
     to create). Offering "create" to someone whose filter simply hid the thing is
     the failure EmptyState exists to prevent. */
  const narrowed = () => !!query().trim() || !showHistory();
  const openComposer = () => { setError(""); setNotice(""); setComposing(true); };
  const clearFilters = () => { setQuery(""); setShowHistory(true); };
  const setFormField = <K extends keyof MeetingForm>(field: K, value: MeetingForm[K]) => setForm({ ...form(), [field]: value });
  const setMeetingField = <K extends keyof Meeting>(field: K, value: Meeting[K]) => {
    const meeting = selected();
    if (meeting) setSelected({ ...meeting, [field]: value });
  };
  // The link is refused HERE as well as natively, so a bad address is named before a
  // round trip — and the meeting is never saved with a Join button that goes nowhere.
  const validate = (meeting: Pick<Meeting, "title" | "starts_at" | "ends_at" | "location" | "rrule" | "meeting_url">) => meetingDraftError({
    title: meeting.title,
    starts_at: localInput(meeting.starts_at),
    ends_at: localInput(meeting.ends_at),
    location: meeting.location ?? "",
    rrule: meeting.rrule ?? "",
  }) || meetingLinkError(meeting.meeting_url);
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
        visibility: draft.visibility,
        modification_preference: draft.modification_preference,
        meeting_url: draft.meeting_url?.trim() || null,
        archived: false,
        // A new meeting has no room yet: the room is minted and bound at the first join.
        video_provider: null,
        video_room_id: null,
        join_url: null,
        video_status: "scheduled",
        video_started_at: null,
        video_ended_at: null,
        video_ended_by: null,
        source_entity_type: null,
        source_entity_id: null,
      };
      const invalid = validate(meeting);
      if (invalid) throw new Error(invalid);
      await meetingsApi.create(meeting);
      const channel_id = await meetingsApi.attachChannel(meeting.id);
      // The drawer collects people before there is a meeting to invite them to,
      // so the invites land here, once. A failing invite must not lose the
      // meeting that was already created.
      const invited: string[] = [];
      for (const person of draftInvitees()) {
        try { await meetingsApi.invite(meeting.id, person); invited.push(person); }
        catch (reason) { setError(humanError(reason)); }
      }
      setSelected({ ...meeting, channel_id });
      setForm(newForm());
      setDraftInvitees([]);
      setComposing(false);
      setNotice(invited.length
        ? `Meeting created and ${invited.length} person(s) invited.`
        : "Meeting created. Add participants or open it on the calendar.");
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
  const filteredRooms = () => { const required = equipmentFilter().split(",").map(x => x.trim().toLowerCase()).filter(Boolean); return (rooms() ?? []).filter(room => required.every(item => room.equipment.some((equipment: string) => equipment.toLowerCase() === item))); };
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
    <PageHeader
      icon="calendar"
      title="Meetings"
      subline="Attendance, rooms and recurring series — Calendar owns the day view."
      chips={<>
        <Chip value={upcomingCount()} label="Upcoming" tone="teal" />
        <Chip value={todayCount()} label="Today" tone="amber" />
        <Chip value={seriesCount()} label="Recurring" />
      </>}
    />
    {/* Both acts rank themselves in the one row: New meeting makes something, Open
       calendar is the quieter way out to the day view. */}
    <nav class="page-actionbar" aria-label="Meeting actions">
      <button type="button" class="primary meeting-new" onClick={openComposer}>New meeting</button>
      <GhostPill class="meeting-calendar-link" {...linkProps({ view: "Calendar" })}>Open calendar</GhostPill>
    </nav>
    <Show when={error()}><p class="meeting-error" role="alert">{error()}</p></Show>
    <Show when={notice()}><p class="meeting-notice" role="status">{notice()}</p></Show>

    <Show when={composing()}>
      <MeetingDrawer
        form={form()}
        setField={setFormField}
        invitees={draftInvitees()}
        addInvitee={(id) => setDraftInvitees((people) => people.includes(id) ? people : [...people, id])}
        removeInvitee={(id) => setDraftInvitees((people) => people.filter((person) => person !== id))}
        error={error()}
        onSubmit={create}
        onClose={() => setComposing(false)}
      />
    </Show>

    <div class="meetings-layout">
      <main class="meeting-list" aria-label="Meetings">
        {/* The scope is a choice between two named views, so it is a PillSelect, not
            a `Show history` toggle whose label had to describe its own next state. */}
        <SectionHeading
          title={showHistory() ? "All meetings" : "Upcoming meetings"}
          meta={`${visibleMeetings().length} of ${liveMeetings().length}`}
          actions={<PillSelect label="Meetings shown" value={showHistory() ? "all" : "upcoming"} onChange={(value) => setShowHistory(value === "all")}>
            <option value="upcoming">Upcoming</option>
            <option value="all">All &amp; history</option>
          </PillSelect>}
        />
        <div class="meeting-filter-row">
          <QuietSearch label="Filter meetings" placeholder="Filter by title, place, or organizer" value={query()} onInput={setQuery} />
        </div>
        <Show when={meetings.loading}><p class="meeting-empty" role="status">Loading meetings…</p></Show>
        <Show when={!meetings.loading && !visibleMeetings().length}>
          <Show
            when={liveMeetings().length && narrowed()}
            fallback={<EmptyState
              title="No meetings yet"
              hint="Schedule one to manage its attendance, room and recurrence here."
              actions={<button type="button" class="primary" onClick={openComposer}>New meeting</button>}
            />}
          >
            <EmptyState
              variant="no-match"
              title="No meetings match this view."
              hint={showHistory() ? "Try a different search term." : "Past meetings are hidden — widen the view to include history."}
              actions={<GhostPill onClick={clearFilters}>Clear filters</GhostPill>}
            />
          </Show>
        </Show>
        {/* The Knowledge card, not a bare row: tile · title · ONE meta line · arrow.
            The date and the place used to be two stacked muted lines; they are one. */}
        {/* Join is a SECOND act on the card, so it cannot live inside the card's own
            button (a button may not contain a button). The card chrome moved out to
            `.meeting-row-shell`; selecting the meeting and joining it now sit side by
            side in it, and the row keeps exactly the shape it had. */}
        <div class="meeting-rows"><For each={visibleMeetings()}>{(meeting) => <div classList={{ "meeting-row-shell": true, active: selected()?.id === meeting.id }}><button type="button" class="meeting-row" onClick={() => selectMeeting(meeting)}><span class="meeting-row-icon" aria-hidden="true"><Icon name="calendar" size={20} /></span><span class="meeting-row-copy"><strong>{meeting.title}</strong><small><time datetime={new Date(meeting.starts_at * 1000).toISOString()}>{displayDate(meeting.starts_at)}</time> · {meeting.location || "No location"} · {recurrenceLabel(meeting.rrule)}</small></span><span class="meeting-row-open" aria-hidden="true">→</span></button><JoinLink meeting={meeting} onError={setError} /></div>}</For></div>
      </main>

      <aside class="meeting-detail" aria-label="Meeting details">
        <Show when={selected()} fallback={<EmptyState title="No meeting selected" hint="Pick a meeting to manage its attendance, room booking and recurrence." />}>
          {(meeting) => <>
            <div class="detail-actions"><a class="meeting-permalink" {...linkProps({ view: "Calendar", entityType: "meeting", entityId: meeting().id })}>Open on calendar</a><Show when={meeting().channel_id} fallback={<button type="button" onClick={async () => { try { const channel_id = await meetingsApi.attachChannel(meeting().id); setSelected({ ...meeting(), channel_id }); await refetch(); } catch (reason) { setError(humanError(reason)); } }}>Attach discussion</button>}><a {...linkProps({ view: "Chat", entityType: "channel", entityId: meeting().channel_id! })}>Open discussion</a></Show><button type="button" onClick={save}>Save</button><button type="button" class="danger" onClick={archive}>Archive</button></div>
            <label>Title<input class="meeting-title" value={meeting().title} onInput={(event) => setMeetingField("title", event.currentTarget.value)}/></label>
            <label>Description<textarea value={meeting().description ?? ""} onInput={(event) => setMeetingField("description", event.currentTarget.value || null)}/></label>
            {/* Divs, not labels: the day is chosen with a button (components/DateField). The
    epoch seconds the view stores are untouched, so meetingDraftError still rules
    on "the end must follow the start" when Save is pressed. */}
<div class="meeting-detail-when"><div class="when-field"><span>Start</span><DateTimeField label="Start" clearable={false} value={localInput(meeting().starts_at)} onChange={(value) => setMeetingField("starts_at", epoch(value))}/></div><div class="when-field"><span>End</span><DateTimeField label="End" clearable={false} value={localInput(meeting().ends_at)} onChange={(value) => setMeetingField("ends_at", epoch(value))}/></div></div>
            <label>Location<input value={meeting().location ?? ""} onInput={(event) => setMeetingField("location", event.currentTarget.value || null)}/></label>
            {/* The external address, editable here and joinable right beside it — the
                one place that both holds the fact and acts on it. */}
            <label>Meeting link<input type="url" inputmode="url" placeholder="https://meet.google.com/abc-defg-hij" aria-invalid={meetingLinkError(meeting().meeting_url) ? "true" : undefined} value={meeting().meeting_url ?? ""} onInput={(event) => setMeetingField("meeting_url", event.currentTarget.value || null)}/></label>
            <Show when={meetingLinkError(meeting().meeting_url)}><p class="meeting-link-error" role="alert">{meetingLinkError(meeting().meeting_url)}</p></Show>
            <Show when={hasMeetingLink(meeting())}><div class="meeting-link-actions"><JoinLink meeting={meeting()} onError={setError} /><span class="meeting-link-url">{meeting().meeting_url}</span></div></Show>
            <label>Visibility<select value={meeting().visibility} onChange={(event) => setMeetingField("visibility", event.currentTarget.value as Meeting["visibility"])}><option value="participants">Participants</option><option value="private">Private</option><option value="public">Public</option></select></label>
            <label>Who can edit?<select value={meeting().modification_preference} onChange={(event) => setMeetingField("modification_preference", event.currentTarget.value as Meeting["modification_preference"])}><option value="organizer-only">Organizer only</option><option value="participants">Participants</option></select></label>
            <label>RRULE<input placeholder="FREQ=WEEKLY;COUNT=4" value={meeting().rrule ?? ""} onInput={(event) => setMeetingField("rrule", event.currentTarget.value || null)}/></label>
            <section class="rsvp"><div class="section-heading"><div><h3>Room booking</h3><p>Filter by equipment; overlaps are rejected.</p></div></div><input aria-label="Required equipment" placeholder="Projector, Whiteboard" value={equipmentFilter()} onInput={event => setEquipmentFilter(event.currentTarget.value)}/><div class="inline-form"><select aria-label="Meeting room" value={roomId()} onChange={event => setRoomId(event.currentTarget.value)}><option value="">Select room</option><For each={filteredRooms()}>{room => <option value={room.id}>{room.name} · {room.equipment.join(", ") || "No equipment"}</option>}</For></select><button type="button" onClick={() => roomId() && reserveRoom(roomId())}>Reserve</button></div></section>
            <section class="rsvp"><div class="section-heading"><div><h3>Participants</h3><p>Invite people and record their response.</p></div></div><div class="inline-form"><ProfilePicker label="Participant" value={invitee()} onChange={setInvitee}/><button type="button" onClick={invite}>Invite</button></div><Show when={participants.loading}><p class="meeting-empty">Loading participants…</p></Show><For each={participants()}>{(participant) => <div class="participant"><span>{participant.profile_id}</span><select aria-label={`RSVP for ${participant.profile_id}`} value={participant.status} onChange={(event) => rsvp(participant, event.currentTarget.value as MeetingParticipant["status"])}><option value="invited">Invited</option><option value="accepted">Accepted</option><option value="declined">Declined</option></select></div>}</For></section>
            <section class="meeting-availability"><div class="section-heading"><div><h3>Availability</h3><p>Room and attendee conflicts for this meeting time.</p></div><button type="button" onClick={() => reloadAvailability()}>Refresh</button></div><Show when={availability.loading}><p class="meeting-empty">Checking availability…</p></Show><For each={availability()?.conflicts ?? []}>{(conflict) => <p class="availability-conflict">{conflict.message}</p>}</For><Show when={!availability.loading && !((availability()?.conflicts ?? []).length)}><p class="availability-clear">No room, meeting, or absence conflicts.</p></Show><div class="room-suggestions"><For each={availability()?.suggestions ?? []}>{(room) => <button type="button" class="room-suggestion" onClick={() => reserveRoom(room.id)}>{room.name}<small>{room.location || "Room"}{room.equipment.length ? ` · ${room.equipment.join(", ")}` : ""}</small></button>}</For></div><Show when={!availability.loading && !((availability()?.suggestions ?? []).length)}><p class="meeting-empty">No available rooms to suggest.</p></Show></section>
            <Show when={!isWeb()}><CallPanel meeting={meeting()} identity={profileId()} displayName={profileId()}/></Show>
          </>}
        </Show>
      </aside>
    </div>
  </section>;
}
