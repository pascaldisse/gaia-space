import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { planningApi } from "../api/issues";
import { createProject, humanError, projectId, projects, reloadProjects, setProjectId } from "../session";
import { requestView } from "../nav";
import "./Portfolio.css";

// Portfolio — the real project list. Picking a project sets the active project
// and drops into its Steering cockpit. Open-issue counts come from existing
// issue data, grouped client-side. A visible create-project flow lets a fresh
// workspace get its first project and open it immediately.
export default function Portfolio() {
  void reloadProjects();
  const list = createMemo(() => (projects() ?? []).filter((p) => !p.archived));

  const [counts] = createResource(async () => {
    const [issues, statuses] = await Promise.all([planningApi.issues({}), planningApi.statuses()]);
    const resolved = new Set(statuses.filter((s) => s.resolved).map((s) => s.id));
    const by = new Map<string, number>();
    for (const i of issues) {
      if (i.archived || resolved.has(i.status_id ?? "")) continue;
      by.set(i.project_id, (by.get(i.project_id) ?? 0) + 1);
    }
    return by;
  });

  const open = (id: string) => { setProjectId(id); requestView("Steering"); };

  // ── create-project flow ──
  const [creating, setCreating] = createSignal(false);
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [keyTouched, setKeyTouched] = createSignal(false);
  const [description, setDescription] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // Derive a sensible key from the name until the user edits the key directly.
  const autoKey = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5).toUpperCase();
  const onName = (value: string) => { setName(value); if (!keyTouched()) setKey(autoKey(value)); };

  const startCreate = () => { setError(""); setCreating(true); };
  const cancelCreate = () => {
    setCreating(false); setError("");
    setName(""); setKey(""); setKeyTouched(false); setDescription("");
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");
    const trimmedName = name().trim();
    const trimmedKey = key().trim();
    if (!trimmedName) { setError("Give the project a name."); return; }
    if (!trimmedKey) { setError("Give the project a short key (e.g. PLT)."); return; }
    setBusy(true);
    try {
      const project = await createProject({ name: trimmedName, key: trimmedKey, description: description() });
      cancelCreate();
      open(project.id); // enter the new project's steering workspace right away
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  const createForm = () =>
    <form class="pf-create" onSubmit={submit}>
      <h2>New project</h2>
      <Show when={error()}><div class="pf-error">{error()}</div></Show>
      <label class="pf-field">
        <span>Name</span>
        <input value={name()} onInput={(e) => onName(e.currentTarget.value)} placeholder="Marketing site redesign" autofocus />
      </label>
      <label class="pf-field">
        <span>Key</span>
        <input value={key()} onInput={(e) => { setKeyTouched(true); setKey(e.currentTarget.value.toUpperCase()); }} placeholder="PLT" maxlength="10" />
      </label>
      <label class="pf-field">
        <span>Description <em>optional</em></span>
        <textarea value={description()} onInput={(e) => setDescription(e.currentTarget.value)} placeholder="What is this project about?" />
      </label>
      <div class="pf-create-actions">
        <button type="button" onClick={cancelCreate} disabled={busy()}>Cancel</button>
        <button class="primary" type="submit" disabled={busy()}>{busy() ? "Creating…" : "Create & open"}</button>
      </div>
    </form>;

  return <section class="pf-view">
    <header class="pf-head">
      <div><h1>Projects</h1><p>Your portfolio. Open a project to enter its steering workspace.</p></div>
      <Show when={!creating() && list().length}>
        <button class="primary pf-new" onClick={startCreate}>+ New project</button>
      </Show>
    </header>

    <Show when={projects() === undefined}><p class="pf-muted">Loading projects…</p></Show>

    {/* Empty workspace: lead straight into creating the first project. */}
    <Show when={projects() && !list().length && !creating()}>
      <div class="pf-empty">
        <div class="pf-empty-mark">◈</div>
        <h2>No projects yet</h2>
        <p>Projects are the containers for issues, boards, docs, chat, and delivery. Create your first one to get started.</p>
        <button class="primary" onClick={startCreate}>+ Create your first project</button>
      </div>
    </Show>

    <Show when={creating()}>{createForm()}</Show>

    <Show when={list().length}>
      <div class="pf-grid">
        <For each={list()}>{(p) =>
          <button class="pf-card" classList={{ current: p.id === projectId() }} onClick={() => open(p.id)}>
            <div class="pf-card-top">
              <span class="pf-mark">{(p.key ?? "··").slice(0, 2).toUpperCase()}</span>
              <span class="pf-open">{counts()?.get(p.id) ?? 0} open</span>
            </div>
            <strong>{p.name}</strong>
            <p>{p.description || "No description."}</p>
            <span class="pf-key">{p.key}</span>
          </button>}</For>
      </div>
    </Show>
  </section>;
}
