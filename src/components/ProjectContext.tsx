import { createEffect, createMemo, onMount, Show, type JSX } from "solid-js";
import { linkProps, route } from "../router";
import { projects, reloadProjects, setProjectId } from "../session";
import "./ProjectContext.css";

const projectRoute = () => route().projectId ?? (route().entityType === "project" ? route().entityId : undefined);
const tabs = [
  ["Steering", "Project Steering"],
  ["Board", "Projects"],
  ["Tasks", "Project Tasks"],
  ["Calendar", "Calendar"],
  ["Settings", "Project Settings"],
] as const;

export function ProjectContext(props: { children: JSX.Element }) {
  const id = projectRoute;
  const project = createMemo(() => (projects() ?? []).find(item => item.id === id()));
  onMount(() => { void reloadProjects(); });
  createEffect(() => { if (id()) setProjectId(id()!); });
  return <section class="project-context">
    <header class="project-context-head">
      <a class="project-context-back" {...linkProps({ view: "Projects" })}>Projects</a>
      <span aria-hidden="true">/</span>
      <strong>{project()?.name ?? "Project"}</strong>
      <Show when={project()?.key}><code>{project()!.key}</code></Show>
    </header>
    <nav class="project-context-tabs" aria-label="Project navigation">
      {tabs.map(([label, view]) => <a classList={{ active: route().view === view }} {...linkProps(view === "Projects" ? { view, entityType: "project", entityId: id() } : { view, projectId: id() })}>{label}</a>)}
    </nav>
    {props.children}
  </section>;
}
