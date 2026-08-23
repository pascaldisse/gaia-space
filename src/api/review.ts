// Code review API surface — thin invoke() wrappers over src-tauri/src/review.rs.
// Kept standalone from ../api.ts (owned by another lane): types + calls needed by
// views/Reviews.tsx + views/Reviews.css only.
import { invoke } from "@tauri-apps/api/core";

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export type Review = {
  id: string;
  project_id: string;
  number: number;
  kind: string;
  state: string; // Opened | Closed | Merged
  source_branch: string | null;
  target_branch: string | null;
  title: string;
  turn_based: boolean;
  channel_id: string | null;
  repo_path: string | null;
};

export type ReviewParticipant = {
  review_id: string;
  profile_id: string;
  role: string; // Author | Reviewer | Watcher
  state: string | null; // accepted | rejected | waiting
  their_turn: boolean;
};

export type ReviewDiscussion = {
  id: string;
  review_id: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  revision: string | null;
  resolved: boolean;
  channel_id: string | null;
  suggestion_commit_id: string | null;
  suggestion_status: SuggestedEditStatus | null;
  suggestion_content: string | null;
  suggestion_has_conflicts: boolean | null;
  suggestion_identical_contents: boolean | null;
  suggestion_resolved_by: string | null;
};
export type SuggestedEditStatus = "OPEN" | "ACCEPTED" | "REJECTED";
export type ReviewAggregatedStatus = "MERGED" | "CLOSED" | "ACCEPTED" | "NEEDS_MY_REVIEW" | "NEEDS_MY_ATTENTION" | "WAITING_FOR_REVIEW" | "WAITING_FOR_UPDATES" | "OPENED";

export type ProtectedBranchRule = {
  id: string;
  project_id: string;
  branch_pattern: string;
  regex: boolean;
  allow_create_json: string | null;
  allow_push_json: string | null;
  allow_delete_json: string | null;
  allow_force_push_json: string | null;
  allow_merge_json: string | null;
  linear_history: boolean;
  bypass_quality_gate_json: string | null;
};

export type QualityGateRule = {
  id: string;
  project_id: string;
  branch_pattern: string;
  min_approvals: number;
  required_reviewers_json: string | null;
  codeowners_required: boolean;
  // JSON array of external check names the gate waits for, even before they report.
  external_checks_json: string | null;
  applications_json: string | null;
  roles_json: string | null;
};

export type MergePolicy = {
  project_id: string; allow_merge: boolean; allow_rebase: boolean; allow_squash: boolean;
  merge_message_option: "DEFAULT" | "TITLE" | "TITLE_AND_DESCRIPTION";
  squash_message_option: "DEFAULT" | "TITLE" | "TITLE_AND_DESCRIPTION" | "TITLE_AND_COMMITS";
};
export type SafeMergeRun = {
  id: string;
  review_id: string;
  state: string; // RUNNING | SUCCEEDED | FAILING
  is_dry_run: boolean;
  log: string | null;
  source_oid: string | null;
  target_oid: string | null;
  merge_commit_oid: string | null;
};

export type QualityGateEvaluation = {
  satisfied: boolean;
  reasons: string[];
  approvals: number;
  min_approvals: number;
  matched_rules: number;
  codeowner_paths: string[];
  codeowner_approvers: string[];
  required_checks: string[];
};

export type ExternalIssueLink = { id: string; review_id: string; external_url: string; title: string | null };
export type ExternalCheckStatus = "PENDING" | "SUCCEEDED" | "FAILED";
export type ExternalCheck = {
  review_id: string;
  check_name: string;
  status: ExternalCheckStatus;
  details: string | null;
  updated_at: number;
};

export type ReviewStack = {
  id: string;
  project_id: string;
  repo_path: string;
  target_branch: string;
  source_branch: string;
  review_ids: string[];
};
export type NewReviewStack = ReviewStack;
export type RestackStep = {
  review_id: string;
  branch: string;
  onto_branch: string;
  replayed: string[];
  new_tip: string | null;
  conflicts: string[];
  applied: boolean;
};
export type NewMergeRequest = {
  id: string;
  project_id: string;
  repo_path: string;
  source_branch: string;
  target_branch: string;
  title: string;
  author_id: string;
  reviewer_ids: string[];
  channel_id: string;
};

export type NewDiscussion = {
  id: string;
  review_id: string;
  channel_id: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  revision: string | null;
  author_id: string;
  message: string;
  suggestion_commit_id?: string | null;
  suggestion_content?: string | null;
  suggestion_has_conflicts?: boolean | null;
  suggestion_identical_contents?: boolean | null;
};

