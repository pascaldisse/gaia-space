import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount } from "solid-js";
import {
  ensureDefaults, profileId, profileLocked, profiles, projectId, projects,
  reloadProfiles, reloadProjects, setProfileId, setProjectId,
} from "../session";
import "./Pickers.css";

// ── shared visual helpers ────────────────────────────────────────────────
// Deterministic avatar hue from an id so a person/project keeps one colour.
const hueOf = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
};
const initials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

type Option = { id: string; label: string; sub?: string };

/**
 * One coherent, accessible picker used everywhere an identity or project is
 * chosen. Renders a compact trigger (avatar · name · chevron) that opens a
 * polished popover with type-ahead search and full keyboard support — no more
 * bare native <select>. Same prop shape as before so every call site is a
 * drop-in.
 */
function EntityPicker(props: {
  kind: "profile" | "project";
  label?: string;
  value?: string;
  onChange?: (id: string) => void;
  allowAll?: boolean;
  options: Option[];
  loading: boolean;
  locked?: boolean;
  lockedTitle?: string;
  allLabel: string;
  emptyLabel: string;
  placeholder: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [activeIdx, setActiveIdx] = createSignal(0);
  const listId = createUniqueId();
  let root!: HTMLDivElement;
  let searchEl: HTMLInputElement | undefined;

  const rows = createMemo<Option[]>(() => {
    const base: Option[] = props.allowAll ? [{ id: "", label: props.allLabel }, ...props.options] : props.options;
    const q = query().trim().toLowerCase();
    if (!q) return base;
    return base.filter((o) => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
  });

  const selected = createMemo(() => props.options.find((o) => o.id === props.value) ?? null);
  const triggerLabel = () => {
    if (props.value === "" && props.allowAll) return props.allLabel;
    if (selected()) return selected()!.label;
    if (props.loading) return "Loading…";
    return props.emptyLabel;
  };

  const choose = (id: string) => { (props.onChange ?? (props.kind === "profile" ? setProfileId : setProjectId))(id); close(); };
  const close = () => { setOpen(false); setQuery(""); };
  const openMenu = () => {
    if (props.locked) return;
    setOpen(true);
    const idx = Math.max(0, rows().findIndex((o) => o.id === (props.value ?? "")));
    setActiveIdx(idx);
    queueMicrotask(() => searchEl?.focus());
  };

  // keep the highlighted row valid as the filtered set changes
  createEffect(() => { if (open()) { const n = rows().length; if (activeIdx() >= n) setActiveIdx(Math.max(0, n - 1)); } });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(rows().length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActiveIdx(0); }
    else if (e.key === "End") { e.preventDefault(); setActiveIdx(rows().length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows()[activeIdx()]; if (row) choose(row.id); }
    else if (e.key === "Escape") { e.preventDefault(); close(); trigger?.focus(); }
    else if (e.key === "Tab") { close(); }
  };

  let trigger: HTMLButtonElement | undefined;
  onMount(() => {
    const away = (e: MouseEvent) => { if (open() && !root.contains(e.target as Node)) close(); };
    window.addEventListener("mousedown", away);
    onCleanup(() => window.removeEventListener("mousedown", away));
  });

  return (
    <div class="ep" classList={{ "ep-locked": props.locked }} ref={root}>
      <Show when={props.label}><span class="ep-caption">{props.label}</span></Show>
      <button
        type="button" ref={trigger} class="ep-trigger"
        aria-haspopup="listbox" aria-expanded={open()} aria-controls={listId}
        disabled={props.locked} title={props.locked ? props.lockedTitle : undefined}
        onClick={() => (open() ? close() : openMenu())}
      >
        <span class="ep-avatar" classList={{ "ep-avatar-all": props.value === "" && props.allowAll }}
          style={props.value ? { "--ep-hue": String(hueOf(props.value)) } : undefined} aria-hidden="true">
          {props.value === "" && props.allowAll ? "∗" : initials(triggerLabel())}
        </span>
        <span class="ep-name">{triggerLabel()}</span>
        <Show when={!props.locked}><span class="ep-chevron" aria-hidden="true">▾</span></Show>
      </button>

      <Show when={open()}>
        <div class="ep-menu" role="dialog" aria-label={props.label || props.placeholder}>
          <div class="ep-search">
            <span class="ep-search-icon" aria-hidden="true">⌕</span>
            <input ref={searchEl} type="text" value={query()} placeholder={props.placeholder}
              aria-label={props.placeholder} aria-activedescendant={rows()[activeIdx()] ? `${listId}-${activeIdx()}` : undefined}
              onInput={(e) => { setQuery(e.currentTarget.value); setActiveIdx(0); }} onKeyDown={onKey} />
          </div>
          <ul class="ep-list" role="listbox" id={listId} aria-label={props.placeholder}>
            <Show when={props.loading}><li class="ep-note">Loading…</li></Show>
            <Show when={!props.loading && !rows().length}><li class="ep-note">No matches.</li></Show>
            <For each={rows()}>{(o, i) =>
              <li id={`${listId}-${i()}`} role="option" aria-selected={o.id === (props.value ?? "")}
                classList={{ "ep-opt": true, active: i() === activeIdx(), selected: o.id === (props.value ?? "") }}
                onMouseEnter={() => setActiveIdx(i())} onMouseDown={(e) => { e.preventDefault(); choose(o.id); }}>
                <span class="ep-avatar" classList={{ "ep-avatar-all": o.id === "" }}
                  style={o.id ? { "--ep-hue": String(hueOf(o.id)) } : undefined} aria-hidden="true">
                  {o.id === "" ? "∗" : initials(o.label)}
                </span>
                <span class="ep-opt-text"><span class="ep-opt-name">{o.label}</span><Show when={o.sub}><span class="ep-opt-sub">{o.sub}</span></Show></span>
                <Show when={o.id === (props.value ?? "")}><span class="ep-check" aria-hidden="true">✓</span></Show>
              </li>}</For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

/** "Acting as" — pick an existing profile with a polished identity menu. */
export function ProfilePicker(props: { label?: string; value?: string; onChange?: (id: string) => void; allowAll?: boolean }) {
  onMount(() => { void reloadProfiles(); });
  createEffect(() => ensureDefaults());
  const value = () => (props.value !== undefined ? props.value : profileId());
  const options = createMemo<Option[]>(() =>
    (profiles()?.filter((p) => !p.archived) ?? []).map((p) => ({ id: p.id, label: p.display_name || p.username, sub: `@${p.username}` })));
  return (
    <EntityPicker kind="profile" label={props.label ?? "Acting as"} value={value()} onChange={props.onChange} allowAll={props.allowAll}
      options={options()} loading={profiles() === undefined} locked={profileLocked()} lockedTitle="Locked to your account's profile"
      allLabel="All profiles" emptyLabel="No profile — add one in Members" placeholder="Search people…" />
  );
}

/** Active project — same coherent picker for project-scoped views. */
export function ProjectPicker(props: { label?: string; value?: string; onChange?: (id: string) => void; allowAll?: boolean }) {
  onMount(() => { void reloadProjects(); });
  createEffect(() => ensureDefaults());
  const value = () => (props.value !== undefined ? props.value : projectId());
  const options = createMemo<Option[]>(() =>
    (projects()?.filter((p) => !p.archived) ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.key })));
  return (
    <EntityPicker kind="project" label={props.label ?? "Project"} value={value()} onChange={props.onChange} allowAll={props.allowAll}
      options={options()} loading={projects() === undefined}
      allLabel="All projects" emptyLabel="No projects yet" placeholder="Search projects…" />
  );
}
