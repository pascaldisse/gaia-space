import { For, Show, createMemo, createSignal, createUniqueId, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import "./TaskMeta.css";

// Deterministic avatar hue so a person/project keeps one colour (mirrors Pickers).
const hueOf = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
};
const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

/**
 * One generous, same-language metadata control for the task composer.
 * Renders a full, equal-weight action button (icon · label · value · chevron)
 * that opens a polished popover. All three composer controls — Project, Due
 * date, Assignee — share this shell so they read as one clean row, never as
 * cramped inline labels or a bare native select.
 */
function MetaControl(props: {
  icon: string;
  label: string;
  value?: string;          // resting-state value line; empty → placeholder
  placeholder: string;
  set: boolean;            // has a value been chosen?
  menuLabel: string;
  children: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const menuId = createUniqueId();
  let root!: HTMLDivElement;
  let trigger: HTMLButtonElement | undefined;
  const close = () => setOpen(false);

  onMount(() => {
    const away = (e: MouseEvent) => { if (open() && !root.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && open()) { close(); trigger?.focus(); } };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    onCleanup(() => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", key); });
  });

  return (
    <div class="tm" ref={root}>
      <button
        type="button" ref={trigger}
        class="tm-trigger" classList={{ set: props.set, open: open() }}
        aria-haspopup="dialog" aria-expanded={open()} aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span class="tm-icon" aria-hidden="true">{props.icon}</span>
        <span class="tm-text">
          <span class="tm-label">{props.label}</span>
          <span class="tm-value" classList={{ placeholder: !props.set }}>{props.set ? props.value : props.placeholder}</span>
        </span>
        <span class="tm-chevron" aria-hidden="true">▾</span>
      </button>
      <Show when={open()}>
        <div class="tm-menu" id={menuId} role="dialog" aria-label={props.menuLabel}>
          {props.children(close)}
        </div>
      </Show>
    </div>
  );
}

type Project = { id: string; name: string; key?: string };
type Person = { id: string; label: string; sub?: string };

/** Project chooser — list incl. "No project — personal", single select. */
export function ProjectControl(props: { value: string; projects: Project[]; onChange: (id: string) => void }) {
  const selected = createMemo(() => props.projects.find((p) => p.id === props.value) ?? null);
  return (
    <MetaControl icon="▦" label="Project" placeholder="No project — personal"
      value={selected()?.name} set={Boolean(props.value)} menuLabel="Choose project">
      {(close) => (
        <ul class="tm-list" role="listbox" aria-label="Project">
          <li role="option" aria-selected={props.value === ""}
            classList={{ "tm-opt": true, selected: props.value === "" }}
            onMouseDown={(e) => { e.preventDefault(); props.onChange(""); close(); }}>
            <span class="tm-opt-badge all" aria-hidden="true">∗</span>
            <span class="tm-opt-text"><span class="tm-opt-name">No project</span><span class="tm-opt-sub">Personal task</span></span>
            <Show when={props.value === ""}><span class="tm-check" aria-hidden="true">✓</span></Show>
          </li>
          <For each={props.projects}>{(p) =>
            <li role="option" aria-selected={p.id === props.value}
              classList={{ "tm-opt": true, selected: p.id === props.value }}
              onMouseDown={(e) => { e.preventDefault(); props.onChange(p.id); close(); }}>
              <span class="tm-opt-badge" style={{ "--tm-hue": String(hueOf(p.id)) }} aria-hidden="true">{initials(p.name)}</span>
              <span class="tm-opt-text"><span class="tm-opt-name">{p.name}</span><Show when={p.key}><span class="tm-opt-sub">{p.key}</span></Show></span>
              <Show when={p.id === props.value}><span class="tm-check" aria-hidden="true">✓</span></Show>
            </li>}
          </For>
        </ul>
      )}
    </MetaControl>
  );
}

const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
const isoOffset = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

/** Due-date chooser — obvious quick options + a full native date picker. */
export function DueDateControl(props: { value: string; onChange: (iso: string) => void }) {
  const quick: [string, string][] = [["Today", isoOffset(0)], ["Tomorrow", isoOffset(1)], ["Next week", isoOffset(7)]];
  let dateEl: HTMLInputElement | undefined;
  return (
    <MetaControl icon="◷" label="Due date" placeholder="No due date"
      value={fmtDate(props.value)} set={Boolean(props.value)} menuLabel="Choose due date">
      {(close) => (
        <div class="tm-date">
          <div class="tm-quick">
            <For each={quick}>{([name, iso]) =>
              <button type="button" class="tm-quick-btn" classList={{ selected: props.value === iso }}
                onMouseDown={(e) => { e.preventDefault(); props.onChange(iso); close(); }}>{name}</button>}
            </For>
          </div>
          <label class="tm-date-field">
            <span class="tm-date-caption">Pick a date</span>
            <input ref={dateEl} type="date" value={props.value}
              onInput={(e) => props.onChange(e.currentTarget.value)} />
          </label>
          <Show when={props.value}>
            <button type="button" class="tm-clear" onMouseDown={(e) => { e.preventDefault(); props.onChange(""); close(); }}>Clear due date</button>
          </Show>
        </div>
      )}
    </MetaControl>
  );
}

/** Assignee chooser — multi-select people with live count + checkmarks. */
export function AssigneeControl(props: { value: string[]; people: Person[]; onToggle: (id: string) => void }) {
  const names = createMemo(() => props.value.map((id) => props.people.find((p) => p.id === id)?.label ?? id));
  const summary = createMemo(() => {
    const n = names();
    if (!n.length) return "";
    if (n.length <= 2) return n.join(", ");
    return `${n[0]}, ${n[1]} +${n.length - 2}`;
  });
  return (
    <MetaControl icon="◍" label="Assignee" placeholder="Unassigned"
      value={summary()} set={props.value.length > 0} menuLabel="Choose assignees">
      {() => (
        <ul class="tm-list" role="listbox" aria-multiselectable="true" aria-label="Assignees">
          <Show when={!props.people.length}><li class="tm-note">No people yet — add profiles in Members.</li></Show>
          <For each={props.people}>{(p) => {
            const on = () => props.value.includes(p.id);
            return (
              <li role="option" aria-selected={on()}
                classList={{ "tm-opt": true, selected: on() }}
                onMouseDown={(e) => { e.preventDefault(); props.onToggle(p.id); }}>
                <span class="tm-opt-badge" style={{ "--tm-hue": String(hueOf(p.id)) }} aria-hidden="true">{initials(p.label)}</span>
                <span class="tm-opt-text"><span class="tm-opt-name">{p.label}</span><Show when={p.sub}><span class="tm-opt-sub">{p.sub}</span></Show></span>
                <span class="tm-checkbox" classList={{ on: on() }} aria-hidden="true">{on() ? "✓" : ""}</span>
              </li>
            );
          }}</For>
        </ul>
      )}
    </MetaControl>
  );
}
