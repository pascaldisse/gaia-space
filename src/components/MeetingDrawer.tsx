import { For, Show, createEffect, type JSX } from "solid-js";
import { meetingLinkError, type Meeting } from "../api/meetings";
import { localInput } from "../calendar";
import { PillMenu } from "./controls";
import DateTimeField from "./DateTimeField";
import { ProfilePicker } from "./Pickers";
import { profileId, profiles, reloadProfiles } from "../session";
import "./MeetingDrawer.css";

/** ── WHY A DRAWER ───────────────────────────────────────────────────────────
 *
 *  `#/meetings` used to spend its whole left column on a ten-field composer that
 *  was open before anyone had asked to create anything. The surface's job is to
 *  show the MEETINGS; creating one is an act you opt into. So the composer moved
 *  here, behind a primary "New meeting" action in the page header.
 *
 *  Two rules shape what is inside:
 *
 *    1. COMMON FIELDS FIRST. Title, Start, End, Location, Participants are what
 *       booking a meeting actually is. Description, Visibility, Who can edit,
 *       Repeat and RRULE are real but rare, so they sit behind ONE `<details>`
 *       disclosure, collapsed. `<details>` and not a signal-driven `<Show>`:
 *       collapsed content stays in the DOM, so the form still submits every
 *       field and assistive tech / find-in-page still reach them.
 *
 *    2. NOBODY LEARNS RRULE. `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` is developer
 *       syntax on a user surface. The four repeats people actually pick are
 *       menu entries and the string is DERIVED (see REPEAT_PRESETS). The raw
 *       field stays for power users — and typing a string that matches no
 *       preset flips the menu to "Custom" instead of silently rewriting it.
 */

export type MeetingForm = Pick<
  Meeting,
  "title" | "description" | "starts_at" | "ends_at" | "rrule" | "location" | "organizer_id" | "channel_id" | "visibility" | "modification_preference" | "meeting_url"
>;

/** The repeats a person picks from a menu, each paired with the RRULE it means.
 *  The label is the user's language; the value is what the backend stores. */
export const REPEAT_PRESETS = [
  ["", "Does not repeat"],
  ["FREQ=DAILY", "Daily"],
  ["FREQ=WEEKLY", "Weekly"],
  ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Every weekday"],
  ["FREQ=MONTHLY", "Monthly"],
] as const;

/** Which menu entry a stored rrule corresponds to. An empty rule is "no repeat";
 *  an exact match (case- and space-insensitive) is that preset; anything else is
 *  a hand-written rule, which the menu reports as "custom" and never overwrites. */
export function repeatPresetOf(rrule: string | null | undefined): string {
  const normalised = (rrule ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalised) return "";
  const hit = REPEAT_PRESETS.find(([value]) => value && value === normalised);
  return hit ? hit[0] : "custom";
}

export type MeetingDrawerProps = {
  form: MeetingForm;
  setField: <K extends keyof MeetingForm>(field: K, value: MeetingForm[K]) => void;
  /** Invitees collected before the meeting exists; the view invites them after create. */
  invitees: string[];
  addInvitee: (id: string) => void;
  removeInvitee: (id: string) => void;
  error?: string;
  onSubmit: (event: SubmitEvent) => void;
  onClose: () => void;
};

const epoch = (value: string) => Math.floor(Date.parse(value) / 1000);

