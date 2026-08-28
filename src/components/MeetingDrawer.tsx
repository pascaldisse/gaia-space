import { For, Show, createSignal, type JSX } from "solid-js";
import type { Meeting } from "../api/meetings";
import { localInput } from "../calendar";
import { ProfilePicker } from "./Pickers";
import { profileId } from "../session";
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
  "title" | "description" | "starts_at" | "ends_at" | "rrule" | "location" | "organizer_id" | "channel_id" | "visibility" | "modification_preference"
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
  const [invitee, setInvitee] = createSignal("");
  // The menu reflects the rule, so a hand-written RRULE shows as "Custom" rather
  // than snapping the display back to one of the presets.
  const preset = () => repeatPresetOf(props.form.rrule);

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
            <label class="mtd-field">
              <span>Start</span>
              <input class="mtd-input" type="datetime-local" required value={localInput(props.form.starts_at)}
                onInput={(event) => props.setField("starts_at", epoch(event.currentTarget.value))} />
            </label>
            <label class="mtd-field">
              <span>End</span>
              <input class="mtd-input" type="datetime-local" required value={localInput(props.form.ends_at)}
                onInput={(event) => props.setField("ends_at", epoch(event.currentTarget.value))} />
            </label>
          </div>

          <label class="mtd-field">
            <span>Location</span>
            <input class="mtd-input" placeholder="Room, video link, or hybrid details"
              value={props.form.location ?? ""}
              onInput={(event) => props.setField("location", event.currentTarget.value || null)} />
          </label>

          {/* Invitees are collected here but sent after the meeting exists: the
              invite command needs a meeting id, which create() mints. */}
          <div class="mtd-field">
            <span>Participants</span>
            <div class="mtd-invite">
              <ProfilePicker label="Participant" value={invitee()} onChange={setInvitee} />
              <button type="button" class="mtd-btn" disabled={!invitee().trim()}
                onClick={() => { const id = invitee().trim(); if (id) { props.addInvitee(id); setInvitee(""); } }}>
                Add
              </button>
            </div>
            <Show when={props.invitees.length} fallback={<p class="mtd-hint">Nobody invited yet — you can also invite people after creating.</p>}>
              <ul class="mtd-people">
                <For each={props.invitees}>
                  {(id) => (
                    <li class="mtd-person">
                      <span>{id}</span>
                      <button type="button" class="mtd-remove" aria-label={`Remove ${id}`} onClick={() => props.removeInvitee(id)}>Remove</button>
                    </li>
                  )}
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

            <label class="mtd-field">
              <span>Visibility</span>
              <select class="mtd-input" value={props.form.visibility}
                onChange={(event) => props.setField("visibility", event.currentTarget.value as Meeting["visibility"])}>
                <option value="participants">Participants</option>
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </label>

            <label class="mtd-field">
              <span>Who can edit?</span>
              <select class="mtd-input" value={props.form.modification_preference}
                onChange={(event) => props.setField("modification_preference", event.currentTarget.value as Meeting["modification_preference"])}>
                <option value="organizer-only">Organizer only</option>
                <option value="participants">Participants</option>
              </select>
            </label>

            <label class="mtd-field">
              <span>Repeat</span>
              <select class="mtd-input" aria-label="Repeat" value={preset()}
                onChange={(event) => {
                  const chosen = event.currentTarget.value;
                  // "custom" is a report, not a command: picking it leaves the
                  // existing rule alone so the raw field below stays authoritative.
                  if (chosen === "custom") return;
                  props.setField("rrule", chosen || null);
                }}>
                <For each={REPEAT_PRESETS}>{([value, label]) => <option value={value}>{label}</option>}</For>
                <Show when={preset() === "custom"}><option value="custom">Custom…</option></Show>
              </select>
              <span class="mtd-hint">Bounded or unusual series (COUNT, UNTIL, odd weekdays) go in the RRULE field.</span>
            </label>

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
