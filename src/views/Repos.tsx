import { createResource, createSignal, For, Show, createEffect } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type Commit, type RepoRef } from "../api";
import { Diff } from "../Diff";
import { Resizer, paneWidth } from "../components/Resizer";
import "../App.css";

function when(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    year: "2-digit",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [repos, { mutate: setRepos }] = createResource<RepoRef[]>(() =>
    api.repoList(),
  );
  const [active, setActive] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Commit | "working" | null>(null);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [sideW, setSideW] = paneWidth("repos.side.width", 220);
  const [centerW, setCenterW] = paneWidth("repos.center.width", 340);

  // auto-select the first repo once the list arrives
  createEffect(() => {
    const list = repos();
    if (list && list.length && !active()) setActive(list[0].path);
  });

  const [info] = createResource(active, (p) => api.repoInfo(p));
  const [log, { refetch: refetchLog }] = createResource(active, (p) =>
    api.repoLog(p),
  );
  const [branches] = createResource(active, (p) => api.repoBranches(p));
  const [status, { refetch: refetchStatus }] = createResource(active, (p) =>
    api.repoStatus(p),
  );

  const diffKey = () => {
    const p = active();
    const s = selected();
    if (!p || !s) return null;
    return { path: p, id: s === "working" ? undefined : s.id };
  };
  const [diff] = createResource(diffKey, (k) => api.repoDiff(k.path, k.id));

  async function addRepo() {
    setError(null);
    const dir = await openDialog({ directory: true, title: "Open repository" });
    if (typeof dir !== "string") return;
    try {
      setRepos(await api.repoAdd(dir));
      setActive(dir.replace(/\/$/, ""));
      setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeRepo(path: string, ev: MouseEvent) {
    ev.stopPropagation();
    setRepos(await api.repoRemove(path));
    if (active() === path) {
      setActive(repos()?.[0]?.path ?? null);
      setSelected(null);
    }
  }

  async function stageAll() {
    const p = active();
    const files = status()?.map((s) => s.path) ?? [];
    if (!p || !files.length) return;
    try {
      await api.repoStage(p, files);
      refetchStatus();
    } catch (e) {
      setError(String(e));
    }
  }

  async function commit() {
    const p = active();
    if (!p) return;
    setError(null);
    try {
      await api.repoCommit(p, message());
      setMessage("");
      refetchStatus();
      refetchLog();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      class="app"
      style={{ "--col-side": sideW() + "px", "--col-center": centerW() + "px" }}
    >
      <aside class="sidebar">
        <header class="brand">
          <span>Repositories</span>
          <button class="ghost" title="Connect a repository…" onClick={addRepo}>
            +
          </button>
        </header>

        <p class="hint repos-purpose">
          Git repositories connected to your workspace — they power Code reviews and Pipelines.
        </p>

        <div class="section-label">Connected</div>
        <Show
          when={repos()?.length}
          fallback={<p class="hint">No repositories connected yet — press “+” to add one from your computer.</p>}
        >
          <ul class="repo-list">
            <For each={repos()}>
              {(r) => (
                <li
                  classList={{ active: r.path === active() }}
                  onClick={() => {
                    setActive(r.path);
                    setSelected(null);
                  }}
                >
                  <span class="repo-name">{r.name}</span>
                  <button
                    class="ghost small"
                    title="Forget repository"
                    onClick={(e) => removeRepo(r.path, e)}
                  >
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={branches()?.length}>
          <div class="section-label">Branches</div>
          <ul class="branch-list">
            <For each={branches()!.filter((b) => !b.remote)}>
              {(b) => (
                <li classList={{ head: b.is_head }}>
                  {b.is_head ? "● " : ""}
                  {b.name}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </aside>

      <Resizer width={sideW} setWidth={setSideW} min={170} max={460} />

      <section class="center">
        <header class="topbar">
          <Show when={info()} fallback={<span class="hint">No repository selected</span>}>
            <strong>{info()!.name}</strong>
            <span class="branch-chip">{info()!.head ?? "unborn"}</span>
            <span class="path">{info()!.path}</span>
          </Show>
        </header>

        <Show when={!active()}>
          <div class="repos-onboard">
            <h2>Connect your first repository</h2>
            <p>Add a Git repository from your computer to browse its history and use it for code reviews and pipelines.</p>
            <button class="primary" onClick={addRepo}>Connect a repository</button>
          </div>
        </Show>

        <Show when={active()}>
          <div
            class="working-row"
            classList={{ active: selected() === "working" }}
            onClick={() => setSelected("working")}
          >
            <span class="dot" />
            Working tree
            <span class="count">{status()?.length ?? 0} changed</span>
          </div>

          <ul class="commits">
            <For each={log()}>
              {(c) => (
                <li
                  classList={{
                    active: (() => {
                      const s = selected();
                      return typeof s === "object" && s !== null && s.id === c.id;
                    })(),
                  }}
                  onClick={() => setSelected(c)}
                >
                  <span class="sha">{c.short_id}</span>
                  <span class="summary">{c.summary}</span>
                  <span class="meta">
                    {c.author} · {when(c.time)}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <Resizer width={centerW} setWidth={setCenterW} min={240} max={720} />

      <section class="detail">
        <Show when={error()}>
          <div class="error-bar" onClick={() => setError(null)}>
            {error()}
          </div>
        </Show>

        <Show when={selected() === "working"}>
          <div class="commit-box">
            <ul class="status-list">
              <For each={status()}>
                {(s) => (
                  <li>
                    <span class={`badge ${s.status}`}>{s.status[0]}</span>
                    <span class="file">{s.path}</span>
                    <Show when={s.staged}>
                      <span class="staged">staged</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <textarea
              placeholder="Commit message"
              value={message()}
              onInput={(e) => setMessage(e.currentTarget.value)}
            />
            <div class="row-actions">
              <button onClick={stageAll}>Stage all</button>
              <button class="primary" onClick={commit} disabled={!message().trim()}>
                Commit
              </button>
            </div>
          </div>
        </Show>

        <Show
          when={selected()}
          fallback={<p class="hint pad">Select a commit or the working tree.</p>}
        >
          <Diff text={diff() ?? ""} loading={diff.loading} />
        </Show>
      </section>
    </div>
  );
}
