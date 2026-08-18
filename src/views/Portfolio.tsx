import { createMemo, createResource, For, Show } from "solid-js";
import { planningApi } from "../api/issues";
import { projectId, projects, reloadProjects, setProjectId } from "../session";
import { requestView } from "../nav";
import "./Portfolio.css";

// Portfolio — the real project list. Picking a project sets the active project
// and drops into its Steering cockpit. Open-issue counts come from existing
// issue data, grouped client-side.
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

  return <section class="pf-view">
    <header class="pf-head">
      <div><h1>Projects</h1><p>Your portfolio. Open a project to enter its steering workspace.</p></div>
    </header>

    <Show when={projects() === undefined}><p class="pf-muted">Loading projects…</p></Show>
    <Show when={projects() && !list().length}><p class="pf-empty">No projects yet. Create one from the desktop app or seed data.</p></Show>

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
  </section>;
}
