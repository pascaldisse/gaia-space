import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import { pipelinesApi, newId, PACKAGE_FORMATS, REPO_MODES, type PackageRepository, type PackageVersion } from "../api/pipelines";
import { projectId, projects } from "../session";
import { ProjectHeader } from "../components/ProjectHeader";
import { Icon } from "../components/Icon";
import "./Packages.css";

// Friendly, non-technical labels so the primary surface reads for owners, not
// just package tooling experts. The raw format/mode keys are preserved on save.
const FORMAT_LABEL: Record<string, string> = {
  maven: "Maven", npm: "npm", nuget: "NuGet", pypi: "PyPI",
  dart: "Dart", container: "Container", composer: "Composer", file: "Generic files",
};
const MODE_LABEL: Record<string, string> = { HOSTING: "Hosted here", PROXY: "Proxy upstream" };
const fmt = (f: string) => FORMAT_LABEL[f] ?? f;
const mode = (m: string) => MODE_LABEL[m] ?? m;

export default function Packages() {
  const [error, setError] = createSignal<string | null>(null);

  // Active project context — Packages only shows this project's repositories.
  const activeProject = () => projects()?.find((p) => p.id === projectId()) ?? null;
  const activeProjectName = () => activeProject()?.name ?? null;

  const [allRepos, { refetch: refetchRepos }] = createResource(() => pipelinesApi.listPackageRepositories());
  // Scope to the active project (client-side by project_id); nothing leaks in
  // from other projects or the org-wide space.
  const repos = () => {
    const pid = projectId();
    if (!pid) return [] as PackageRepository[];
    return (allRepos() ?? []).filter((r) => r.project_id === pid);
  };
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // Keep the selection valid for the current project.
  createEffect(() => {
    const list = repos();
    const current = selectedId();
    if (current && list.some((r) => r.id === current)) return;
    setSelectedId(list.length ? list[0].id : null);
  });
  const selected = (): PackageRepository | null => repos().find((r) => r.id === selectedId()) ?? null;

  // ---------- new repository ----------
  const [showNewRepo, setShowNewRepo] = createSignal(false);
  const [formName, setFormName] = createSignal("");
  const [formFormat, setFormFormat] = createSignal<string>(PACKAGE_FORMATS[0]);
  const [formMode, setFormMode] = createSignal<string>(REPO_MODES[0]);
  const [formDescription, setFormDescription] = createSignal("");

  async function createRepo(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    if (!projectId()) {
      setError("Select a project first.");
      return;
    }
    if (!formName().trim()) {
      setError("Give the repository a name.");
      return;
    }
    try {
      const repo: PackageRepository = {
        id: newId("pkgrepo"),
        project_id: projectId(),
        name: formName().trim(),
        format: formFormat(),
        mode: formMode(),
        description: formDescription().trim() || null,
        archived: false,
      };
      await pipelinesApi.createPackageRepository(repo);
      setFormName("");
      setFormDescription("");
      setShowNewRepo(false);
      await refetchRepos();
      setSelectedId(repo.id);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggleArchived(repo: PackageRepository) {
    try {
      await pipelinesApi.updatePackageRepository({ ...repo, archived: !repo.archived });
      refetchRepos();
    } catch (err) {
      setError(String(err));
    }
  }
  async function deleteRepo(id: string) {
    try {
      await pipelinesApi.deletePackageRepository(id);
      if (selectedId() === id) setSelectedId(null);
      await refetchRepos();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- versions ----------
  const [search, setSearch] = createSignal("");
  const [versions, { refetch: refetchVersions }] = createResource(
    () => (selectedId() ? { id: selectedId()!, q: search() } : null),
    (k) => (k ? pipelinesApi.listPackageVersions(k.id, k.q) : Promise.resolve([])),
  );
  const [viewingMeta, setViewingMeta] = createSignal<PackageVersion | null>(null);

  // ---------- publish ----------
  const [showPublish, setShowPublish] = createSignal(false);
  const [pubName, setPubName] = createSignal("");
  const [pubVersion, setPubVersion] = createSignal("");
  const [pubMetadata, setPubMetadata] = createSignal("{}");
  const [pubFilename, setPubFilename] = createSignal("");
  const [pubContent, setPubContent] = createSignal("");

  async function publish(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    const repo = selected();
    if (!repo || !pubName().trim() || !pubVersion().trim()) {
      setError("Package name and version are required.");
      return;
    }
    try {
      await pipelinesApi.publishPackageVersion({
        repositoryId: repo.id,
        packageName: pubName().trim(),
        version: pubVersion().trim(),
        metadataJson: pubMetadata().trim() || "{}",
        payloadFilename: pubFilename().trim() || null,
        payloadContent: pubFilename().trim() ? pubContent() : null,
      });
      setPubName("");
      setPubVersion("");
      setPubMetadata("{}");
      setPubFilename("");
      setPubContent("");
      setShowPublish(false);
      refetchVersions();
    } catch (err) {
      setError(String(err));
    }
  }
  async function deleteVersion(id: string) {
    try {
      await pipelinesApi.deletePackageVersion(id);
      if (viewingMeta()?.id === id) setViewingMeta(null);
      refetchVersions();
    } catch (err) {
      setError(String(err));
    }
  }

  const noProject = () => !projectId();
  const projectEmpty = () => !noProject() && !allRepos.loading && repos().length === 0;

  return (
    <section class="packages-view">
      <ProjectHeader title="Packages" project={activeProject()}>
        Publish and browse the packages that ship from{" "}
        <strong>{activeProjectName() ?? "this project"}</strong> — libraries, containers, and
        release artifacts, all in one place.
      </ProjectHeader>

      <Show when={error()}>
        <div class="packages-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <Show when={noProject()}>
        <div class="proj-empty">
          <div class="proj-empty-card">
            <div class="proj-empty-icon" aria-hidden="true"><Icon name="package" size={26} /></div>
            <h2>No project selected</h2>
            <p>Choose a project from the context header to see its package repositories.</p>
          </div>
        </div>
      </Show>

      <Show when={projectEmpty()}>
        <div class="proj-empty">
          <div class="proj-empty-card">
            <div class="proj-empty-icon" aria-hidden="true"><Icon name="package" size={26} /></div>
            <h2>Set up a package repository</h2>
            <p>
              Keep the releases for <strong>{activeProjectName() ?? "this project"}</strong> in one
              trusted place — pick a format like npm, Maven, or containers and start publishing.
            </p>
            <button class="primary proj-empty-cta" onClick={() => setShowNewRepo(true)}>
              <Icon name="plus" size={15} /> New repository
            </button>
          </div>
        </div>
      </Show>

      <Show when={!noProject() && !projectEmpty()}>
        <div class="packages-toolbar">
          <Show
            when={showNewRepo()}
            fallback={
              <button class="ghost new-repo-open" onClick={() => setShowNewRepo(true)}>
                <Icon name="plus" size={14} /> New repository
              </button>
            }
          >
            <form class="new-repo-form" onSubmit={createRepo}>
              <input placeholder="Repository name" value={formName()} onInput={(e) => setFormName(e.currentTarget.value)} />
              <label class="field">Format
                <select value={formFormat()} onChange={(e) => setFormFormat(e.currentTarget.value)}>
                  <For each={PACKAGE_FORMATS}>{(f) => <option value={f}>{fmt(f)}</option>}</For>
                </select>
              </label>
              <label class="field">Mode
                <select value={formMode()} onChange={(e) => setFormMode(e.currentTarget.value)}>
                  <For each={REPO_MODES}>{(m) => <option value={m}>{mode(m)}</option>}</For>
                </select>
              </label>
              <input class="grow" placeholder="Description (optional)" value={formDescription()} onInput={(e) => setFormDescription(e.currentTarget.value)} />
              <div class="row-actions">
                <button type="button" class="ghost small" onClick={() => setShowNewRepo(false)}>Cancel</button>
                <button class="primary">Create repository</button>
              </div>
            </form>
          </Show>
        </div>

        <div class="packages-body">
          <aside class="repos-list">
            <div class="section-label">Repositories</div>
            <ul>
              <For each={repos()}>
                {(r) => (
                  <li classList={{ active: r.id === selectedId(), archived: r.archived }} onClick={() => setSelectedId(r.id)}>
                    <strong>{r.name}</strong>
                    <span class="repo-meta">{fmt(r.format)} · {mode(r.mode)}</span>
                  </li>
                )}
              </For>
            </ul>
          </aside>

          <Show when={selected()} fallback={<p class="hint pad">Select a repository to publish and browse versions.</p>}>
            {(repo) => (
              <section class="repo-detail">
                <header class="repo-detail-head">
                  <div class="repo-detail-title">
                    <h2>{repo().name}</h2>
                    <span class="repo-meta">{fmt(repo().format)} · {mode(repo().mode)}</span>
                    <Show when={repo().archived}><span class="tag">archived</span></Show>
                  </div>
                  <div class="repo-actions">
                    <button class="primary small" onClick={() => setShowPublish((v) => !v)}>
                      <Icon name="plus" size={13} /> Publish version
                    </button>
                    <details class="repo-more">
                      <summary class="ghost small">More</summary>
                      <div class="repo-more-menu">
                        <button class="ghost small" onClick={() => toggleArchived(repo())}>{repo().archived ? "Unarchive" : "Archive"}</button>
                        <button class="ghost small danger" onClick={() => deleteRepo(repo().id)}>Delete repository</button>
                      </div>
                    </details>
                  </div>
                </header>
                <Show when={repo().description}><p class="repo-desc">{repo().description}</p></Show>

                <Show when={showPublish()}>
                  <section class="publish-section">
                    <h3>Publish a version</h3>
                    <form class="publish-form" onSubmit={publish}>
                      <div class="publish-row">
                        <input placeholder="Package name" value={pubName()} onInput={(e) => setPubName(e.currentTarget.value)} />
                        <input placeholder="Version (e.g. 1.2.0)" value={pubVersion()} onInput={(e) => setPubVersion(e.currentTarget.value)} />
                      </div>
                      <details class="publish-advanced">
                        <summary>Advanced: metadata &amp; attached file</summary>
                        <textarea class="meta-input" placeholder="Metadata JSON" rows="3" value={pubMetadata()} onInput={(e) => setPubMetadata(e.currentTarget.value)} />
                        <input placeholder="Attached file name (optional)" value={pubFilename()} onInput={(e) => setPubFilename(e.currentTarget.value)} />
                        <Show when={pubFilename().trim()}>
                          <textarea class="payload-input" placeholder="File content" rows="3" value={pubContent()} onInput={(e) => setPubContent(e.currentTarget.value)} />
                        </Show>
                      </details>
                      <div class="row-actions">
                        <button type="button" class="ghost small" onClick={() => setShowPublish(false)}>Cancel</button>
                        <button class="primary">Publish</button>
                      </div>
                    </form>
                  </section>
                </Show>

                <section class="versions-section">
                  <header class="versions-head">
                    <h3>Versions</h3>
                    <input class="search" placeholder="Search by package name…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
                  </header>
                  <Show
                    when={versions()?.length}
                    fallback={
                      <p class="hint pad">
                        {search().trim() ? "No packages match your search." : "No versions published yet — use “Publish version” above."}
                      </p>
                    }
                  >
                    <table class="versions-table">
                      <thead><tr><th>Package</th><th>Version</th><th>Published</th><th></th></tr></thead>
                      <tbody>
                        <For each={versions()}>
                          {(v) => (
                            <tr>
                              <td>{v.package_name}</td>
                              <td><code>{v.version}</code></td>
                              <td>{new Date(v.created_at * 1000).toLocaleString()}</td>
                              <td class="row-actions">
                                <button class="ghost small" onClick={() => setViewingMeta(v)}>Details</button>
                                <button class="ghost small danger" onClick={() => deleteVersion(v.id)}>Delete</button>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                  <Show when={viewingMeta()}>
                    {(v) => (
                      <div class="metadata-view">
                        <header>
                          <strong>{v().package_name}@{v().version}</strong>
                          <button class="ghost small" onClick={() => setViewingMeta(null)}>×</button>
                        </header>
                        <pre>{JSON.stringify(JSON.parse(v().metadata_json || "{}"), null, 2)}</pre>
                      </div>
                    )}
                  </Show>
                </section>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
