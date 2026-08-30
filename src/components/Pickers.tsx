import { For, Show, createEffect, onMount, type JSX } from "solid-js";
import {
  ensureDefaults, profileId, profileLocked, profiles, projectId, projects,
  reloadProfiles, reloadProjects, setProfileId, setProjectId,
} from "../session";
import { PillMenu, type PillMenuOption } from "./controls";

/** ── WHY THE PILL FORM IS NOT A `<select>` ANY MORE ─────────────────────────
 *
 *  A native select's RESTING state is ours; its OPEN state is the operating
 *  system's — grey rows, system font, system chrome, and no CSS reaches it. So
 *  the calendar's own filters looked redesigned right up to the moment they
 *  mattered, and the product owner named exactly that: "when I click it, the old
 *  view still appears".
 *
 *  `PillMenu` (components/controls.tsx) draws the open state itself and re-implements
 *  everything the native control gave away for free — Enter/Space/arrows/Home/End,
 *  type-ahead, Escape returning focus, a click outside closing — all covered by
 *  controls.pillmenu.test.tsx.
 *
 *  The LABELLED form keeps its native `<select>`: inside a form, next to other
 *  fields, that is the right control and its popup is not the product's surface. */
function PickerFrame(props: {
  label: string; labelHidden?: boolean; value: string; disabled?: boolean; title?: string;
  onChange: (id: string) => void; ref: (element: HTMLSelectElement) => void;
  options: PillMenuOption[]; children: JSX.Element;
}) {
  return (
    <Show
      when={props.labelHidden}
      fallback={
        <label class="picker">
          {props.label}
          <select ref={props.ref} value={props.value} disabled={props.disabled} title={props.title}
            onChange={(e) => props.onChange(e.currentTarget.value)}>{props.children}</select>
        </label>
      }
    >
      <PillMenu label={props.label} value={props.value} disabled={props.disabled} title={props.title}
        options={props.options} onChange={props.onChange} />
    </Show>
  );
}

/** "Acting as" — pick an existing profile instead of typing an opaque id. */
/** `identity` marks the "who am I acting as" picker — that one is bound to the
 *  logged-in account in web mode. Choosing OTHER people (assignee, invitee) is
 *  a different act and must stay open, or nothing can ever be assigned. */
export function ProfilePicker(props: { label?: string; labelHidden?: boolean; value?: string; onChange?: (id: string) => void; allowAll?: boolean; locked?: boolean; identity?: boolean }) {
  onMount(() => { void reloadProfiles(); });
  createEffect(() => ensureDefaults());
  const current = () => (props.value !== undefined ? props.value : profileId());
  const set = (id: string) => (props.onChange ? props.onChange(id) : setProfileId(id));
  const locked = () => props.locked || (props.identity === true && profileLocked());
  let picker!: HTMLSelectElement;
  // Options load after the select mounts. Re-apply the controlled value then;
  // otherwise the browser can display its first option while the route points elsewhere.
  createEffect(() => { profiles(); const value = current(); if (picker && picker.value !== value) picker.value = value; });
  /* ONE list, two renderings: the pill menu takes it as data, the labelled select
     as <option> children. They can never disagree because they are the same list. */
  const options = (): PillMenuOption[] => {
    const list: PillMenuOption[] = [];
    if (props.allowAll) list.push({ value: "", label: "All profiles" });
    if (profiles() === undefined) list.push({ value: "", label: "Loading profiles…" });
    else if (!profiles()?.length) list.push({ value: "", label: "No profiles — add one in Members" });
    for (const p of profiles()?.filter((person) => !person.archived) ?? []) {
      list.push({ value: p.id, label: p.display_name || p.username });
    }
    return list;
  };
  return (
    <PickerFrame
      options={options()}
      label={props.label ?? "Acting as"}
      labelHidden={props.labelHidden}
      value={current()}
      disabled={locked()}
      title={locked() ? "Locked to your account's profile" : undefined}
      onChange={set}
      ref={(element) => (picker = element)}
    >
        <Show when={props.allowAll}>
          <option value="">All profiles</option>
        </Show>
        <Show when={profiles() === undefined}>
          <option value="">Loading profiles…</option>
        </Show>
        <Show when={profiles() !== undefined && !profiles()?.length}>
          <option value="">No profiles — add one in Members</option>
        </Show>
        <For each={profiles()?.filter((p) => !p.archived)}>
          {(p) => <option value={p.id}>{p.display_name || p.username}</option>}
        </For>
    </PickerFrame>
  );
}

/** Active project — same idea for project-scoped views. */
export function ProjectPicker(props: { label?: string; labelHidden?: boolean; value?: string; onChange?: (id: string) => void; allowAll?: boolean }) {
  onMount(() => { void reloadProjects(); });
  createEffect(() => ensureDefaults());
  const current = () => (props.value !== undefined ? props.value : projectId());
  const set = (id: string) => (props.onChange ? props.onChange(id) : setProjectId(id));
  let picker!: HTMLSelectElement;
  createEffect(() => { projects(); const value = current(); if (picker && picker.value !== value) picker.value = value; });
  const options = (): PillMenuOption[] => {
    const list: PillMenuOption[] = [];
    if (props.allowAll) list.push({ value: "", label: "All projects" });
    if (projects() === undefined) list.push({ value: "", label: "Loading projects…" });
    else if (!projects()?.length) list.push({ value: "", label: "No projects yet" });
    for (const p of projects()?.filter((project) => !project.archived) ?? []) {
      list.push({ value: p.id, label: `${p.name} (${p.key})` });
    }
    return list;
  };
  return (
    <PickerFrame
      options={options()}
      label={props.label ?? "Project"}
      labelHidden={props.labelHidden}
      value={current()}
      onChange={set}
      ref={(element) => (picker = element)}
    >
        <Show when={props.allowAll}>
          <option value="">All projects</option>
        </Show>
        <Show when={projects() === undefined}>
          <option value="">Loading projects…</option>
        </Show>
        <Show when={projects() !== undefined && !projects()?.length}>
          <option value="">No projects yet</option>
        </Show>
        <For each={projects()?.filter((p) => !p.archived)}>
          {(p) => <option value={p.id}>{p.name} ({p.key})</option>}
        </For>
    </PickerFrame>
  );
}
