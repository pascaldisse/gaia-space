import {
  createResource,
  createSignal,
  createEffect,
  createMemo,
  For,
  Show,
} from "solid-js";
import { api } from "../api";
import {
  reviewApi,
  newId,
  type Review,
  type ReviewDiscussion,
  type ExternalCheckStatus,
  type ProtectedBranchRule,
  type RestackStep,
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
    if (!actingProfileId() && profiles()?.length)
      setActingProfileId(profiles()![0].id);
  });

  // ---------- create merge request ----------
  const [formProjectId, setFormProjectId] = createSignal("");
  const [formRepoPath, setFormRepoPath] = createSignal("");
  const [formSource, setFormSource] = createSignal("");
  const [formTarget, setFormTarget] = createSignal("");
  const [formTitle, setFormTitle] = createSignal("");
  const [formReviewers, setFormReviewers] = createSignal<string[]>([]);
  const [formBranches] = createResource(formRepoPath, (p) =>
    p ? api.repoBranches(p) : Promise.resolve([]),
  );
  createEffect(() => {
    if (!formProjectId() && projects()?.length)
      setFormProjectId(projects()![0].id);
  });
  createEffect(() => {
    if (!formRepoPath() && repos()?.length) setFormRepoPath(repos()![0].path);
  });
  function toggleReviewer(id: string) {
    setFormReviewers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const [reviews, { refetch: refetchReviews }] = createResource(() =>
    reviewApi.list(),
  );
  const [quickFilter, setQuickFilter] = createSignal<"all" | "open" | "mine" | "waiting">("all");
  const [reviewSort, setReviewSort] = createSignal<"number" | "title">("number");
  const [aggregatedStatuses] = createResource(
    () => ({ reviews: reviews() ?? [], profileId: actingProfileId() }),
    async ({ reviews, profileId }) => {
      if (!profileId) return {} as Record<string, string>;
      const entries = await Promise.all(reviews.map(async (review) => [review.id, await reviewApi.aggregatedStatus(review.id, profileId)] as const));
      return Object.fromEntries(entries);
    },
  );
  const visibleReviews = createMemo(() => {
    const statuses = aggregatedStatuses() ?? {};
    return (reviews() ?? []).filter((review) => {
      const status = statuses[review.id];
      return quickFilter() === "all" ||
        (quickFilter() === "open" && review.state === "Opened") ||
        (quickFilter() === "mine" && (status === "NEEDS_MY_REVIEW" || status === "NEEDS_MY_ATTENTION")) ||
        (quickFilter() === "waiting" && (status === "WAITING_FOR_REVIEW" || status === "WAITING_FOR_UPDATES"));
    }).sort((left, right) => reviewSort() === "title"
      ? left.title.localeCompare(right.title)
      : right.number - left.number);
  });
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // Default to the first review once, on load only. After that the URL is the source of
  // truth for the selection, so back-navigating to the view-only URL (which clears the
  // selection below) must not trigger a re-select of the first review.
  let didAutoSelect = false;
  createEffect(() => {
    if (didAutoSelect) return;
    if (reviews()?.length) {
      didAutoSelect = true;
      if (!selectedId() && !route().entityId) setSelectedId(reviews()![0].id);
    }
  });
  const selected = (): Review | null =>
    reviews()?.find((r) => r.id === selectedId()) ?? null;
  useDeepLink(
    "review",
    (id) => setSelectedId(id),
    () => setSelectedId(null),
  );

  async function createMR(e: SubmitEvent) {
    e.preventDefault();
    setError(null);
    if (
      !formProjectId() ||
      !formRepoPath() ||
      !formSource() ||
      !formTarget() ||
      !formTitle().trim() ||
      !actingProfileId()
    ) {
      setError(
        "project, repo, both branches, title and acting profile are required",
      );
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

  const [participants, { refetch: refetchParticipants }] = createResource(
    selectedId,
    (id) => (id ? reviewApi.listParticipants(id) : Promise.resolve([])),
  );
  const [discussions, { refetch: refetchDiscussions }] = createResource(
    selectedId,
    (id) => (id ? reviewApi.listDiscussions(id) : Promise.resolve([])),
  );
  const [gateRules, { refetch: refetchGateRules }] = createResource(
    () => selected()?.project_id,
    (id) => (id ? reviewApi.listGateRules(id) : Promise.resolve([])),
  );
  const [gateEval, { refetch: refetchGateEval }] = createResource(
    selectedId,
    (id) => (id ? reviewApi.evaluateGate(id) : Promise.resolve(null)),
  );
  const [protectedRules, { refetch: refetchProtectedRules }] = createResource(
    () => selected()?.project_id,
    (id) => (id ? reviewApi.listProtectedBranchRules(id) : Promise.resolve([])),
  );
  const [mergeRuns, { refetch: refetchMergeRuns }] = createResource(
    selectedId,
    (id) => (id ? reviewApi.listMergeRuns(id) : Promise.resolve([])),
  );
  const [externalIssueLinks, { refetch: refetchExternalIssueLinks }] = createResource(
    selectedId,
    (id) => (id ? reviewApi.listExternalIssueLinks(id) : Promise.resolve([])),
  );
  const [externalChecks, { refetch: refetchExternalChecks }] = createResource(
    selectedId,
    (id) => (id ? reviewApi.listExternalChecks(id) : Promise.resolve([])),
  );
  const diffKey = () => {
    const r = selected();
    const p = diffRepoPath();
    return r && p && r.source_branch && r.target_branch
      ? { p, s: r.source_branch, t: r.target_branch }
      : null;
  };
  const [diff] = createResource(diffKey, (k) => reviewApi.diff(k.p, k.s, k.t));
  const [ownedOnly, setOwnedOnly] = createSignal(false);
  const [ownedFiles] = createResource(
    () => ({ reviewId: selectedId(), profileId: actingProfileId() }),
    ({ reviewId, profileId }) => reviewId && profileId
      ? reviewApi.listOwnedFiles(reviewId, profileId)
      : Promise.resolve([]),
  );
  const [navigationFile, setNavigationFile] = createSignal<string | null>(null);
  const [navigationNotice, setNavigationNotice] = createSignal("");
  let unresolvedCursor = -1;
  let fileCursor = -1;
  function changedFiles() {
    return [...new Set((diff() ?? "").split("\n").flatMap((line) => {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      return match ? [match[2]] : [];
    }))];
  }
  function jumpToNextUnresolved() {
    const open = (discussions() ?? []).filter((item) => !item.resolved);
    if (!open.length) { setNavigationNotice("No unresolved discussions."); return; }
    unresolvedCursor = (unresolvedCursor + 1) % open.length;
    const item = open[unresolvedCursor];
    setNavigationNotice(`Unresolved ${unresolvedCursor + 1}/${open.length}: ${item.file_path}${item.line_start ? `:${item.line_start}` : ""}`);
    requestAnimationFrame(() => document.getElementById(`discussion-${item.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  function jumpToNextFile() {
    const files = changedFiles();
    if (!files.length) { setNavigationNotice("No changed files in this diff."); return; }
    fileCursor = (fileCursor + 1) % files.length;
    const file = files[fileCursor];
    setNavigationFile(null);
    requestAnimationFrame(() => setNavigationFile(file));
    setNavigationNotice(`File ${fileCursor + 1}/${files.length}: ${file}`);
  }

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
  const [suggestionContent, setSuggestionContent] = createSignal("");
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
        suggestion_commit_id: selected()?.source_branch ?? null,
        suggestion_content: suggestionContent().trim() || null,
        suggestion_has_conflicts: false,
        suggestion_identical_contents: null,
      });
      setDiscFile("");
      setDiscLine("");
      setDiscMessage("");
      setSuggestionContent("");
      refetchDiscussions();
    } catch (err) {
      setError(String(err));
    }
  }
  async function setSuggestionStatus(d: ReviewDiscussion, status: "OPEN" | "ACCEPTED" | "REJECTED") {
    if (!actingProfileId()) return;
    try {
      await reviewApi.setSuggestedEditStatus(d.id, status, actingProfileId());
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
  // Comma-separated check names the gate must wait for even before they report.
  const [ruleChecks, setRuleChecks] = createSignal("");
  const [ruleApplications, setRuleApplications] = createSignal("");
  const [ruleRoles, setRuleRoles] = createSignal("");
  function jsonList(value: string): string | null {
    const values = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length ? JSON.stringify(values) : null;
  }
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
        applications_json: jsonList(ruleApplications()),
        roles_json: jsonList(ruleRoles()),
        external_checks_json: (() => {
          const names = ruleChecks()
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
          return names.length ? JSON.stringify(names) : null;
        })(),
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
  // ---------- protected branches ----------
  const [protectionPattern, setProtectionPattern] = createSignal("main");
  const [protectionRegex, setProtectionRegex] = createSignal(false);
  const [protectionCreate, setProtectionCreate] = createSignal("");
  const [protectionPush, setProtectionPush] = createSignal("");
  const [protectionDelete, setProtectionDelete] = createSignal("");
  const [protectionForcePush, setProtectionForcePush] = createSignal("");
  const [protectionMerge, setProtectionMerge] = createSignal("");
  const [protectionBypass, setProtectionBypass] = createSignal("");
  const [protectionLinear, setProtectionLinear] = createSignal(false);
  async function saveProtection(e: SubmitEvent) {
    e.preventDefault();
    const projectId = selected()?.project_id;
    if (!projectId) return;
    const rule: ProtectedBranchRule = {
      id: newId("protection"), project_id: projectId,
      branch_pattern: protectionPattern().trim() || "*", regex: protectionRegex(),
      allow_create_json: jsonList(protectionCreate()), allow_push_json: jsonList(protectionPush()),
      allow_delete_json: jsonList(protectionDelete()), allow_force_push_json: jsonList(protectionForcePush()),
      allow_merge_json: jsonList(protectionMerge()), linear_history: protectionLinear(),
      bypass_quality_gate_json: jsonList(protectionBypass()),
    };
    try {
      await reviewApi.saveProtectedBranchRule(rule);
      setProtectionCreate(""); setProtectionPush(""); setProtectionDelete("");
      setProtectionForcePush(""); setProtectionMerge(""); setProtectionBypass("");
      refetchProtectedRules();
    } catch (err) { setError(String(err)); }
  }
  async function deleteProtection(id: string) {
    try { await reviewApi.deleteProtectedBranchRule(id); refetchProtectedRules(); }
    catch (err) { setError(String(err)); }
  }

  // ---------- stacked merge requests (cherry-pick / restack) ----------
  const [stacks, { refetch: refetchStacks }] = createResource(
    () => selected()?.project_id,
    (id) => (id ? reviewApi.listStacks(id) : Promise.resolve([])),
  );
  const [restackSteps, setRestackSteps] = createSignal<RestackStep[]>([]);
  const [pickOid, setPickOid] = createSignal("");
  async function runRestack(stackId: string, dryRun: boolean) {
    try {
      setRestackSteps(await reviewApi.restackStack(stackId, dryRun));
      if (!dryRun) refetchStacks();
    } catch (err) {
      setError(String(err));
    }
  }
  // Dissolves the stack; the member merge requests stay open.
  async function removeStack(stackId: string) {
    try {
      await reviewApi.removeStack(stackId);
      setRestackSteps([]);
      refetchStacks();
    } catch (err) {
      setError(String(err));
    }
  }
  async function runCherryPick(e: SubmitEvent) {
    e.preventDefault();
    const id = selectedId();
    if (!id || !pickOid().trim()) return;
    try {
      const step = await reviewApi.stackCherryPick(id, pickOid().trim());
      setRestackSteps([step]);
      setPickOid("");
    } catch (err) {
      setError(String(err));
    }
  }

  // ---------- external issue links (canonical URLs stay in their tracker) ----------
const [externalIssueUrl, setExternalIssueUrl] = createSignal("");
const [externalIssueTitle, setExternalIssueTitle] = createSignal("");
async function addExternalIssueLink(e: SubmitEvent) {
  e.preventDefault();
  const reviewId = selectedId();
  if (!reviewId || !externalIssueUrl().trim()) return;
  try {
    await reviewApi.createExternalIssueLink({
      id: newId("external-issue"), review_id: reviewId,
      external_url: externalIssueUrl().trim(), title: externalIssueTitle().trim() || null,
    });
    setExternalIssueUrl(""); setExternalIssueTitle("");
    refetchExternalIssueLinks();
  } catch (err) { setError(String(err)); }
}
async function removeExternalIssueLink(id: string) {
  try { await reviewApi.deleteExternalIssueLink(id); refetchExternalIssueLinks(); }
  catch (err) { setError(String(err)); }
}
// ---------- external checks (CI/scanners report in; the gate waits on non-SUCCEEDED) ----------
  const [checkName, setCheckName] = createSignal("");
  const [checkStatus, setCheckStatus] =
    createSignal<ExternalCheckStatus>("PENDING");
  const [checkDetails, setCheckDetails] = createSignal("");
  async function recordCheck(e: SubmitEvent) {
    e.preventDefault();
    const id = selectedId();
    if (!id || !checkName().trim()) return;
    try {
      await reviewApi.recordExternalCheck({
        review_id: id,
        check_name: checkName().trim(),
        status: checkStatus(),
        details: checkDetails().trim() || null,
        updated_at: 0,
      });
      setCheckName("");
      setCheckDetails("");
      refetchExternalChecks();
      refetchGateEval();
    } catch (err) {
      setError(String(err));
    }
  }
  async function deleteCheck(name: string) {
    const id = selectedId();
    if (!id) return;
    try {
      await reviewApi.deleteExternalCheck(id, name);
      refetchExternalChecks();
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
      await reviewApi.dryRunMerge(
        newId("merge"),
        p,
        r.id,
        r.source_branch,
        r.target_branch,
      );
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
      await reviewApi.attemptMerge(
        newId("merge"),
        p,
        r.id,
        r.source_branch,
        r.target_branch,
        actingProfileId(),
      );
      refetchMergeRuns();
      refetchReviews();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section class="reviews-view">
      <header class="reviews-head">
        <div>
          <h1>Code Reviews</h1>
          <p>
            Merge requests on registered repos' real branches — quality gates,
            turn-based review, dry-run safe merge.
          </p>
        </div>
        <label>
          Acting as
          <select
            value={actingProfileId()}
            onChange={(e) => setActingProfileId(e.currentTarget.value)}
          >
            <For each={profiles()?.filter((p) => !p.archived)}>
              {(p) => <option value={p.id}>{p.display_name}</option>}
            </For>
          </select>
        </label>
      </header>

      <Show when={error()}>
        <div class="reviews-error" onClick={() => setError(null)}>
          {error()}
        </div>
      </Show>

      <form class="new-review-form" onSubmit={createMR}>
        <div class="new-review-row">
          <label>
            Project
            <select
              value={formProjectId()}
              onChange={(e) => setFormProjectId(e.currentTarget.value)}
            >
              <For each={projects()}>
                {(p) => <option value={p.id}>{p.name}</option>}
              </For>
            </select>
          </label>
          <label>
            Repo
            <select
              value={formRepoPath()}
              onChange={(e) => {
                setFormRepoPath(e.currentTarget.value);
                setFormSource("");
                setFormTarget("");
              }}
            >
              <For each={repos()}>
                {(r) => <option value={r.path}>{r.name}</option>}
              </For>
            </select>
          </label>
          <label>
            Source branch
            <select
              value={formSource()}
              onChange={(e) => setFormSource(e.currentTarget.value)}
            >
              <option value="">select…</option>
              <For each={formBranches()?.filter((b) => !b.remote)}>
                {(b) => <option value={b.name}>{b.name}</option>}
              </For>
            </select>
          </label>
          <label>
            Target branch
            <select
              value={formTarget()}
              onChange={(e) => setFormTarget(e.currentTarget.value)}
            >
              <option value="">select…</option>
              <For each={formBranches()?.filter((b) => !b.remote)}>
                {(b) => <option value={b.name}>{b.name}</option>}
              </For>
            </select>
          </label>
        </div>
        <div class="new-review-row">
          <input
            class="grow"
            placeholder="Title"
            value={formTitle()}
            onInput={(e) => setFormTitle(e.currentTarget.value)}
          />
          <div class="reviewer-picks">
            <span class="hint">Reviewers:</span>
            <For
              each={profiles()?.filter(
                (p) => p.id !== actingProfileId() && !p.archived,
              )}
            >
              {(p) => (
                <label class="reviewer-pick">
                  <input
                    type="checkbox"
                    checked={formReviewers().includes(p.id)}
                    onChange={() => toggleReviewer(p.id)}
                  />
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
          <div class="review-list-controls">
            <div class="quick-filters" aria-label="Review quick filters">
              <For each={["all", "open", "mine", "waiting"] as const}>
                {(filter) => <button type="button" classList={{ active: quickFilter() === filter }} onClick={() => setQuickFilter(filter)}>{filter === "mine" ? "Needs me" : filter}</button>}
              </For>
            </div>
            <label>Sort <select value={reviewSort()} onChange={(event) => setReviewSort(event.currentTarget.value as "number" | "title")}><option value="number">Newest</option><option value="title">Title</option></select></label>
          </div>
          <Show
            when={visibleReviews().length}
            fallback={<p class="hint pad">No reviews match this filter.</p>}
          >
            <ul>
              <For each={visibleReviews()}>
                {(r) => (
                  <li classList={{ active: r.id === selectedId() }}>
                    <a
                      class="row-link"
                      {...linkProps({
                        view: "Code Reviews",
                        entityType: "review",
                        entityId: r.id,
                      })}
                    >
                      <span class="num">#{r.number}</span>
                      <strong>{r.title}</strong>
                      <span class={`state state-${r.state.toLowerCase()}`}>
                        {r.state}
                      </span>
                      <span class="branches">
                        {r.source_branch} → {r.target_branch}
                      </span>
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        <Show
          when={selected()}
          fallback={<p class="hint pad">Select or open a review.</p>}
        >
          {(review) => (
            <section class="review-detail">
              <header class="review-detail-head">
                <h2>
                  #{review().number} {review().title}
                </h2>
                <span class={`state state-${review().state.toLowerCase()}`}>
                  {review().state}
                </span>
                <label class="repo-picker">
                  Git actions repo
                  <select
                    value={diffRepoPath()}
                    onChange={(e) => setDiffRepoPath(e.currentTarget.value)}
                  >
                    <For each={repos()}>
                      {(r) => <option value={r.path}>{r.name}</option>}
                    </For>
                  </select>
                </label>
              </header>

              <section class="participants">
                <h3>Participants</h3>
                <ul>
                  <For each={participants()}>
                    {(p) => {
                      const profile = () =>
                        profiles()?.find((pr) => pr.id === p.profile_id);
                      return (
                        <li>
                          <strong>
                            {profile()?.display_name ?? p.profile_id}
                          </strong>
                          <span class="role">{p.role}</span>
                          <span class={`pstate pstate-${p.state ?? "waiting"}`}>
                            {p.state ?? "waiting"}
                          </span>
                          <Show when={p.their_turn}>
                            <span class="turn">their turn</span>
                          </Show>
                          <Show when={p.role === "Reviewer"}>
                            <button
                              class="ghost small"
                              onClick={() =>
                                setParticipantState(p.profile_id, "accepted")
                              }
                            >
                              Accept
                            </button>
                            <button
                              class="ghost small"
                              onClick={() =>
                                setParticipantState(p.profile_id, "rejected")
                              }
                            >
                              Reject
                            </button>
                          </Show>
                          <Show when={p.role === "Author"}>
                            <button
                              class="ghost small"
                              onClick={() =>
                                setParticipantState(p.profile_id, null)
                              }
                            >
                              Resume work
                            </button>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>

              <section
                class="gate-banner"
                classList={{
                  ok: gateEval()?.satisfied,
                  blocked: gateEval() ? !gateEval()!.satisfied : false,
                }}
              >
                <h3>
                  Quality gate:{" "}
                  {gateEval()
                    ? gateEval()!.satisfied
                      ? "Satisfied"
                      : "Blocking"
                    : "…"}
                </h3>
                <Show when={gateEval() && !gateEval()!.satisfied}>
                  <ul>
                    <For each={gateEval()!.reasons}>
                      {(reason) => <li>{reason}</li>}
                    </For>
                  </ul>
                </Show>
                <p class="hint">
                  {gateEval()?.approvals ?? 0} approval(s), matched{" "}
                  {gateEval()?.matched_rules ?? 0} rule(s), needs{" "}
                  {gateEval()?.min_approvals ?? 0}.
                </p>
                <Show when={gateEval()?.required_checks.length}>
                  <p class="hint">
                    Required checks: {gateEval()!.required_checks.join(", ")}
                  </p>
                </Show>
                <Show when={gateEval()?.codeowner_paths.length}>
                  <p class="hint">
                    CODEOWNERS: {gateEval()!.codeowner_paths.join(", ")} ·
                    resolved approvers:{" "}
                    {gateEval()!.codeowner_approvers.join(", ") || "none"}
                  </p>
                </Show>

                <details class="gate-rules">
                  <summary>
                    Rules for this project ({gateRules()?.length ?? 0})
                  </summary>
                  <ul>
                    <For each={gateRules()}>
                      {(rule) => (
                        <li>
                          <code>{rule.branch_pattern}</code> min{" "}
                          {rule.min_approvals} approval(s)
                          <Show when={rule.codeowners_required}>
                            {" "}
                            · CODEOWNERS
                          </Show>
                          <Show when={rule.external_checks_json}>
                            {" "}
                            · checks:{" "}
                            {(
                              JSON.parse(rule.external_checks_json!) as string[]
                            ).join(", ")}
                          </Show>
                          <Show when={rule.applications_json}>
                            {" "}
                            · applications:{" "}
                            {(
                              JSON.parse(rule.applications_json!) as string[]
                            ).join(", ")}
                          </Show>
                          <Show when={rule.roles_json}>
                            {" "}
                            · roles:{" "}
                            {(JSON.parse(rule.roles_json!) as string[]).join(
                              ", ",
                            )}
                          </Show>
                          <button
                            class="ghost small"
                            onClick={() => deleteRule(rule.id)}
                          >
                            ×
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <form class="new-rule-form" onSubmit={addRule}>
                    <input
                      placeholder="branch pattern (e.g. main, release/*)"
                      value={rulePattern()}
                      onInput={(e) => setRulePattern(e.currentTarget.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      value={ruleApprovals()}
                      onInput={(e) =>
                        setRuleApprovals(Number(e.currentTarget.value))
                      }
                    />
                    <label>
                      <input
                        type="checkbox"
                        checked={ruleCodeowners()}
                        onChange={(e) =>
                          setRuleCodeowners(e.currentTarget.checked)
                        }
                      />{" "}
                      CODEOWNERS
                    </label>
                    <input
                      class="grow"
                      placeholder="required checks (comma separated, e.g. ci/build, ci/test)"
                      value={ruleChecks()}
                      onInput={(e) => setRuleChecks(e.currentTarget.value)}
                    />
                    <input
                      placeholder="application ids (comma separated)"
                      value={ruleApplications()}
                      onInput={(e) =>
                        setRuleApplications(e.currentTarget.value)
                      }
                    />
                    <input
                      placeholder="role ids (comma separated)"
                      value={ruleRoles()}
                      onInput={(e) => setRuleRoles(e.currentTarget.value)}
                    />
                    <button class="ghost">Add rule</button>
                  </form>
                </details>

                <details class="gate-rules protected-branches">
                  <summary>Protected branches ({protectedRules()?.length ?? 0})</summary>
                  <p class="hint">Matching rules compose restrictively; empty lists deny. Merge permission is enforced now; direct branch mutation UI is not available.</p>
                  <ul>
                    <For each={protectedRules()}>
                      {(rule) => (
                        <li>
                          <code>{rule.branch_pattern}</code>
                          {rule.regex ? " · regex" : " · glob"}
                          {rule.linear_history ? " · linear history" : ""}
                          {rule.allow_merge_json
                            ? ` · merge: ${(JSON.parse(rule.allow_merge_json) as string[]).join(", ")}`
                            : " · merge: nobody"}
                          <button class="ghost small" onClick={() => deleteProtection(rule.id)}>×</button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <form class="new-rule-form" onSubmit={saveProtection}>
                    <input placeholder="branch pattern" value={protectionPattern()} onInput={(e) => setProtectionPattern(e.currentTarget.value)} />
                    <label><input type="checkbox" checked={protectionRegex()} onChange={(e) => setProtectionRegex(e.currentTarget.checked)} /> regex</label>
                    <label><input type="checkbox" checked={protectionLinear()} onChange={(e) => setProtectionLinear(e.currentTarget.checked)} /> linear history</label>
                    <input placeholder="create principals" value={protectionCreate()} onInput={(e) => setProtectionCreate(e.currentTarget.value)} />
                    <input placeholder="push principals" value={protectionPush()} onInput={(e) => setProtectionPush(e.currentTarget.value)} />
                    <input placeholder="delete principals" value={protectionDelete()} onInput={(e) => setProtectionDelete(e.currentTarget.value)} />
                    <input placeholder="force-push principals" value={protectionForcePush()} onInput={(e) => setProtectionForcePush(e.currentTarget.value)} />
                    <input placeholder="merge principals" value={protectionMerge()} onInput={(e) => setProtectionMerge(e.currentTarget.value)} />
                    <input placeholder="gate-bypass principals" value={protectionBypass()} onInput={(e) => setProtectionBypass(e.currentTarget.value)} />
                    <button class="ghost">Protect branch</button>
                  </form>
                </details>

                <section class="external-issue-links">
<h3>External issues ({externalIssueLinks()?.length ?? 0})</h3>
<ul>
<For each={externalIssueLinks()} fallback={<li class="hint">No external issues linked.</li>}>
{(link) => <li><a href={link.external_url} target="_blank" rel="noopener noreferrer">{link.title || link.external_url}</a><button class="ghost small" aria-label={`Remove external issue ${link.title || link.external_url}`} onClick={() => removeExternalIssueLink(link.id)}>×</button></li>}
</For>
</ul>
<form class="new-rule-form" onSubmit={addExternalIssueLink}>
<input class="grow" type="url" placeholder="https://tracker.example/PROJ-42" value={externalIssueUrl()} onInput={(e) => setExternalIssueUrl(e.currentTarget.value)} />
<input placeholder="Issue title (optional)" value={externalIssueTitle()} onInput={(e) => setExternalIssueTitle(e.currentTarget.value)} />
<button class="ghost">Link issue</button>
</form>
</section>
<details class="gate-rules external-checks" open>
                  <summary>
                    External checks ({externalChecks()?.length ?? 0})
                  </summary>
                  <ul>
                    <For
                      each={externalChecks()}
                      fallback={
                        <li class="hint">No external checks reported.</li>
                      }
                    >
                      {(check) => (
                        <li>
                          <span
                            class={`check-status check-${check.status.toLowerCase()}`}
                          >
                            {check.status}
                          </span>
                          <code>{check.check_name}</code>
                          <Show when={check.details}>
                            <span class="hint">{check.details}</span>
                          </Show>
                          <button
                            class="ghost small"
                            onClick={() => deleteCheck(check.check_name)}
                          >
                            ×
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                  <form class="new-rule-form" onSubmit={recordCheck}>
                    <input
                      placeholder="check name (e.g. ci/build)"
                      value={checkName()}
                      onInput={(e) => setCheckName(e.currentTarget.value)}
                    />
                    <select
                      value={checkStatus()}
                      onChange={(e) =>
                        setCheckStatus(
                          e.currentTarget.value as ExternalCheckStatus,
                        )
                      }
                    >
                      <option value="PENDING">pending</option>
                      <option value="SUCCEEDED">success</option>
                      <option value="FAILED">failure</option>
                    </select>
                    <input
                      class="grow"
                      placeholder="details (optional)"
                      value={checkDetails()}
                      onInput={(e) => setCheckDetails(e.currentTarget.value)}
                    />
                    <button class="ghost">Report check</button>
                  </form>
                </details>
              </section>

              <section class="review-stacks">
                <h3>Stack</h3>
                <p class="hint">
                  Restack replays each member onto its predecessor's new tip
                  through libgit2's in-memory index, then moves the branch refs
                  — the working directory is never touched. A conflicting member
                  stops the run before any ref below it moves.
                </p>
                <ul class="stack-list">
                  <For
                    each={stacks()?.filter((s) =>
                      s.review_ids.includes(review().id),
                    )}
                    fallback={
                      <li class="hint">
                        This merge request is not in a stack.
                      </li>
                    }
                  >
                    {(stack) => (
                      <li>
                        <code>
                          {stack.source_branch} → {stack.target_branch}
                        </code>
                        <span class="hint">
                          {stack.review_ids.length} member(s)
                        </span>
                        <button
                          class="ghost small"
                          onClick={() => runRestack(stack.id, true)}
                        >
                          Preview restack
                        </button>
                        <button
                          class="ghost small"
                          onClick={() => runRestack(stack.id, false)}
                        >
                          Restack
                        </button>
                        <button
                          class="ghost small"
                          onClick={() => removeStack(stack.id)}
                        >
                          Unstack
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <form class="new-rule-form" onSubmit={runCherryPick}>
                  <input
                    class="grow"
                    placeholder="commit sha to cherry-pick onto this MR's source branch"
                    value={pickOid()}
                    onInput={(e) => setPickOid(e.currentTarget.value)}
                  />
                  <button class="ghost">Cherry-pick</button>
                </form>
                <Show when={restackSteps().length}>
                  <ul class="restack-steps">
                    <For each={restackSteps()}>
                      {(step) => (
                        <li
                          classList={{ conflicted: step.conflicts.length > 0 }}
                        >
                          <code>{step.branch}</code> onto{" "}
                          <code>{step.onto_branch}</code>
                          <span class="hint">
                            {step.conflicts.length
                              ? `conflicts: ${step.conflicts.join(", ")}`
                              : `${step.replayed.length} commit(s) ${step.applied ? "replayed" : "planned"}${step.new_tip ? ` → ${step.new_tip.slice(0, 8)}` : ""}`}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>

              <section class="safe-merge">
                <h3>Safe merge</h3>
                <div class="safe-merge-actions">
                  <button onClick={runDryRun}>Dry run</button>
                  <button class="primary" onClick={runMerge}>
                    Merge
                  </button>
                </div>
                <p class="hint">
                  Dry run snapshots both branch tips and waits for green project
                  CI. Merge rechecks CI and both refs, then writes only the
                  target ref—never the worktree.
                </p>
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
                <h3>
                  Diff ({review().source_branch} → {review().target_branch})
                </h3>
                <div class="review-navigation">
                  <button class="ghost small" type="button" onClick={jumpToNextUnresolved}>Next unresolved</button>
                  <button class="ghost small" type="button" onClick={jumpToNextFile}>Next file</button>
                  <label class="owned-files-filter"><input type="checkbox" checked={ownedOnly()} disabled={!ownedFiles()?.length} onChange={(event) => setOwnedOnly(event.currentTarget.checked)} /> My owned files ({ownedFiles()?.length ?? 0})</label>
                  <span class="hint" aria-live="polite">{navigationNotice()}</span>
                </div>
                <Show when={ownedOnly() && !ownedFiles()?.length}><p class="hint">No changed files are assigned to you by source-branch CODEOWNERS.</p></Show>
                <Diff text={diff() ?? ""} loading={diff.loading} focusFile={navigationFile()} ownedFiles={ownedFiles()} ownedOnly={ownedOnly()} />
              </section>

              <section class="discussions">
                <h3>Discussions</h3>
                <ul>
                  <For each={discussions()}>
                    {(d) => (
                      <li id={`discussion-${d.id}`} classList={{ resolved: d.resolved }}>
                        <code>
                          {d.file_path}
                          {d.line_start ? `:${d.line_start}` : ""}
                        </code>
                        <span class="resolved-tag">
                          {d.resolved ? "resolved" : "open"}
                        </span>
                        <Show when={d.suggestion_status}>
                          <span class="hint">suggestion: {d.suggestion_status}</span>
                          <Show when={d.suggestion_status === "OPEN"}>
                            <button class="ghost small" onClick={() => setSuggestionStatus(d, "ACCEPTED")}>Accept edit</button>
                            <button class="ghost small" onClick={() => setSuggestionStatus(d, "REJECTED")}>Reject edit</button>
                          </Show>
                          <Show when={d.suggestion_status !== "OPEN"}>
                            <button class="ghost small" onClick={() => setSuggestionStatus(d, "OPEN")}>Reopen edit</button>
                          </Show>
                        </Show>
                        <button class="ghost small" onClick={() => toggleResolved(d)}>
                          {d.resolved ? "Reopen" : "Resolve"}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
                <form class="new-discussion-form" onSubmit={addDiscussion}>
                  <input
                    placeholder="file path"
                    value={discFile()}
                    onInput={(e) => setDiscFile(e.currentTarget.value)}
                  />
                  <input
                    placeholder="line #"
                    type="number"
                    value={discLine()}
                    onInput={(e) => setDiscLine(e.currentTarget.value)}
                  />
                  <input
                    class="grow"
                    placeholder="comment"
                    value={discMessage()}
                    onInput={(e) => setDiscMessage(e.currentTarget.value)}
                  />
                  <input
                    class="grow"
                    placeholder="suggested replacement (optional)"
                    value={suggestionContent()}
                    onInput={(e) => setSuggestionContent(e.currentTarget.value)}
                  />
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
