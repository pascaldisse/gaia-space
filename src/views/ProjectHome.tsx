import { createResource, Show } from "solid-js";
import { personalApi } from "../api/personal";
import type { Project } from "../api/platform";
/** Project overview is deliberately derived: cards and dashboard share the same project id. */
export default function ProjectHome(props:{project:Project}) {
 const [dashboard,{refetch}] = createResource(() => props.project.id, personalApi.projectDashboard);
 return <section class="project-home" aria-label={`${props.project.name} dashboard`}>
  <header><h3>Project dashboard</h3><button class="ghost small" onClick={()=>refetch()}>Refresh</button></header>
  <Show when={dashboard()} fallback={<p class="hint">Loading project dashboard…</p>}>{data=><div class="pf-summary">
   <div class="pf-metric"><span class="pf-metric-num">{data().open_issues}</span><span class="pf-metric-lbl">Open issues</span></div>
   <div class="pf-metric"><span class="pf-metric-num">{data().open_todos}</span><span class="pf-metric-lbl">Open tasks</span></div>
   <div class="pf-metric"><span class="pf-metric-num">{data().member_count}</span><span class="pf-metric-lbl">Members</span></div>
   <div class="pf-metric"><span class="pf-metric-num sm">{data().deadline ?? "—"}</span><span class="pf-metric-lbl">Deadline</span></div>
  </div>}</Show>
 </section>;
}
