import { createResource, createSignal, createMemo, createEffect, For, Show, type JSX } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type Commit, type RepoRef } from "../api";
import { Diff } from "../Diff";
import { Resizer, paneWidth } from "../components/Resizer";
import "../App.css";
import "./Repos.css";
import EmptyState from "../components/EmptyState";
import { GhostPill, IconButton, PillMenu, PillSelect, QuietSearch } from "../components/controls";
import { Icon } from "../components/Icon";
import PageHeader, { Chip } from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import "./devCards.css";
import { UI_LOCALE } from "../calendar";
import { assignLanes, type GraphCommit, type GraphLayout } from "../gitGraph";

/* THE PAGE FRAME, restored (stage 11), then grown into a Fork-class client (stage 12).
 *
 * The frame is untouched: PageHeader/ContentHead/EmptyState still own the header,
 * the "nothing here" cases, and the KB page chrome. Everything below the frame is
 * new — a real git client's toolbar, sidebar, commit graph and detail tabs — built
 * entirely from the same controls language (`IconButton`/`GhostPill`/`PillMenu`/
 * `QuietSearch`) and the same `spaceTheme.css` tokens, so none of it reads as a
 * second, foreign product bolted onto the KB shell.
 *
 * WHAT THIS SURFACE HONESTLY IS: repositories are registered in a LOCAL
 * `repos.json`, keyed by filesystem path. They are not in the database and no
 * project owns them — hence the subline, and hence no project picker here. */

const ROW_H = 30;
const LANE_W = 16;
const LANE_PAD = 8;
/* Reused, not invented: the accent teal already used app-wide for the current
 * branch/HEAD, plus the three already-used badge hexes from the status list
 * below (`App.css` `.badge.modified/.renamed/.new`). Cycling through EXISTING
 * on-brand colours is what keeps a multi-lane graph legible without adding a
 * new palette to the theme. */
const LANE_COLORS = ["var(--accent, #00c2a8)", "var(--attn-amber, #f0a742)", "#7ab8f5", "#7cd68a"];
function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}
function laneX(lane: number): number {
  return LANE_PAD + lane * LANE_W;
}

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

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
/** "3d ago", "2mo ago" — the relative-date column Fork-class graphs use so a row
 *  reads at a glance without doing date arithmetic in your head. Falls back to
 *  seconds for anything under a minute. */
function relativeTime(ts: number): string {
  const rtf = new Intl.RelativeTimeFormat(UI_LOCALE, { numeric: "auto" });
  const deltaSec = ts - Date.now() / 1000;
  const abs = Math.abs(deltaSec);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs) return rtf.format(Math.round(deltaSec / secs), unit);
  }
  return rtf.format(Math.round(deltaSec), "second");
}

type Ref = { label: string; kind: "head" | "branch" | "remote" | "tag" };

/** A collapsible sidebar section (Branches / Remotes / Tags / Stashes / Worktrees).
 *  State lives in the caller so five sections share one shape instead of five
 *  private signals; the chevron rotates, nothing unmounts — collapsing is a
 *  display toggle, not a re-fetch. */
function Group(props: { title: string; count: number; open: boolean; onToggle: () => void; children: JSX.Element }) {
  return (
    <div class="side-group">
      <button type="button" class="side-group-head" aria-expanded={props.open} onClick={props.onToggle}>
        <Icon name="chevron-right" size={12} class={props.open ? "side-group-chevron open" : "side-group-chevron"} />
        <span class="side-group-title">{props.title}</span>
        <span class="side-group-count">{props.count}</span>
      </button>
      <Show when={props.open}>
        <div class="side-group-body">{props.children}</div>
      </Show>
    </div>
  );
}

/** One row of the commit graph: the SVG lane column, flexible summary/ref badges,
 *  then fixed-width SHA/date. Pure render over an already-computed `LaneNode` — all the graph MATH lives in
 *  `gitGraph.ts` and is unit-tested there; this only turns lanes into pixels. */