export default function MeetingDrawer(props: MeetingDrawerProps): JSX.Element {
  // The menu reflects the rule, so a hand-written RRULE shows as "Custom" rather
  // than snapping the display back to one of the presets.
  const preset = () => repeatPresetOf(props.form.rrule);
  /* Anyone in the workspace may be invited to a meeting — unlike a task assignee, whom
     the owning project's membership limits. So the list is the profiles minus archived
     ones, in TaskDrawer's control: pick people from a list, never type their ids. */
  createEffect(() => { void reloadProfiles(); });
  /* Everyone in the workspace EXCEPT the organizer: you are in your own meeting by
     making it, so offering to invite yourself is an option that means nothing. The
     day composer in the calendar draws the same line. */
  const invitable = () => (profiles() ?? []).filter((person) => !person.archived && person.id !== (profileId() || ""));
  const nameOf = (person: { display_name: string | null; username: string }) => person.display_name || person.username;
  const toggleInvitee = (id: string) => (props.invitees.includes(id) ? props.removeInvitee(id) : props.addInvitee(id));
  /** Only people who are not already coming — a menu that offers what is already true
   *  makes the reader check the list twice. */
  const addable = () => invitable().filter((person) => !props.invitees.includes(person.id));
  /* Said while it is typed, not at submit: a link that will be refused must not look
     accepted for the rest of the form. `meetings::normalize_meeting_url` enforces the
     same rule natively, so this is the early word, not the only guard. */
  const linkError = () => meetingLinkError(props.form.meeting_url);

  return (
    <div class="mtd-root" role="dialog" aria-modal="true" aria-label="New meeting">
      <div class="mtd-backdrop" onClick={() => props.onClose()} />
      <div class="mtd-panel">
        <div class="mtd-head">
          <div>
            <h2>New meeting</h2>
            <p>Time and people first. Everything else is optional.</p>
          </div>
          <button type="button" class="mtd-close" aria-label="Close" onClick={() => props.onClose()}>×</button>
        </div>

        <form class="mtd-form" aria-label="New meeting" onSubmit={props.onSubmit}>
          <Show when={props.error}>
            <p class="mtd-error" role="alert">{props.error}</p>
          </Show>

          <label class="mtd-field">
            <span>Title</span>
            <input
              class="mtd-input"
              aria-label="Meeting title"
              required
              placeholder="Weekly product review"
              value={props.form.title}
              onInput={(event) => props.setField("title", event.currentTarget.value)}
            />
          </label>

          <div class="mtd-when">
            {/* Divs, not labels: the day half is a button that opens the product's own
                month grid. A meeting must have both ends, so neither offers Clear —
                that is what `required` said on the native control. */}
            <div class="mtd-field">
              <span>Start</span>
              <DateTimeField label="Start" clearable={false} value={localInput(props.form.starts_at)}
                onChange={(value) => props.setField("starts_at", epoch(value))} />
            </div>
            <div class="mtd-field">
              <span>End</span>
              <DateTimeField label="End" clearable={false} value={localInput(props.form.ends_at)}
                onChange={(value) => props.setField("ends_at", epoch(value))} />
            </div>
          </div>

          <label class="mtd-field">
            <span>Location</span>
            <input class="mtd-input" placeholder="Room or building — where people physically go"
              value={props.form.location ?? ""}
              onInput={(event) => props.setField("location", event.currentTarget.value || null)} />
          </label>

          {/* THE MEETING HAPPENS ON SOMEBODY ELSE'S SERVICE. This product runs no
              conferencing of its own for these dates, so the honest field is the plain
              URL a person pastes out of Google Calendar, Zoom or Teams. No vendor is
              parsed out of it: a URL is a URL, and a guessed provider would only be a
              second, wrong truth beside `video_provider`. */}
          <label class="mtd-field">
            <span>Meeting link</span>
            <input class="mtd-input" type="url" inputmode="url" aria-label="Meeting link"
              aria-invalid={linkError() ? "true" : undefined}
              placeholder="https://meet.google.com/abc-defg-hij"
              value={props.form.meeting_url ?? ""}
              onInput={(event) => props.setField("meeting_url", event.currentTarget.value || null)} />
            <Show when={linkError()} fallback={<span class="mtd-hint">Paste the Google Meet, Zoom or Teams address — the meeting then shows a Join button.</span>}>
              <span class="mtd-field-error" role="alert">{linkError()}</span>
            </Show>
          </label>

          {/* Invitees are collected here but sent after the meeting exists: the invite
              command needs a meeting id, which create() mints. WHO IS COMING and WHO CAN
              SEE IT are two different facts — `visibility` stays where it is, under More
              options, and neither field explains the other. */}
          {/* A FIELD LIKE THE OTHERS. A grid of checkboxes was a panel wearing the
              shape of a form; this is the picker every other field uses — choose a
              person, they stand as a chip, press × to take them off again. WHO IS
              COMING and WHO MAY SEE IT stay two facts: `visibility` is untouched. */}
          <div class="mtd-field">
            <span class="mtd-caption">Participants</span>
            <PillMenu
              label="Add participant"
              value=""
              placeholder={invitable().length ? "Add someone…" : "No profiles available yet"}
              disabled={!addable().length}
              options={addable().map((person) => ({ value: person.id, label: nameOf(person) }))}
              onChange={(id) => id && toggleInvitee(id)}
            />
            <Show when={props.invitees.length}>
              <ul class="mtd-invitees" aria-label="Invited people">
                <For each={props.invitees}>
                  {(id) => {
                    const person = () => invitable().find((candidate) => candidate.id === id);
                    const label = () => (person() ? nameOf(person()!) : id);
                    return (
                      <li class="mtd-invitee">
                        {label()}
                        <button type="button" aria-label={`Remove ${label()}`} onClick={() => props.removeInvitee(id)}>×</button>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>

          {/* Rare-but-real settings. Collapsed, in the DOM, one disclosure. */}
          <details class="mtd-more">
            <summary>More options</summary>

            <label class="mtd-field">
              <span>Description</span>
              <textarea class="mtd-input" aria-label="Meeting description"
                placeholder="Agenda, preparation, or joining details"
                value={props.form.description ?? ""}
                onInput={(event) => props.setField("description", event.currentTarget.value || null)} />
            </label>

            <div class="mtd-field mtd-organizer">
              <ProfilePicker label="Organizer" identity value={props.form.organizer_id ?? profileId()}
                onChange={(id) => props.setField("organizer_id", id)} />
            </div>

            {/* Three closed vocabularies of two to four words each: the exact case
               PillMenu exists for, and a `<label>` cannot wrap a button, so the
               caption sits beside the control and names it through `label`. */}
            <div class="mtd-field">
              <span>Visibility</span>
              <PillMenu label="Visibility" value={props.form.visibility}
                onChange={(value) => props.setField("visibility", value as Meeting["visibility"])}
                options={[
                  { value: "participants", label: "Participants" },
                  { value: "private", label: "Private" },
                  { value: "public", label: "Public" },
                ]} />
            </div>

            <div class="mtd-field">
              <span>Who can edit?</span>
              <PillMenu label="Who can edit?" value={props.form.modification_preference}
                onChange={(value) => props.setField("modification_preference", value as Meeting["modification_preference"])}
                options={[
                  { value: "organizer-only", label: "Organizer only" },
                  { value: "participants", label: "Participants" },
                ]} />
            </div>

            <div class="mtd-field">
              <span>Repeat</span>
              <PillMenu label="Repeat" value={preset()}
                onChange={(chosen) => {
                  // "custom" is a report, not a command: picking it leaves the
                  // existing rule alone so the raw field below stays authoritative.
                  if (chosen === "custom") return;
                  props.setField("rrule", chosen || null);
                }}
                options={[
                  ...REPEAT_PRESETS.map(([value, label]) => ({ value, label })),
                  ...(preset() === "custom" ? [{ value: "custom", label: "Custom…" }] : []),
                ]} />
              <span class="mtd-hint">Bounded or unusual series (COUNT, UNTIL, odd weekdays) go in the RRULE field.</span>
            </div>

            <label class="mtd-field">
              <span>RRULE</span>
              <input class="mtd-input" aria-label="RRULE recurrence"
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8"
                value={props.form.rrule ?? ""}
                onInput={(event) => props.setField("rrule", event.currentTarget.value || null)} />
            </label>
          </details>

          <div class="mtd-actions">
            <button type="button" class="mtd-btn" onClick={() => props.onClose()}>Cancel</button>
            <button type="submit" class="mtd-btn mtd-primary">Create meeting</button>
          </div>
        </form>
      </div>
    </div>
  );
}
