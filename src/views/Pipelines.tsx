import { createResource, createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { api } from "../api";
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
  type JobRun,
  type Worker,
  type TestReport,
} from "../api/pipelines";
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
  const [projects] = createResource(() => api.listProjects());

  return (
    <section class="pipelines-view">
      <header class="pipelines-head">
        <h1>Pipelines</h1>
        <p>Automation is config-as-code: jobs in a script always run in parallel (no dependency graph), max {MAX_JOBS_PER_SCRIPT} jobs/script, {MAX_STEPS_PER_JOB} steps/job. No daemon here, so triggers are manual-only.</p>
        <nav class="tab-switch">
          <button classList={{ active: tab() === "automation" }} onClick={() => setTab("automation")}>Automation</button>
          <button classList={{ active: tab() === "deployments" }} onClick={() => setTab("deployments")}>Deployments</button>
        </nav>
      </header>

      <Show when={error()}>
        <div class="pipelines-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <Show when={tab() === "automation"}>
        <Automation projects={projects} setError={setError} />
      </Show>
      <Show when={tab() === "deployments"}>
        <Deployments projects={projects} setError={setError} />
      </Show>
    </section>
  );
}

function Automation(props: { projects: () => { id: string; name: string }[] | undefined; setError: (e: string | null) => void }) {
  const [scripts, { refetch: refetchScripts }] = createResource(() => pipelinesApi.listScripts());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  createEffect(() => {
    if (!selectedId() && scripts()?.length) setSelectedId(scripts()![0].id);
  });
  const selected = (): PipelineScript | null => scripts()?.find((s) => s.id === selectedId()) ?? null;

  const [newProjectId, setNewProjectId] = createSignal("");
  const [newPath, setNewPath] = createSignal(".space.kts");
  createEffect(() => {
    if (!newProjectId() && props.projects()?.length) setNewProjectId(props.projects()![0].id);
  });
  async function createScript(e: SubmitEvent) {
    e.preventDefault();
    props.setError(null);
    if (!newProjectId()) {
      props.setError("project is required");
      return;
    }
    try {
      const script: PipelineScript = { id: newId("script"), project_id: newProjectId(), repository: null, path: newPath().trim() || ".space.kts", source: JSON.stringify({ jobs: [] }), archived: false };
      await pipelinesApi.createScript(script);
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

  return (
    <div class="automation-body">
      <form class="new-script-form" onSubmit={createScript}>
        <select value={newProjectId()} onChange={(e) => setNewProjectId(e.currentTarget.value)}>
          <For each={props.projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <input placeholder="path (e.g. .space.kts)" value={newPath()} onInput={(e) => setNewPath(e.currentTarget.value)} />
        <button class="primary">New script</button>
      </form>

      <div class="automation-grid">
        <aside class="scripts-list">
          <Show when={scripts()?.length} fallback={<p class="hint pad">No pipeline scripts yet.</p>}>
            <ul>
              <For each={scripts()}>
                {(s) => (
                  <li classList={{ active: s.id === selectedId() }} onClick={() => setSelectedId(s.id)}>
                    <strong>{s.path}</strong>
                    <span class="hint">{s.repository ?? "no repo"}</span>
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
                <input class="repo-input" placeholder="repository (optional)" value={repository()} onInput={(e) => setRepository(e.currentTarget.value)} />
                <button class="primary" onClick={saveScript}>Save script</button>
                <button class="ghost" disabled={triggering()} onClick={trigger}>{triggering() ? "Triggering…" : "Trigger run"}</button>
                <button class="ghost danger" onClick={() => deleteScript(script().id)}>Delete script</button>
              </header>

              <section class="jobs-editor">
                <h3>Jobs ({jobs.length}/{MAX_JOBS_PER_SCRIPT}) — always run in parallel, no dependency graph</h3>
                <For each={jobs}>
                  {(job, i) => (
                    <div class="job-card">
                      <div class="job-row">
                        <input class="job-name" placeholder="job name" value={job.name} onInput={(e) => updateJob(i(), { name: e.currentTarget.value })} />
                        <select value={job.trigger_type} onChange={(e) => updateJob(i(), { trigger_type: e.currentTarget.value })}>
                          <For each={JOB_TRIGGER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
                        </select>
                        <input
                          type="number"
                          class="timeout-input"
                          placeholder={`timeout secs (default ${DEFAULT_JOB_TIMEOUT_SECS})`}
                          value={job.timeout_secs ?? ""}
                          onInput={(e) => updateJob(i(), { timeout_secs: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                        />
                        <button class="ghost small danger" onClick={() => removeJob(i())}>Remove job</button>
                      </div>
                      <textarea
                        class="steps-input"
                        placeholder={`shell steps, one per line (max ${MAX_STEPS_PER_JOB})`}
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
                <Show when={runs()?.length} fallback={<p class="hint pad">No runs yet — trigger this script above.</p>}>
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
              <WorkerRunPanel runs={() => runs() ?? []} setError={props.setError} />
            </section>
          )}
        </Show>
      </div>
    </div>
  );
}

function WorkerRunPanel(props: { runs: () => JobRun[]; setError: (value: string | null) => void }) {
  const [workers, { refetch: refetchWorkers }] = createResource(() => pipelinesApi.listWorkers());
  const [name, setName] = createSignal("");
  const [runId, setRunId] = createSignal<string | null>(null);
  createEffect(() => { if (!runId() && props.runs().length) setRunId(props.runs()[0].id); });
  const [artifacts, { refetch: refetchArtifacts }] = createResource(runId, id => id ? pipelinesApi.listJobArtifacts(id) : Promise.resolve([]));
  const [reports, { refetch: refetchReports }] = createResource(runId, id => id ? pipelinesApi.listTestReports(id) : Promise.resolve([]));
  async function register(e: SubmitEvent) { e.preventDefault(); try { await pipelinesApi.registerWorker({ id: newId("worker"), name: name().trim(), os: navigator.platform || "unknown", tags_json: "[]", status: "ONLINE", registered_at: 0, last_seen_at: 0 }); setName(""); refetchWorkers(); } catch (error) { props.setError(String(error)); } }
  async function artifact() { const id = runId(); if (!id) return; try { await pipelinesApi.createJobArtifact({ id: newId("artifact"), job_run_id: id, name: "build.txt", content: Array.from(new TextEncoder().encode("artifact")) }); refetchArtifacts(); } catch (error) { props.setError(String(error)); } }
  async function report() { const id = runId(); if (!id) return; try { const value: TestReport = { id: newId("test"), job_run_id: id, suite: "manual", test_name: "reported test", status: "PASSED", duration_ms: 0, message: null, created_at: Math.floor(Date.now() / 1000) }; await pipelinesApi.saveTestReport(value); refetchReports(); } catch (error) { props.setError(String(error)); } }
  return <section class="runs-section"><h3>Workers · artifacts · test reports</h3><form class="new-script-form" onSubmit={register}><input placeholder="worker name" value={name()} onInput={e => setName(e.currentTarget.value)} /><button class="ghost">Register worker</button></form><p class="hint">{workers()?.map((worker: Worker) => `${worker.name} (${worker.os})`).join(", ") || "No workers."}</p><select value={runId() ?? ""} onChange={e => setRunId(e.currentTarget.value || null)}><For each={props.runs()}>{run => <option value={run.id}>{run.job_id} · {run.status}</option>}</For></select><button class="ghost small" onClick={artifact}>Add artifact</button><button class="ghost small" onClick={report}>Add test report</button><p class="hint">Artifacts: {artifacts()?.map(a => a.name).join(", ") || "none"}; tests: {reports()?.map(r => `${r.test_name} ${r.status}`).join(", ") || "none"}</p></section>;
}
function Deployments(props: { projects: () => { id: string; name: string }[] | undefined; setError: (e: string | null) => void }) {
  const [targets, { refetch: refetchTargets }] = createResource(() => pipelinesApi.listDeployTargets());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  createEffect(() => {
    if (!selectedId() && targets()?.length) setSelectedId(targets()![0].id);
  });
  const selected = (): DeployTarget | null => targets()?.find((t) => t.id === selectedId()) ?? null;

  const [formProjectId, setFormProjectId] = createSignal("");
  const [formName, setFormName] = createSignal("");
  const [formKey, setFormKey] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");
  const [formManual, setFormManual] = createSignal(false);
  createEffect(() => {
    if (!formProjectId() && props.projects()?.length) setFormProjectId(props.projects()![0].id);
  });
  async function createTarget(e: SubmitEvent) {
    e.preventDefault();
    props.setError(null);
    if (!formName().trim() || !formKey().trim()) {
      props.setError("target name and key are required");
      return;
    }
    try {
      const target: DeployTarget = { id: newId("deploytarget"), project_id: formProjectId(), name: formName().trim(), target_key: formKey().trim(), description: formDescription().trim() || null, manual_control: formManual(), archived: false };
      await pipelinesApi.createDeployTarget(target);
      setFormName("");
      setFormKey("");
      setFormDescription("");
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

  return (
    <div class="deployments-body">
      <form class="new-target-form" onSubmit={createTarget}>
        <select value={formProjectId()} onChange={(e) => setFormProjectId(e.currentTarget.value)}>
          <For each={props.projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <input placeholder="target name" value={formName()} onInput={(e) => setFormName(e.currentTarget.value)} />
        <input placeholder="key (e.g. staging)" value={formKey()} onInput={(e) => setFormKey(e.currentTarget.value)} />
        <input class="grow" placeholder="description" value={formDescription()} onInput={(e) => setFormDescription(e.currentTarget.value)} />
        <label class="manual-control"><input type="checkbox" checked={formManual()} onChange={(e) => setFormManual(e.currentTarget.checked)} /> Manual control</label>
        <button class="primary">Create target</button>
      </form>

      <div class="deployments-grid">
        <aside class="targets-list">
          <Show when={targets()?.length} fallback={<p class="hint pad">No deploy targets yet.</p>}>
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

        <Show when={selected()} fallback={<p class="hint pad">Select or create a deploy target.</p>}>
          {(target) => (
            <section class="target-detail">
              <header class="target-detail-head">
                <h2>{target().name}</h2>
                <code>{target().target_key}</code>
                <Show when={target().manual_control}><span class="tag">manual control</span></Show>
                <button class="ghost small danger" onClick={() => deleteTarget(target().id)}>Delete target</button>
              </header>
              <p class="hint">{target().description ?? "no description"}</p>

              <form class="schedule-form" onSubmit={scheduleDeployment}>
                <input placeholder="version" value={depVersion()} onInput={(e) => setDepVersion(e.currentTarget.value)} />
                <input class="grow" placeholder="description" value={depDescription()} onInput={(e) => setDepDescription(e.currentTarget.value)} />
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
    </div>
  );
}
