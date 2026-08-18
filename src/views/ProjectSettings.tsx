import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Status } from "../api/issues";
import { platformApi } from "../api/platform";
import { projectId, setProjectId, projects, reloadProjects, humanError } from "../session";
import "./ProjectSettings.css";

// Project Settings — the owner's home for a project. Reads top-to-bottom like a
// settings page rather than a developer console: identity first (name /
// description / deadline), then the workflow (issue statuses), then rarely-used
// support details (raw record ID, canonical-record note) tucked behind a
// disclosure, and finally a clearly-fenced danger zone (archive).
//
// No schema changes: everything here persists through the existing platform API
// (updateProject / statuses CRUD). Name & description are editable because the
// project record owns them; the short key stays read-only since it drives issue
// numbering. Archive uses updateProject({ archived: true }) — the only
// destructive action the backend exposes (there is no hard delete).
export default function ProjectSettings() {
  const project = createMemo(() => projects()?.find((p) => p.id === projectId()));
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 2600); };

  // ── Identity (name + description) ──────────────────────────────────────────
  // Mirrors the canonical project record; saved together via updateProject.
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [savingDetails, setSavingDetails] = createSignal(false);
  createEffect(() => { const p = project(); setName(p?.name ?? ""); setDescription(p?.description ?? ""); });
  const detailsDirty = () =>
    name().trim() !== (project()?.name ?? "") || (description().trim()) !== (project()?.description ?? "");
  const saveDetails = async () => {
    const current = project();
    if (!current) return;
    if (!name().trim()) { setError("A project needs a name."); return; }
    setSavingDetails(true); setError("");
    try {
      await platformApi.updateProject({ ...current, name: name().trim(), description: description().trim() || null });
      await reloadProjects();
      flash("Project details saved.");
    } catch (e) { setError(humanError(e)); }
    finally { setSavingDetails(false); }
  };

  // ── Deadline ────────────────────────────────────────────────────────────────
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
      flash("Deadline saved.");
    } catch (e) { setError(humanError(e)); }
    finally { setSavingDeadline(false); }
  };

  // ── Workflow (issue statuses) ────────────────────────────────────────────────
  const [newStatus, setNewStatus] = createSignal("");
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

  // ── Support / advanced disclosure ────────────────────────────────────────────
  const copyId = async () => {
    const id = project()?.id; if (!id) return;
    try { await navigator.clipboard?.writeText(id); flash("Project ID copied."); }
    catch { /* clipboard unavailable — the field is selectable as a fallback */ }
  };

  // ── Danger zone (archive) ────────────────────────────────────────────────────
  const [confirmArchive, setConfirmArchive] = createSignal(false);
  const [archiving, setArchiving] = createSignal(false);
  const archiveProject = async () => {
    const current = project();
    if (!current) return;
    setArchiving(true); setError("");
    try {
      await platformApi.updateProject({ ...current, archived: true });
      const fresh = await reloadProjects();
      // Move off the archived project so the shell never lands on it.
      const next = fresh.find((p) => !p.archived && p.id !== current.id);
      setProjectId(next?.id ?? "");
      setConfirmArchive(false);
    } catch (e) { setError(humanError(e)); }
    finally { setArchiving(false); }
  };

  const mark = () => (project()?.key ?? "··").slice(0, 2).toUpperCase();

  return <section class="ps-view">
    <Show when={!projectId()}>
      <header class="ps-head"><div><h1>Project settings</h1></div></header>
      <p class="ps-empty">No project selected — pick one from the project switcher above.</p>
    </Show>

    <Show when={projectId() && project()}>
      <header class="ps-head">
        <div class="ps-identity">
          <div class="ps-mark">{mark()}</div>
          <div>
            <h1>{project()?.name || "Untitled project"}</h1>
            <p><span class="ps-keychip">{project()?.key || "—"}</span>{project()?.description || "No description yet."}</p>
          </div>
        </div>
      </header>

      <Show when={error()}><p class="ps-error">{error()}</p></Show>
      <Show when={notice()}><p class="ps-notice">{notice()}</p></Show>

      <div class="ps-grid">
        {/* Overview / details */}
        <section class="ps-panel">
          <div class="ps-panel-head"><h2>Overview</h2></div>
          <p class="ps-hint">The name and summary people see across Steering, the calendar and the project switcher.</p>
          <label class="ps-field">
            <span>Name</span>
            <input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Project name" />
          </label>
          <label class="ps-field">
            <span>Description <em>optional</em></span>
            <textarea rows="3" value={description()} onInput={(e) => setDescription(e.currentTarget.value)} placeholder="What is this project about?" />
          </label>
          <label class="ps-field">
            <span>Short key</span>
            <input value={project()?.key ?? ""} readonly disabled />
          </label>
          <p class="ps-hint ps-hint-quiet">The key prefixes every issue number, so it stays fixed once the project is created.</p>
          <div class="ps-actions">
            <button class="primary" disabled={!detailsDirty() || savingDetails()} onClick={saveDetails}>{savingDetails() ? "Saving…" : "Save details"}</button>
          </div>
        </section>

        {/* Deadline */}
        <section class="ps-panel">
          <div class="ps-panel-head"><h2>Deadline</h2></div>
          <p class="ps-hint">A target date for the whole project. It appears on the calendar and drives the Steering countdown.</p>
          <label class="ps-field">
            <span>Target date <em>optional</em></span>
            <input type="date" value={deadline()} onInput={(e) => setDeadline(e.currentTarget.value)} />
          </label>
          <div class="ps-actions">
            <Show when={deadline()}><button class="ghost" onClick={() => setDeadline("")}>Clear</button></Show>
            <button class="primary" disabled={!deadlineDirty() || savingDeadline()} onClick={saveDeadline}>{savingDeadline() ? "Saving…" : "Save deadline"}</button>
          </div>
        </section>

        {/* Workflow — issue statuses */}
        <section class="ps-panel ps-panel-wide">
          <div class="ps-panel-head"><h2>Workflow statuses</h2></div>
          <p class="ps-hint">Statuses define how issues move. Mark one as <strong>done</strong> so it resolves issues and clears them from Steering. Changes apply to every issue and board column.</p>
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

      {/* Support / advanced — hidden until asked for */}
      <details class="ps-advanced">
        <summary>Advanced &amp; support</summary>
        <div class="ps-advanced-body">
          <p class="ps-hint">You rarely need this. Share the reference ID below if support asks for it.</p>
          <div class="ps-refrow">
            <div>
              <span class="ps-reflabel">Reference ID</span>
              <code class="ps-refid">{project()?.id ?? "—"}</code>
            </div>
            <button class="ghost" onClick={copyId}>Copy</button>
          </div>
          <p class="ps-hint ps-hint-quiet">This project is the canonical record used by the workspace. Deleting data is not possible here — archive it below instead.</p>
        </div>
      </details>

      {/* Danger zone */}
      <section class="ps-danger">
        <div class="ps-danger-head"><h2>Danger zone</h2></div>
        <div class="ps-danger-row">
          <div>
            <strong>Archive this project</strong>
            <p>Hides the project and its work from every workspace. It stays recoverable — nothing is deleted.</p>
          </div>
          <Show when={!confirmArchive()} fallback={
            <div class="ps-confirm">
              <span>Archive “{project()?.name}”?</span>
              <button class="ghost" disabled={archiving()} onClick={() => setConfirmArchive(false)}>Cancel</button>
              <button class="danger" disabled={archiving()} onClick={archiveProject}>{archiving() ? "Archiving…" : "Archive"}</button>
            </div>
          }>
            <button class="danger-outline" onClick={() => setConfirmArchive(true)}>Archive project</button>
          </Show>
        </div>
      </section>
    </Show>
  </section>;
}
