import {
  createResource,
  createSignal,
  createEffect,
  createMemo,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import PageHeader, { Chip } from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import { Icon } from "../components/Icon";
import { GhostPill, PillSelect } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { profileId } from "../session";
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
import "../components/WorkItemDrawer.css";
import "./Reviews.css";

/** The quick filters name themselves in the product's voice: a control's label
 *  is a word, not the wire value that happens to back it. */
const QUICK_FILTER_LABELS = { all: "All", open: "Open", mine: "Needs me", waiting: "Waiting" } as const;

export default function Reviews() {
  const [error, setError] = createSignal<string | null>(null);

  const [profiles] = createResource(() => api.listProfiles());
  const [projects] = createResource(() => api.listProjects());
  const [repos] = createResource(() => api.repoList());

  // L1: identity is INHERITED from the shell (`SpaceShell` owns the one "Acting
  // as" control). The local signal stays because every git-side call below is
  // performed *as* somebody; it is now fed, never asked for. The first profile
  // remains the fallback for the case where the session has not resolved yet.
  const [actingProfileId, setActingProfileId] = createSignal("");
  createEffect(() => {
    const own = profileId();
    if (own) { if (actingProfileId() !== own) setActingProfileId(own); return; }
    if (!actingProfileId() && profiles()?.length)
      setActingProfileId(profiles()![0].id);
  });
  /* L3: creating a merge request is a drawer, not a band across the surface. */
  const [creating, setCreating] = createSignal(false);

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
  // Header metric. A count carries NO tone — `0 open` must read as a fact, not
  // as an alarm, so this is a plain Chip and never a coloured one.
  const openCount = createMemo(() => (reviews() ?? []).filter((review) => review.state === "Opened").length);
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
      setCreating(false);
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
  const [externalLinks, { refetch: refetchExternalLinks }] = createResource(
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
      if (status === "ACCEPTED") await reviewApi.applySuggestedEdit(d.id, actingProfileId());
      else await reviewApi.setSuggestedEditStatus(d.id, status, actingProfileId());
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
  const [editingProtectionId, setEditingProtectionId] = createSignal<string | null>(null);
  const [protectionPattern, setProtectionPattern] = createSignal("main");
  const [protectionRegex, setProtectionRegex] = createSignal(false);
  const [protectionCreate, setProtectionCreate] = createSignal("");
  const [protectionPush, setProtectionPush] = createSignal("");
  const [protectionDelete, setProtectionDelete] = createSignal("");
  const [protectionForcePush, setProtectionForcePush] = createSignal("");
  const [protectionMerge, setProtectionMerge] = createSignal("");
  const [protectionBypass, setProtectionBypass] = createSignal("");
  const [protectionLinear, setProtectionLinear] = createSignal(false);
  function principalList(json: string | null): string {
    try { return json ? (JSON.parse(json) as string[]).join(", ") : ""; }
    catch { return ""; }
  }
  function editProtection(rule: ProtectedBranchRule) {
    setEditingProtectionId(rule.id);
    setProtectionPattern(rule.branch_pattern); setProtectionRegex(rule.regex);
    setProtectionCreate(principalList(rule.allow_create_json));
    setProtectionPush(principalList(rule.allow_push_json));
    setProtectionDelete(principalList(rule.allow_delete_json));
    setProtectionForcePush(principalList(rule.allow_force_push_json));
    setProtectionMerge(principalList(rule.allow_merge_json));
    setProtectionBypass(principalList(rule.bypass_quality_gate_json));
    setProtectionLinear(rule.linear_history);
  }
  function resetProtectionForm() {
    setEditingProtectionId(null); setProtectionPattern("main"); setProtectionRegex(false);
    setProtectionCreate(""); setProtectionPush(""); setProtectionDelete("");
    setProtectionForcePush(""); setProtectionMerge(""); setProtectionBypass("");
    setProtectionLinear(false);
  }
  async function saveProtection(e: SubmitEvent) {
    e.preventDefault();
    const projectId = selected()?.project_id;
    if (!projectId) return;
    const rule: ProtectedBranchRule = {
      id: editingProtectionId() ?? newId("protection"), project_id: projectId,
      branch_pattern: protectionPattern().trim() || "*", regex: protectionRegex(),
      allow_create_json: jsonList(protectionCreate()), allow_push_json: jsonList(protectionPush()),
      allow_delete_json: jsonList(protectionDelete()), allow_force_push_json: jsonList(protectionForcePush()),
      allow_merge_json: jsonList(protectionMerge()), linear_history: protectionLinear(),
      bypass_quality_gate_json: jsonList(protectionBypass()),
    };
    try { await reviewApi.saveProtectedBranchRule(rule); resetProtectionForm(); refetchProtectedRules(); }
    catch (err) { setError(String(err)); }
  }
  async function deleteProtection(id: string) {
    try {
      await reviewApi.deleteProtectedBranchRule(id);
      if (editingProtectionId() === id) resetProtectionForm();
      refetchProtectedRules();
    } catch (err) { setError(String(err)); }
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

  // ---------- external links (canonical URLs stay in their tracker) ----------
const [externalLinkUrl, setExternalLinkUrl] = createSignal("");
const [externalLinkTitle, setExternalLinkTitle] = createSignal("");
async function addExternalLink(e: SubmitEvent) {
  e.preventDefault();
  const reviewId = selectedId();
  if (!reviewId || !externalLinkUrl().trim()) return;
  try {
    await reviewApi.createExternalIssueLink({
      id: newId("external-issue"), review_id: reviewId,
      external_url: externalLinkUrl().trim(), title: externalLinkTitle().trim() || null,
    });
    setExternalLinkUrl(""); setExternalLinkTitle("");
    refetchExternalLinks();
  } catch (err) { setError(String(err)); }
}
async function removeExternalLink(id: string) {
  try { await reviewApi.deleteExternalIssueLink(id); refetchExternalLinks(); }
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
      {/* One header. The old `reviews-head` under it existed only to ask again
          who you are — the shell already says so. A metric chip carries no tone,
          so `0 open` is a number and not a colour. */}
      {/* The title is the name the navigation uses — the rail says "Pull
          requests", so the page cannot call itself something else. The view's
          ROUTE id stays `Code Reviews`; that is a wire key, not a word on
          screen.

          ONE ACTION, ONE PLACE: while the list is empty its empty state carries
          "Open merge request", so the header does not draw the same act twice. */}
      <PageHeader
        icon="review"
        title="Pull requests"
        subline="Merge requests on real repository branches"
        chips={<Chip value={openCount()} label="open" />}
      />

      {/* THE ACTION ROW (PageHeader.css `.page-actionbar`). Opening a merge request
          MAKES something, so it leads on the left; the quick filters and the sort
          only change what the list shows, so they sit at the view-control end — they
          used to be a second control block wedged inside the 260px list column.
          While nothing exists the empty lead below carries the act, and a filter over
          an empty universe controls nothing, so the whole row is not drawn. */}
      <Show when={reviews()?.length}>
        <nav class="page-actionbar" aria-label="Merge request actions">
          <button type="button" class="primary" onClick={() => setCreating(true)}>Open merge request</button>
          <span class="actionbar-view-controls">
            <div class="quick-filters" aria-label="Review quick filters">
              <For each={["all", "open", "mine", "waiting"] as const}>
                {(filter) => <button type="button" classList={{ active: quickFilter() === filter }} onClick={() => setQuickFilter(filter)}>{QUICK_FILTER_LABELS[filter]}</button>}
              </For>
            </div>
            {/* The value is the label: "Newest" needs no word above it. */}
            <PillSelect label="Sort" value={reviewSort()} onChange={(value) => setReviewSort(value as "number" | "title")}>
              <option value="number">Newest</option>
              <option value="title">Title</option>
            </PillSelect>
          </span>
        </nav>
        {/* What this surface carries, above the things themselves. */}
        <ContentHead icon="review" title="Pull requests" line="Merge requests on this project's repositories, and what each one is waiting for." />
      </Show>

      <Show when={error()}>
        <div class="reviews-error" onClick={() => setError(null)}>
          {error()}
        </div>
      </Show>

      <Show when={creating()}>
        <NewReviewDrawer
          projects={projects() ?? []}
          repos={repos() ?? []}
          branches={(formBranches() ?? []).filter((b) => !b.remote)}
          reviewers={(profiles() ?? []).filter((p) => p.id !== actingProfileId() && !p.archived)}
          projectId={formProjectId()} setProjectId={setFormProjectId}
          repoPath={formRepoPath()} setRepoPath={(path) => { setFormRepoPath(path); setFormSource(""); setFormTarget(""); }}
          source={formSource()} setSource={setFormSource}
          target={formTarget()} setTarget={setFormTarget}
          title={formTitle()} setTitle={setFormTitle}
          selectedReviewers={formReviewers()} toggleReviewer={toggleReviewer}
          onSubmit={createMR}
          onClose={() => setCreating(false)}
        />
      </Show>

      {/* NOTHING YET is a page-wide lead, not a card squeezed into a 260px list
          column beside an empty detail pane — and filters over an empty universe
          are controls with nothing to control, so they are not drawn either. */}
      <Show when={reviews.loading || reviews()?.length} fallback={
        <div class="reviews-lead">
          <EmptyState
            title="No merge requests yet"
            hint="A merge request reviews one branch against another, on a real repository."
            actions={<button type="button" class="primary" onClick={() => setCreating(true)}>Open merge request</button>}
          />
        </div>
      }>
      <div class="reviews-body">
        <aside class="reviews-list">
          {/* The filters that used to stand here are on the page's one action row now. */}
          {/* Inside the list only the FILTERS-MATCH-NOTHING case can happen now:
              the empty universe is handled above, page-wide. */}
          <Show
            when={visibleReviews().length}
            fallback={<EmptyState variant="no-match" title="No merge requests match this filter." actions={<GhostPill onClick={() => setQuickFilter("all")}>Show all</GhostPill>} />}
          >
            {/* THE KNOWLEDGE CARD in one column (design rollout). A merge request has a
                title and one quiet line — its number and the two branches. Those were
                three stacked spans; they are one meta line now, and the state keeps its
                pill because it is the one fact you scan for. */}
            <ul class="dev-card-list">
              <For each={visibleReviews()}>
                {(r) => (
                  <li classList={{ active: r.id === selectedId() }}>
                    <a
                      class="row-link dev-card"
                      {...linkProps({
                        view: "Code Reviews",
                        entityType: "review",
                        entityId: r.id,
                      })}
                    >
                      <span class="dev-card-icon" aria-hidden="true"><Icon name="review" size={20} /></span>
                      <span class="dev-card-copy">
                        <strong>{r.title}</strong>
                        <small>
                          <span class="num">#{r.number}</span>{" · "}
                          <span class="branches">{r.source_branch} → {r.target_branch}</span>
                        </small>
                      </span>
                      <span class={`state state-${r.state.toLowerCase()}`}>
                        {r.state}
                      </span>
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </aside>

        {/* A "nothing selected" pane next to a list that HAS nothing in it says
            the same absence twice; with no merge requests there is nothing to
            pick, so the pane is not drawn at all. */}
        <Show
          when={selected()}
          fallback={<Show when={visibleReviews().length}>
            <EmptyState variant="no-match" title="Nothing selected" hint="Pick a merge request on the left." />
          </Show>}
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
                {/* Which checkout git actions run against — the repo name is the
                    label, so the caption is gone. */}
                <PillSelect class="repo-picker" label="Repository for git actions" value={diffRepoPath()} onChange={setDiffRepoPath}>
                  <For each={repos()}>
                    {(r) => <option value={r.path}>{r.name}</option>}
                  </For>
                </PillSelect>
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
                          <button class="ghost small" onClick={() => editProtection(rule)}>Edit</button>
                          <button class="ghost small" aria-label={`Delete protection ${rule.branch_pattern}`} onClick={() => deleteProtection(rule.id)}>×</button>
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
                    <button class="ghost">{editingProtectionId() ? "Save protection" : "Protect branch"}</button>
                    <Show when={editingProtectionId()}>
                      <button type="button" class="ghost" onClick={resetProtectionForm}>Cancel</button>
                    </Show>
                  </form>
                </details>

                <section class="external-links">
<h3>External links ({externalLinks()?.length ?? 0})</h3>
<ul>
<For each={externalLinks()} fallback={<li class="hint">No external links linked.</li>}>
{(link) => <li><a href={link.external_url} target="_blank" rel="noopener noreferrer">{link.title || link.external_url}</a><button class="ghost small" aria-label={`Remove external link ${link.title || link.external_url}`} onClick={() => removeExternalLink(link.id)}>×</button></li>}
</For>
</ul>
<form class="new-rule-form" onSubmit={addExternalLink}>
<input class="grow" type="url" placeholder="GitHub issue / PR URL…" value={externalLinkUrl()} onInput={(e) => setExternalLinkUrl(e.currentTarget.value)} />
<input placeholder="Link title (optional)" value={externalLinkTitle()} onInput={(e) => setExternalLinkTitle(e.currentTarget.value)} />
<button class="ghost">Add link</button>
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
      </Show>
    </section>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Opening a merge request, off the surface (L3). Every field of the old band is
 *  here — project, repo, both branches, title, the reviewer picks — and captions
 *  are correct inside a drawer, which is why they stay `.wid-field` labels. */
function NewReviewDrawer(props: {
  projects: { id: string; name: string }[];
  repos: { path: string; name: string }[];
  branches: { name: string }[];
  reviewers: { id: string; display_name: string }[];
  projectId: string; setProjectId: (value: string) => void;
  repoPath: string; setRepoPath: (value: string) => void;
  source: string; setSource: (value: string) => void;
  target: string; setTarget: (value: string) => void;
  title: string; setTitle: (value: string) => void;
  selectedReviewers: string[]; toggleReviewer: (id: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onClose: () => void;
}) {
  let panel!: HTMLElement;
  let firstField!: HTMLSelectElement;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !panel.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    firstField?.focus();
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });
  return (
    <div class="wid-root">
      <div class="wid-backdrop" onClick={props.onClose} aria-hidden="true" />
      <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="new-review-heading" ref={panel}>
        <header class="wid-head">
          <h2 id="new-review-heading">Open merge request</h2>
          <p>Reviews run on real branches of a real repository.</p>
        </header>
        <form class="wid-form" onSubmit={props.onSubmit}>
          <label class="wid-field"><span>Project</span>
            <select class="wid-input" ref={firstField} value={props.projectId} onChange={(e) => props.setProjectId(e.currentTarget.value)}>
              <For each={props.projects}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
          </label>
          <label class="wid-field"><span>Repository</span>
            <select class="wid-input" value={props.repoPath} onChange={(e) => props.setRepoPath(e.currentTarget.value)}>
              <For each={props.repos}>{(r) => <option value={r.path}>{r.name}</option>}</For>
            </select>
          </label>
          <label class="wid-field"><span>Source branch</span>
            <select class="wid-input" value={props.source} onChange={(e) => props.setSource(e.currentTarget.value)}>
              <option value="">select…</option>
              <For each={props.branches}>{(b) => <option value={b.name}>{b.name}</option>}</For>
            </select>
          </label>
          <label class="wid-field"><span>Target branch</span>
            <select class="wid-input" value={props.target} onChange={(e) => props.setTarget(e.currentTarget.value)}>
              <option value="">select…</option>
              <For each={props.branches}>{(b) => <option value={b.name}>{b.name}</option>}</For>
            </select>
          </label>
          <label class="wid-field"><span>Title</span>
            <input class="wid-input" value={props.title} onInput={(e) => props.setTitle(e.currentTarget.value)} placeholder="What does this branch change?" />
          </label>
          <fieldset class="wid-field wid-people"><legend>Reviewers</legend>
            <Show when={props.reviewers.length} fallback={<p class="wid-hint">Nobody else has a profile in this organization yet.</p>}>
              <For each={props.reviewers}>{(p) => (
                <label class="wid-person">
                  <input type="checkbox" checked={props.selectedReviewers.includes(p.id)} onChange={() => props.toggleReviewer(p.id)} />
                  <span>{p.display_name}</span>
                </label>
              )}</For>
            </Show>
          </fieldset>
          <footer class="wid-actions">
            <button type="button" class="wid-btn" onClick={props.onClose}>Cancel</button>
            <button type="submit" class="wid-btn wid-primary" disabled={!props.title.trim() || !props.source || !props.target}>Open merge request</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
