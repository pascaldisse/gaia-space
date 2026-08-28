import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import PageHeader from "../components/PageHeader";
import { api } from "../api";
import { currentUser } from "../session";
import { devenvApi, type DevEnvironment } from "../api/devenv";
import EmptyState from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { GhostPill, IconButton, PillSelect } from "../components/controls";
import "./operatorForm.css";
import "./devCards.css";
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
      {/* The `chips` lane is for METRICS — a value and its word. A picker there
         is a control in the readout's place, so the project picker moved to the
         action line, where every other view keeps it. */}
      <PageHeader
        icon="repo"
        title="Dev environments"
        subline="Cloud workspaces for this project: start one, let it hibernate, claim one from standby."
        actions={<>
          <PillSelect label="Project" value={projectId()} onChange={setProjectId}>
            <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </PillSelect>
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

      {/* READING ORDER: the band that creates an environment comes BEFORE the
          list of environments, as on every other operator tool here (Packages,
          Pipelines). It used to sit under the list, so an empty project showed
          "nothing yet" floating above the very form that fixes it. */}
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

      {/* THE KNOWLEDGE CARD, not a naked row (design rollout). An environment has a
          NAME and one quiet line of facts about it — exactly the shape the library
          card carries — so it wears the same card, from the same tokens. The row's
          own acts keep the place the arrow would have, because this card DOES things
          instead of opening a page. */}
      <ul class="devenv-list dev-card-grid">
        {/* ONE ACTION, ONE PLACE: the band above IS "create an environment", so
            this state names the absence and does not draw that act again. */}
        <For each={envs()} fallback={
          <li class="devenv-empty devenv-empty-full">
            <EmptyState
              title="No dev environments in this project"
              hint="An environment is a running workspace with your IDE attached. It hibernates on its own when it goes quiet."
            />
          </li>
        }>
          {(env) => (
            <li>
              <div class="dev-card">
                <span class="dev-card-icon" aria-hidden="true"><Icon name="repo" size={20} /></span>
                <span class="dev-card-copy">
                  <strong>{env.name}</strong>
                  {/* ONE meta line. `preserved: …` used to be a second one; it is a
                      fact about a hibernated environment, so it joins this line
                      rather than starting a paragraph. */}
                  <small>
                    {env.ide} · {env.instance_type} · idle {env.idle_timeout_minutes}m · quiet for{" "}
                    {minutesAgo(env.last_activity_at).toFixed(0)}m
                    <Show when={env.persisted_home}> · preserved {env.persisted_home} + {env.persisted_worktree}</Show>
                  </small>
                </span>
                <span class={`devenv-state dev-card-state devenv-${env.state.toLowerCase()}`}>{env.state}</span>
                <span class="dev-card-actions">
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
                </span>
              </div>
            </li>
          )}
        </For>
      </ul>

    </div>
  );
}
