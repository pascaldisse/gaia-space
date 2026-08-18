import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import { api } from "../api";
import {
  reviewApi,
  newId,
  type Review,
  type ReviewDiscussion,
} from "../api/review";
import { Diff } from "../Diff";
import { profileId, projectId, projects } from "../session";
import { ProfilePicker } from "../components/Pickers";
import { ProjectHeader } from "../components/ProjectHeader";
import { Icon } from "../components/Icon";
import "./Reviews.css";

export default function Reviews() {
  const [error, setError] = createSignal<string | null>(null);

  const [profiles] = createResource(() => api.listProfiles());
  const [repos] = createResource(() => api.repoList());

  // Active project context — Code reviews are scoped to this project.
  const activeProject = () => projects()?.find((p) => p.id === projectId()) ?? null;
  const activeProjectName = () => activeProject()?.name ?? null;

  // Acting person = app-wide identity chosen in the header "Acting as" control
  // (session.profileId). No per-view default that could silently diverge from
  // the global selection.
  const actingProfileId = () => profileId();

  // ---------- create merge request ----------
  const [showNew, setShowNew] = createSignal(false);
  const [formRepoPath, setFormRepoPath] = createSignal("");
  const [formSource, setFormSource] = createSignal("");
  const [formTarget, setFormTarget] = createSignal("");
  const [formTitle, setFormTitle] = createSignal("");
  const [formReviewers, setFormReviewers] = createSignal<string[]>([]);
  const [formBranches] = createResource(formRepoPath, (p) => (p ? api.repoBranches(p) : Promise.resolve([])));
  createEffect(() => {
    if (!formRepoPath() && repos()?.length) setFormRepoPath(repos()![0].path);
  });
  function toggleReviewer(id: string) {
    setFormReviewers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const [allReviews, { refetch: refetchReviews }] = createResource(() => reviewApi.list());
  // Scope to the active project (client-side by project_id).
  const reviews = () => {
    const pid = projectId();
    if (!pid) return [] as Review[];
    return (allReviews() ?? []).filter((r) => r.project_id === pid);
  };
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  createEffect(() => {
    const list = reviews();
    const current = selectedId();
    if (current && list.some((r) => r.id === current)) return;
    setSelectedId(list.length ? list[0].id : null);
  });
  const selected = (): Review | null => reviews().find((r) => r.id === selectedId()) ?? null;

  async function createMR(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    if (!projectId()) {
      setError("Select a project first.");
      return;
    }
    if (!formRepoPath() || !formSource() || !formTarget() || !formTitle().trim() || !actingProfileId()) {
      setError("Pick a repository, both branches, a title, and who you are acting as.");
      return;
    }
    if (formSource() === formTarget()) {
      setError("Source and target branches must differ.");
      return;
    }
    try {
      const review = await reviewApi.openMergeRequest({
        id: newId("review"),
        project_id: projectId(),
        repo_path: formRepoPath(),
        source_branch: formSource(),
        target_branch: formTarget(),
        title: formTitle().trim(),
        author_id: actingProfileId(),
        reviewer_ids: formReviewers(),
        channel_id: newId("channel"),
      });
      setFormTitle("");
      setFormReviewers([]);
      setFormSource("");
      setFormTarget("");
      setShowNew(false);
      setDiffRepoPath(formRepoPath());
      await refetchReviews();
      setSelectedId(review.id);
    } catch (err) {
      setError(String(err));
    }
  }

  // repo used for git-dependent actions (diff / safe merge) on the selected review —
  // reviews are not tied to a repo path in the schema, so the operator picks it explicitly
  // (same explicit-path philosophy as git.rs).
  const [diffRepoPath, setDiffRepoPath] = createSignal("");
  createEffect(() => {
    if (!diffRepoPath() && repos()?.length) setDiffRepoPath(repos()![0].path);
  });

  const [participants, { refetch: refetchParticipants }] = createResource(selectedId, (id) =>
    id ? reviewApi.listParticipants(id) : Promise.resolve([]),
  );
  const [discussions, { refetch: refetchDiscussions }] = createResource(selectedId, (id) =>
    id ? reviewApi.listDiscussions(id) : Promise.resolve([]),
  );
  const [gateRules, { refetch: refetchGateRules }] = createResource(
    () => selected()?.project_id,
    (id) => (id ? reviewApi.listGateRules(id) : Promise.resolve([])),
  );
  const [gateEval, { refetch: refetchGateEval }] = createResource(selectedId, (id) =>
    id ? reviewApi.evaluateGate(id) : Promise.resolve(null),
  );
  const [mergeRuns, { refetch: refetchMergeRuns }] = createResource(selectedId, (id) =>
    id ? reviewApi.listMergeRuns(id) : Promise.resolve([]),
  );
  const diffKey = () => {
    const r = selected();
    const p = diffRepoPath();
    return r && p && r.source_branch && r.target_branch ? { p, s: r.source_branch, t: r.target_branch } : null;
  };
  const [diff] = createResource(diffKey, (k) => reviewApi.diff(k.p, k.s, k.t));

  async function setParticipantState(profileId: string, state: string | null) {
    const id = selectedId();
    if (!id) return;
    try {
      await reviewApi.setParticipantState(id, profileId, state);
      refetchParticipants();
      refetchGateEval();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- discussions ----------
  const [discFile, setDiscFile] = createSignal("");
  const [discLine, setDiscLine] = createSignal("");
  const [discMessage, setDiscMessage] = createSignal("");
  async function addDiscussion(e: SubmitEvent) {
    e.preventDefault();
    const id = selectedId();
    if (!id || !discFile().trim() || !actingProfileId()) return;
    try {
      await reviewApi.createDiscussion({
        id: newId("disc"),
        review_id: id,
        channel_id: newId("channel"),
        file_path: discFile().trim(),
        line_start: discLine() ? Number(discLine()) : null,
        line_end: null,
        revision: selected()?.source_branch ?? null,
        author_id: actingProfileId(),
        message: discMessage(),
      });
      setDiscFile("");
      setDiscLine("");
      setDiscMessage("");
      refetchDiscussions();
    } catch (err) {
      setError(String(err));
    }
  }
  async function toggleResolved(d: ReviewDiscussion) {
    try {
      await reviewApi.setDiscussionResolved(d.id, !d.resolved);
      refetchDiscussions();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- quality gate rules ----------
  const [rulePattern, setRulePattern] = createSignal("main");
  const [ruleApprovals, setRuleApprovals] = createSignal(1);
  const [ruleCodeowners, setRuleCodeowners] = createSignal(false);
  async function addRule(e: SubmitEvent) {
    e.preventDefault();
    const pid = selected()?.project_id;
    if (!pid) return;
    try {
      await reviewApi.createGateRule({
        id: newId("gate"),
        project_id: pid,
        branch_pattern: rulePattern().trim() || "*",
        min_approvals: ruleApprovals(),
        required_reviewers_json: null,
        codeowners_required: ruleCodeowners(),
      });
      refetchGateRules();
      refetchGateEval();
    } catch (err) {
      setError(String(err));
    }
  }
  async function deleteRule(id: string) {
    try {
      await reviewApi.deleteGateRule(id);
      refetchGateRules();
      refetchGateEval();
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- safe merge (dry-run only — see review.rs module doc) ----------
  async function runDryRun() {
    const r = selected();
    const p = diffRepoPath();
    if (!r || !p || !r.source_branch || !r.target_branch) return;
    try {
      await reviewApi.dryRunMerge(newId("merge"), p, r.id, r.source_branch, r.target_branch);
      refetchMergeRuns();
    } catch (err) {
      setError(String(err));
    }
  }
  async function runMerge() {
    const r = selected();
    const p = diffRepoPath();
    if (!r || !p || !r.source_branch || !r.target_branch) return;
    try {
      await reviewApi.attemptMerge(newId("merge"), p, r.id, r.source_branch, r.target_branch);
      refetchMergeRuns();
    } catch (err) {
      setError(String(err));
    }
  }

  const noProject = () => !projectId();
  const projectEmpty = () => !noProject() && !allReviews.loading && reviews().length === 0;

  const newReviewForm = () => (
    <form class="new-review-form" onSubmit={createMR}>
      <div class="new-review-row">
        <label>
          Repository
          <select value={formRepoPath()} onChange={(e) => { setFormRepoPath(e.currentTarget.value); setFormSource(""); setFormTarget(""); }}>
            <For each={repos()}>{(r) => <option value={r.path}>{r.name}</option>}</For>
          </select>
        </label>
        <label>
          From branch
          <select value={formSource()} onChange={(e) => setFormSource(e.currentTarget.value)}>
            <option value="">select…</option>
            <For each={formBranches()?.filter((b) => !b.remote)}>{(b) => <option value={b.name}>{b.name}</option>}</For>
          </select>
        </label>
        <label>
          Into branch
          <select value={formTarget()} onChange={(e) => setFormTarget(e.currentTarget.value)}>
            <option value="">select…</option>
            <For each={formBranches()?.filter((b) => !b.remote)}>{(b) => <option value={b.name}>{b.name}</option>}</For>
          </select>
        </label>
      </div>
      <div class="new-review-row">
        <input class="grow" placeholder="What does this change do?" value={formTitle()} onInput={(e) => setFormTitle(e.currentTarget.value)} />
      </div>
      <div class="new-review-row">
        <div class="reviewer-picks">
          <span class="hint">Reviewers:</span>
          <For each={profiles()?.filter((p) => p.id !== actingProfileId() && !p.archived)}>
            {(p) => (
              <label class="reviewer-pick">
                <input type="checkbox" checked={formReviewers().includes(p.id)} onChange={() => toggleReviewer(p.id)} />
                {p.display_name}
              </label>
            )}
          </For>
        </div>
        <div class="row-actions">
          <button type="button" class="ghost small" onClick={() => setShowNew(false)}>Cancel</button>
          <button class="primary">Open merge request</button>
        </div>
      </div>
    </form>
  );

  return (
    <section class="reviews-view">
      <ProjectHeader
        title="Code reviews"
        project={activeProject()}
        actions={<label class="proj-head-acting"><span>Acting as</span><ProfilePicker /></label>}
      >
        Propose and review changes for{" "}
        <strong>{activeProjectName() ?? "this project"}</strong> before they merge — with
        approvals, inline discussion, and a safe merge check.
      </ProjectHeader>

      <Show when={error()}>
        <div class="reviews-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <Show when={noProject()}>
        <div class="proj-empty">
          <div class="proj-empty-card">
            <div class="proj-empty-icon" aria-hidden="true"><Icon name="review" size={26} /></div>
            <h2>No project selected</h2>
            <p>Choose a project from the context header to see its code reviews.</p>
          </div>
        </div>
      </Show>

      <Show when={projectEmpty() && !showNew()}>
        <div class="proj-empty">
          <div class="proj-empty-card">
            <div class="proj-empty-icon" aria-hidden="true"><Icon name="review" size={26} /></div>
            <h2>Review changes together</h2>
            <p>
              Open a merge request for <strong>{activeProjectName() ?? "this project"}</strong> to
              propose changes, gather approvals, and discuss the diff before it lands.
            </p>
            <button class="primary proj-empty-cta" onClick={() => setShowNew(true)}>
              <Icon name="plus" size={15} /> Open a merge request
            </button>
          </div>
        </div>
      </Show>

      <Show when={!noProject() && !(projectEmpty() && !showNew())}>
        <div class="reviews-toolbar">
          <Show
            when={showNew()}
            fallback={<button class="ghost new-open" onClick={() => setShowNew(true)}><Icon name="plus" size={14} /> Open a merge request</button>}
          >
            {newReviewForm()}
          </Show>
        </div>

        <div class="reviews-body">
          <aside class="reviews-list">
            <div class="section-label">Merge requests</div>
            <Show when={reviews().length} fallback={<p class="hint pad">No open reviews.</p>}>
              <ul>
                <For each={reviews()}>
                  {(r) => (
                    <li classList={{ active: r.id === selectedId() }} onClick={() => setSelectedId(r.id)}>
                      <div class="review-row-top">
                        <span class="num">#{r.number}</span>
                        <strong>{r.title}</strong>
                        <span class={`state state-${r.state.toLowerCase()}`}>{r.state}</span>
                      </div>
                      <span class="branches">{r.source_branch} → {r.target_branch}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>

          <Show when={selected()} fallback={<p class="hint pad">Select or open a review.</p>}>
            {(review) => (
              <section class="review-detail">
                <header class="review-detail-head">
                  <div class="review-detail-title">
                    <h2>#{review().number} {review().title}</h2>
                    <span class={`state state-${review().state.toLowerCase()}`}>{review().state}</span>
                    <span class="branches">{review().source_branch} → {review().target_branch}</span>
                  </div>
                  <label class="repo-picker">
                    Repository for git actions
                    <select value={diffRepoPath()} onChange={(e) => setDiffRepoPath(e.currentTarget.value)}>
                      <For each={repos()}>{(r) => <option value={r.path}>{r.name}</option>}</For>
                    </select>
                  </label>
                </header>

                <section class="participants">
                  <h3>Reviewers</h3>
                  <ul>
                    <For each={participants()}>
                      {(p) => {
                        const profile = () => profiles()?.find((pr) => pr.id === p.profile_id);
                        return (
                          <li>
                            <strong>{profile()?.display_name ?? p.profile_id}</strong>
                            <span class="role">{p.role}</span>
                            <span class={`pstate pstate-${p.state ?? "waiting"}`}>{p.state ?? "waiting"}</span>
                            <Show when={p.their_turn}><span class="turn">their turn</span></Show>
                            <Show when={p.role === "Reviewer"}>
                              <button class="ghost small" onClick={() => setParticipantState(p.profile_id, "accepted")}>Approve</button>
                              <button class="ghost small" onClick={() => setParticipantState(p.profile_id, "rejected")}>Request changes</button>
                            </Show>
                            <Show when={p.role === "Author"}>
                              <button class="ghost small" onClick={() => setParticipantState(p.profile_id, null)}>Resume work</button>
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </section>

                <section class="gate-banner" classList={{ ok: gateEval()?.satisfied, blocked: gateEval() ? !gateEval()!.satisfied : false }}>
                  <h3>Ready to merge: {gateEval() ? (gateEval()!.satisfied ? "Yes" : "Not yet") : "…"}</h3>
                  <Show when={gateEval() && !gateEval()!.satisfied}>
                    <ul><For each={gateEval()!.reasons}>{(reason) => <li>{reason}</li>}</For></ul>
                  </Show>
                  <p class="hint">{gateEval()?.approvals ?? 0} approval(s) of {gateEval()?.min_approvals ?? 0} required.</p>

                  <details class="gate-rules">
                    <summary>Approval rules ({gateRules()?.length ?? 0})</summary>
                    <p class="hint">Set how many approvals a branch needs before it can merge.</p>
                    <ul>
                      <For each={gateRules()}>
                        {(rule) => (
                          <li>
                            <code>{rule.branch_pattern}</code> needs {rule.min_approvals} approval(s)
                            <Show when={rule.codeowners_required}> · code owners required</Show>
                            <button class="ghost small" onClick={() => deleteRule(rule.id)}>×</button>
                          </li>
                        )}
                      </For>
                    </ul>
                    <form class="new-rule-form" onSubmit={addRule}>
                      <input placeholder="branch (e.g. main, release/*)" value={rulePattern()} onInput={(e) => setRulePattern(e.currentTarget.value)} />
                      <input type="number" min="0" value={ruleApprovals()} onInput={(e) => setRuleApprovals(Number(e.currentTarget.value))} />
                      <label><input type="checkbox" checked={ruleCodeowners()} onChange={(e) => setRuleCodeowners(e.currentTarget.checked)} /> Code owners</label>
                      <button class="ghost">Add rule</button>
                    </form>
                  </details>
                </section>

                <section class="safe-merge">
                  <h3>Safe merge</h3>
                  <div class="safe-merge-actions">
                    <button onClick={runDryRun}>Check for conflicts</button>
                    <button class="primary" onClick={runMerge}>Merge</button>
                  </div>
                  <p class="hint">Both actions run a safe, read-only merge check against the selected repository — nothing is written to your repo here.</p>
                  <Show when={mergeRuns()?.length}>
                    <ul class="merge-runs">
                      <For each={mergeRuns()}>
                        {(run) => (
                          <li class={`run-${run.state.toLowerCase()}`}>
                            <strong>{run.state}</strong>
                            <span>{run.log}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section class="review-diff-section">
                  <h3>Changes ({review().source_branch} → {review().target_branch})</h3>
                  <Diff text={diff() ?? ""} loading={diff.loading} />
                </section>

                <section class="discussions">
                  <h3>Discussion</h3>
                  <ul>
                    <For each={discussions()}>
                      {(d) => (
                        <li classList={{ resolved: d.resolved }}>
                          <code>{d.file_path}{d.line_start ? `:${d.line_start}` : ""}</code>
                          <span class="resolved-tag">{d.resolved ? "resolved" : "open"}</span>
                          <button class="ghost small" onClick={() => toggleResolved(d)}>{d.resolved ? "Reopen" : "Resolve"}</button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <form class="new-discussion-form" onSubmit={addDiscussion}>
                    <input placeholder="file path" value={discFile()} onInput={(e) => setDiscFile(e.currentTarget.value)} />
                    <input placeholder="line #" type="number" value={discLine()} onInput={(e) => setDiscLine(e.currentTarget.value)} />
                    <input class="grow" placeholder="comment" value={discMessage()} onInput={(e) => setDiscMessage(e.currentTarget.value)} />
                    <button class="ghost">Add comment</button>
                  </form>
                </section>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
