import { For, Show, createMemo, createResource, createSignal, createUniqueId, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import DateField from "./DateField";
import "./TaskMeta.css";
import { UI_LOCALE } from "../calendar";
import { personalApi, type TodoLink } from "../api/personal";
import { humanError } from "../session";

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
export type MetaPerson = { id: string; label: string; sub?: string; avatarUrl?: string | null };

/** Project chooser — one project or none (a personal task). */
export function ProjectControl(props: { value: string; projects: MetaProject[]; onChange: (id: string) => void }) {
  const selected = createMemo(() => props.projects.find(project => project.id === props.value));
  // The mark of a PROJECT is the rail's own layers glyph — `grid` was a generic
  // placeholder that said nothing about the thing it stands for.
  return (
    <MetaControl icon="layers" label="Project" placeholder="No project — personal"
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
  return parsed.toLocaleDateString(UI_LOCALE, { weekday: "short", month: "short", day: "numeric" });
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
          {/* The product's own month grid, not the operating system's (DateField). */}
          <div class="tm-date-field">
            <DateField label="Due date" value={props.value} onChange={value => { props.onChange(value); if (value) close(); }} placeholder="Pick a date" />
          </div>
          <Show when={props.value}>
            <button type="button" class="tm-clear" onMouseDown={event => { event.preventDefault(); props.onChange(""); close(); }}>Clear due date</button>
          </Show>
        </div>
      )}
    </MetaControl>
  );
}

/**
 * Category chooser — what KIND of act this task is. Optional by design: most tasks
 * never get one, and a task without a category must never look unfinished, so the
 * resting state is a plain "No category" and the control offers a way back to it.
 *
 * The list is CLOSED and lives in one place (`api/personal`), shared with the server
 * that validates it. A free text field here would produce "Review", "review" and
 * "Reviewing" within a week and no two of them would group together.
 */
export function CategoryControl(props: {
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const selected = createMemo(() => props.options.find(option => option.id === props.value));
  return (
    <MetaControl icon="tag" label="Category" placeholder="No category"
      value={selected()?.label} set={Boolean(props.value)} menuLabel="Choose category">
      {close => (
        <ul class="tm-list" role="listbox" aria-label="Category">
          <li role="option" aria-selected={props.value === ""}
            classList={{ "tm-opt": true, selected: props.value === "" }}
            onMouseDown={event => { event.preventDefault(); props.onChange(""); close(); }}>
            <span class="tm-opt-text"><span class="tm-opt-name">No category</span></span>
            <Show when={props.value === ""}><span class="tm-check" aria-hidden="true"><Icon name="check" size={13} /></span></Show>
          </li>
          <For each={props.options}>{option =>
            <li role="option" aria-selected={option.id === props.value}
              classList={{ "tm-opt": true, selected: option.id === props.value }}
              onMouseDown={event => { event.preventDefault(); props.onChange(option.id); close(); }}>
              <span class={`tm-cat-dot cat-${option.id}`} aria-hidden="true" />
              <span class="tm-opt-text"><span class="tm-opt-name">{option.label}</span></span>
              <Show when={option.id === props.value}><span class="tm-check" aria-hidden="true"><Icon name="check" size={13} /></span></Show>
            </li>}
          </For>
        </ul>
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
  /** NAMING IS NOT THE SAME QUESTION AS ASSIGNING. `people` is who you MAY assign —
   *  the project's members — but a task already assigned to somebody outside that
   *  list (a personal task, or a member since removed) still has to say WHO. Without
   *  this resolver the control fell back to the raw `profile-19fe6e19f53`, while the
   *  chip row beside it read "Jannes": one fact, two answers, one of them a database
   *  key shown to a person. */
  nameOf?: (id: string) => string;
}) {
  const names = createMemo(() => props.value.map(id =>
    props.people.find(person => person.id === id)?.label ?? props.nameOf?.(id) ?? id));
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
                <Avatar class="tm-opt-badge" variant="person" name={person.label} avatarUrl={person.avatarUrl} />
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
/**
 * Links row — a task's own cross-references (`Todo.links`, `TodoLink[]`): a bare
 * external URL (a GitHub issue/PR, a doc, …) or another task by id. Only meaningful
 * once the task itself has an id (`update_todo` mode) — a task being created has
 * nothing yet to hang a link off, so the caller does not mount this before then.
 *
 * One kind is offered here: EXTERNAL. Linking one task to another (`kind: "TASK"`) is
 * the server's shape already (`add_todo_link`), but no surface yet hands this control
 * a task PICKER, so it is not offered from here — adding it later is additive, not a
 * rename of what is here now.
 */
export function LinksControl(props: { todoId: string; canEdit: boolean }) {
const [links, { refetch }] = createResource(
() => props.todoId,
async (id: string): Promise<{ items?: TodoLink[]; failed?: string }> => {
if (!id) return { items: [] };
try { return { items: await personalApi.todoLinks(id) }; }
catch (reason) { return { failed: humanError(reason) }; }
},
);
const items = () => links()?.items ?? [];
const failed = () => links()?.failed ?? "";
const [url, setUrl] = createSignal("");
const [title, setTitle] = createSignal("");
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal("");
const add = async (event: SubmitEvent) => {
event.preventDefault();
const trimmedUrl = url().trim();
if (!trimmedUrl || busy()) return;
setBusy(true); setError("");
try {
await personalApi.addTodoLink({ todo_id: props.todoId, kind: "EXTERNAL", url: trimmedUrl, title: title().trim() || null });
setUrl(""); setTitle("");
await refetch();
} catch (reason) { setError(humanError(reason)); }
finally { setBusy(false); }
};
const remove = async (id: string) => {
setBusy(true); setError("");
try { await personalApi.deleteTodoLink(id); await refetch(); }
catch (reason) { setError(humanError(reason)); }
finally { setBusy(false); }
};
return (
<div class="tm-links">
<span class="field-label">Links</span>
<Show when={failed()}>{reason => <p class="personal-error" role="alert">Links could not be loaded: {reason()}</p>}</Show>
<ul class="tm-links-list">
<For each={items()}>{link =>
<li class="tm-link-row">
<a href={link.url ?? undefined} target="_blank" rel="noopener noreferrer">{link.title || link.url || link.target_id}</a>
<Show when={props.canEdit}>
<button type="button" class="ghost small tm-link-remove" aria-label={`Remove link ${link.title || link.url || link.id}`}
disabled={busy()} onClick={() => void remove(link.id)}>×</button>
</Show>
</li>}
</For>
<Show when={!items().length && !failed()}><li class="tm-note">No links yet.</li></Show>
</ul>
<Show when={props.canEdit}>
<form class="tm-link-add" onSubmit={event => void add(event)}>
<input class="grow" type="url" aria-label="Link URL" placeholder="GitHub issue / PR URL…"
value={url()} onInput={event => setUrl(event.currentTarget.value)} />
<input aria-label="Link title" placeholder="Title (optional)"
value={title()} onInput={event => setTitle(event.currentTarget.value)} />
<button type="submit" class="ghost small" disabled={busy() || !url().trim()}>Add</button>
</form>
</Show>
<Show when={error()}><p class="personal-error" role="alert">{error()}</p></Show>
</div>
);
}
