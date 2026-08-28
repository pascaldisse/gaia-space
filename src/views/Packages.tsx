import { UI_LOCALE } from "../calendar";
import { createResource, createSignal, createEffect, For, Match, Show, Switch } from "solid-js";
import PageHeader from "../components/PageHeader";
import { api } from "../api";
import { pipelinesApi, newId, PACKAGE_FORMATS, REPO_MODES, type DependencyOverview, type PackageRepository, type PackageVersion, type PackageDetail, type RetentionCandidate } from "../api/pipelines";
import "./Packages.css";

export default function Packages() {
  const [error, setError] = createSignal<string | null>(null);
  const [projects] = createResource(() => api.listProjects());

  const [repos, { refetch: refetchRepos }] = createResource(() => pipelinesApi.listPackageRepositories());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  createEffect(() => {
    if (!selectedId() && repos()?.length) setSelectedId(repos()![0].id);
  });
  const selected = (): PackageRepository | null => repos()?.find((r) => r.id === selectedId()) ?? null;

  // ---------- new repository ----------
  const [formName, setFormName] = createSignal("");
  const [formProjectId, setFormProjectId] = createSignal("");
  const [formFormat, setFormFormat] = createSignal<string>(PACKAGE_FORMATS[0]);
  const [formMode, setFormMode] = createSignal<string>(REPO_MODES[0]);
  const [formDescription, setFormDescription] = createSignal("");
  createEffect(() => {
    if (!formProjectId() && projects()?.length) setFormProjectId(projects()![0].id);
  });

  async function createRepo(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    if (!formName().trim()) {
      setError("repository name is required");
      return;
    }
    try {
      const repo: PackageRepository = {
        id: newId("pkgrepo"),
        project_id: formProjectId() || null,
        name: formName().trim(),
        format: formFormat(),
        mode: formMode(),
        description: formDescription().trim() || null,
        archived: false,
        retention_days: null,
        retention_version_count: null,
        retain_downloaded: true,
        access_level: "PRIVATE",
      };
      await pipelinesApi.createPackageRepository(repo);
      setFormName("");
      setFormDescription("");
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
  const [pubName, setPubName] = createSignal("");
  const [pubVersion, setPubVersion] = createSignal("");
  const [pubMetadata, setPubMetadata] = createSignal("{}");
  const [pubFilename, setPubFilename] = createSignal("");
  const [pubContent, setPubContent] = createSignal("");
const [pubImmutable, setPubImmutable] = createSignal(false);
const [overview, setOverview] = createSignal<{ cve_id: string; severity: string; affected_range: string }[] | null>(null);
  const [candidates, setCandidates] = createSignal<RetentionCandidate[] | null>(null);
  const [repoReport, setRepoReport] = createSignal<DependencyOverview[] | null>(null);
  const [detail, setDetail] = createSignal<PackageDetail | null>(null);

  async function publish(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    const repo = selected();
    if (!repo || !pubName().trim() || !pubVersion().trim()) {
      setError("package name and version are required");
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
immutable: pubImmutable(),
      });
      setPubName("");
      setPubVersion("");
      setPubMetadata("{}");
      setPubFilename("");
      setPubContent("");
setPubImmutable(false);
      refetchVersions();
    } catch (err) {
      setError(String(err));
    }
  }
  async function applyRetention() {
    const repo = selected();
    if (!repo) return;
    try { const removed = await pipelinesApi.applyPackageRetention(repo.id); setError(removed ? `Retention removed ${removed} version(s)` : "Retention found no removable versions"); refetchVersions(); } catch (err) { setError(String(err)); }
  }
  /// Preview before deleting: retention candidates are computed and shown, never applied here.
  async function previewRetention() {
    const repo = selected();
    if (!repo) return;
    try { setCandidates(await pipelinesApi.packageRetentionCandidates(repo.id)); } catch (err) { setError(String(err)); }
  }
  async function showRepoCves() {
    const repo = selected();
    if (!repo) return;
    try { setRepoReport(await pipelinesApi.repositoryVulnerabilityReport(repo.id)); } catch (err) { setError(String(err)); }
  }
  async function showDetail(v: PackageVersion) {
    const repo = selected();
    if (!repo) return;
    try { setDetail(await pipelinesApi.packageVersionDetail(repo.id, v.package_name, v.version)); } catch (err) { setError(String(err)); }
  }
  async function showOverview(v: PackageVersion) { try { setOverview((await pipelinesApi.dependencyOverview(v.id)).vulnerabilities); } catch (err) { setError(String(err)); } }
async function togglePinned(v: PackageVersion) {
    try { await pipelinesApi.setPackageVersionPinned(v.id, !v.pinned); refetchVersions(); } catch (err) { setError(String(err)); }
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

  return (
    <section class="packages-view">
      <PageHeader title="Packages" subline="Publish and browse package versions" />

      <Show when={error()}>
        <div class="packages-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <form class="new-repo-form" onSubmit={createRepo}>
        <input placeholder="repository name" value={formName()} onInput={(e) => setFormName(e.currentTarget.value)} />
        <select value={formProjectId()} onChange={(e) => setFormProjectId(e.currentTarget.value)}>
          <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>
        <select value={formFormat()} onChange={(e) => setFormFormat(e.currentTarget.value)}>
          <For each={PACKAGE_FORMATS}>{(f) => <option value={f}>{f}</option>}</For>
        </select>
        <select value={formMode()} onChange={(e) => setFormMode(e.currentTarget.value)}>
          <For each={REPO_MODES}>{(m) => <option value={m}>{m}</option>}</For>
        </select>
        <input class="grow" placeholder="description" value={formDescription()} onInput={(e) => setFormDescription(e.currentTarget.value)} />
        <button class="primary">Create repository</button>
      </form>

      <div class="packages-body">
        <aside class="repos-list">
          <Show when={repos()?.length} fallback={<p class="hint pad">No repositories yet — create one above.</p>}>
            <ul>
              <For each={repos()}>
                {(r) => (
                  <li classList={{ active: r.id === selectedId(), archived: r.archived }} onClick={() => setSelectedId(r.id)}>
                    <strong>{r.name}</strong>
                    <span class="fmt">{r.format}</span>
                    <span class="mode">{r.mode}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        <Show when={selected()} fallback={<p class="hint pad">Select or create a repository.</p>}>
          {(repo) => (
            <section class="repo-detail">
              <header class="repo-detail-head">
                <h2>{repo().name}</h2>
                <span class="fmt">{repo().format}</span>
                <span class="mode">{repo().mode}</span>
                <div class="repo-actions">
                  <button class="ghost small" onClick={() => toggleArchived(repo())}>{repo().archived ? "Unarchive" : "Archive"}</button>
                  <button class="ghost small danger" onClick={() => deleteRepo(repo().id)}>Delete</button>
                </div>
              </header>
              <p class="hint">{repo().description ?? "no description"} · {repo().access_level}</p>
              <div class="repo-actions">
                <button class="ghost small" onClick={previewRetention}>Preview retention</button>
                <button class="ghost small" onClick={applyRetention}>Apply retention</button>
                <button class="ghost small" onClick={showRepoCves}>Repository CVEs</button>
              </div>
              <Show when={candidates()}>
                <div class="metadata-view">
                  <header><strong>Retention would delete {candidates()!.length} version(s)</strong><button class="ghost small" onClick={() => setCandidates(null)}>×</button></header>
                  <Show when={candidates()!.length} fallback={<p class="hint pad">Nothing matches this policy.</p>}>
                    <ul><For each={candidates()!}>{(c) => <li>{c.package_name} <code>{c.version}</code> · {c.reason} · {c.downloads} download(s)</li>}</For></ul>
                  </Show>
                </div>
              </Show>
              <Show when={repoReport()}>
                <div class="metadata-view">
                  <header><strong>Repository CVE ledger</strong><button class="ghost small" onClick={() => setRepoReport(null)}>×</button></header>
                  <Show when={repoReport()!.length} fallback={<p class="hint pad">No local CVEs recorded (no-op scanner).</p>}>
                    <ul><For each={repoReport()!}>{(o) => <li>{o.version.package_name} <code>{o.version.version}</code> · {o.vulnerabilities.map((v) => `${v.cve_id} (${v.severity})`).join(", ")}</li>}</For></ul>
                  </Show>
                </div>
              </Show>

              <section class="publish-section">
                <h3>Publish version</h3>
                <form class="publish-form" onSubmit={publish}>
                  <div class="publish-row">
                    <input placeholder="package name" value={pubName()} onInput={(e) => setPubName(e.currentTarget.value)} />
                    <input placeholder="version" value={pubVersion()} onInput={(e) => setPubVersion(e.currentTarget.value)} />
                    <input placeholder="payload filename (optional)" value={pubFilename()} onInput={(e) => setPubFilename(e.currentTarget.value)} />
                  </div>
                  <label><input type="checkbox" checked={pubImmutable()} onChange={(e) => setPubImmutable(e.currentTarget.checked)} /> Immutable version/tag</label>
<textarea class="meta-input" placeholder="metadata JSON — use formatMetadata for typed registry fields" rows="3" value={pubMetadata()} onInput={(e) => setPubMetadata(e.currentTarget.value)} />
                  <Show when={pubFilename().trim()}>
                    <textarea class="payload-input" placeholder="payload content (stored as text under app-data/packages/…)" rows="3" value={pubContent()} onInput={(e) => setPubContent(e.currentTarget.value)} />
                  </Show>
                  <button class="primary">Publish</button>
                </form>
              </section>

              <section class="versions-section">
                <header class="versions-head">
                  <h3>Versions</h3>
                  <input class="search" placeholder="search by package name…" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
                </header>
                <Show when={versions()?.length} fallback={<p class="hint pad">No versions published yet.</p>}>
                  <table class="versions-table">
                    <thead><tr><th>Package</th><th>Version</th><th>Published</th><th></th></tr></thead>
                    <tbody>
                      <For each={versions()}>
                        {(v) => (
                          <tr>
                            <td>{v.package_name}</td>
                            <td><code>{v.version}</code>{v.pinned && " 📌"}{v.immutable && " 🔒"}</td>
                            <td>{new Date(v.created_at * 1000).toLocaleString(UI_LOCALE)}</td>
                            <td class="row-actions">
                              <button class="ghost small" onClick={() => setViewingMeta(v)}>Metadata</button>
<button class="ghost small" onClick={() => showDetail(v)}>Detail</button>
<button class="ghost small" onClick={() => showOverview(v)}>CVEs</button>
                              <button class="ghost small" onClick={() => togglePinned(v)}>{v.pinned ? "Unpin" : "Pin"}</button>
                              <button class="ghost small danger" onClick={() => deleteVersion(v.id)}>Delete</button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={overview()}><div class="metadata-view"><header><strong>Dependency vulnerability overview</strong><button class="ghost small" onClick={() => setOverview(null)}>×</button></header><Show when={overview()!.length} fallback={<p class="hint pad">No local CVEs recorded (no-op scanner).</p>}><ul><For each={overview()!}>{(v) => <li><strong>{v.cve_id}</strong> · {v.severity} · {v.affected_range}</li>}</For></ul></Show></div></Show>
<Show when={detail()}>
                  {(d) => (
                    <div class="metadata-view">
                      <header>
                        <strong>Typed detail · {d().format}</strong>
                        <button class="ghost small" onClick={() => setDetail(null)}>×</button>
                      </header>
                      <Switch>
                        <Match when={d().format === "nuget" ? (d() as Extract<PackageDetail, { format: "nuget" }>) : null}>
                          {(n) => (
                            <dl class="detail-list">
                              <dt>Id</dt><dd><code>{n().id}</code> <code>{n().version}</code></dd>
                              <dt>Authors</dt><dd>{n().authors ?? "—"}</dd>
                              <dt>Description</dt><dd>{n().description ?? "—"}</dd>
                              <dt>License</dt><dd>{n().license ?? "—"}</dd>
                              <dt>Tags</dt><dd>{n().tags.length ? n().tags.join(", ") : "—"}</dd>
                              <dt>Dependencies</dt><dd><Show when={n().dependencies.length} fallback="—"><ul><For each={n().dependencies}>{(x) => <li>{x.name} <code>{x.requirement}</code></li>}</For></ul></Show></dd>
                            </dl>
                          )}
                        </Match>
                        <Match when={d().format === "pypi" ? (d() as Extract<PackageDetail, { format: "pypi" }>) : null}>
                          {(p) => (
                            <dl class="detail-list">
                              <dt>Name</dt><dd><code>{p().name}</code> <code>{p().version}</code></dd>
                              <dt>Summary</dt><dd>{p().summary ?? "—"}</dd>
                              <dt>Requires-Python</dt><dd>{p().requires_python ?? "—"}</dd>
                              <dt>Requires-Dist</dt><dd><Show when={p().requires_dist.length} fallback="—"><ul><For each={p().requires_dist}>{(x) => <li>{x.name} <code>{x.requirement}</code></li>}</For></ul></Show></dd>
                              <dt>Files</dt><dd><Show when={p().files.length} fallback="—"><ul><For each={p().files}>{(f) => <li><code>{f}</code></li>}</For></ul></Show></dd>
                            </dl>
                          )}
                        </Match>
                        <Match when={d().format === "composer" ? (d() as Extract<PackageDetail, { format: "composer" }>) : null}>
                          {(c) => (
                            <dl class="detail-list">
                              <dt>Name</dt><dd><code>{c().name}</code> <code>{c().version}</code></dd>
                              <dt>Description</dt><dd>{c().description ?? "—"}</dd>
                              <dt>Type</dt><dd>{c().package_type ?? "—"}</dd>
                              <dt>Licenses</dt><dd>{c().licenses.length ? c().licenses.join(", ") : "—"}</dd>
                              <dt>Require</dt><dd><Show when={c().require.length} fallback="—"><ul><For each={c().require}>{(x) => <li>{x.name} <code>{x.requirement}</code></li>}</For></ul></Show></dd>
                            </dl>
                          )}
                        </Match>
                        <Match when={d().format === "container" ? (d() as Extract<PackageDetail, { format: "container" }>) : null}>
                          {(o) => (
                            <dl class="detail-list">
                              <dt>Reference</dt><dd><code>{o().name}:{o().reference}</code></dd>
                              <dt>Media type</dt><dd><code>{o().media_type ?? "—"}</code></dd>
                              <dt>Config</dt><dd>{o().config ? <code>{o().config!.digest} · {o().config!.size} B</code> : "—"}</dd>
                              <dt>Layers</dt><dd><Show when={o().layers.length} fallback="—"><ul><For each={o().layers}>{(l) => <li><code>{l.digest}</code> · {l.media_type} · {l.size} B</li>}</For></ul></Show></dd>
                              <dt>Total size</dt><dd>{o().total_size} B</dd>
                              <dt>Subject</dt><dd>{o().subject ? <code>{o().subject}</code> : "—"}</dd>
                            </dl>
                          )}
                        </Match>
                        <Match when={["maven", "npm", "dart", "file"].includes(d().format) ? d() : null}>
{(x) => (
<dl class="detail-list">
<dt>Typed protocol detail</dt><dd><pre>{JSON.stringify(x(), null, 2)}</pre></dd>
</dl>
)}
</Match>
<Match when={d().format === "generic" ? (d() as Extract<PackageDetail, { format: "generic" }>) : null}>
                          {(g) => (
                            <>
                              <p class="hint pad">No protocol model for this format — the publisher's own projection, unchanged.</p>
                              <pre>{JSON.stringify(g().fields, null, 2)}</pre>
                            </>
                          )}
                        </Match>
                      </Switch>
                    </div>
                  )}
                </Show>
<Show when={viewingMeta()}>
                  {(v) => (
                    <div class="metadata-view">
                      <header>
                        <strong>{v().package_name}@{v().version}</strong>
                        <button class="ghost small" onClick={() => setViewingMeta(null)}>×</button>
                      </header>
                      <h4>Format metadata</h4>
<pre>{JSON.stringify(JSON.parse(v().format_metadata_json || "{}"), null, 2)}</pre>
<h4>Generic metadata</h4>
<pre>{JSON.stringify(JSON.parse(v().metadata_json || "{}"), null, 2)}</pre>
                    </div>
                  )}
                </Show>
              </section>
            </section>
          )}
        </Show>
      </div>
    </section>
  );
}
