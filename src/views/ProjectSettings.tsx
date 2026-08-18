import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Status } from "../api/issues";
import { platformApi } from "../api/platform";
import { projectId, projects, reloadProjects, humanError } from "../session";
import "./ProjectSettings.css";

// Project Settings — the home for project workflow configuration. Issue
// statuses (name / colour / resolved flag) live here now instead of being
// scattered across the Issues view. Project metadata is shown read-only; the
// canonical record is still the Space container project.
export default function ProjectSettings() {
  const project = createMemo(() => projects()?.find((p) => p.id === projectId()));
  const [error, setError] = createSignal("");
  const [newStatus, setNewStatus] = createSignal("");

  // Editable project deadline (optional ISO date). Mirrors the canonical project
  // record; saving persists via the platform API and refreshes the shared cache so
  // the calendar, steering and overview all reflect the change immediately.
  const [deadline, setDeadline] = createSignal("");
  const [savingDeadline, setSavingDeadline] = createSignal(false);
  createEffect(() => setDeadline(project()?.deadline ?? ""));
  const deadlineDirty = () => (deadline() || "") !== (project()?.deadline ?? "");
  const saveDeadline = async () => {
    const current = project();
    if (!current) return;
    setSavingDeadline(true); setError("");
    try {
      await platformApi.updateProject({ ...current, deadline: deadline().trim() || null });
      await reloadProjects();
    } catch (e) { setError(humanError(e)); }
    finally { setSavingDeadline(false); }
  };
  const [statuses, { refetch }] = createResource(projectId, (id) => (id ? planningApi.statuses(id) : Promise.resolve([] as Status[])));

  const addStatus = async () => {
    const name = newStatus().trim();
    if (!name || !projectId()) return;
    try { await planningApi.createStatus({ project_id: projectId(), name, color: "#5b78e5", resolved: false }); setNewStatus(""); refetch(); }
    catch (e) { setError(humanError(e)); }
  };
  const patch = async (s: Status, next: Partial<Status>) => {
    try { await planningApi.updateStatus({ ...s, ...next }); refetch(); } catch (e) { setError(humanError(e)); }
  };
  const remove = async (s: Status) => {
    try { await planningApi.deleteStatus(s.id); refetch(); } catch (e) { setError(humanError(e)); }
  };

  return <section class="ps-view">
    <header class="ps-head"><div><h1>Project settings</h1><p>Workflow and configuration for this project. Status changes apply to every issue and board column.</p></div></header>

    <Show when={!projectId()}><p class="ps-empty">No project selected — pick one from the project switcher above.</p></Show>

    <Show when={projectId()}>
      <Show when={error()}><p class="ps-error">{error()}</p></Show>

      <div class="ps-grid">
        <section class="ps-panel">
          <div class="ps-panel-head"><h2>Project</h2></div>
          <dl class="ps-meta">
            <div><dt>Name</dt><dd>{project()?.name ?? "—"}</dd></div>
            <div><dt>Key</dt><dd><code>{project()?.key ?? "—"}</code></dd></div>
            <div><dt>Description</dt><dd>{project()?.description || "—"}</dd></div>
            <div><dt>Project ID</dt><dd><code>{project()?.id ?? "—"}</code></dd></div>
          </dl>
          <div class="ps-deadline">
            <label>
              <span>Deadline <em>optional</em></span>
              <input type="date" value={deadline()} onInput={(e) => setDeadline(e.currentTarget.value)} />
            </label>
            <div class="ps-deadline-actions">
              <Show when={deadline()}><button class="ghost" onClick={() => setDeadline("")}>Clear</button></Show>
              <button class="primary" disabled={!deadlineDirty() || savingDeadline()} onClick={saveDeadline}>{savingDeadline() ? "Saving…" : "Save deadline"}</button>
            </div>
          </div>
          <p class="ps-hint">The deadline appears on the calendar and in Steering. Project name, key and description are managed as the Space container record.</p>
        </section>

        <section class="ps-panel">
          <div class="ps-panel-head"><h2>Issue statuses &amp; workflow</h2></div>
          <p class="ps-hint">Statuses define the workflow. Mark a status "done" so it resolves issues and clears them from Steering.</p>
          <div class="ps-status-add">
            <input placeholder="New status name" value={newStatus()} onInput={(e) => setNewStatus(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") addStatus(); }} />
            <button class="primary" onClick={addStatus}>Add status</button>
          </div>
          <Show when={statuses.loading}><p class="ps-hint">Loading statuses…</p></Show>
          <ul class="ps-status-list">
            <For each={statuses()}>{(s) =>
              <li>
                <input type="color" value={s.color} onInput={(e) => patch(s, { color: e.currentTarget.value })} />
                <input class="ps-status-name" value={s.name} onChange={(e) => patch(s, { name: e.currentTarget.value })} />
                <label class="ps-status-done"><input type="checkbox" checked={s.resolved} onChange={(e) => patch(s, { resolved: e.currentTarget.checked })} /> done</label>
                <button class="ghost" title="Delete status" onClick={() => remove(s)}>×</button>
              </li>}</For>
          </ul>
          <Show when={statuses() && !statuses()!.length}><p class="ps-hint">No statuses yet — add the first one above.</p></Show>
        </section>
      </div>
    </Show>
  </section>;
}
