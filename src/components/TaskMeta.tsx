import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import "./TaskMeta.css";

/**
 * One shell for every piece of metadata a task carries. The three composer
 * controls — Project, Due date, Assignee — are the same full-width button
 * (icon · label · value · chevron) opening a popover, so the composer reads as
 * one row instead of three cramped native selects.
 *
 * The popover is a real dialog for the keyboard: Escape closes it and hands
 * focus back to the trigger, a click outside closes it, and the trigger states
 * what it owns (`aria-expanded`, `aria-controls`).
 */
export function MetaControl(props: {
  icon: IconName;
  label: string;
  value?: string;          // resting value line; empty -> placeholder
  placeholder: string;
  set: boolean;            // has a value been chosen?
  menuLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const menuId = createUniqueId();
  let root!: HTMLDivElement;
  let trigger: HTMLButtonElement | undefined;
  const close = () => setOpen(false);
  // Closing returns the focus it took: a popover that swallows the caret leaves
  // the keyboard stranded in the middle of the composer.
  const closeToTrigger = () => { close(); trigger?.focus(); };
  onMount(() => {
    const away = (event: MouseEvent) => { if (open() && !root.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && open()) { event.stopPropagation(); closeToTrigger(); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    onCleanup(() => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); });
  });
  return (
    <div class="tm" ref={root}>
      <button
        type="button" ref={trigger}
        class="tm-trigger" classList={{ set: props.set, open: open() }}
        disabled={props.disabled}
        title={props.disabled ? props.disabledReason : undefined}
        aria-haspopup="dialog" aria-expanded={open()} aria-controls={menuId}
        onClick={() => setOpen(was => !was)}
      >
        <span class="tm-icon" aria-hidden="true"><Icon name={props.icon} size={16} /></span>
        <span class="tm-text">
          <span class="tm-label">{props.label}</span>
          <span class="tm-value" classList={{ placeholder: !props.set }}>{props.set ? props.value : props.placeholder}</span>
        </span>
        <span class="tm-chevron" aria-hidden="true"><Icon name="chevron-down" size={13} /></span>
      </button>
      <Show when={open()}>
        <div class="tm-menu" id={menuId} role="dialog" aria-label={props.menuLabel}>
          {props.children(close)}
        </div>
      </Show>
    </div>
  );
}

export type MetaProject = { id: string; name: string; key?: string };
export type MetaPerson = { id: string; label: string; sub?: string };

/** Project chooser — one project or none (a personal task). */
export function ProjectControl(props: { value: string; projects: MetaProject[]; onChange: (id: string) => void }) {
  const selected = createMemo(() => props.projects.find(project => project.id === props.value));
  return (
    <MetaControl icon="grid" label="Project" placeholder="No project — personal"
      value={selected()?.name} set={Boolean(props.value)} menuLabel="Choose project">
      {close => (
        <ul class="tm-list" role="listbox" aria-label="Project">
          <li role="option" aria-selected={props.value === ""}
            classList={{ "tm-opt": true, selected: props.value === "" }}
            onMouseDown={event => { event.preventDefault(); props.onChange(""); close(); }}>
            <Avatar class="tm-opt-badge" variant="all" />
            <span class="tm-opt-text"><span class="tm-opt-name">No project</span><span class="tm-opt-sub">Personal task</span></span>
            <Show when={props.value === ""}><span class="tm-check" aria-hidden="true"><Icon name="check" size={13} /></span></Show>
          </li>
          <For each={props.projects}>{project =>
            <li role="option" aria-selected={project.id === props.value}
              classList={{ "tm-opt": true, selected: project.id === props.value }}
              onMouseDown={event => { event.preventDefault(); props.onChange(project.id); close(); }}>
              <Avatar class="tm-opt-badge" variant="project" name={project.name} />
              <span class="tm-opt-text"><span class="tm-opt-name">{project.name}</span><Show when={project.key}>{key => <span class="tm-opt-sub">{key()}</span>}</Show></span>
              <Show when={project.id === props.value}><span class="tm-check" aria-hidden="true"><Icon name="check" size={13} /></span></Show>
            </li>}
          </For>
        </ul>
      )}
    </MetaControl>
  );
}

/** A due date is a `YYYY-MM-DD` string end to end; it is only formatted for reading. */
export const readableDate = (iso: string) => {
  if (!iso) return "";
  const parsed = new Date(iso + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
export const isoInDays = (days: number, from = new Date()) => {
  const day = new Date(from);
  day.setDate(day.getDate() + days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};
export const QUICK_DUE_DAYS: [string, number][] = [["Today", 0], ["Tomorrow", 1], ["Next week", 7]];

/** Due-date chooser — the obvious answers, plus the full date field. */
export function DueDateControl(props: { value: string; onChange: (iso: string) => void; quick?: [string, number][] }) {
  const quick = () => (props.quick ?? QUICK_DUE_DAYS).map(([label, days]) => [label, isoInDays(days)] as const);
  return (
    <MetaControl icon="clock" label="Due date" placeholder="No due date"
      value={readableDate(props.value)} set={Boolean(props.value)} menuLabel="Choose due date">
      {close => (
        <div class="tm-date">
          <div class="tm-quick">
            <For each={quick()}>{([label, iso]) =>
              <button type="button" class="tm-quick-btn" classList={{ selected: props.value === iso }}
                onMouseDown={event => { event.preventDefault(); props.onChange(iso); close(); }}>{label}</button>}
            </For>
          </div>
          <label class="tm-date-field">
            <span class="tm-date-caption">Pick a date</span>
            <input type="date" aria-label="Due date" value={props.value} onInput={event => props.onChange(event.currentTarget.value)} />
          </label>
          <Show when={props.value}>
            <button type="button" class="tm-clear" onMouseDown={event => { event.preventDefault(); props.onChange(""); close(); }}>Clear due date</button>
          </Show>
        </div>
      )}
    </MetaControl>
  );
}

/**
 * Assignee chooser — several people, because a task carries `assignee_ids`.
 * The list is whatever the caller hands in; the composer hands in the project's
 * members only, since assigning somebody who is not on the project is refused.
 */
export function AssigneeControl(props: {
  value: string[]; people: MetaPerson[]; onToggle: (id: string) => void;
  disabled?: boolean; disabledReason?: string; emptyNote?: string;
}) {
  const names = createMemo(() => props.value.map(id => props.people.find(person => person.id === id)?.label ?? id));
  const summary = createMemo(() => {
    const list = names();
    if (!list.length) return "";
    if (list.length <= 2) return list.join(", ");
    return `${list[0]}, ${list[1]} +${list.length - 2}`;
  });
  return (
    <MetaControl icon="user" label="Assignee" placeholder="Unassigned"
      value={summary()} set={props.value.length > 0} menuLabel="Choose assignees"
      disabled={props.disabled} disabledReason={props.disabledReason}>
      {() => (
        <ul class="tm-list" role="listbox" aria-multiselectable="true" aria-label="Assignees">
          <Show when={!props.people.length}><li class="tm-note">{props.emptyNote ?? "Nobody available to assign."}</li></Show>
          <For each={props.people}>{person => {
            const on = () => props.value.includes(person.id);
            return (
              <li role="option" aria-selected={on()}
                classList={{ "tm-opt": true, selected: on() }}
                onMouseDown={event => { event.preventDefault(); props.onToggle(person.id); }}>
                <Avatar class="tm-opt-badge" variant="person" name={person.label} />
                <span class="tm-opt-text"><span class="tm-opt-name">{person.label}</span><Show when={person.sub}>{sub => <span class="tm-opt-sub">{sub()}</span>}</Show></span>
                <span class="tm-checkbox" classList={{ on: on() }} aria-hidden="true"><Show when={on()}><Icon name="check" size={12} /></Show></span>
              </li>
            );
          }}</For>
        </ul>
      )}
    </MetaControl>
  );
}
