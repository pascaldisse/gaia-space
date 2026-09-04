import { Show } from "solid-js";
import { meetingLinkError, type Meeting } from "../api/meetings";

/** ── HOW DOES A PERSON GET INTO THIS MEETING? ONE CHOICE, THREE ANSWERS ──────
 *
 *  Both composers used to hardcode `video_provider: null` and offer only an
 *  external link field — the product's own call room (LiveKit, `video_provider:
 *  "livekit"`) was never reachable from either. This is the one shared control
 *  that names the choice honestly instead of leaving it implicit in which
 *  field happened to be filled in:
 *
 *    Video call    -> video_provider "livekit", no external address needed
 *    External link -> the address a person pastes (Zoom, Meet, Teams…)
 *    In person     -> a place, not a link
 *
 *  The three are exclusive by construction: `meetingWherePayload` below is the
 *  ONLY place that turns a choice into the three Meeting fields it can touch,
 *  so a stray value left over from a choice no longer selected can never leak
 *  into the create/update payload. */
export type MeetingWhereKind = "video" | "link" | "in_person";
export type MeetingWhereValue = { kind: MeetingWhereKind; meeting_url: string; location: string };
export const DEFAULT_MEETING_WHERE: MeetingWhereValue = { kind: "video", meeting_url: "", location: "" };

/** Which choice existing data implies, for a composer that opens already carrying a
 *  meeting_url or location (e.g. editing a meeting booked before this control existed).
 *  video_provider "livekit" wins outright; otherwise whichever of the other two fields
 *  is non-empty; "video" (the default choice) when neither is. */
export const meetingWhereKindOf = (source: Pick<Meeting, "video_provider" | "meeting_url" | "location">): MeetingWhereKind =>
  source.video_provider === "livekit" ? "video" : source.meeting_url?.trim() ? "link" : source.location?.trim() ? "in_person" : "video";

/** The one place a choice becomes the three Meeting fields it may touch. Whatever was
 *  typed into a field for a choice no longer selected is dropped, never sent. */
export const meetingWherePayload = (value: MeetingWhereValue): Pick<Meeting, "video_provider" | "meeting_url" | "location"> => ({
  video_provider: value.kind === "video" ? "livekit" : null,
  meeting_url: value.kind === "link" ? (value.meeting_url.trim() || null) : null,
  location: value.kind === "in_person" ? (value.location.trim() || null) : null,
});

const CHOICES: Array<[MeetingWhereKind, string]> = [
  ["video", "Video call"],
  ["link", "External link"],
  ["in_person", "In person"],
];

export default function MeetingWhereField(props: { value: MeetingWhereValue; onChange: (value: MeetingWhereValue) => void }) {
  const pick = (kind: MeetingWhereKind) => props.onChange({ ...props.value, kind });
  const linkError = () => (props.value.kind === "link" ? meetingLinkError(props.value.meeting_url) : "");
  return (
    <div class="mtd-field mtd-where">
      <span class="mtd-caption">Where</span>
      <div class="mtd-where-choices" role="radiogroup" aria-label="Where">
        {CHOICES.map(([kind, label]) => (
          <button type="button" role="radio" aria-checked={props.value.kind === kind}
            classList={{ "mtd-where-active": props.value.kind === kind }}
            onClick={() => pick(kind)}>{label}</button>
        ))}
      </div>
      <Show when={props.value.kind === "link"}>
        <input class="mtd-input" type="url" inputmode="url" aria-label="Meeting link"
          aria-invalid={linkError() ? "true" : undefined}
          placeholder="https://meet.google.com/abc-defg-hij"
          value={props.value.meeting_url}
          onInput={(event) => props.onChange({ ...props.value, meeting_url: event.currentTarget.value })} />
        <Show when={linkError()} fallback={<span class="mtd-hint">Paste the Google Meet, Zoom or Teams address — the meeting then shows a Join button.</span>}>
          <span class="mtd-field-error" role="alert">{linkError()}</span>
        </Show>
      </Show>
      <Show when={props.value.kind === "in_person"}>
        <input class="mtd-input" aria-label="Location"
          placeholder="Room or building — where people physically go"
          value={props.value.location}
          onInput={(event) => props.onChange({ ...props.value, location: event.currentTarget.value })} />
      </Show>
      <Show when={props.value.kind === "video"}>
        <span class="mtd-hint">Uses this product's own call room — a Join button appears once the meeting is created.</span>
      </Show>
    </div>
  );
}
