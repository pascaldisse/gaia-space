import { createMemo, createResource, For, Show } from "solid-js";
import { planningApi } from "../api/issues";
import { personalApi } from "../api/personal";
import { linkProps, route } from "../router";
import { profileId, projects, reloadProjects } from "../session";
import "./Steering.css";

type Work = { kind: "Issue" | "Task"; id: string; title: string; due: string | null; unassigned?: boolean; number?: number; color?: string };
const today = () => new Date().toISOString().slice(0, 10);
const project = () => route().projectId ?? "";

export default function Steering() {
  void reloadProjects();
  const [data] = createResource(() => [project(), profileId()] as const, async ([id, profile]) => {
    if (!id || !profile) return { work: [] as Work[] };
    const [issues, statuses, todos] = await Promise.all([
      planningApi.issues({ project_id: id }), planningApi.statuses(id),
      // Web policy requires both project + authenticated acting profile.
      personalApi.projectTodos(id, profile, true),
    ]);
    const done = new Set(statuses.filter(status => status.resolved).map(status => status.id));
    const color = (statusId: string | null) => statuses.find(status => status.id === statusId)?.color;
    const work: Work[] = [
      ...issues.filter(issue => !issue.archived && !done.has(issue.status_id ?? "")).map(issue => ({ kind: "Issue" as const, id: issue.id, title: issue.title, due: issue.due_date, unassigned: !issue.assignee_id, number: issue.number, color: color(issue.status_id) })),
      ...todos.filter(todo => !todo.done).map(todo => ({ kind: "Task" as const, id: todo.id, title: todo.content, due: todo.due_date })),
    ];
    return { work };
  });
  const work = () => data()?.work ?? [];
  const overdue = createMemo(() => work().filter(item => item.due && item.due < today()));
  const soon = createMemo(() => { const end = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10); return work().filter(item => item.due && item.due >= today() && item.due <= end); });
  const unassigned = createMemo(() => work().filter(item => item.unassigned));
  const link = (item: Work) => item.kind === "Issue" ? { view: "Issues", entityType: "issue", entityId: item.id, projectId: project() } : { view: "Project Tasks", projectId: project() };
  const rows = (items: Work[]) => <ul class="st-list"><For each={items.slice(0, 6)}>{item => <li><span class={`st-kind ${item.kind.toLowerCase()}`}>{item.kind}</span><Show when={item.number}><span class="st-num">#{item.number}</span></Show><a {...linkProps(link(item))}>{item.title}</a><Show when={item.color}><span class="st-status" style={{ background: item.color }}/></Show><Show when={item.due}><time>{item.due}</time></Show></li>}</For></ul>;
  const bucket = (label: string, items: Work[], tone: string) => <section class={`st-action ${tone}`}><header><span class="st-dot"/><h3>{label}</h3><b>{items.length}</b></header><Show when={items.length} fallback={<p class="st-clear">All clear</p>}>{rows(items)}</Show></section>;
  return <section class="st-view"><header class="st-head"><div class="st-title"><div class="st-mark">{(projects() ?? []).find(item => item.id === project())?.key.slice(0, 2) ?? "··"}</div><div><h1>Steering</h1><p>What needs attention in this project now.</p></div></div></header><Show when={data.loading}><p class="st-muted">Loading project work…</p></Show><Show when={data()}><div class="st-band"><span class="st-band-label">Action needed</span><div class="st-actions">{bucket("Overdue", overdue(), "overdue")}{bucket("Due soon", soon(), "soon")}{bucket("Unassigned", unassigned(), "unassigned")}</div></div><section class="st-card"><div class="st-card-head"><h2>Current work <small>{work().length} active</small></h2><a class="st-link" {...linkProps({ view: "Projects", entityType: "project", entityId: project() })}>Open board →</a></div><Show when={work().length} fallback={<p class="st-muted">Nothing in flight.</p>}>{rows(work())}</Show></section></Show></section>;
}
