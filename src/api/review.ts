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
};

export type ProtectedBranchRule = {
  id: string; project_id: string; branch_pattern: string; regex: boolean;
  allow_create_json: string | null; allow_push_json: string | null;
  allow_delete_json: string | null; allow_force_push_json: string | null;
  allow_merge_json: string | null; linear_history: boolean;
  bypass_quality_gate_json: string | null;
};

export type QualityGateRule = {
  id: string;
  project_id: string;
  branch_pattern: string;
  min_approvals: number;
  required_reviewers_json: string | null;
  codeowners_required: boolean;
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
};

export const reviewApi = {
  list: () => invoke<Review[]>("list_reviews"),
  get: (id: string) => invoke<Review | null>("get_review", { id }),
  update: (review: Review) => invoke<void>("update_review", { review }),
  openMergeRequest: (req: NewMergeRequest) => invoke<Review>("open_merge_request", { req }),
  diff: (repoPath: string, sourceBranch: string, targetBranch: string) =>
    invoke<string>("review_diff", { repoPath, sourceBranch, targetBranch }),

  listParticipants: (reviewId: string) =>
    invoke<ReviewParticipant[]>("list_review_participants", { reviewId }),
  addParticipant: (participant: ReviewParticipant) =>
    invoke<void>("add_review_participant", { participant }),
  setParticipantState: (reviewId: string, profileId: string, state: string | null) =>
    invoke<void>("set_participant_state", { reviewId, profileId, state }),

  listDiscussions: (reviewId: string) =>
    invoke<ReviewDiscussion[]>("list_review_discussions", { reviewId }),
  createDiscussion: (discussion: NewDiscussion) =>
    invoke<ReviewDiscussion>("create_review_discussion", { discussion }),
  setDiscussionResolved: (id: string, resolved: boolean) =>
    invoke<void>("set_discussion_resolved", { id, resolved }),

  listProtectedBranchRules: (projectId: string) => invoke<ProtectedBranchRule[]>("list_protected_branch_rules", { projectId }),
  saveProtectedBranchRule: (rule: ProtectedBranchRule) => invoke<void>("save_protected_branch_rule", { rule }),
  deleteProtectedBranchRule: (id: string) => invoke<void>("delete_protected_branch_rule", { id }),

  listGateRules: (projectId: string) =>
    invoke<QualityGateRule[]>("list_quality_gate_rules", { projectId }),
  createGateRule: (rule: QualityGateRule) => invoke<void>("create_quality_gate_rule", { rule }),
  updateGateRule: (rule: QualityGateRule) => invoke<void>("update_quality_gate_rule", { rule }),
  deleteGateRule: (id: string) => invoke<void>("delete_quality_gate_rule", { id }),
  evaluateGate: (reviewId: string) =>
    invoke<QualityGateEvaluation>("evaluate_quality_gate", { reviewId }),

  listMergeRuns: (reviewId: string) => invoke<SafeMergeRun[]>("list_safe_merge_runs", { reviewId }),
  dryRunMerge: (id: string, repoPath: string, reviewId: string, sourceBranch: string, targetBranch: string) =>
    invoke<SafeMergeRun>("dry_run_merge", { id, repoPath, reviewId, sourceBranch, targetBranch }),
  attemptMerge: (id: string, repoPath: string, reviewId: string, sourceBranch: string, targetBranch: string, actorId: string) =>
    invoke<SafeMergeRun>("attempt_merge", { id, repoPath, reviewId, sourceBranch, targetBranch, actorId }),
};