function GraphRow(props: {
  commit: Commit;
  node: GraphLayout["nodes"][number] | undefined;
  refs: Ref[];
  laneCount: number;
  active: boolean;
  onSelect: () => void;
}) {
  const width = () => LANE_PAD * 2 + Math.max(props.laneCount, 1) * LANE_W;
  return (
    <div class="graph-row" classList={{ active: props.active }} onClick={props.onSelect} role="row">
      <svg class="graph-cell" width={width()} height={ROW_H} viewBox={`0 0 ${width()} ${ROW_H}`} aria-hidden="true">
        <Show when={props.node}>
          {(node) => (
            <>
              <For each={node().passthroughLanes}>
                {(lane) => (
                  <line x1={laneX(lane)} y1={0} x2={laneX(lane)} y2={ROW_H} stroke={laneColor(lane)} stroke-width="2" />
                )}
              </For>
              <line
                x1={laneX(node().lane)}
                y1={0}
                x2={laneX(node().lane)}
                y2={ROW_H / 2}
                stroke={laneColor(node().lane)}
                stroke-width="2"
              />
              <For each={node().parentLanes}>
                {(link) => (
                  <line
                    x1={laneX(node().lane)}
                    y1={ROW_H / 2}
                    x2={laneX(link.lane)}
                    y2={ROW_H}
                    stroke={laneColor(link.lane === node().lane ? node().lane : link.lane)}
                    stroke-width="2"
                  />
                )}
              </For>
              <circle cx={laneX(node().lane)} cy={ROW_H / 2} r={4.5} fill={laneColor(node().lane)} />
            </>
          )}
        </Show>
      </svg>
      <span class="graph-summary">
        <For each={props.refs}>{(r) => <span class={`ref-badge ref-${r.kind}`}>{r.label}</span>}</For>
        {props.commit.summary || "(no summary)"}
      </span>
      <span class="graph-sha">{props.commit.short_id}</span>
      <span class="graph-date" title={when(props.commit.time)}>{relativeTime(props.commit.time)}</span>
    </div>
  );
}

/** File Tree tab: the tree at one commit, browsable into subdirectories. Owns its
 *  own `dir` signal and resets it when the commit id changes — browsing into
 *  `src/components/` on one commit must not still be "open" after picking another. */
