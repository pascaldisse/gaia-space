import { createResource, createSignal, createMemo, createEffect, For, Show, type JSX } from "solid-js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type ChangeEntry, type Commit, type RepoRef } from "../api";
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
import { GraphRow, when, type Ref } from "../components/CommitGraph";
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

type Side = "staged" | "unstaged" | "untracked";
/** One file's diff split into hunks, each with its own stage/unstage button.
 *  Hunk numbers sent to Rust are the 0-based order of `@@` headers in this text. */
function HunkView(props: { path: string; file: string; side: Side; rev: number; onChanged: () => void; onError: (e: unknown) => void }) {
  const key = () => ({ p: props.path, f: props.file, s: props.side, rev: props.rev });
  const [text] = createResource(key, (k) => api.repoFileDiff(k.p, k.f, k.s === "staged"));
  const hunks = createMemo(() => {
    const out: { header: string; lines: string[] }[] = [];
    for (const l of (text() ?? "").split("\n")) {
      if (l.startsWith("@@")) out.push({ header: l, lines: [] });
      else if (out.length) out[out.length - 1].lines.push(l);
    }
    for (const h of out) while (h.lines.length && h.lines[h.lines.length - 1] === "") h.lines.pop();
    return out;
  });
  async function act(i: number) {
    try {
      if (props.side === "staged") await api.repoUnstageHunk(props.path, props.file, i);
      else await api.repoStageHunk(props.path, props.file, i);
      props.onChanged();
    } catch (e) {
      props.onError(e);
    }
  }
  return (
    <div class="hunk-view" data-testid="hunk-view">
      <div class="hunk-file">{props.file} <span class="hunk-side">{props.side}</span></div>
      <Show when={!text.loading} fallback={<p class="hint pad">Loading diff…</p>}>
        <For each={hunks()} fallback={<p class="hint pad">No textual changes (binary or mode-only).</p>}>
          {(h, i) => (
            <div class="hunk">
              <div class="hunk-head">
                <span class="hunk-range">{h.header}</span>
                <GhostPill onClick={() => act(i())}>{props.side === "staged" ? "Unstage hunk" : props.side === "untracked" ? "Stage file" : "Stage hunk"}</GhostPill>
              </div>
              <pre class="hunk-lines">
                <For each={h.lines}>{(l) => <div classList={{ "hl-add": l.startsWith("+"), "hl-del": l.startsWith("-") }}>{l || " "}</div>}</For>
              </pre>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
export default function App() {
  const [repos, { mutate: setRepos }] = createResource<RepoRef[]>(() => api.repoList());
  const [active, setActive] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Commit | "working" | null>(null);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [amend, setAmend] = createSignal(false);
  const [newBranch, setNewBranch] = createSignal("");
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
  const [changes, { refetch: refetchChanges }] = createResource(active, (p) => api.repoChanges(p));
  const [rev, setRev] = createSignal(0);
  const changeCount = createMemo(() => {
    const c = changes();
    return c ? new Set([...c.staged, ...c.unstaged, ...c.untracked].map((f) => f.path)).size : 0;
  });
  /** Every working-copy mutation ends here: lists + open hunk view re-read from Rust. */
  function changed() {
    setRev((n) => n + 1);
    refetchChanges();
  }
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
    refetchChanges();
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
  const [focusSide, setFocusSide] = createSignal<Side>("unstaged");
  function focus(f: ChangeEntry, side: Side) {
    setFocusFile(f.path);
    setFocusSide(side);
    setTab("changes");
  }
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
    if (p) run("Fetching\u2026", async () => { await api.repoFetch(p); setNotice("Fetched."); refetchAll(); });
  }
  function doPull() {
    const p = active();
    if (p) run("Pulling\u2026", async () => { setNotice(await api.repoPull(p)); refetchAll(); });
  }
  function doPush() {
    const p = active();
    if (p) run("Pushing\u2026", async () => { await api.repoPush(p); setNotice("Pushed."); refetchAll(); });
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
    { value: "save", label: "Stash changes", disabled: !changeCount() },
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

  // ---------- local changes: stage / unstage / discard / commit / branches ----------
  const stagedFiles = createMemo(() => changes()?.staged ?? []);
  const unstagedFiles = createMemo(() => changes()?.unstaged ?? []);
  const untrackedFiles = createMemo(() => changes()?.untracked ?? []);
  async function mutate(fn: (p: string) => Promise<void>) {
    const p = active();
    if (!p) return;
    try {
      await fn(p);
      changed();
    } catch (e) {
      setError(String(e));
    }
  }
  const stageFiles = (files: string[]) => (files.length ? mutate((p) => api.repoStage(p, files)) : undefined);
  const unstageFiles = (files: string[]) => (files.length ? mutate((p) => api.repoUnstage(p, files)) : undefined);
  function discardFiles(files: string[]) {
    if (!files.length || !window.confirm(`Discard changes to ${files.length === 1 ? files[0] : files.length + " files"}? This cannot be undone.`)) return;
    mutate((p) => api.repoDiscard(p, files));
  }
  async function commit() {
    const p = active();
    if (!p) return;
    setError(null);
    try {
      await api.repoCommit(p, message(), amend());
      setMessage("");
      setAmend(false);
      changed();
      refetchLog();
      setNotice("Committed.");
    } catch (e) {
      setError(String(e));
    }
  }
  // Fork prefills the previous message when Amend is ticked.
  createEffect(() => {
    if (amend() && !message().trim()) setMessage(log()?.[0]?.summary ?? "");
  });
  function createBranch(ev: SubmitEvent) {
    ev.preventDefault();
    const p = active();
    const name = newBranch().trim();
    if (!p || !name) return;
    run("Creating branch\u2026", async () => {
      await api.repoCheckout(p, name, true);
      setNewBranch("");
      refetchAll();
    });
  }
  async function deleteBranch(name: string) {
    const p = active();
    if (!p || !window.confirm(`Delete branch ${name}?`)) return;
    await run("Deleting branch\u2026", async () => {
      try {
        await api.repoBranchDelete(p, name);
      } catch (e) {
        if (!String(e).includes("not fully merged") || !window.confirm(`${name} is not fully merged. Delete anyway?`)) throw e;
        await api.repoBranchDelete(p, name, true);
      }
      refetchAll();
    });
  }
  // ---------- diff / commit-files / tree resources for the detail pane ----------
  const diffKey = () => {
    const p = active();
    const s = selected();
    if (!p || !s) return null;
    return { path: p, id: s === "working" ? undefined : s.id, rev: rev() };
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

      <Show when={notice() && !error()}>
        <div class="repos-notice" role="status" onClick={() => setNotice(null)}>{notice()}</div>
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
                  <span class="side-nav-dot" classList={{ dirty: changeCount() > 0 }} aria-hidden="true" />
                  <span>Local Changes</span>
                  <span class="side-nav-badge">{changeCount()}</span>
                </button>
                <button type="button" class="side-nav-row" classList={{ active: leftView() === "commits" }} onClick={() => setLeftView("commits")}>
                  <Icon name="clock" size={14} />
                  <span>All Commits</span>
                </button>
              </div>

              <QuietSearch label="Filter commits and branches" placeholder="Filter…" value={filter()} onInput={setFilter} class="side-filter" />

              <Group title="Branches" count={localBranches().length} open={groupsOpen().branches} onToggle={() => toggleGroup("branches")}>
                <form class="branch-form" onSubmit={createBranch}>
                  <input aria-label="New branch name" placeholder="New branch…" value={newBranch()} onInput={(e) => setNewBranch(e.currentTarget.value)} />
                  <GhostPill type="submit" disabled={!!busy() || !newBranch().trim()}>Create &amp; checkout</GhostPill>
                </form>
                <ul class="ref-list">
                <For each={localBranches().filter((b) => matchesFilter(b.name))} fallback={<li class="hint">No branches.</li>}>
                    {(b) => (
                      <li classList={{ head: b.is_head }} class="branch-row" onClick={() => !b.is_head && doCheckout(b.name)}>
                        <span>{b.is_head ? "● " : ""}{b.name}</span>
                        <Show when={!b.is_head}>
                          <IconButton class="small" label={`Delete branch ${b.name}`} onClick={(e: MouseEvent) => { e.stopPropagation(); deleteBranch(b.name); }}>
                            <Icon name="close" size={12} />
                          </IconButton>
                        </Show>
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
                  <div class="local-changes" data-testid="local-changes">
                    <div class="lc-section" data-testid="lc-staged">
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
                            <li classList={{ active: focusFile() === f.path && focusSide() === "staged" }} onClick={() => focus(f, "staged")}>
                              <span class={`badge ${f.status}`}>{f.status[0]}</span>
                              <span class="lc-file-path">{f.path}</span>
                              <IconButton class="small" label={`Unstage ${f.path}`} onClick={(e: MouseEvent) => { e.stopPropagation(); unstageFiles([f.path]); }}>
                                <Icon name="close" size={12} />
                              </IconButton>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                    <div class="lc-section" data-testid="lc-unstaged">
                      <div class="lc-section-head">
                        <span>Unstaged</span>
                        <span class="lc-count">{unstagedFiles().length}</span>
                        <Show when={unstagedFiles().length}>
                          <GhostPill onClick={() => discardFiles(unstagedFiles().map((f) => f.path))}>Discard all</GhostPill>
                          <GhostPill onClick={() => stageFiles(unstagedFiles().map((f) => f.path))}>Stage all</GhostPill>
                        </Show>
                      </div>
                      <ul class="lc-file-list">
                        <For each={unstagedFiles()} fallback={<li class="hint">No modified files.</li>}>
                          {(f) => (
                            <li classList={{ active: focusFile() === f.path && focusSide() === "unstaged" }} onClick={() => focus(f, "unstaged")}>
                              <span class={`badge ${f.status}`}>{f.status[0]}</span>
                              <span class="lc-file-path">{f.path}</span>
                              <IconButton class="small" label={`Discard ${f.path}`} onClick={(e: MouseEvent) => { e.stopPropagation(); discardFiles([f.path]); }}>
                                <Icon name="close" size={12} />
                              </IconButton>
                              <IconButton class="small" label={`Stage ${f.path}`} onClick={(e: MouseEvent) => { e.stopPropagation(); stageFiles([f.path]); }}>
                                <Icon name="plus" size={12} />
                              </IconButton>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                    <div class="lc-section" data-testid="lc-untracked">
                      <div class="lc-section-head">
                        <span>Untracked</span>
                        <span class="lc-count">{untrackedFiles().length}</span>
                        <Show when={untrackedFiles().length}>
                          <GhostPill onClick={() => stageFiles(untrackedFiles().map((f) => f.path))}>Stage all</GhostPill>
                        </Show>
                      </div>
                      <ul class="lc-file-list">
                        <For each={untrackedFiles()} fallback={<li class="hint">No untracked files.</li>}>
                          {(f) => (
                            <li classList={{ active: focusFile() === f.path && focusSide() === "untracked" }} onClick={() => focus(f, "untracked")}>
                              <span class={`badge ${f.status}`}>{f.status[0]}</span>
                              <span class="lc-file-path">{f.path}</span>
                              <IconButton class="small" label={`Delete ${f.path}`} onClick={(e: MouseEvent) => { e.stopPropagation(); discardFiles([f.path]); }}>
                                <Icon name="close" size={12} />
                              </IconButton>
                              <IconButton class="small" label={`Stage ${f.path}`} onClick={(e: MouseEvent) => { e.stopPropagation(); stageFiles([f.path]); }}>
                                <Icon name="plus" size={12} />
                              </IconButton>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                    <div class="commit-box">
                      <textarea placeholder="Commit message" value={message()} onInput={(e) => setMessage(e.currentTarget.value)} />
                      <div class="row-actions">
                        <label class="amend-check">
                          <input type="checkbox" checked={amend()} onChange={(e) => setAmend(e.currentTarget.checked)} />
                          Amend last commit
                        </label>
                        <button class="primary" onClick={commit} disabled={amend() ? false : !message().trim() || !stagedFiles().length}>
                          {amend() ? "Amend" : "Commit"}
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
                  <Show
                    when={selected() === "working" && focusFile()}
                    fallback={
                      <Diff
                        text={diff() ?? ""}
                        loading={diff.loading}
                        focusFile={focusFile()}
                        ownedFiles={focusFile() ? [focusFile()!] : undefined}
                        ownedOnly={!!focusFile()}
                      />
                    }
                  >
                    <HunkView path={active()!} file={focusFile()!} side={focusSide()} rev={rev()} onChanged={changed} onError={(e) => setError(String(e))} />
                  </Show>
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
