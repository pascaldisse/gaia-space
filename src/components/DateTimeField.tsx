import { createEffect, createSignal, type JSX } from "solid-js";
import DateField from "./DateField";
import "./DateTimeField.css";

/** ── AN INSTANT IS A DAY AND A CLOCK, PICKED SEPARATELY ─────────────────────
 *
 *  `<input type="datetime-local">` carried the same defect as `type="date"`: the day
 *  half opened the operating system's calendar, in a layer no CSS reaches. So the day
 *  is chosen in the product's own month grid (DateField) and the clock stays a
 *  `type="time"` input — its system popup is a scroll wheel, not a calendar, and a
 *  wheel is not the problem being solved here.
 *
 *  The VALUE does not move: callers keep sending and receiving `YYYY-MM-DDTHH:mm`,
 *  exactly what the native control emitted. Halves are held locally so that editing
 *  one does not destroy the other, and:
 *    · both halves present → the composed instant is written;
 *    · both halves empty   → the empty string is written (the field was cleared);
 *    · one half missing    → NOTHING is written. Half a date is not a date.
 */

export const splitLocal = (value: string): { date: string; time: string } => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return match ? { date: match[1], time: match[2] } : { date: "", time: "" };
};

export const joinLocal = (date: string, time: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? `${date}T${time}` : "";

export type DateTimeFieldProps = {
  /** Accessible name of the whole instant; the day half carries it verbatim. */
  label: string;
  /** `YYYY-MM-DDTHH:mm`, or "" for no instant. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the clock half; defaults to "<label> time". */
  timeLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Hide the day's clear action where an instant is mandatory. */
  clearable?: boolean;
  class?: string;
};

export default function DateTimeField(props: DateTimeFieldProps): JSX.Element {
  const [day, setDay] = createSignal(splitLocal(props.value).date);
  const [clock, setClock] = createSignal(splitLocal(props.value).time);

  // The caller stays the source of truth: whenever it states an instant this field did
  // not just compose (another meeting selected, a form reset), that instant wins. What
  // it must NOT do is undo a half-finished edit — an emptied clock is remembered as
  // empty, or clearing a field would spring back to the value it is clearing.
  let applied = props.value;
  createEffect(() => {
    const incoming = props.value;
    if (incoming === applied) return;
    applied = incoming;
    const parts = splitLocal(incoming);
    setDay(parts.date);
    setClock(parts.time);
  });

  const emit = (date: string, time: string) => {
    setDay(date);
    setClock(time);
    const composed = joinLocal(date, time);
    if (composed || (!date && !time)) {
      applied = composed;
      props.onChange(composed);
    }
  };

  return (
    <span class="date-time-field" classList={props.class ? { [props.class]: true } : undefined}>
      <DateField
        label={props.label}
        value={day()}
        onChange={(value) => emit(value, clock())}
        placeholder={props.placeholder}
        disabled={props.disabled}
        clearable={props.clearable}
      />
      <input
        class="date-time-clock"
        type="time"
        aria-label={props.timeLabel ?? `${props.label} time`}
        disabled={props.disabled}
        value={clock()}
        onInput={(event) => emit(day(), event.currentTarget.value)}
      />
    </span>
  );
}
