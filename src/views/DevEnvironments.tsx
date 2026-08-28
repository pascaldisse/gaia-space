import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { api } from "../api";
import { currentUser } from "../session";
import { devenvApi, type DevEnvironment } from "../api/devenv";
import EmptyState from "../components/EmptyState";
import { GhostPill, IconButton, PillSelect } from "../components/controls";
import "./operatorForm.css";
import "./DevEnvironments.css";

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const minutesAgo = (at: number) => Math.max(0, Math.round(Date.now() / 1000 - at) / 60);

/** Cloud dev environments: lifecycle only — no machine is provisioned from this view. */
export default function DevEnvironments() {
  const [error, setError] = createSignal<string | null>(null);
  const [projects] = createResource(() => api.listProjects());
  const [projectId, setProjectId] = createSignal("");
  createEffect(() => {
    if (!projectId() && projects()?.length) setProjectId(projects()![0].id);
  });

  const [envs, { refetch }] = createResource(projectId, (id) =>
    id ? devenvApi.list(id) : Promise.resolve([] as DevEnvironment[]),
  );

  // Rights are checked per member profile, not per login account.
  const actor = () => currentUser()?.profile_id ?? null;
  const [name, setName] = createSignal("");
  const [idleTimeout, setIdleTimeout] = createSignal(30);
  const [standby, setStandby] = createSignal(false);
const [poolTarget, setPoolTarget] = createSignal(0);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refetch();
    } catch (err) {
      setError(String(err));
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    const pid = projectId();
    if (!pid || !name().trim()) {
      setError("a project and a name are required");
      return;
    }
    await run(async () => {
      await devenvApi.create({
        id: newId("devenv"),
        project_id: pid,
        // A standby environment is unowned until someone claims it.
        owner_id: standby() ? null : actor(),
        name: name().trim(),
        idle_timeout_minutes: idleTimeout(),
        standby: standby(),
      });
      setName("");
    });
  }

  return (
    <div class="view dev-environments">
      {/* THE HAND-ROLLED HEADER IS GONE. A <header class="view-header"> sitting
          under a PageHeader is a second header on one screen: the project picker
          and the three pool actions belong ON the page header's own action line,
          which is where every other view in the app puts them. */}
      <PageHeader
        title="Dev environments"
        chips={
          <PillSelect label="Project" value={projectId()} onChange={setProjectId}>
            <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </PillSelect>
        }
        actions={<>
          <GhostPill onClick={() => run(() => devenvApi.sweepIdle())}>Hibernate idle</GhostPill>
          <GhostPill
            onClick={() => {
              const pid = projectId();
              const me = actor();
              if (pid && me) run(() => devenvApi.claimStandby(pid, me));
            }}
          >
            Claim standby
          </GhostPill>
          <GhostPill
            onClick={() => {
              const pid = projectId();
              if (pid) run(() => devenvApi.refillStandbyPool(pid, "IntelliJ IDEA", "regular"));
            }}
          >
            Refill standby
          </GhostPill>
        </>}
      />

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      <ul class="devenv-list">
        {/* A page-filling panel, so a real empty state. The create form is the
            block below, so the action puts the cursor in it. */}
        <For each={envs()} fallback={
          <li class="devenv-empty">
            <EmptyState
              title="No dev environments in this project"
              hint="An environment is a running workspace with your IDE attached. It hibernates on its own when it goes quiet."
              actions={<button class="primary" type="button" onClick={() => document.querySelector<HTMLInputElement>('.dev-environments input[aria-label="Environment name"]')?.focus()}>Create an environment</button>}
            />
          </li>
        }>
          {(env) => (
            <li>
              <strong>{env.name}</strong>
              <span class={`devenv-state devenv-${env.state.toLowerCase()}`}>{env.state}</span>
              <span class="hint">
                {env.ide} · {env.instance_type} · idle {env.idle_timeout_minutes}m · quiet for{" "}
                {minutesAgo(env.last_activity_at).toFixed(0)}m
              </span>
              <Show when={env.persisted_home}>
                <span class="hint">preserved: {env.persisted_home} + {env.persisted_worktree}</span>
              </Show>
              <GhostPill class="small" onClick={() => run(() => devenvApi.touch(env.id))}>
                Activity
              </GhostPill>
              <Show when={env.state === "RUNNING" || env.state === "STARTING"}>
                <GhostPill class="small" onClick={() => run(() => devenvApi.hibernate(env.id, actor()))}>
                  Hibernate
                </GhostPill>
              </Show>
              <Show when={env.state === "HIBERNATED"}>
                <GhostPill class="small" onClick={() => run(() => devenvApi.resume(env.id, actor()))}>
                  Resume
                </GhostPill>
              </Show>
              {/* A round × with no accessible name is a button nobody can read.
                  IconButton makes the name mandatory. */}
              <IconButton label={`Delete ${env.name}`} onClick={() => run(() => devenvApi.remove(env.id, actor()))}>
                ×
              </IconButton>
            </li>
          )}
        </For>
      </ul>

      {/* Stays on the surface: operator tool (L3 relaxed, L4 in full). */}
      <form class="new-rule-form op-form" onSubmit={create}>
        <input class="op-input op-grow" aria-label="Environment name" placeholder="Environment name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        {/* A bare number box said nothing about what it counted. It is minutes,
            so it says minutes — the one place a caption earns its line. */}
        <label class="op-field">
          <span>Idle timeout (min)</span>
          <input
            class="op-input op-narrow"
            type="number"
            min="1"
            value={idleTimeout()}
            onInput={(e) => setIdleTimeout(Number(e.currentTarget.value))}
          />
        </label>
        <label class="devenv-standby">
          <input type="checkbox" checked={standby()} onChange={(e) => setStandby(e.currentTarget.checked)} /> Standby pool
        </label>
        <label class="op-field">
          <span>Standby target</span>
          <input
            class="op-input op-narrow"
            type="number"
            min="0"
            value={poolTarget()}
            onInput={(e) => setPoolTarget(Number(e.currentTarget.value))}
          />
        </label>
        <GhostPill
          onClick={() => {
            const pid = projectId();
            if (pid)
              run(() =>
                devenvApi.saveStandbyPoolPolicy(
                  { project_id: pid, ide: "IntelliJ IDEA", instance_type: "regular", target_size: poolTarget() },
                  actor(),
                ),
              );
          }}
        >
          Set pool target
        </GhostPill>
        {/* Creating the environment is the point of this form, so it is the
            primary, not one more grey pill among four. */}
        <button class="primary" type="submit">Create environment</button>
      </form>
    </div>
  );
}
