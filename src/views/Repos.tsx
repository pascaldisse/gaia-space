import { createResource, createSignal, For, Show, createEffect } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, type Commit, type RepoRef } from "../api";
import { Diff } from "../Diff";
import { Resizer, paneWidth } from "../components/Resizer";
import "../App.css";
import "./Repos.css";
import EmptyState from "../components/EmptyState";
import { GhostPill, IconButton } from "../components/controls";
import { Icon } from "../components/Icon";
import PageHeader, { Chip } from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import "./devCards.css";
import { UI_LOCALE } from "../calendar";

/* THE PAGE FRAME, restored (stage 11).
 *
 * The earlier note here argued that a three-pane git client is not a page and
 * so deserves no header. Next to its seven siblings in Development that reads
 * as an omission, not as a decision: the surface had no h1 at all, and its two
 * "nothing here" cases were bare strips instead of empty states. Repos is a
 * page whose body happens to be three panes.
 *
 * WHAT THIS SURFACE HONESTLY IS: repositories are registered in a LOCAL
 * `repos.json`, keyed by filesystem path. They are not in the database and no
 * project owns them — hence the subline, and hence no project picker here. */

function when(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(UI_LOCALE, {
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

  const hasRepos = () => !!repos()?.length;

  return (
    <section class="repos-view">
      {/* ONE ACTION, ONE PLACE: while nothing is registered, the empty state
          below carries "Open a repository…" and the header does not. */}
      <PageHeader
        icon="repo"
        title="Repositories"
        subline="Local git checkouts registered on this machine"
        chips={<Show when={hasRepos()}><Chip value={repos()!.length} label="open" /></Show>}
      />

      {/* THE ACTION ROW (PageHeader.css `.page-actionbar`). Registering a checkout
          MAKES something, so it belongs here and not in the header's top-right edge,
          which now carries only the count. Nothing on this page changes the view, so
          the row has no right-hand end. */}
      <Show when={hasRepos()}>
        <nav class="page-actionbar" aria-label="Repository actions">
          <button class="primary" type="button" onClick={addRepo}>Open a repository…</button>
        </nav>
        {/* What this surface carries, above the things themselves. */}
        <ContentHead icon="repo" title="Repositories" line="Local git checkouts this machine knows about." />
      </Show>

      <Show when={error()}>
        <div class="repos-error" role="alert" onClick={() => setError(null)}>{error()}</div>
      </Show>

      {/* NOTHING YET: one lead on the page, not an empty pane rail plus two
          strips saying the same absence three times. */}
      <Show when={hasRepos()} fallback={
        <div class="repos-lead">
          <EmptyState
            title="No repositories yet"
            hint="Open a local git repository to browse its branches and commits, and to stage and commit from here."
            actions={<button class="primary" type="button" onClick={addRepo}>Open a repository…</button>}
          />
        </div>
      }>
    <div
      class="app repos-panes"
      style={{ "--col-side": sideW() + "px", "--col-center": centerW() + "px" }}
    >
      <aside class="sidebar">
        <div class="section-label">Repositories</div>
        <Show when={hasRepos()}>
          {/* THE KNOWLEDGE CARD in one column (design rollout). A registered checkout
              has a name and one quiet line — the path it lives at, which is the only
              thing that tells two same-named clones apart. It used to be a bare row
              with the path shown nowhere in the list at all. */}
          <ul class="repo-list dev-card-list">
            <For each={repos()}>
              {(r) => (
                <li classList={{ active: r.path === active() }}>
                  <div class="dev-card">
                    <button
                      type="button"
                      class="repo-open"
                      aria-pressed={r.path === active()}
                      onClick={() => {
                        setActive(r.path);
                        setSelected(null);
                      }}
                    >
                      <span class="dev-card-icon" aria-hidden="true"><Icon name="repo" size={20} /></span>
                      <span class="dev-card-copy">
                        <strong class="repo-name">{r.name}</strong>
                        <small>{r.path}</small>
                      </span>
                    </button>
                    <span class="dev-card-actions">
                      <IconButton
                        class="small"
                        label={`Forget ${r.name}`}
                        onClick={(e: MouseEvent) => removeRepo(r.path, e)}
                      >
                        ×
                      </IconButton>
                    </span>
                  </div>
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
        <Show when={info()}>
          <header class="topbar">
            <strong>{info()!.name}</strong>
            <span class="branch-chip">{info()!.head ?? "unborn"}</span>
            <span class="path">{info()!.path}</span>
          </header>
        </Show>

        {/* A registered repository that is not open: the list is one click to
            the left, so this offers no creation — it says where to look. */}
        <Show when={active()} fallback={
          <EmptyState variant="no-match" title="No repository open" hint="Pick a repository on the left to see its commits." />
        }>
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
                  {/* The row is the paper idiom every list uses now: the line
                      worth reading first, its facts muted underneath. Side by
                      side in a 340px pane the summary was squeezed to "Ho…"
                      between the sha and the date. */}
                  <span class="summary">{c.summary}</span>
                  <span class="meta">
                    <span class="sha">{c.short_id}</span>
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
        {/* The error used to be printed here, inside the right pane. It is the
            page's error — it belongs under the header, once, and that is where
            it is now. */}
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
              <GhostPill onClick={stageAll}>Stage all</GhostPill>
              <button class="primary" onClick={commit} disabled={!message().trim()}>
                Commit
              </button>
            </div>
          </div>
        </Show>

        {/* A missing SELECTION: the commits are one click to the left, so
            nothing is offered. */}
        <Show
          when={selected()}
          fallback={<Show when={active()}>
            <EmptyState variant="no-match" title="Nothing selected" hint="Pick a commit, or the working tree, to see its diff." />
          </Show>}
        >
          <Diff text={diff() ?? ""} loading={diff.loading} />
        </Show>
      </section>
    </div>
      </Show>
    </section>
  );
}