function FileTree(props: { path: string | null; commitId: string | null }) {
  const [dir, setDir] = createSignal("");
  createEffect(() => {
    props.commitId;
    setDir("");
  });
  const treeKey = () => {
    if (!props.path || !props.commitId) return null;
    return { path: props.path, id: props.commitId, dir: dir() };
  };
  const [tree] = createResource(treeKey, (k) => api.repoTree(k.path, k.id, k.dir || undefined));
  const crumbs = createMemo(() => (dir() ? dir().split("/") : []));
  return (
    <Show when={props.commitId} fallback={<p class="hint pad">No commits yet.</p>}>
      <div class="file-tree">
        <div class="file-tree-crumbs">
          <button type="button" onClick={() => setDir("")}>root</button>
          <For each={crumbs()}>
            {(part, i) => (
              <>
                <span class="crumb-sep">/</span>
                <button type="button" onClick={() => setDir(crumbs().slice(0, i() + 1).join("/"))}>{part}</button>
              </>
            )}
          </For>
        </div>
        <Show when={!tree.loading} fallback={<p class="hint pad">Loading tree…</p>}>
          <ul class="file-tree-list">
            <For each={tree()} fallback={<li class="hint">Empty directory.</li>}>
              {(entry) => (
                <li
                  classList={{ dir: entry.is_dir }}
                  onClick={() => entry.is_dir && setDir(entry.path)}
                >
                  <Icon name={entry.is_dir ? "folder" : "doc"} size={16} />
                  <span>{entry.name}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

export default function App() {
  const [repos, { mutate: setRepos }] = createResource<RepoRef[]>(() => api.repoList());
  const [active, setActive] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Commit | "working" | null>(null);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [sideW, setSideW] = paneWidth("repos.side.width", 240);
  const [centerW, setCenterW] = paneWidth("repos.center.width", 480);

  // auto-select the first repo once the list arrives
  createEffect(() => {
    const list = repos();
    if (list && list.length && !active()) setActive(list[0].path);
  });

  const [info, { refetch: refetchInfo }] = createResource(active, (p) => api.repoInfo(p));
  const [log, { refetch: refetchLog }] = createResource(active, (p) => api.repoLog(p));
  const [branches, { refetch: refetchBranches }] = createResource(active, (p) => api.repoBranches(p));
  const [status, { refetch: refetchStatus }] = createResource(active, (p) => api.repoStatus(p));
  const [tags, { refetch: refetchTags }] = createResource(active, (p) => api.repoTags(p));
  const [stashes, { refetch: refetchStashes }] = createResource(active, (p) => api.repoStashList(p));
  const [worktrees, { refetch: refetchWorktrees }] = createResource(active, (p) => api.repoWorktrees(p));
  const [projects] = createResource(() => api.listProjects());
  const [hostedProjectId, setHostedProjectId] = createSignal("");
  const [hostedRepos, { refetch: refetchHostedRepos }] = createResource(hostedProjectId, (projectId) => api.listHostedRepos(projectId));
  const [newHosted, setNewHosted] = createSignal(false);
  const [hostedName, setHostedName] = createSignal("");
  const [hostedBranch, setHostedBranch] = createSignal("main");

  createEffect(() => {
    if (!hostedProjectId() && projects()?.length) setHostedProjectId(projects()![0].id);
  });
  const hostedProject = createMemo(() => projects()?.find((project) => project.id === hostedProjectId()) ?? null);

  async function createHostedRepo(event: SubmitEvent) {
    event.preventDefault();
    const projectId = hostedProjectId();
    if (!projectId || !hostedName().trim() || !hostedBranch().trim()) {
      setError("A project, repository name, and default branch are required.");
      return;
    }
    await run("Creating hosted repository…", async () => {
      await api.createHostedRepo(projectId, hostedName().trim(), hostedBranch().trim());
      setHostedName("");
      setHostedBranch("main");
      setNewHosted(false);
      await refetchHostedRepos();
    });
  }
  function copyHostedCloneUrl(name: string) {
    const project = hostedProject();
    if (!project) return;
    run("Copying clone URL…", async () => {
      const url = await api.hostedRepoCloneUrl(window.location.origin, project.id, name);
      await navigator.clipboard.writeText(url);
    });
  }

  function refetchAll() {
    refetchInfo();
    refetchLog();
    refetchBranches();
    refetchStatus();
    refetchTags();
    refetchStashes();
    refetchWorktrees();
  }

  // ---------- left sidebar: view switch / filter / collapsible groups ----------
  const [leftView, setLeftView] = createSignal<"commits" | "changes">("commits");
  const [filter, setFilter] = createSignal("");
  const [groupsOpen, setGroupsOpen] = createSignal({
    hosted: true,
    branches: true,
    remotes: false,
    tags: false,
    stashes: false,
    worktrees: false,
  });
  function toggleGroup(key: keyof ReturnType<typeof groupsOpen>) {
    setGroupsOpen((g) => ({ ...g, [key]: !g[key] }));
  }
  const localBranches = createMemo(() => (branches() ?? []).filter((b) => !b.remote));
  const remoteBranches = createMemo(() => (branches() ?? []).filter((b) => b.remote));
  function matchesFilter(name: string) {
    const q = filter().trim().toLowerCase();
    return !q || name.toLowerCase().includes(q);
  }

  // ---------- detail pane tabs ----------
  const [tab, setTab] = createSignal<"commit" | "changes" | "tree">("commit");
  const [focusFile, setFocusFile] = createSignal<string | null>(null);
  // "Commit" has no meaning for the working tree — land on Changes instead of a
  // tab that would just be blank.
  createEffect(() => {
    if (selected() === "working" && tab() === "commit") setTab("changes");
  });
  createEffect(() => {
    selected();
    setFocusFile(null);
  });

  function selectLocalChanges() {
    setLeftView("changes");
    setSelected("working");
  }
  function selectCommit(c: Commit) {
    setLeftView("commits");
    setSelected(c);
  }
  function jumpToParent(id: string) {
    const target = (log() ?? []).find((c) => c.id === id);
    if (target) {
      selectCommit(target);
      setTab("commit");
    }
  }

  // ---------- toolbar: fetch / pull / push / stash / checkout / finder ----------
  const [busy, setBusy] = createSignal<string | null>(null);
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }
  function doFetch() {
    const p = active();
    if (p) run("Fetching\u2026", async () => { await api.repoFetch(p); refetchAll(); });
  }
  function doPull() {
    const p = active();
    if (p) run("Pulling\u2026", async () => { await api.repoPull(p); refetchAll(); });
  }
  function doPush() {
    const p = active();
    if (p) run("Pushing\u2026", async () => { await api.repoPush(p); refetchAll(); });
  }
  function doCheckout(branch: string) {
    const p = active();
    if (!p) return;
    run("Checking out\u2026", async () => {
      await api.repoCheckout(p, branch);
      refetchAll();
      setSelected(null);
    });
  }
  function onStashAction(value: string) {
    const p = active();
    if (!p || !value) return;
    if (value === "save") {
      run("Stashing\u2026", async () => { await api.repoStashSave(p); refetchAll(); });
      return;
    }
    const index = Number(value.slice("pop:".length));
    run("Popping stash\u2026", async () => { await api.repoStashPop(p, index); refetchAll(); });
  }
  async function openInFinder() {
    const p = active();
    if (!p) return;
    try {
      await revealItemInDir(p);
    } catch (e) {
      setError(String(e));
    }
  }
  const stashOptions = createMemo(() => [
    { value: "save", label: "Stash changes", disabled: !(status()?.length) },
    ...(stashes() ?? []).map((s) => ({ value: `pop:${s.index}`, label: `Pop stash@{${s.index}}: ${s.message}` })),
  ]);
  const branchOptions = createMemo(() => localBranches().map((b) => ({ value: b.name, label: b.name })));

  // ---------- repo registration (unchanged behaviour) ----------
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

  // ---------- local changes: stage / unstage / commit ----------
  const stagedFiles = createMemo(() => (status() ?? []).filter((s) => s.staged));
  const unstagedFiles = createMemo(() => (status() ?? []).filter((s) => !s.staged));

  async function stageFiles(files: string[]) {
    const p = active();
    if (!p || !files.length) return;
    try {
      await api.repoStage(p, files);
      refetchStatus();
    } catch (e) {
      setError(String(e));
    }
  }
  async function unstageFiles(files: string[]) {
    const p = active();
    if (!p || !files.length) return;
    try {
      await api.repoUnstage(p, files);
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

  // ---------- diff / commit-files / tree resources for the detail pane ----------
  const diffKey = () => {
    const p = active();
    const s = selected();
    if (!p || !s) return null;
    return { path: p, id: s === "working" ? undefined : s.id };
  };
  const [diff] = createResource(diffKey, (k) => api.repoDiff(k.path, k.id));

  const commitFilesKey = () => {
    const p = active();
    const s = selected();
    if (!p || !s || s === "working") return null;
    return { path: p, id: s.id };
  };
  const [commitFiles] = createResource(commitFilesKey, (k) => api.repoCommitFiles(k.path, k.id));

  const headCommitId = () => log()?.[0]?.id ?? null;
  const treeCommitId = () => {
    const s = selected();
    return s && s !== "working" ? s.id : headCommitId();
  };

  // ---------- commit graph layout + ref badges ----------
  const graphCommits = createMemo<GraphCommit[]>(() => (log() ?? []).map((c) => ({ id: c.id, parents: c.parents })));
  const layout = createMemo<GraphLayout>(() => assignLanes(graphCommits()));
  const nodeById = createMemo(() => new Map(layout().nodes.map((n) => [n.id, n])));
  const refsByCommit = createMemo(() => {
    const map = new Map<string, Ref[]>();
    const push = (id: string | null | undefined, ref: Ref) => {
      if (!id) return;
      const list = map.get(id) ?? [];
      list.push(ref);
      map.set(id, list);
    };
    for (const b of branches() ?? []) {
      push(b.target, { label: b.name, kind: b.is_head ? "head" : b.remote ? "remote" : "branch" });
    }
    for (const t of tags() ?? []) push(t.target, { label: t.name, kind: "tag" });
    return map;
  });
  const filteredLog = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const list = log() ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.summary.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.short_id.includes(q),
    );
  });

  const hasRepos = () => !!repos()?.length;
  const selectedCommit = () => {
    const s = selected();
    return s && s !== "working" ? s : null;
  };

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

      <Show when={hasRepos()}>
        <nav class="page-actionbar" aria-label="Repository actions">
          <button class="primary" type="button" onClick={addRepo}>Open a repository…</button>
        </nav>
        <ContentHead icon="repo" title="Repositories" line="Local git checkouts this machine knows about." />
      </Show>

      <Show when={error()}>
        <div class="repos-error" role="alert" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <Show when={hasRepos()} fallback={
        <div class="repos-lead">
          <EmptyState
            title="No repositories yet"
            hint="Open a local git repository to browse its branches and commits, and to stage and commit from here."
            actions={<button class="primary" type="button" onClick={addRepo}>Open a repository…</button>}
          />
        </div>
      }>
        <Show when={active()}>
          <nav class="repo-toolbar" aria-label="Git actions">
            <IconButton label="Fetch" onClick={doFetch} disabled={!!busy()}><Icon name="refresh" /></IconButton>
            <IconButton label="Pull" onClick={doPull} disabled={!!busy()}><Icon name="arrow-down" /></IconButton>
            <IconButton label="Push" onClick={doPush} disabled={!!busy()}><Icon name="arrow-up" /></IconButton>
            <PillMenu
              label="Stash"
              value=""
              placeholder="Stash"
              options={stashOptions()}
              onChange={onStashAction}
              disabled={!!busy()}
              class="repo-toolbar-stash"
            />
            <PillMenu
              label="Current branch — checkout"
              value={info()?.head ?? ""}
              placeholder={info()?.detached ? "detached HEAD" : "no branch"}
              options={branchOptions()}
              onChange={doCheckout}
              disabled={!!busy()}
              class="repo-toolbar-branch"
            />
            <span class="repo-toolbar-spacer" />
            <Show when={busy()}><span class="repo-toolbar-busy">{busy()}</span></Show>
            <IconButton label="Open in Finder" onClick={openInFinder}><Icon name="folder" /></IconButton>
          </nav>
        </Show>

        <div
          class="app repos-panes"
          style={{ "--col-side": sideW() + "px", "--col-center": centerW() + "px" }}
        >
          <aside class="sidebar">
            <div class="section-label">Repositories</div>
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

            <Show when={active()}>
              <div class="side-nav">
                <button type="button" class="side-nav-row" classList={{ active: leftView() === "changes" }} onClick={selectLocalChanges}>
                  <span class="side-nav-dot" classList={{ dirty: (status()?.length ?? 0) > 0 }} aria-hidden="true" />
                  <span>Local Changes</span>
                  <span class="side-nav-badge">{status()?.length ?? 0}</span>
                </button>
                <button type="button" class="side-nav-row" classList={{ active: leftView() === "commits" }} onClick={() => setLeftView("commits")}>
                  <Icon name="clock" size={14} />
                  <span>All Commits</span>
                </button>
              </div>

              <QuietSearch label="Filter commits and branches" placeholder="Filter…" value={filter()} onInput={setFilter} class="side-filter" />

              <Group title="HOSTED" count={hostedRepos()?.length ?? 0} open={groupsOpen().hosted} onToggle={() => toggleGroup("hosted")}>
                <Show when={projects()?.length} fallback={<EmptyState title="No projects" hint="Create a project before creating a hosted repository." />}>
                  <div class="hosted-project-picker">
                    <PillSelect label="Hosted repository project" value={hostedProjectId()} onChange={setHostedProjectId}>
                      <For each={projects()}>{(project) => <option value={project.id}>{project.name}</option>}</For>
                    </PillSelect>
                  </div>
                  <ul class="ref-list hosted-repo-list">
                    <For each={hostedRepos()} fallback={<li class="hint">No hosted repositories.</li>}>
                      {(repo) => (
                        <li class="hosted-repo-row">
                          <span>{repo.name}</span>
                          <IconButton label={`Copy clone URL for ${repo.name}`} onClick={() => copyHostedCloneUrl(repo.name)} disabled={!!busy()}>
                            <Icon name="copy" size={14} />
                          </IconButton>
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={newHosted()} fallback={<GhostPill onClick={() => setNewHosted(true)}>New hosted repository…</GhostPill>}>
                    <form class="hosted-repo-form" onSubmit={createHostedRepo}>
                      <input aria-label="Hosted repository name" value={hostedName()} onInput={(event) => setHostedName(event.currentTarget.value)} placeholder="Repository name" />
                      <input aria-label="Default branch" value={hostedBranch()} onInput={(event) => setHostedBranch(event.currentTarget.value)} placeholder="Default branch" />
                      <GhostPill disabled={!!busy()}>Create</GhostPill>
                      <IconButton label="Cancel hosted repository" onClick={() => setNewHosted(false)}><Icon name="close" size={12} /></IconButton>
                    </form>
                  </Show>
                </Show>
              </Group>
              <Group title="Branches" count={localBranches().length} open={groupsOpen().branches} onToggle={() => toggleGroup("branches")}>
                <ul class="ref-list">
                  <For each={localBranches().filter((b) => matchesFilter(b.name))} fallback={<li class="hint">No branches.</li>}>
                    {(b) => (
                      <li classList={{ head: b.is_head }} onClick={() => !b.is_head && doCheckout(b.name)}>
                        {b.is_head ? "● " : ""}{b.name}
                      </li>
                    )}
                  </For>
                </ul>
              </Group>
              <Group title="Remotes" count={remoteBranches().length} open={groupsOpen().remotes} onToggle={() => toggleGroup("remotes")}>
                <ul class="ref-list">
                  <For each={remoteBranches().filter((b) => matchesFilter(b.name))} fallback={<li class="hint">No remote branches.</li>}>
                    {(b) => <li>{b.name}</li>}
                  </For>
                </ul>
              </Group>
              <Group title="Tags" count={tags()?.length ?? 0} open={groupsOpen().tags} onToggle={() => toggleGroup("tags")}>
                <ul class="ref-list">
                  <For each={(tags() ?? []).filter((t) => matchesFilter(t.name))} fallback={<li class="hint">No tags.</li>}>
                    {(t) => <li>{t.name}</li>}
                  </For>
                </ul>
              </Group>
              <Group title="Stashes" count={stashes()?.length ?? 0} open={groupsOpen().stashes} onToggle={() => toggleGroup("stashes")}>
                <ul class="ref-list">
                  <For each={stashes() ?? []} fallback={<li class="hint">No stashes.</li>}>
                    {(s) => (
                      <li class="stash-row">
                        <span>stash@{"{"}{s.index}{"}"}: {s.message}</span>
                        <GhostPill onClick={() => onStashAction(`pop:${s.index}`)}>Pop</GhostPill>
                      </li>
                    )}
                  </For>
                </ul>
              </Group>
              <Group title="Worktrees" count={worktrees()?.length ?? 0} open={groupsOpen().worktrees} onToggle={() => toggleGroup("worktrees")}>
                <ul class="ref-list">
                  <For each={worktrees() ?? []} fallback={<li class="hint">No worktrees.</li>}>
                    {(w) => <li>{w.name}</li>}
                  </For>
                </ul>
              </Group>
            </Show>
          </aside>

          <Resizer width={sideW} setWidth={setSideW} min={200} max={480} />

          <section class="center">
            <Show when={info()}>
              <header class="topbar">
                <strong>{info()!.name}</strong>
                <span class="path">{info()!.path}</span>
              </header>
            </Show>

            <Show when={active()} fallback={
              <EmptyState variant="no-match" title="No repository open" hint="Pick a repository on the left to see its commits." />
            }>
              <Show
                when={leftView() === "commits"}
                fallback={
                  <div class="local-changes">
                    <div class="lc-section">
                      <div class="lc-section-head">
                        <span>Staged</span>
                        <span class="lc-count">{stagedFiles().length}</span>
                        <Show when={stagedFiles().length}>
                          <GhostPill onClick={() => unstageFiles(stagedFiles().map((f) => f.path))}>Unstage all</GhostPill>
                        </Show>
                      </div>
                      <ul class="lc-file-list">
                        <For each={stagedFiles()} fallback={<li class="hint">Nothing staged.</li>}>
                          {(f) => (
                            <li classList={{ active: focusFile() === f.path }} onClick={() => setFocusFile(f.path)}>
                              <span class={`badge ${f.status}`}>{f.status[0]}</span>
                              <span class="lc-file-path">{f.path}</span>
                              <IconButton
                                class="small"
                                label={`Unstage ${f.path}`}
                                onClick={(e: MouseEvent) => { e.stopPropagation(); unstageFiles([f.path]); }}
                              >
                                <Icon name="close" size={12} />
                              </IconButton>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                    <div class="lc-section">
                      <div class="lc-section-head">
                        <span>Unstaged</span>
                        <span class="lc-count">{unstagedFiles().length}</span>
                        <Show when={unstagedFiles().length}>
                          <GhostPill onClick={() => stageFiles(unstagedFiles().map((f) => f.path))}>Stage all</GhostPill>
                        </Show>
                      </div>
                      <ul class="lc-file-list">
                        <For each={unstagedFiles()} fallback={<li class="hint">Working tree clean.</li>}>
                          {(f) => (
                            <li classList={{ active: focusFile() === f.path }} onClick={() => setFocusFile(f.path)}>
                              <span class={`badge ${f.status}`}>{f.status[0]}</span>
                              <span class="lc-file-path">{f.path}</span>
                              <IconButton
                                class="small"
                                label={`Stage ${f.path}`}
                                onClick={(e: MouseEvent) => { e.stopPropagation(); stageFiles([f.path]); }}
                              >
                                <Icon name="plus" size={12} />
                              </IconButton>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                    <div class="commit-box">
                      <textarea
                        placeholder="Commit message"
                        value={message()}
                        onInput={(e) => setMessage(e.currentTarget.value)}
                      />
                      <div class="row-actions">
                        <button class="primary" onClick={commit} disabled={!message().trim() || !stagedFiles().length}>
                          Commit
                        </button>
                      </div>
                    </div>
                  </div>
                }
              >
                <div class="graph-table" role="table" aria-label="Commit graph">
                  <For each={filteredLog()} fallback={<EmptyState variant="no-match" title="No commits yet" hint="Commit from Local Changes to start this repository's history." />}>
                    {(c) => (
                      <GraphRow
                        commit={c}
                        node={nodeById().get(c.id)}
                        refs={refsByCommit().get(c.id) ?? []}
                        laneCount={layout().laneCount}
                        active={selectedCommit()?.id === c.id}
                        onSelect={() => selectCommit(c)}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </section>

          <Resizer width={centerW} setWidth={setCenterW} min={280} max={760} />

          <section class="detail">
            <Show
              when={selected()}
              fallback={<Show when={active()}>
                <EmptyState variant="no-match" title="Nothing selected" hint="Pick a commit, or Local Changes, to see its details." />
              </Show>}
            >
              <div class="detail-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab() === "commit"} classList={{ active: tab() === "commit" }} disabled={selected() === "working"} onClick={() => setTab("commit")}>Commit</button>
                <button type="button" role="tab" aria-selected={tab() === "changes"} classList={{ active: tab() === "changes" }} onClick={() => setTab("changes")}>Changes</button>
                <button type="button" role="tab" aria-selected={tab() === "tree"} classList={{ active: tab() === "tree" }} onClick={() => setTab("tree")}>File Tree</button>
              </div>
              <div class="detail-body">
                <Show when={tab() === "commit"}>
                  <Show when={selectedCommit()}>
                    {(c) => (
                      <div class="commit-meta">
                        <h3>{c().summary || "(no summary)"}</h3>
                        <dl>
                          <div><dt>Author</dt><dd>{c().author} &lt;{c().email}&gt;</dd></div>
                          <div><dt>Date</dt><dd>{when(c().time)}</dd></div>
                          <div><dt>SHA</dt><dd class="mono">{c().id}</dd></div>
                          <Show when={(refsByCommit().get(c().id) ?? []).length}>
                            <div>
                              <dt>Refs</dt>
                              <dd><For each={refsByCommit().get(c().id) ?? []}>{(r) => <span class={`ref-badge ref-${r.kind}`}>{r.label}</span>}</For></dd>
                            </div>
                          </Show>
                          <Show when={c().parents.length}>
                            <div>
                              <dt>Parents</dt>
                              <dd>
                                <For each={c().parents}>
                                  {(p) => (
                                    <button type="button" class="link-sha" onClick={() => jumpToParent(p)}>
                                      {p.slice(0, 8)}
                                    </button>
                                  )}
                                </For>
                              </dd>
                            </div>
                          </Show>
                        </dl>
                        <ul class="file-list">
                          <For each={commitFiles()}>
                            {(f) => (
                              <li>
                                <span class={`file-badge ${f.status}`}>{f.status}</span>
                                <span class="lc-file-path">{f.path}</span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    )}
                  </Show>
                </Show>
                <Show when={tab() === "changes"}>
                  <Diff
                    text={diff() ?? ""}
                    loading={diff.loading}
                    focusFile={focusFile()}
                    ownedFiles={focusFile() ? [focusFile()!] : undefined}
                    ownedOnly={!!focusFile()}
                  />
                </Show>
                <Show when={tab() === "tree"}>
                  <FileTree path={active()} commitId={treeCommitId()} />
                </Show>
              </div>
            </Show>
          </section>
        </div>
      </Show>
    </section>
  );
}
