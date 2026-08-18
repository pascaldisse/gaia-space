import { createResource, createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  pipelinesApi,
  newId,
  parseScriptSource,
  isTerminalRun,
  allowedDeploymentTransitions,
  JOB_TRIGGER_TYPES,
  MAX_JOBS_PER_SCRIPT,
  MAX_STEPS_PER_JOB,
  DEFAULT_JOB_TIMEOUT_SECS,
  type PipelineScript,
  type ScriptJobDef,
  type DeployTarget,
} from "../api/pipelines";
import { projectId, projects } from "../session";
import { ProjectHeader } from "../components/ProjectHeader";
import { Icon } from "../components/Icon";
import "./Pipelines.css";

type EditJob = ScriptJobDef & { stepsText: string };
function toEditJob(j: ScriptJobDef): EditJob {
  return { ...j, stepsText: j.steps.join("\n") };
}
function fromEditJob(j: EditJob): ScriptJobDef {
  return { name: j.name, trigger_type: j.trigger_type, timeout_secs: j.timeout_secs, steps: j.stepsText.split("\n").map((s) => s.trim()).filter(Boolean) };
}

export default function Pipelines() {
  const [error, setError] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<"automation" | "deployments">("automation");

  const activeProject = () => projects()?.find((p) => p.id === projectId()) ?? null;
  const activeProjectName = () => activeProject()?.name ?? null;

  return (
    <section class="pipelines-view">
      <ProjectHeader title="Pipelines" project={activeProject()}>
        Automate builds and ship releases for{" "}
        <strong>{activeProjectName() ?? "this project"}</strong> — run scripted jobs on demand and
        move versions through your environments.
      </ProjectHeader>

      <Show when={error()}>
        <div class="pipelines-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <Show
        when={projectId()}
        fallback={
          <div class="proj-empty">
            <div class="proj-empty-card">
              <div class="proj-empty-icon" aria-hidden="true"><Icon name="pipeline" size={26} /></div>
              <h2>No project selected</h2>
              <p>Choose a project from the context header to see its automation and deployments.</p>
            </div>
          </div>
        }
      >
        <nav class="tab-switch">
          <button classList={{ active: tab() === "automation" }} onClick={() => setTab("automation")}>Automation</button>
          <button classList={{ active: tab() === "deployments" }} onClick={() => setTab("deployments")}>Deployments</button>
        </nav>

        <Show when={tab() === "automation"}>
          <Automation projectName={activeProjectName} setError={setError} />
        </Show>
        <Show when={tab() === "deployments"}>
          <Deployments projectName={activeProjectName} setError={setError} />
        </Show>
      </Show>
    </section>
  );
}

