import { UI_LOCALE } from "../calendar";
import { createResource, createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { Icon } from "../components/Icon";
import "./devCards.css";
import { createStore, produce } from "solid-js/store";
import { api } from "../api";
import { currentUser } from "../session";
import {
  pipelinesApi,
  newId,
  parseScriptSource,
  isTerminalRun,
  allowedDeploymentTransitions,
  JOB_TRIGGER_TYPES,
  droppedContainerSteps,
  scriptDefErrors,
  scriptDefWarnings,
  serializeJob,
  editableJob,
  MAX_JOBS_PER_SCRIPT,
  MAX_STEPS_PER_JOB,
  stepCount,
  DEFAULT_JOB_TIMEOUT_SECS,
  TRIGGER_EVENT_TYPES,
  type TriggerEvent,
  type PipelineScript,
  type EditableJob,
  type DeployTarget,
  type JobRun,
  type Worker,
  type TestReport,
} from "../api/pipelines";
import EmptyState from "../components/EmptyState";
import { SectionHeading } from "../components/blocks";
import { GhostPill, PillSelect } from "../components/controls";
import "./Pipelines.css";
import "./operatorForm.css";
import "./Development.css";

/** A picker's resting value IS its label. `CODE_REVIEW_OPENED` and
 *  `BranchDeleted` are wire constants; they were the control's own visible
 *  text. Stored values untouched — only the words. */
const eventLabel = (event: string): string =>
  event.replace(/(?!^)([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const jobTriggerLabel = (trigger: string): string =>
  trigger.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Wire conversion lives in ../api/pipelines (tested against the Rust serde contract) so the
// view cannot invent a step shape the server rejects.
type EditJob = EditableJob;
const toEditJob = editableJob;
const fromEditJob = serializeJob;

export default function Pipelines() {
  const [error, setError] = createSignal<string | null>(null);
  const [warning, setWarning] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal<"automation" | "deployments">("automation");
  const [projects] = createResource(() => api.listProjects());

  return (
    <section class="pipelines-view">
      <PageHeader icon="pipeline" title="Pipelines" subline="Config-as-code automation, triggered manually" />
      {/* Automation | Deployments are SECTIONS of this page, not a second header.
          A <header> under a PageHeader is two headers on one screen; the same
          switch is section pills in Development, so it is section pills here. */}
      <nav class="dev-tabs pipelines-tabs" aria-label="Pipelines sections">
        <button type="button" class="dev-tab" classList={{ active: tab() === "automation" }} aria-current={tab() === "automation" ? "page" : undefined} onClick={() => setTab("automation")}>Automation</button>
        <button type="button" class="dev-tab" classList={{ active: tab() === "deployments" }} aria-current={tab() === "deployments" ? "page" : undefined} onClick={() => setTab("deployments")}>Deployments</button>
      </nav>

      <Show when={error()}>
        <div class="pipelines-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <Show when={warning()}>
        <div class="pipelines-warning" role="alert" onClick={() => setWarning(null)}>{warning()}</div>
      </Show>

      <Show when={tab() === "automation"}>
        <Automation projects={projects} setError={setError} setWarning={setWarning} />
      </Show>
      <Show when={tab() === "deployments"}>
        <Deployments projects={projects} setError={setError} />
      </Show>
    </section>
  );
}

function Automation(props: { projects: () => { id: string; name: string }[] | undefined; setError: (e: string | null) => void; setWarning: (e: string | null) => void }) {
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
      const parsed = parseScriptSource(s.source);
      setJobs(parsed.jobs.map(toEditJob));
      props.setWarning(parsed.warnings.length ? `Source preservation warning: ${parsed.warnings.join("; ")}. Saving will omit those parts.` : null);
    }
  });
  function addJob() {
    setJobs(produce((draft) => { draft.push({ name: `job-${draft.length + 1}`, trigger_type: "MANUAL", timeout_secs: null, triggers: [{ type: "Manual" }], stepsText: "" }); }));
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
      // A container step whose command line was edited away cannot be re-emitted; saving would
      // silently move that command from its image onto the worker host. Block, don't warn.
      const dropped = jobs.flatMap((job) => droppedContainerSteps(job).map((image) => `job '${job.name}': container step (image '${image}') was edited or removed; saving would run its command on the worker host instead. Restore the original command line or delete the step deliberately in the source view.`));
      if (dropped.length) {
        props.setError(dropped.join("; "));
        return;
      }
      const def = { jobs: jobs.map(fromEditJob) };
      // Refuse locally exactly what parse_and_validate_script would refuse, so "Save script"
      // never reports success for a script the server dropped.
      const problems = scriptDefErrors(def);
      if (problems.length) {
        props.setError(problems.join("; "));
        return;
      }
      const warnings = scriptDefWarnings(def);
      props.setWarning(warnings.length ? warnings.join("; ") : null);
      const source = JSON.stringify(def);
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
  // Event-driven triggers: the wire tag is the Rust variant name, so the picker's value *is*
  // the `TriggerEvent["type"]`. Repository comes from the script (the server rejects a
  // mismatch anyway); only the branch / review id is free-form.
  const [eventType, setEventType] = createSignal<TriggerEvent["type"]>("Push");
  const [eventRef, setEventRef] = createSignal("main");
  function eventPayload(): TriggerEvent {
    const type = eventType();
    const reference = eventRef().trim();
    switch (type) {
      case "Push":
      case "BranchDeleted":
        return { type, repository: repository().trim(), branch: reference };
      case "CodeReviewOpened":
      case "CodeReviewClosed":
      case "SafeMerge":
        return { type, review_id: reference };
      default:
        return { type: "Manual" };
    }
  }
  async function fireEvent() {
    const s = selected();
    if (!s) return;
    props.setError(null);
    setTriggering(true);
    try {
      await pipelinesApi.triggerPipelineEvent(s.id, eventPayload());
      await refetchJobNames();
      await refetchRuns();
    } catch (err) {
      props.setError(String(err));
    } finally {
      setTriggering(false);
    }
  }
  /// Cron tick is poll-driven server-side; this is the manual pull of whatever is already due.
  async function runDueSchedules() {
    props.setError(null);
    setTriggering(true);
    try {
      await pipelinesApi.dueScheduledRuns();
      await refetchRuns();
    } catch (err) {
      props.setError(String(err));
    } finally {
      setTriggering(false);
    }
  }

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
      {/* Stays on the surface: operator tool, scripts are added in runs. */}
      <form class="new-script-form op-form" onSubmit={createScript}>
        <PillSelect label="Project" value={newProjectId()} onChange={setNewProjectId}>
          <For each={props.projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </PillSelect>
        <input class="op-input op-grow" aria-label="Script path" placeholder="Path, e.g. .space.kts" value={newPath()} onInput={(e) => setNewPath(e.currentTarget.value)} />
        <button class="primary">New script</button>
      </form>

      <div class="automation-grid">
        <aside class="scripts-list">
          {/* ONE ACTION, ONE PLACE: "New script" sits permanently in the band
              above (an operator tool's form may live on the surface). A primary
              here that only focused that band's field drew the same act twice. */}
          <Show when={scripts()?.length} fallback={
            <EmptyState
              title="No pipeline scripts yet"
              hint="A script is a file in a repository. Adding one here registers it so its jobs can be run."
            />
          }>
            {/* THE KNOWLEDGE CARD in one column (design rollout): a script has a path
                and one quiet line — the repository it lives in. */}
            <ul class="dev-card-list">
              <For each={scripts()}>
                {(s) => (
                  <li classList={{ active: s.id === selectedId() }}>
                    <button type="button" class="dev-card" aria-pressed={s.id === selectedId()} onClick={() => setSelectedId(s.id)}>
                      <span class="dev-card-icon" aria-hidden="true"><Icon name="pipeline" size={20} /></span>
                      <span class="dev-card-copy">
                        <strong>{s.path}</strong>
                        <small>{s.repository ?? "no repo"}</small>
                      </span>
                      <span class="dev-card-open" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        <Show when={selected()} fallback={<Show when={scripts()?.length}>
          <EmptyState variant="no-match" title="No script selected" hint="Pick a script on the left to edit its jobs and trigger a run." />
        </Show>}>
          {(script) => (
            <section class="script-detail">
              <header class="script-detail-head op-form">
                <input class="op-input path-input" aria-label="Script path" value={path()} onInput={(e) => setPath(e.currentTarget.value)} />
                <input class="op-input repo-input" aria-label="Repository" placeholder="Repository (optional)" value={repository()} onInput={(e) => setRepository(e.currentTarget.value)} />
                <button class="primary" onClick={saveScript}>Save script</button>
                <GhostPill disabled={triggering()} onClick={trigger}>{triggering() ? "Triggering…" : "Trigger run"}</GhostPill>
                <GhostPill class="danger" onClick={() => deleteScript(script().id)}>Delete script</GhostPill>
              </header>

              <div class="event-trigger-row op-form">
                <PillSelect label="Event to fire" value={eventType()} onChange={(value) => setEventType(value as TriggerEvent["type"])}>
                  <For each={TRIGGER_EVENT_TYPES}>{(t) => <option value={t}>{eventLabel(t)}</option>}</For>
                </PillSelect>
                <Show when={eventType() !== "Manual"}>
                  <input
                    class="op-input event-ref-input"
                    aria-label={eventType() === "Push" || eventType() === "BranchDeleted" ? "Branch" : "Review id"}
                    placeholder={eventType() === "Push" || eventType() === "BranchDeleted" ? "Branch" : "Review id"}
                    value={eventRef()}
                    onInput={(e) => setEventRef(e.currentTarget.value)}
                  />
                </Show>
                <GhostPill disabled={triggering()} onClick={fireEvent}>Fire event</GhostPill>
                <Show when={currentUser()?.role === "GlobalAdmin"}><GhostPill disabled={triggering()} onClick={runDueSchedules}>Run due schedules</GhostPill></Show>
              </div>

              <section class="jobs-editor">
                {/* A heading NAMES the section; the count and the rule about how
                    jobs run are facts ABOUT it, so they sit in the heading's meta
                    lane instead of inside the title. Same shape as every other
                    section in the app. */}
                <SectionHeading
                  title="Jobs"
                  meta={<span classList={{ over: jobs.length > MAX_JOBS_PER_SCRIPT }}>{jobs.length}/{MAX_JOBS_PER_SCRIPT} · always run in parallel, no dependency graph</span>}
                />
                <For each={jobs}>
                  {(job, i) => (
                    <div class="job-card">
                      <div class="job-row">
                        <input class="op-input job-name" aria-label="Job name" placeholder="Job name" value={job.name} onInput={(e) => updateJob(i(), { name: e.currentTarget.value })} />
                        <PillSelect label="Job trigger" value={job.trigger_type} onChange={(value) => updateJob(i(), { trigger_type: value })}>
                          <For each={JOB_TRIGGER_TYPES}>{(t) => <option value={t}>{jobTriggerLabel(t)}</option>}</For>
                        </PillSelect>
                        <input
                          type="number"
                          class="op-input timeout-input"
                          aria-label="Job timeout in seconds"
                          placeholder={`Timeout s (default ${DEFAULT_JOB_TIMEOUT_SECS})`}
                          value={job.timeout_secs ?? ""}
                          onInput={(e) => updateJob(i(), { timeout_secs: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
                        />
                        <GhostPill class="small danger" onClick={() => removeJob(i())}>Remove job</GhostPill>
                      </div>
                      <Show when={job.triggers?.length}>
                        <p class="hint">Triggers: {job.triggers!.map((trigger) => trigger.type.replace(/(?!^)([A-Z])/g, " $1")).join(", ")}</p>
                      </Show>
                      <textarea
                        class="steps-input"
                        placeholder={`shell steps, one per line (max ${MAX_STEPS_PER_JOB})`}
                        rows="3"
                        value={job.stepsText}
                        onInput={(e) => updateJob(i(), { stepsText: e.currentTarget.value })}
                      />
                      {/* The steps limit used to live only in the placeholder, which
                          disappears at the first keystroke — it vanished exactly when
                          the count started to matter. It is a standing hint now, worded
                          like the jobs heading and read from the same constant the
                          validator uses, so the two can never disagree. */}
                      <p class="hint steps-count" classList={{ over: stepCount(job.stepsText) > MAX_STEPS_PER_JOB }}>
                        Steps: {stepCount(job.stepsText)}/{MAX_STEPS_PER_JOB} per job
                      </p>
                    </div>
                  )}
                </For>
                <button class="ghost" onClick={addJob}>+ Add job</button>
              </section>

              <section class="runs-section">
                <SectionHeading title="Runs" />
                <Show when={runs()?.length} fallback={<p class="hint pad">No runs yet — trigger this script above.</p>}>
                  <ul class="runs-list">
                    <For each={runs()}>
                      {(run) => (
                        <li class={`run-${run.status.toLowerCase()}`}>
                          <details>
                            <summary>
                              <strong>{nameFor(run.job_id)}</strong>
                              <span class={`status status-${run.status.toLowerCase()}`}>{run.status}</span>
                              <span class="hint">triggered {new Date(run.triggered_at * 1000).toLocaleTimeString(UI_LOCALE)}</span>
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
  async function register(e: SubmitEvent) { e.preventDefault(); try { await pipelinesApi.registerWorker({ id: newId("worker"), name: name().trim(), os: navigator.platform || "unknown", tags_json: "[]", status: "ONLINE", registered_at: 0, last_seen_at: 0, suspended: false }); setName(""); refetchWorkers(); } catch (error) { props.setError(String(error)); } }
async function heartbeat(workerId: string) { try { await pipelinesApi.workerHeartbeat(workerId); refetchWorkers(); } catch (error) { props.setError(String(error)); } }
async function assign(workerId: string) { try { const run = await pipelinesApi.assignJobRun(workerId); if (run) setRunId(run.id); refetchWorkers(); } catch (error) { props.setError(String(error)); } }
  async function artifact() { const id = runId(); if (!id) return; try { await pipelinesApi.createJobArtifact({ id: newId("artifact"), job_run_id: id, name: "build.txt", content: Array.from(new TextEncoder().encode("artifact")) }); refetchArtifacts(); } catch (error) { props.setError(String(error)); } }
async function downloadArtifact(id: string, name: string) { try { const bytes = await pipelinesApi.downloadJobArtifact(id); const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)])); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); } catch (error) { props.setError(String(error)); } }
  async function report() { const id = runId(); if (!id) return; try { const value: TestReport = { id: newId("test"), job_run_id: id, suite: "manual", test_name: "reported test", status: "PASSED", duration_ms: 0, message: null, created_at: Math.floor(Date.now() / 1000) }; await pipelinesApi.saveTestReport(value); refetchReports(); } catch (error) { props.setError(String(error)); } }
  return <section class="runs-section"><SectionHeading title="Workers, artifacts and test reports" /><form class="new-script-form op-form" onSubmit={register}><input class="op-input op-grow" aria-label="Worker name" placeholder="Worker name" value={name()} onInput={e => setName(e.currentTarget.value)} /><GhostPill type="submit">Register worker</GhostPill></form><ul class="entity-list">{workers()?.map((worker: Worker) => <li>{worker.name} ({worker.os}) · {worker.status}<GhostPill class="small" onClick={() => void heartbeat(worker.id)}>Heartbeat</GhostPill><GhostPill class="small" disabled={worker.suspended || worker.status !== "ONLINE"} onClick={() => void assign(worker.id)}>Assign next</GhostPill></li>) || <li class="hint">No workers registered.</li>}</ul>{/* An EMPTY picker is a control with nothing to pick and no way to know it:
     before, it rendered as a naked chevron on an empty pill. It only exists
     once there is a run to attach an artifact to. */}
<div class="op-form"><PillSelect label="Run to attach to" disabled={!props.runs().length} value={runId() ?? ""} onChange={value => setRunId(value || null)}><option value="">{props.runs().length ? "Choose a run…" : "No runs to attach to"}</option><For each={props.runs()}>{run => <option value={run.id}>{run.job_id} · {run.status}</option>}</For></PillSelect><GhostPill class="small" disabled={!runId()} onClick={artifact}>Add artifact</GhostPill><GhostPill class="small" disabled={!runId()} onClick={report}>Add test report</GhostPill></div><p class="hint">Artifacts: <For each={artifacts() ?? []}>{a => <GhostPill class="small" onClick={() => void downloadArtifact(a.id, a.name)}>{a.name} ({a.size_bytes} B)</GhostPill>}</For>{!artifacts()?.length && "none"}; tests: {reports()?.map(r => `${r.test_name} ${r.status}`).join(", ") || "none"}</p></section>;
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
      <form class="new-target-form op-form" onSubmit={createTarget}>
        <PillSelect label="Project" value={formProjectId()} onChange={setFormProjectId}>
          <For each={props.projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </PillSelect>
        <input class="op-input" aria-label="Target name" placeholder="Target name" value={formName()} onInput={(e) => setFormName(e.currentTarget.value)} />
        <input class="op-input" aria-label="Target key" placeholder="Key, e.g. staging" value={formKey()} onInput={(e) => setFormKey(e.currentTarget.value)} />
        <input class="op-input op-grow" aria-label="Description" placeholder="Description" value={formDescription()} onInput={(e) => setFormDescription(e.currentTarget.value)} />
        <label class="manual-control"><input type="checkbox" checked={formManual()} onChange={(e) => setFormManual(e.currentTarget.checked)} /> Manual control</label>
        <button class="primary">Create target</button>
      </form>

      <div class="deployments-grid">
        <aside class="targets-list">
          <Show when={targets()?.length} fallback={
            <EmptyState
              title="No deploy targets yet"
              hint="A target is one place you deploy to — staging, production — and it carries that place's deployment history."
            />
          }>
            <ul class="dev-card-list">
              <For each={targets()}>
                {(t) => (
                  <li classList={{ active: t.id === selectedId() }}>
                    <button type="button" class="dev-card" aria-pressed={t.id === selectedId()} onClick={() => setSelectedId(t.id)}>
                      <span class="dev-card-icon" aria-hidden="true"><Icon name="pipeline" size={20} /></span>
                      <span class="dev-card-copy">
                        <strong>{t.name}</strong>
                        <small><code>{t.target_key}</code></small>
                      </span>
                      <span class="dev-card-open" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        <Show when={selected()} fallback={<Show when={targets()?.length}>
          <EmptyState variant="no-match" title="No deploy target selected" hint="Pick a target on the left to schedule a deployment and see its history." />
        </Show>}>
          {(target) => (
            <section class="target-detail">
              <header class="target-detail-head">
                <h2>{target().name}</h2>
                <code>{target().target_key}</code>
                <Show when={target().manual_control}><span class="tag">manual control</span></Show>
                <GhostPill class="small danger" onClick={() => deleteTarget(target().id)}>Delete target</GhostPill>
              </header>
              <p class="hint">{target().description ?? "no description"}</p>

              <form class="schedule-form op-form" onSubmit={scheduleDeployment}>
                <input class="op-input" aria-label="Version" placeholder="Version" value={depVersion()} onInput={(e) => setDepVersion(e.currentTarget.value)} />
                <input class="op-input op-grow" aria-label="Description" placeholder="Description" value={depDescription()} onInput={(e) => setDepDescription(e.currentTarget.value)} />
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