export const reviewApi = {
  list: () => invoke<Review[]>("list_reviews"),
  get: (id: string) => invoke<Review | null>("get_review", { id }),
  update: (review: Review) => invoke<void>("update_review", { review }),
  aggregatedStatus: (reviewId: string, profileId: string) =>
    invoke<ReviewAggregatedStatus>("review_aggregated_status", { reviewId, profileId }),
  listOwnedFiles: (reviewId: string, profileId: string) =>
    invoke<string[]>("list_owned_review_files", { reviewId, profileId }),
  openMergeRequest: (req: NewMergeRequest) =>
    invoke<Review>("open_merge_request", { req }),
  diff: (repoPath: string, sourceBranch: string, targetBranch: string) =>
    invoke<string>("review_diff", { repoPath, sourceBranch, targetBranch }),

  listParticipants: (reviewId: string) =>
    invoke<ReviewParticipant[]>("list_review_participants", { reviewId }),
  addParticipant: (participant: ReviewParticipant) =>
    invoke<void>("add_review_participant", { participant }),
  setParticipantState: (
    reviewId: string,
    profileId: string,
    state: string | null,
  ) => invoke<void>("set_participant_state", { reviewId, profileId, state }),

  listDiscussions: (reviewId: string) =>
    invoke<ReviewDiscussion[]>("list_review_discussions", { reviewId }),
  createDiscussion: (discussion: NewDiscussion) =>
    invoke<ReviewDiscussion>("create_review_discussion", { discussion }),
  setDiscussionResolved: (id: string, resolved: boolean) =>
    invoke<void>("set_discussion_resolved", { id, resolved }),
  setSuggestedEditStatus: (id: string, status: SuggestedEditStatus, actorId: string) =>
    invoke<void>("set_suggested_edit_status", { id, status, actorId }),

  getMergePolicy: (projectId: string) => invoke<MergePolicy>("get_merge_policy", { projectId }),
  saveMergePolicy: (policy: MergePolicy) => invoke<void>("save_merge_policy", { policy }),
  listProtectedBranchRules: (projectId: string) =>
    invoke<ProtectedBranchRule[]>("list_protected_branch_rules", { projectId }),
  saveProtectedBranchRule: (rule: ProtectedBranchRule) =>
    invoke<void>("save_protected_branch_rule", { rule }),
  deleteProtectedBranchRule: (id: string) =>
    invoke<void>("delete_protected_branch_rule", { id }),

  listGateRules: (projectId: string) =>
    invoke<QualityGateRule[]>("list_quality_gate_rules", { projectId }),
  createStack: (input: NewReviewStack) =>
    invoke<ReviewStack>("create_review_stack", { input }),
  listStacks: (projectId: string) =>
    invoke<ReviewStack[]>("list_review_stacks", { projectId }),
  listMyStacks: (profileId: string) =>
    invoke<ReviewStack[]>("list_my_review_stacks", { profileId }),
  // Dissolves the stacking relation only; member merge requests and branches survive.
  removeStack: (stackId: string) =>
    invoke<void>("remove_review_stack", { stackId }),
  // committer defaults to the repo's configured signature; pass null explicitly so the
  // Rust Option arms are unambiguous over the IPC boundary.
  restackStack: (
    stackId: string,
    dryRun: boolean,
    committerName: string | null = null,
    committerEmail: string | null = null,
  ) =>
    invoke<RestackStep[]>("restack_stack", {
      stackId,
      dryRun,
      committerName,
      committerEmail,
    }),
  stackCherryPick: (
    reviewId: string,
    commitOid: string,
    committerName: string | null = null,
    committerEmail: string | null = null,
  ) =>
    invoke<RestackStep>("stack_cherry_pick", {
      reviewId,
      commitOid,
      committerName,
      committerEmail,
    }),
  createGateRule: (rule: QualityGateRule) =>
    invoke<void>("create_quality_gate_rule", { rule }),
  updateGateRule: (rule: QualityGateRule) =>
    invoke<void>("update_quality_gate_rule", { rule }),
  deleteGateRule: (id: string) =>
    invoke<void>("delete_quality_gate_rule", { id }),
  evaluateGate: (reviewId: string) =>
    invoke<QualityGateEvaluation>("evaluate_quality_gate", { reviewId }),

  listExternalIssueLinks: (reviewId: string) =>
    invoke<ExternalIssueLink[]>("list_external_issue_links", { reviewId }),
  createExternalIssueLink: (link: ExternalIssueLink) =>
    invoke<void>("create_external_issue_link", { link }),
  deleteExternalIssueLink: (id: string) =>
    invoke<void>("delete_external_issue_link", { id }),
  listExternalChecks: (reviewId: string) =>
    invoke<ExternalCheck[]>("list_external_checks", { reviewId }),
  recordExternalCheck: (check: ExternalCheck) =>
    invoke<void>("record_external_check", { check }),
  deleteExternalCheck: (reviewId: string, checkName: string) =>
    invoke<void>("delete_external_check", { reviewId, checkName }),

  listMergeRuns: (reviewId: string) =>
    invoke<SafeMergeRun[]>("list_safe_merge_runs", { reviewId }),
  dryRunMerge: (
    id: string,
    repoPath: string,
    reviewId: string,
    sourceBranch: string,
    targetBranch: string,
  ) =>
    invoke<SafeMergeRun>("dry_run_merge", {
      id,
      repoPath,
      reviewId,
      sourceBranch,
      targetBranch,
    }),
  attemptMerge: (
    id: string,
    repoPath: string,
    reviewId: string,
    sourceBranch: string,
    targetBranch: string,
    actorId: string,
  ) =>
    invoke<SafeMergeRun>("attempt_merge", {
      id,
      repoPath,
      reviewId,
      sourceBranch,
      targetBranch,
      actorId,
    }),
};
