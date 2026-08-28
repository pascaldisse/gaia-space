import { For, Show, createEffect, onMount, type JSX } from "solid-js";
import {
  ensureDefaults, profileId, profileLocked, profiles, projectId, projects,
  reloadProfiles, reloadProjects, setProfileId, setProjectId,
} from "../session";
import { PillSelect } from "./controls";

/** `labelHidden` is the stage-9a floating-label sweep: a filter control's VALUE
 *  is its label ("Demo Project (DEMO)", "All profiles"), so the word above the
 *  field is redundant furniture. The name is NOT deleted — it moves into
 *  `aria-label` on the select, so the control is still named for assistive tech.
 *  Views that genuinely need a visible caption (forms, settings) just omit it. */
function PickerFrame(props: {
  label: string; labelHidden?: boolean; value: string; disabled?: boolean; title?: string;
  onChange: (id: string) => void; ref: (element: HTMLSelectElement) => void; children: JSX.Element;
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
      <PillSelect label={props.label} value={props.value} disabled={props.disabled} title={props.title}
        onChange={props.onChange} ref={props.ref}>{props.children}</PillSelect>
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
  return (
    <PickerFrame
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
  return (
    <PickerFrame
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