function Automation(props: { projectName: () => string | null; setError: (e: string | null) => void }) {
  const [allScripts, { refetch: refetchScripts }] = createResource(() => pipelinesApi.listScripts());
  const scripts = () => (allScripts() ?? []).filter((s) => s.project_id === projectId());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  createEffect(() => {
    const list = scripts();
    const current = selectedId();
    if (current && list.some((s) => s.id === current)) return;
    setSelectedId(list.length ? list[0].id : null);
  });
  const selected = (): PipelineScript | null => scripts().find((s) => s.id === selectedId()) ?? null;

  const [showNew, setShowNew] = createSignal(false);
  const [newPath, setNewPath] = createSignal(".space.kts");
  async function createScript(e: SubmitEvent) {
    e.preventDefault();
    props.setError(null);
    if (!projectId()) {
      props.setError("Select a project first.");
      return;
    }
    try {
      const script: PipelineScript = { id: newId("script"), project_id: projectId(), repository: null, path: newPath().trim() || ".space.kts", source: JSON.stringify({ jobs: [] }), archived: false };
      await pipelinesApi.createScript(script);
      setShowNew(false);
      await refetchScripts();
      setSelectedId(script.id);
    } catch (err) {
      props.setError(String(err));
    }
  }
  async function deleteScript(id: string) {
    try {
      await pipelinesApi.deleteScript(id);
      if (selectedId() === id) setSelectedId(null);
      await refetchScripts();
    } catch (err) {
      props.setError(String(err));
    }
  }

  // ---------- structured job/step editor, synced from the selected script's source ----------
  // A `createStore` (not a plain signal) so editing one job's field mutates that job's proxy
  // in place instead of replacing the array item's reference — with a signal + spread-copy
  // update, <For>'s reconciliation sees a new object identity per keystroke and remounts the
  // row, dropping focus/cursor position on every character typed.
  const [path, setPath] = createSignal("");
  const [repository, setRepository] = createSignal("");
  const [jobs, setJobs] = createStore<EditJob[]>([]);
  createEffect(() => {
    const s = selected();
    if (s) {
      setPath(s.path);
      setRepository(s.repository ?? "");
      setJobs(parseScriptSource(s.source).jobs.map(toEditJob));
    }
  });
  function addJob() {
    setJobs(produce((draft) => { draft.push({ name: `job-${draft.length + 1}`, trigger_type: "MANUAL", timeout_secs: null, steps: [], stepsText: "" }); }));
  }
  function removeJob(i: number) {
    setJobs(produce((draft) => { draft.splice(i, 1); }));
  }
  function updateJob(i: number, patch: Partial<EditJob>) {
    setJobs(i, patch);
  }

  async function saveScript() {
    const s = selected();
    if (!s) return;
    props.setError(null);
    try {
      const source = JSON.stringify({ jobs: jobs.map(fromEditJob) });
      await pipelinesApi.updateScript({ ...s, path: path().trim() || ".space.kts", repository: repository().trim() || null, source });
      await refetchScripts();
    } catch (err) {
      props.setError(String(err));
    }
  }

  const [jobNames, { refetch: refetchJobNames }] = createResource(selectedId, (id) => (id ? pipelinesApi.listJobsForScript(id) : Promise.resolve([])));
  const nameFor = (jobId: string) => jobNames()?.find((j) => j.id === jobId)?.name ?? jobId;

  const [runs, { refetch: refetchRuns }] = createResource(selectedId, (id) => (id ? pipelinesApi.listJobRunsForScript(id) : Promise.resolve([])));
  let pollHandle: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    const id = selectedId();
    if (pollHandle) clearInterval(pollHandle);
    if (id) {
      pollHandle = setInterval(() => {
        refetchRuns();
      }, 1200);
    }
  });
  onCleanup(() => {
    if (pollHandle) clearInterval(pollHandle);
  });

  const [triggering, setTriggering] = createSignal(false);
  async function trigger() {
    const s = selected();
    if (!s) return;
    props.setError(null);
    setTriggering(true);
    try {
      await pipelinesApi.triggerScript(s.id);
      await refetchJobNames();
      await refetchRuns();
    } catch (err) {
      props.setError(String(err));
    } finally {
      setTriggering(false);
    }
  }

  const empty = () => !allScripts.loading && scripts().length === 0;

  return (
    <div class="automation-body">
      <Show when={empty() && !showNew()}>
        <div class="proj-empty">
          <div class="proj-empty-card">
            <div class="proj-empty-icon" aria-hidden="true"><Icon name="pipeline" size={26} /></div>
            <h2>Automate the busywork</h2>
            <p>
              Create a script for <strong>{props.projectName() ?? "this project"}</strong> to run
              builds, checks, or chores as a set of jobs you can trigger anytime.
            </p>
            <button class="primary proj-empty-cta" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={15} /> New script
            </button>
          </div>
        </div>
      </Show>

      <Show when={!empty() || showNew()}>
        <div class="automation-toolbar">
          <Show
            when={showNew()}
            fallback={<button class="ghost new-open" onClick={() => setShowNew(true)}><Icon name="plus" size={14} /> New script</button>}
          >
            <form class="new-script-form" onSubmit={createScript}>
              <input placeholder="Script path (e.g. .space.kts)" value={newPath()} onInput={(e) => setNewPath(e.currentTarget.value)} />
              <div class="row-actions">
                <button type="button" class="ghost small" onClick={() => setShowNew(false)}>Cancel</button>
                <button class="primary">Create script</button>
              </div>
            </form>
          </Show>
        </div>

        <div class="automation-grid">
          <aside class="scripts-list">
            <div class="section-label">Scripts</div>
            <Show when={scripts().length} fallback={<p class="hint pad">No scripts yet.</p>}>
              <ul>
                <For each={scripts()}>
                  {(s) => (
                    <li classList={{ active: s.id === selectedId() }} onClick={() => setSelectedId(s.id)}>
                      <strong>{s.path}</strong>
                      <span class="hint">{s.repository ?? "no repository set"}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>

          <Show when={selected()} fallback={<p class="hint pad">Select or create a script.</p>}>
            {(script) => (
              <section class="script-detail">
                <header class="script-detail-head">
                  <input class="path-input" value={path()} onInput={(e) => setPath(e.currentTarget.value)} />
                  <input class="repo-input" placeholder="Repository (optional)" value={repository()} onInput={(e) => setRepository(e.currentTarget.value)} />
                  <button class="primary" onClick={saveScript}>Save</button>
                  <button class="ghost" disabled={triggering()} onClick={trigger}>{triggering() ? "Triggering…" : "Trigger run"}</button>
                  <details class="script-more">
                    <summary class="ghost small">More</summary>
                    <div class="script-more-menu">
                      <button class="ghost small danger" onClick={() => deleteScript(script().id)}>Delete script</button>
                    </div>
                  </details>
                </header>

                <section class="jobs-editor">
                  <div class="jobs-editor-head">
                    <h3>Jobs</h3>
                    <span class="hint">{jobs.length} of {MAX_JOBS_PER_SCRIPT} · all jobs run together</span>
                  </div>
                  <For each={jobs}>
                    {(job, i) => (
                      <div class="job-card">
                        <div class="job-row">
                          <input class="job-name" placeholder="Job name" value={job.name} onInput={(e) => updateJob(i(), { name: e.currentTarget.value })} />
                          <select value={job.trigger_type} onChange={(e) => updateJob(i(), { trigger_type: e.currentTarget.value })}>
                            <For each={JOB_TRIGGER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
                          </select>
                          <input
                            type="number"
                            class="timeout-input"
                            placeholder={`timeout s (${DEFAULT_JOB_TIMEOUT_SECS})`}
                            value={job.timeout_secs ?? ""}
                            onInput={(e) => updateJob(i(), { timeout_secs: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                          />
                          <button class="ghost small danger" onClick={() => removeJob(i())}>Remove</button>
                        </div>
                        <textarea
                          class="steps-input"
                          placeholder={`Shell steps, one per line (up to ${MAX_STEPS_PER_JOB})`}
                          rows="3"
                          value={job.stepsText}
                          onInput={(e) => updateJob(i(), { stepsText: e.currentTarget.value })}
                        />
                      </div>
                    )}
                  </For>
                  <button class="ghost" onClick={addJob}>+ Add job</button>
                </section>

                <section class="runs-section">
                  <h3>Runs</h3>
                  <Show when={runs()?.length} fallback={<p class="hint pad">No runs yet — “Trigger run” to start.</p>}>
                    <ul class="runs-list">
                      <For each={runs()}>
                        {(run) => (
                          <li class={`run-${run.status.toLowerCase()}`}>
                            <details>
                              <summary>
                                <strong>{nameFor(run.job_id)}</strong>
                                <span class={`status status-${run.status.toLowerCase()}`}>{run.status}</span>
                                <span class="hint">triggered {new Date(run.triggered_at * 1000).toLocaleTimeString()}</span>
                                <Show when={!isTerminalRun(run.status)}><span class="live-dot" title="live" /></Show>
                              </summary>
                              <pre class="run-log">{run.log || "(no output yet)"}</pre>
                            </details>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function Deployments(props: { projectName: () => string | null; setError: (e: string | null) => void }) {
  const [allTargets, { refetch: refetchTargets }] = createResource(() => pipelinesApi.listDeployTargets());
  const targets = () => (allTargets() ?? []).filter((t) => t.project_id === projectId());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  createEffect(() => {
    const list = targets();
    const current = selectedId();
    if (current && list.some((t) => t.id === current)) return;
    setSelectedId(list.length ? list[0].id : null);
  });
  const selected = (): DeployTarget | null => targets().find((t) => t.id === selectedId()) ?? null;

  const [showNew, setShowNew] = createSignal(false);
  const [formName, setFormName] = createSignal("");
  const [formKey, setFormKey] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");
  const [formManual, setFormManual] = createSignal(false);
  async function createTarget(e: SubmitEvent) {
    e.preventDefault();
    props.setError(null);
    if (!projectId()) {
      props.setError("Select a project first.");
      return;
    }
    if (!formName().trim() || !formKey().trim()) {
      props.setError("Environment name and key are required.");
      return;
    }
    try {
      const target: DeployTarget = { id: newId("deploytarget"), project_id: projectId(), name: formName().trim(), target_key: formKey().trim(), description: formDescription().trim() || null, manual_control: formManual(), archived: false };
      await pipelinesApi.createDeployTarget(target);
      setFormName("");
      setFormKey("");
      setFormDescription("");
      setShowNew(false);
      await refetchTargets();
      setSelectedId(target.id);
    } catch (err) {
      props.setError(String(err));
    }
  }
  async function deleteTarget(id: string) {
    try {
      await pipelinesApi.deleteDeployTarget(id);
      if (selectedId() === id) setSelectedId(null);
      await refetchTargets();
    } catch (err) {
      props.setError(String(err));
    }
  }

  const [deployments, { refetch: refetchDeployments }] = createResource(selectedId, (id) => (id ? pipelinesApi.listDeploymentsForTarget(id) : Promise.resolve([])));

  const [depVersion, setDepVersion] = createSignal("");
  const [depDescription, setDepDescription] = createSignal("");
  async function scheduleDeployment(e: SubmitEvent) {
    e.preventDefault();
    const t = selected();
    if (!t || !depVersion().trim()) return;
    try {
      await pipelinesApi.scheduleDeployment({ id: newId("deployment"), target_id: t.id, version: depVersion().trim(), description: depDescription().trim() || null });
      setDepVersion("");
      setDepDescription("");
      refetchDeployments();
    } catch (err) {
      props.setError(String(err));
    }
  }
  async function transition(id: string, status: string) {
    try {
      await pipelinesApi.transitionDeployment(id, status);
      refetchDeployments();
    } catch (err) {
      props.setError(String(err));
    }
  }

  const empty = () => !allTargets.loading && targets().length === 0;

  return (
    <div class="deployments-body">
      <Show when={empty() && !showNew()}>
        <div class="proj-empty">
          <div class="proj-empty-card">
            <div class="proj-empty-icon" aria-hidden="true"><Icon name="layers" size={26} /></div>
            <h2>Add an environment</h2>
            <p>
              Define where <strong>{props.projectName() ?? "this project"}</strong> ships — like
              staging or production — then schedule and track versions as they roll out.
            </p>
            <button class="primary proj-empty-cta" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={15} /> New environment
            </button>
          </div>
        </div>
      </Show>

      <Show when={!empty() || showNew()}>
        <div class="deployments-toolbar">
          <Show
            when={showNew()}
            fallback={<button class="ghost new-open" onClick={() => setShowNew(true)}><Icon name="plus" size={14} /> New environment</button>}
          >
            <form class="new-target-form" onSubmit={createTarget}>
              <input placeholder="Environment name (e.g. Staging)" value={formName()} onInput={(e) => setFormName(e.currentTarget.value)} />
              <input placeholder="Key (e.g. staging)" value={formKey()} onInput={(e) => setFormKey(e.currentTarget.value)} />
              <input class="grow" placeholder="Description (optional)" value={formDescription()} onInput={(e) => setFormDescription(e.currentTarget.value)} />
              <label class="manual-control"><input type="checkbox" checked={formManual()} onChange={(e) => setFormManual(e.currentTarget.checked)} /> Manual approval</label>
              <div class="row-actions">
                <button type="button" class="ghost small" onClick={() => setShowNew(false)}>Cancel</button>
                <button class="primary">Create environment</button>
              </div>
            </form>
          </Show>
        </div>

        <div class="deployments-grid">
          <aside class="targets-list">
            <div class="section-label">Environments</div>
            <Show when={targets().length} fallback={<p class="hint pad">No environments yet.</p>}>
              <ul>
                <For each={targets()}>
                  {(t) => (
                    <li classList={{ active: t.id === selectedId() }} onClick={() => setSelectedId(t.id)}>
                      <strong>{t.name}</strong>
                      <code>{t.target_key}</code>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>

          <Show when={selected()} fallback={<p class="hint pad">Select or create an environment.</p>}>
            {(target) => (
              <section class="target-detail">
                <header class="target-detail-head">
                  <h2>{target().name}</h2>
                  <code>{target().target_key}</code>
                  <Show when={target().manual_control}><span class="tag">manual approval</span></Show>
                  <details class="target-more">
                    <summary class="ghost small">More</summary>
                    <div class="target-more-menu">
                      <button class="ghost small danger" onClick={() => deleteTarget(target().id)}>Delete environment</button>
                    </div>
                  </details>
                </header>
                <Show when={target().description}><p class="target-desc">{target().description}</p></Show>

                <form class="schedule-form" onSubmit={scheduleDeployment}>
                  <input placeholder="Version to deploy" value={depVersion()} onInput={(e) => setDepVersion(e.currentTarget.value)} />
                  <input class="grow" placeholder="Notes (optional)" value={depDescription()} onInput={(e) => setDepDescription(e.currentTarget.value)} />
                  <button class="primary">Schedule deployment</button>
                </form>

                <Show when={deployments()?.length} fallback={<p class="hint pad">No deployments scheduled yet.</p>}>
                  <ul class="deployments-list">
                    <For each={deployments()}>
                      {(d) => (
                        <li class={`dep-${d.status.toLowerCase()}`}>
                          <strong>{d.version}</strong>
                          <span class={`status status-${d.status.toLowerCase()}`}>{d.status}</span>
                          <span class="hint">{d.description ?? ""}</span>
                          <div class="transition-actions">
                            <For each={allowedDeploymentTransitions(d.status)}>
                              {(next) => <button class="ghost small" onClick={() => transition(d.id, next)}>→ {next}</button>}
                            </For>
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
