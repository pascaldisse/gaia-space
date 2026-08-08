import { For, Show, createEffect, onMount } from "solid-js";
import {
  ensureDefaults, profileId, profiles, projectId, projects,
  reloadProfiles, reloadProjects, setProfileId, setProjectId,
} from "../session";

/** "Acting as" — pick an existing profile instead of typing an opaque id. */
export function ProfilePicker(props: { label?: string; value?: string; onChange?: (id: string) => void; allowAll?: boolean }) {
  onMount(() => { void reloadProfiles(); });
  createEffect(() => ensureDefaults());
  const current = () => (props.value !== undefined ? props.value : profileId());
  const set = (id: string) => (props.onChange ? props.onChange(id) : setProfileId(id));
  return (
    <label class="picker">
      {props.label ?? "Acting as"}
      <select value={current()} onChange={(e) => set(e.currentTarget.value)}>
        <Show when={props.allowAll}>
          <option value="">All profiles</option>
        </Show>
        <Show when={!profiles()?.length}>
          <option value="">No profiles — add one in Members</option>
        </Show>
        <For each={profiles()?.filter((p) => !p.archived)}>
          {(p) => <option value={p.id}>{p.display_name || p.username} ({p.id})</option>}
        </For>
      </select>
    </label>
  );
}

/** Active project — same idea for project-scoped views. */
export function ProjectPicker(props: { label?: string; value?: string; onChange?: (id: string) => void; allowAll?: boolean }) {
  onMount(() => { void reloadProjects(); });
  createEffect(() => ensureDefaults());
  const current = () => (props.value !== undefined ? props.value : projectId());
  const set = (id: string) => (props.onChange ? props.onChange(id) : setProjectId(id));
  return (
    <label class="picker">
      {props.label ?? "Project"}
      <select value={current()} onChange={(e) => set(e.currentTarget.value)}>
        <Show when={props.allowAll}>
          <option value="">All projects</option>
        </Show>
        <Show when={!projects()?.length}>
          <option value="">No projects yet</option>
        </Show>
        <For each={projects()?.filter((p) => !p.archived)}>
          {(p) => <option value={p.id}>{p.name} ({p.key})</option>}
        </For>
      </select>
    </label>
  );
}
