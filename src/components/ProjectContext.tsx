import { createEffect, createMemo, onMount, Show, type JSX } from "solid-js";
import { linkProps, route } from "../router";
import { projects, reloadProjects, setProjectId } from "../session";
import "./ProjectContext.css";
const contextId=()=>route().projectId??(route().entityType==="project"?route().entityId:undefined);
const tabs=[{label:"Steering",view:"Project Steering"},{label:"Board",view:"Projects"},{label:"Tasks",view:"Project Tasks"},{label:"Calendar",view:"Calendar"},{label:"Settings",view:"Project Settings"}] as const;
export function ProjectContext(props:{children:JSX.Element}) { const id=contextId; const project=createMemo(()=>projects()?.find(p=>p.id===id())); onMount(()=>void reloadProjects()); createEffect(()=>{if(id())setProjectId(id()!)}); return <section class="project-context"><header class="project-context-head"><a {...linkProps({view:"Projects"})}>Projects</a><span aria-hidden="true">/</span><strong>{project()?.name??"Project unavailable"}</strong><Show when={project()?.key}><code>{project()?.key}</code></Show></header><nav class="project-context-tabs" aria-label="Project navigation">{tabs.map(tab=><a classList={{active:route().view===tab.view}} {...linkProps(tab.view==="Projects"?{view:tab.view,entityType:"project",entityId:id()}:{view:tab.view,projectId:id()})}>{tab.label}</a>)}</nav>{props.children}</section>; }
