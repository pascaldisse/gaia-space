import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { api } from "../api";
import { currentUser } from "../session";
import { devenvApi, type DevEnvironment } from "../api/devenv";

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
      <header class="view-header">
        <h2>Dev environments</h2>
        <select value={projectId()} onChange={(e) => setProjectId(e.currentTarget.value)}>
          <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <button class="ghost small" onClick={() => run(() => devenvApi.sweepIdle())}>
          Hibernate idle
        </button>
        <button
          class="ghost small"
          onClick={() => {
            const pid = projectId();
            const me = actor();
            if (pid && me) run(() => devenvApi.claimStandby(pid, me));
          }}
        >
          Claim standby
        </button>
      </header>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      <ul class="devenv-list">
        <For each={envs()} fallback={<li class="hint">No dev environments in this project.</li>}>
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
              <button class="ghost small" onClick={() => run(() => devenvApi.touch(env.id))}>
                Activity
              </button>
              <Show when={env.state === "RUNNING" || env.state === "STARTING"}>
                <button class="ghost small" onClick={() => run(() => devenvApi.hibernate(env.id, actor()))}>
                  Hibernate
                </button>
              </Show>
              <Show when={env.state === "HIBERNATED"}>
                <button class="ghost small" onClick={() => run(() => devenvApi.resume(env.id, actor()))}>
                  Resume
                </button>
              </Show>
              <button class="ghost small" onClick={() => run(() => devenvApi.remove(env.id, actor()))}>
                ×
              </button>
            </li>
          )}
        </For>
      </ul>

      <form class="new-rule-form" onSubmit={create}>
        <input placeholder="environment name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        <input
          type="number"
          min="1"
          value={idleTimeout()}
          onInput={(e) => setIdleTimeout(Number(e.currentTarget.value))}
        />
        <label>
          <input type="checkbox" checked={standby()} onChange={(e) => setStandby(e.currentTarget.checked)} /> standby
          pool
        </label>
        <button class="ghost">Create</button>
      </form>
    </div>
  );
}
