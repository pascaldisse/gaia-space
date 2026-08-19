import { createResource, createSignal, createEffect, For, Show } from "solid-js";
import { api } from "../api";
import {
  reviewApi,
  newId,
  type Review,
  type ReviewDiscussion,
} from "../api/review";
import { Diff } from "../Diff";
import { useDeepLink, linkProps, route } from "../router";
import "./Reviews.css";

export default function Reviews() {
  const [error, setError] = createSignal<string | null>(null);

  const [profiles] = createResource(() => api.listProfiles());
  const [projects] = createResource(() => api.listProjects());
  const [repos] = createResource(() => api.repoList());

  const [actingProfileId, setActingProfileId] = createSignal("");
  createEffect(() => {
    if (!actingProfileId() && profiles()?.length) setActingProfileId(profiles()![0].id);
  });

  // ---------- create merge request ----------
  const [formProjectId, setFormProjectId] = createSignal("");
  const [formRepoPath, setFormRepoPath] = createSignal("");
  const [formSource, setFormSource] = createSignal("");
  const [formTarget, setFormTarget] = createSignal("");
  const [formTitle, setFormTitle] = createSignal("");
  const [formReviewers, setFormReviewers] = createSignal<string[]>([]);
  const [formBranches] = createResource(formRepoPath, (p) => (p ? api.repoBranches(p) : Promise.resolve([])));
  createEffect(() => {
    if (!formProjectId() && projects()?.length) setFormProjectId(projects()![0].id);
  });
  createEffect(() => {
    if (!formRepoPath() && repos()?.length) setFormRepoPath(repos()![0].path);
  });
  function toggleReviewer(id: string) {
    setFormReviewers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const [reviews, { refetch: refetchReviews }] = createResource(() => reviewApi.list());
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // Default to the first review once, on load only. After that the URL is the source of
  // truth for the selection, so back-navigating to the view-only URL (which clears the
  // selection below) must not trigger a re-select of the first review.
  let didAutoSelect = false;
  createEffect(() => {
    if (didAutoSelect) return;
    if (reviews()?.length) { didAutoSelect = true; if (!selectedId() && !route().entityId) setSelectedId(reviews()![0].id); }
  });
  const selected = (): Review | null => reviews()?.find((r) => r.id === selectedId()) ?? null;
  useDeepLink("review", (id) => setSelectedId(id), () => setSelectedId(null));

  async function createMR(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    if (!formProjectId() || !formRepoPath() || !formSource() || !formTarget() || !formTitle().trim() || !actingProfileId()) {
      setError("project, repo, both branches, title and acting profile are required");
      return;
    }
    try {
      const review = await reviewApi.openMergeRequest({
        id: newId("review"),
        project_id: formProjectId(),
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

  return (
    <section class="reviews-view">
      <header class="reviews-head">
        <div>
          <h1>Code Reviews</h1>
          <p>Merge requests on registered repos' real branches — quality gates, turn-based review, dry-run safe merge.</p>
        </div>
        <label>
          Acting as
          <select value={actingProfileId()} onChange={(e) => setActingProfileId(e.currentTarget.value)}>
            <For each={profiles()?.filter((p) => !p.archived)}>{(p) => <option value={p.id}>{p.display_name}</option>}</For>
          </select>
        </label>
      </header>

      <Show when={error()}>
        <div class="reviews-error" onClick={() => setError(null)}>{error()}</div>
      </Show>

      <form class="new-review-form" onSubmit={createMR}>
        <div class="new-review-row">
          <label>
            Project
            <select value={formProjectId()} onChange={(e) => setFormProjectId(e.currentTarget.value)}>
              <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
          </label>
          <label>
            Repo
            <select value={formRepoPath()} onChange={(e) => { setFormRepoPath(e.currentTarget.value); setFormSource(""); setFormTarget(""); }}>
              <For each={repos()}>{(r) => <option value={r.path}>{r.name}</option>}</For>
            </select>
          </label>
          <label>
            Source branch
            <select value={formSource()} onChange={(e) => setFormSource(e.currentTarget.value)}>
              <option value="">select…</option>
              <For each={formBranches()?.filter((b) => !b.remote)}>{(b) => <option value={b.name}>{b.name}</option>}</For>
            </select>
          </label>
          <label>
            Target branch
            <select value={formTarget()} onChange={(e) => setFormTarget(e.currentTarget.value)}>
              <option value="">select…</option>
              <For each={formBranches()?.filter((b) => !b.remote)}>{(b) => <option value={b.name}>{b.name}</option>}</For>
            </select>
          </label>
        </div>
        <div class="new-review-row">
          <input class="grow" placeholder="Title" value={formTitle()} onInput={(e) => setFormTitle(e.currentTarget.value)} />
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
          <button class="primary">Open merge request</button>
        </div>
      </form>

      <div class="reviews-body">
        <aside class="reviews-list">
          <Show when={reviews()?.length} fallback={<p class="hint pad">No reviews yet — open one above.</p>}>
            <ul>
              <For each={reviews()}>
                {(r) => (
                  <li classList={{ active: r.id === selectedId() }}>
                    <a class="row-link" {...linkProps({ view: "Code Reviews", entityType: "review", entityId: r.id })}>
                      <span class="num">#{r.number}</span>
                      <strong>{r.title}</strong>
                      <span class={`state state-${r.state.toLowerCase()}`}>{r.state}</span>
                      <span class="branches">{r.source_branch} → {r.target_branch}</span>
                    </a>
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
                <h2>#{review().number} {review().title}</h2>
                <span class={`state state-${review().state.toLowerCase()}`}>{review().state}</span>
                <label class="repo-picker">
                  Git actions repo
                  <select value={diffRepoPath()} onChange={(e) => setDiffRepoPath(e.currentTarget.value)}>
                    <For each={repos()}>{(r) => <option value={r.path}>{r.name}</option>}</For>
                  </select>
                </label>
              </header>

              <section class="participants">
                <h3>Participants</h3>
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
                            <button class="ghost small" onClick={() => setParticipantState(p.profile_id, "accepted")}>Accept</button>
                            <button class="ghost small" onClick={() => setParticipantState(p.profile_id, "rejected")}>Reject</button>
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
                <h3>Quality gate: {gateEval() ? (gateEval()!.satisfied ? "Satisfied" : "Blocking") : "…"}</h3>
                <Show when={gateEval() && !gateEval()!.satisfied}>
                  <ul><For each={gateEval()!.reasons}>{(reason) => <li>{reason}</li>}</For></ul>
                </Show>
                <p class="hint">{gateEval()?.approvals ?? 0} approval(s), matched {gateEval()?.matched_rules ?? 0} rule(s), needs {gateEval()?.min_approvals ?? 0}.</p>

                <details class="gate-rules">
                  <summary>Rules for this project ({gateRules()?.length ?? 0})</summary>
                  <ul>
                    <For each={gateRules()}>
                      {(rule) => (
                        <li>
                          <code>{rule.branch_pattern}</code> min {rule.min_approvals} approval(s)
                          <Show when={rule.codeowners_required}> · CODEOWNERS</Show>
                          <button class="ghost small" onClick={() => deleteRule(rule.id)}>×</button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <form class="new-rule-form" onSubmit={addRule}>
                    <input placeholder="branch pattern (e.g. main, release/*)" value={rulePattern()} onInput={(e) => setRulePattern(e.currentTarget.value)} />
                    <input type="number" min="0" value={ruleApprovals()} onInput={(e) => setRuleApprovals(Number(e.currentTarget.value))} />
                    <label><input type="checkbox" checked={ruleCodeowners()} onChange={(e) => setRuleCodeowners(e.currentTarget.checked)} /> CODEOWNERS</label>
                    <button class="ghost">Add rule</button>
                  </form>
                </details>
              </section>

              <section class="safe-merge">
                <h3>Safe merge</h3>
                <div class="safe-merge-actions">
                  <button onClick={runDryRun}>Dry run</button>
                  <button class="primary" onClick={runMerge}>Merge</button>
                </div>
                <p class="hint">Merge execution is disabled for safety: both buttons only ever run an in-memory dry-run check against the picked repo and never write to it. Real merges only happen in cargo tests against throwaway repos.</p>
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
                <h3>Diff ({review().source_branch} → {review().target_branch})</h3>
                <Diff text={diff() ?? ""} loading={diff.loading} />
              </section>

              <section class="discussions">
                <h3>Discussions</h3>
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
                  <button class="ghost">Add discussion</button>
                </form>
              </section>
            </section>
          )}
        </Show>
      </div>
    </section>
  );
}
