# Git Hosting & Code Review — JetBrains Space Knowledge Base

Sources:
- Decompiled Android client (jadx, Kotlin→Java): `~/Downloads/space-clients/android/jadx-out/sources/circlet/`
  - `code/` (2123 .java files) — client-side VMs/logic for reviews, discussions, diffs, repositories.
  - `code/api/` (315 files) — wire data models (`ARecord`/`ExtRecord` classes = server records synced to client).
  - `android/ui/mr/` — mobile UI fragments/presenters/contracts for merge requests.
- Live docs: `jetbrains.com/help/space/*` is **dead** (404 on every page checked: git-and-code-review.html, branch-protection.html, code-review.html, pull-requests.html, quality-gates.html — cloud shut down June 1 2025, help pages pulled). Only surviving official content = `blog.jetbrains.com/space/*` posts (still live, banner: "Space and SpaceCode will be discontinued on June 1, 2025").
- gaia-space Flutter clone: `~/projects/gaia-space/lib/` (Riverpod + Drift deps present in pubspec, but PR/branch-protection features are currently **in-memory only**, no Drift tables wired yet).

---

## 1. Feature Overview (from blog posts + decompile cross-check)

Space's Git/code-review stack, confirmed both in blog prose and in decompiled class names:

- **Git hosting**: repos owned by projects, GitHub/GitLab import (`circlet.code.github.GitHubCommonUtil`, `circlet.code.gitlab.GitLabCommonUtil`, `GitHubService`, `GitLabService` in `code/api/`), branch listing/heads/push subscriptions (`RepoHeadsSubscriptionFilter`, `RepoPushSubscriptionFilter`, `RepoCommitsSubscriptionFilter`).
- **Merge Requests (MRs)** = Space's PR equivalent. `MergeRequestRecord extends CodeReviewRecord`. Also supports ad-hoc "Commit Set" reviews (`CommitSetReviewRecord`) not tied to a branch — review a set of commits directly (feature gaia-space's PR model has no equivalent of).
- **Code Review chat/feed**: every review has a `M2ChannelRecord` (`feedChannel`) — comments/discussions live in Space's unified chat/messaging system, not a separate comments table.
- **Inline discussions**: `CodeDiscussionRecord` — anchored to a line range (`CodeDiscussionAnchor`/`endAnchor`), resolvable/resolved, can carry a **suggested edit** (`CodeDiscussionSuggestedEdit`) that the author can accept/reject/reopen (`CodeDiscussionVMImpl.tryAcceptSuggestedEdit/rejectSuggestedEdit/reopenSuggestedEdit`).
- **Diff views**: both **inline** (`code/repositories/diff/inline/InlineDiffKt.java`) and **side-by-side** (`code/repositories/diff/sideBySide/{BindingType,LinesRangeBinding,LinesRangeMapping,SideBySideDiffKt}.java`) are first-class, with line-range binding/mapping between the two panes (not just a toggle over the same data — side-by-side has its own line-mapping model).
- **Stacked/stacking reviews** ("stacked diffs", like Graphite): `code/review/stacking/` (`ReviewStackVM`, `ReviewStackVMImpl`), backed by `StackedDiffsService` API (`getReviewStack`, `listMyStacks`, `createStack(sourceBranchHead, targetBranchHead)`, `startCherryPick`, `removeStack`) and `CodeReviewStackRecord` (ordered `items: List<CodeReviewStackItem>`, `targetBranchHead`, `sourceBranchHead`). Lets you chain multiple small MRs where cherry-picking / restacking is a first-class operation.
- **Quality Gates**: per-repo, per-protected-branch rule sets that block merging until satisfied. Confirmed gate types (blog + `QualityGateVMImpl`, `ApprovalRuleVM`, `CodeOwnerApprovalRuleVM`): (1) required reviewer **approvals** with a threshold count, (2) required **Automation jobs** (CI) green, (3) **External checks** (3rd-party service posts approval via HTTP API), (4) **CODEOWNERS** approval.
- **CODEOWNERS**: file at repo root or `.space/CODEOWNERS`, gitignore-style path patterns, owners = usernames / verified emails / project roles (e.g. `"Project Admin"`), **last-matching-rule-wins** precedence, branch-specific (feature branch's own CODEOWNERS applies to its own MR). Modeled by `QualityGateCodeOwner` (sealed: `User`/`Role`/`Team`/`Unknown`), `GroupedQualityGateCodeOwnersApproval`, `MergeRequestSuggestedCodeOwner`, `CodeOwnersValidateResult`.
- **Safe Merge / Dry Run**: creates a **temporary merge commit** of latest target+source, runs CI, only finalizes the real merge if green (`SafeMergeCenterVM`, `SafeMergeVM`/`SafeMergeVMImpl`, `SafeMergeRecord`, `SafeMergeState` enum `STARTING/RUNNING/FAILING/FAILED/SUCCEEDED/CANCELLED`, `SafeMergeCheckVM`, `SafeMergeCommand`/`SafeMergeCommandPayload`, `SafeMergeSize{files,additions,deletions,tooManyFiles}`, `SafeMergeLiveStatusDTO`, `RepositorySafeMergesIssue`). Dry Run = same mechanism with `MergeSelectOptions.Operation.DryRun` (never prompts to complete the merge). Configured per protected branch via `GitRepositorySettings.ProtectedBranch.safeMerge` / ` MergeOptions`.
- **Branch protection**: `GitRepositorySettings.ProtectedBranch` — glob/regex `pattern` list, `allowCreate/allowPush/allowDelete/allowForcePush` (each a list of allowed principals, empty = nobody), `linearHistory` flag, nested `QualityGate`, `MergeOptions`, `SafeMerge` settings per rule.
- **Merge options / strategies**: `GitRepositorySettings.MergeOptions{allowMerge, mergeMessageOption, allowRebase, allowSquash, squashMessageOption}` with nested enums `MergeMessageOption{DEFAULT,TITLE,TITLE_AND_DESCRIPTION}` and `SquashMessageOption{DEFAULT,TITLE,TITLE_AND_DESCRIPTION,TITLE_AND_COMMITS}` — i.e. repo owner picks which strategies are even *allowed*, plus per-strategy commit-message templating (gaia-space has none of this granularity). At merge time the actual `MergeSelectOptions{operation: Merge|Rebase|DryRun, mergeMode: GitMergeMode, rebaseMode: GitRebaseMode, squashMode: GitSquashMode, squashCommitMessage, keepSquashCommitMessage, deleteSourceBranch, targetStatusesForLinkedIssues}` is chosen by the user performing the merge (auto-delete-source-branch + auto-transition linked issue statuses on merge are built in).
- **Turn-based review** ("your turn" workflow): `MergeRequestRecord.turnBased`, `CodeReviewParticipant.theirTurn`, events `AuthorWaitsForReview`, `AuthorResumedWork`, `ReviewerWaitsForUpdate`, `ReviewerResumedReview`, `ReviewerChanged`; reviewer actions modeled as a sealed `ReviewerAction` tree: `AcceptChanges`, `AcceptForever`, `ResumeReview(isAccepted)`, `WaitAuthorResponse` — ping-pong control flow between author/reviewer, not just an approve/reject state.
- **Review participants & roles**: `CodeReviewParticipantRole{Reviewer, Author, Watcher}`, `ReviewerState{Accepted, Rejected}` (2-state, no "commented"/"changes requested" as separate enum values — those are modeled via discussions + ReviewerAction instead), per-participant `hasOwnedFiles/ownsAllFiles/reviewOnlyOwnedFiles` (review only files you own), `isApproveSticky` (approval survives new pushes or not), `codeOwnerSlots`/`qualityGateSlots` (which quality-gate rule slot this person fills), `reviewProgress: CodeReviewProgress{viewedFilesCount, totalFilesToReviewCount}` (per-user file-viewed tracking).
- **Review list / filtering**: `ReviewListQuickFilter{OPEN, AUTHORED_BY_ME, NEEDS_MY_ATTENTION, NEEDS_MY_REVIEW}`, `ReviewSorting{CreatedAtDesc, CreatedAtAsc, LastUpdatedDesc, LastUpdatedAsc}`, aggregated status badge `CodeReviewAggregatedStatus{MERGED, MERGING, DRY_RUN, FAILING, DELETED, CLOSED, ACCEPTED, OPENED, NEEDS_MY_ATTENTION, WAITING_FOR_REVIEW, NEEDS_MY_REVIEW, WAITING_FOR_UPDATES}` — a single computed enum combining CI/merge/review state used for list rendering, more granular than a plain PR status.
- **Suggested reviewers**: `SuggestedReviewers`, `MergeRequestApprovalRuleSuggestedReviewers`, `PossibleReviewer`, absence-aware (`getAbsences` in `ApprovalRuleVMKt`) — suggestion pool excludes people on vacation/absence.
- **File-ownership-aware review**: `showOnlyChangesOwnedByMe` toggle (`ShowOnlyChangesOwnedByMe`), `FileSetInReview`, `hasOwnedFiles`/`ownsAllFiles` — large-team feature letting a reviewer filter the diff to only files they own.
- **Changes tree / navigation**: `ChangesTreeVM`, `ReviewChangesTreeVM`, jumpers to navigate by category — `AllDiscussionsJumperProvider`, `PendingDiscussionsJumperProvider`, `UnreadDiscussionsJumperProvider`, `UnresolvedDiscussionsJumperProvider`, `UnresolvedSuggestionsJumperProvider`, `CodeIssuesJumperProvider`, `FileJumperProvider` — keyboard/UI "jump to next X" across the whole review.
- **Read/collapse tracking**: `ReviewChangesReadingVM` (mark files as read), `ReviewChangesCollapsingVM`/`ReviewChangeCollapsingState` (collapse reviewed files in the tree).
- **AI code issues / assistant**: `AiAssistantCodeIssue`, `code/api/ai/` package, `DiffCodeIssueVMImpl.generateAFix` — inline AI-detected issues in review diffs with a "generate a fix" action; `CodeIssueGroup`, `CodeIssueLevel`, `CodeIssueRule`, `CodeIssuesService`.
- **External issue tracker links**: `ExternalCodeReviewLink`, `ExternalIssueLinkedCodeReviewsChanged`, `IssueLinkedToCodeReview`/`IssueLinkedToCommit`, `MergeSelectOptions.targetStatusesForLinkedIssues` (auto-transition issue status on merge).
- **Webhooks / feed events**: rich event stream per review — `CodeReviewCreated/Closed/TitleUpdated/DescriptionUpdated/TargetBranchUpdated`, `CodeReviewDiscussionCreated/Resolved/Reopened/Removed`, `MergeRequestMerged`, `ReviewerChangedEvent`, `ReviewStateChangedEvent`, plus generic `*WebhookEvent` variants for external integrations.
- **GitHub/GitLab interop**: `GitHubCollaborator`, `GitHubTokenProps`, `GitHubService`, `GitLabService` — Space could mirror/import external repos and map collaborators.

---

## 2. Real Data Model (from decompile)

All paths relative to `circlet/code/api/` unless noted. These are `@ApiSerializable` wire records (`ARecord`/`ExtRecord<T>`), i.e. what actually gets synced client↔server — the ground truth for gaia-space's Drift schema design.

### Core review record hierarchy
```
CodeReviewRecord (abstract, implements ARecord)
├── project: ProjectKey, projectId: TID, number: Int, title: String, titleUnfurls: List<Unfurl>?
├── state: CodeReviewState{Opened,Closed,Deleted}, canBeReopened: Boolean?
├── createdAt: Long, createdBy: Ref<TD_MemberProfile>, timestamp: Long?
├── readOnly: Boolean?, turnBased: Boolean?, key (derived), archived: Boolean (= state != Opened)
├── participants: List<CodeReviewParticipant>
├── feedChannel: Ref<M2ChannelRecord>?, feedChannelId, descriptionFeedChannelItemId
├── externalLink: ExternalCodeReviewLink?
├─┬ MergeRequestRecord (the actual "PR" type) — 25 ctor params, adds:
│ │  branchPair: MergeRequestBranchPair?, branchPairs: List<MergeRequestBranchPair>
│ │  projectRepos: Ref<ProjectReposRecord>?
│ │  safeMergeInProgress: Boolean?, hasOwnedFiles: Boolean?
│ │  temporaryId, arenaId
└─┬ CommitSetReviewRecord — review of an arbitrary commit set, not a branch-vs-branch MR
```

### CodeReviewParticipant (per-user state on a review)
```kotlin
CodeReviewParticipant(
  user: Ref<TD_MemberProfile>, role: CodeReviewParticipantRole /*Reviewer|Author|Watcher*/,
  hasOwnedFiles: Boolean?, ownsAllFiles: Boolean?, reviewOnlyOwnedFiles: Boolean?,
  state: ReviewerState? /*Accepted|Rejected*/, isApproveSticky: Boolean?, theirTurn: Boolean?,
  qualityGateSlots: List<CodeReviewParticipantQualityGateSlot>?,
  codeOwnerSlots: List<CodeReviewParticipantCodeOwnerSlot>?,
  addedAt: KotlinXDateTime?, reviewProgress: CodeReviewProgress? /*viewedFilesCount, totalFilesToReviewCount*/
)
```

### Inline discussion (comment thread anchored to code)
```kotlin
CodeDiscussionRecord(
  id, projectId, project: Ref<PR_Project>?,
  anchor: CodeDiscussionAnchor, endAnchor: CodeDiscussionAnchor?,   // line-range anchor, not just a line number
  created: KDateTime, channel: Ref<M2ChannelRecord>,                 // thread = a chat channel
  resolvable: Boolean?, resolved: Boolean,
  snippet: CodeDiscussionSnippet?,                                    // cached code snippet for context
  suggestedEdit: CodeDiscussionSuggestedEdit?,                        // inline "suggest changes"
  resolvedBy: CPrincipal?, pending: Boolean?, review: Ref<CodeReviewRecord>?,
  feedItemId, rootMessageDeleted: Boolean?, reviews: List<CodeReviewRecord>?,  // one discussion can span multiple reviews
  archived, temporaryId, arenaId
)
```
`CodeDiscussionSuggestedEdit(suggestionCommitId, status: CodeDiscussionSuggestedEditState, resolvedBy: CPrincipal?, filePath, hasConflicts: Boolean, identicalContents: Boolean?, startLineIndex: Int, endLineIndexInclusive: Int)`.

### Quality gates / branch protection
```kotlin
GitRepositorySettings.ProtectedBranch(
  pattern: List<String>, regex: Boolean?,
  allowCreate/allowPush/allowDelete/allowForcePush: List<Principal>?,  // empty list = nobody allowed
  qualityGate: QualityGate?, mergeOptions: MergeOptions?, safeMerge: SafeMerge?,
  linearHistory: Boolean?
)
GitRepositorySettings.MergeOptions(
  allowMerge: Boolean?, mergeMessageOption: MergeMessageOption{DEFAULT,TITLE,TITLE_AND_DESCRIPTION},
  allowRebase: Boolean?, allowSquash: Boolean?,
  squashMessageOption: SquashMessageOption{DEFAULT,TITLE,TITLE_AND_DESCRIPTION,TITLE_AND_COMMITS}
)
MergeRequestQualityGateSettings(
  rules: List<MergeRequestQualityGateSettingsRule>, users: List<Ref<TD_MemberProfile>>,
  applications: List<ES_App>, roles: List<DTO_Role>, roles2: List<RoleDTO>?, safeMerge: Boolean
)
QualityGatePermission{ALLOW_DIRECT_PUSH, ALLOW_BYPASS_QUALITY_GATE, ALLOW, QUALITY_GATE_ACTIVE, NOT_ALLOW}
ApprovalRule(approvedBy: List<String>)   // resolved list of "+:name" entries, computed from CODEOWNERS/roles/teams
QualityGateCodeOwner = User(Ref<TD_MemberProfile>) | Role(String) | Team(TeamRef) | Unknown
```

### Safe Merge
```kotlin
SafeMergeRecord(arenaId, id, safeMerge: SafeMerge?, archived: Boolean, temporaryId) : ExtRecord<CodeReviewRecord>
SafeMergeState{STARTING, RUNNING, FAILING, FAILED, SUCCEEDED, CANCELLED}
SafeMergeSize(files: Int, additions: Int, deletions: Int, tooManyFiles: Boolean)
SafeMergeInfo (client VM): project, repository, mergeCommitId, checks: List<SafeMergeCheckVM>, state, isDryRun, mergeOptions: MergeSelectOptions
```

### Merge execution options
```kotlin
MergeSelectOptions(
  operation: Operation{Merge, Rebase, DryRun},
  mergeMode: GitMergeMode, rebaseMode: GitRebaseMode, squashMode: GitSquashMode,
  squashCommitMessage: String, keepSquashCommitMessage: Boolean?,
  deleteSourceBranch: Boolean, targetStatusesForLinkedIssues: List<TargetStatusForLinkedIssue>
)
```

### Stacked reviews
```kotlin
CodeReviewStackRecord(arenaId, id, items: List<CodeReviewStackItem>, targetBranchHead, sourceBranchHead, archived, temporaryId)
StackedDiffsService: getReviewStack(project, review), listMyStacks(project, repositoryName),
  createStack(project, repositoryName, sourceBranchHead, targetBranchHead), startCherryPick(...), removeStack(...)
```

### Misc enums worth carrying over
- `CodeReviewState{Opened, Closed, Deleted}` (review-level; separate from PR-vs-branch state)
- `CodeReviewAggregatedStatus{MERGED, MERGING, DRY_RUN, FAILING, DELETED, CLOSED, ACCEPTED, OPENED, NEEDS_MY_ATTENTION, WAITING_FOR_REVIEW, NEEDS_MY_REVIEW, WAITING_FOR_UPDATES}` — the computed list-badge state
- `ReviewSorting{CreatedAtDesc, CreatedAtAsc, LastUpdatedDesc, LastUpdatedAsc}`
- `ReviewListQuickFilter{OPEN, AUTHORED_BY_ME, NEEDS_MY_ATTENTION, NEEDS_MY_REVIEW}`
- `ReviewerState{Accepted, Rejected}`, `CodeReviewParticipantRole{Reviewer, Author, Watcher}`
- `ReviewerAction` (sealed): `AcceptChanges`, `AcceptForever`, `ResumeReview(isAccepted: Boolean)`, `WaitAuthorResponse`

---

## 3. Key Features List (condensed, for parity backlog)

1. Merge requests (branch↔branch) **and** ad-hoc commit-set reviews (review a commit range without a branch).
2. Turn-based review workflow (explicit author⇄reviewer "whose turn" state + resume/wait actions), not just approve/request-changes.
3. Inline threaded discussions anchored to a line **range** (start+end anchor), resolvable, can carry a code snippet cache and a suggested edit.
4. Suggested edits: reviewer proposes exact code change inline; author accepts/rejects/reopens; tracked per-commit (`suggestionCommitId`) with conflict detection.
5. Both **side-by-side** and **inline/unified** diff modes, each with its own line-mapping model (not one dumb toggle).
6. Quality Gates on protected branches: required-approvals-with-threshold, required CI jobs, external HTTP-API checks, CODEOWNERS approval — each independently togglable and combinable.
7. CODEOWNERS file (repo root or `.space/`), gitignore-style globs, owners = user/email/role, last-match-wins, branch-specific.
8. Branch protection: per-pattern (glob or regex) rules for allow-create/push/delete/force-push (as allow-lists, not just booleans), linear-history enforcement, nested quality-gate + merge-options + safe-merge config.
9. Merge strategy governance: repo owner whitelists which of merge/squash/rebase are allowed, plus separate commit-message templating per strategy (default/title/title+description/title+commits for squash).
10. Safe Merge: temporary merge commit + CI run before finalizing; **Dry Run** variant that never finalizes; auto-retry on flaky failures; size warnings (`tooManyFiles`).
11. Stacked/stacking reviews with cherry-pick and restack operations, explicit stack ordering and shared target/source branch heads.
12. Suggested reviewers (absence-aware) and file-ownership-aware review (filter diff to "only my owned files").
13. Per-user review progress tracking (files viewed / total files) and collapse-when-read UI state.
14. Rich "jump to next" navigation across a review: unresolved discussions, unread discussions, unresolved suggestions, code issues, files.
15. Review list quick filters (Open / Authored by me / Needs my attention / Needs my review) + 4-way sort + a single aggregated status enum for list badges.
16. AI-assisted inline code issues with a "generate a fix" action.
17. Auto-delete source branch and auto-transition linked issue statuses as part of the merge action itself (not a separate step).
18. External issue tracker linking with bidirectional navigation (issue↔commit↔review) and webhook events for most state transitions.
19. GitHub/GitLab import interop helpers (collaborators, tokens) — for migrating repos in.
20. Rich webhook/feed event catalog per review/discussion/commit (created/closed/title/description/target-branch/discussion lifecycle/merged/reviewer-changed/state-changed) for integrations.

---

## 4. gaia-space Gap Analysis

Checked: `lib/core/models/{pull_request,branch_protection,repository,git_diff,git_branch,git_commit,fork_relationship}.dart`, `lib/core/services/{pull_request_service,branch_protection_service,fork_service,git_service}.dart`, `lib/ui/screens/home/{pull_request_screen,git_repository_detail_screen,fork_repository_screen}.dart`, `lib/ui/widgets/git/{diff_viewer,image_diff_viewer}.dart`. No `lib/models` or `lib/services` dir exists (paths are actually `lib/core/models`, `lib/core/services`).

### HAVE
- **PR model** (`PullRequest`): id/title/description/source+target repo+branch/author/status(open/merged/closed/draft)/mergeStrategy(merge/squash/rebase)/reviewerIds/assigneeIds/labels/commitsCount/commentsCount/mergeable/hasConflicts/mergedBy/mergeCommitSha. Roughly matches `MergeRequestRecord` at the surface level.
- **PR service** (`PullRequestService`): create/update/merge/close/reopen, diff + commits retrieval, comments, reviews (approve/changes-requested/commented as a free-text `state` string) — but **all in-memory** (`final List<PullRequest> _pullRequests = []`), no Drift persistence wired despite `drift`/`sqlite3_flutter_libs` being pubspec deps.
- **Branch protection model** (`BranchProtectionRule`): pattern, requirePullRequest, requiredApprovalsCount (int, matches Space's approval-threshold idea), dismissStaleReviews, requireCodeOwnerReviews, restrictPushes+allowedPusherIds, requireStatusChecks+requiredStatusChecks (list of strings — CI check names), requireLinearHistory, allowForcePushes, allowDeletions, enforceAdmins. Structurally a GitHub-style flat rule, closer to GitHub branch protection than Space's nested `ProtectedBranch{qualityGate, mergeOptions, safeMerge}`.
- **CODEOWNERS-equivalent**: `CodeOwnerConfiguration{repositoryId, path, ownerIds: List<String>}` + `BranchProtectionService.getCodeOwnersForFile()`. Simple path→owners map; no actual `CODEOWNERS` file parsing, no gitignore-glob precedence rules, no role/team owners (only raw owner IDs).
- **Diff viewer**: side-by-side and inline/unified modes both implemented (`diff_viewer.dart`, `isDiffSideBySideProvider`), plus a separate image diff viewer with side-by-side/overlay/slider modes (`image_diff_viewer.dart`) — Space has no dedicated image-diff feature visible in the decompile, so this is gaia-space **ahead** here.
- **Fork support**: `fork_relationship.dart`, `fork_service.dart`, `fork_repository_screen.dart` — Space's decompile shows no first-class "fork" concept in `code/api` (Space MRs are typically branch-to-branch within one project); gaia-space's fork model may be closer to GitHub's than Space's.
- **Merge strategies**: `MergeStrategy{merge, squash, rebase}` enum + `GitService.mergeBranches/squashMergeBranches/rebaseBranches` — covers the 3 basic operations Space also supports, but with none of Space's per-repo allow/deny governance or message-template options.

### MISSING
- **Quality Gates** as a concept: no required-CI-jobs-as-gate, no external-HTTP-check gate type, no "N of these M people must approve" rule composition — only a single flat `requiredApprovalsCount` + `requireStatusChecks` boolean+list. No `QualityGatePermission`-style bypass semantics (e.g. `ALLOW_BYPASS_QUALITY_GATE`).
- **Safe Merge / Dry Run**: absent entirely — no temporary-merge-commit-then-CI-then-finalize flow, no dry-run-only mode, no auto-retry-on-flake, no size warnings.
- **Stacked/stacking reviews**: absent entirely — no stack model, no cherry-pick-into-stack, no restack.
- **Turn-based review workflow**: absent — gaia-space's `PullRequestReview.state` is a flat string (`approved/changes_requested/commented`); no explicit author⇄reviewer turn tracking, no `ResumeReview`/`WaitAuthorResponse` actions, no "their turn" indicator.
- **Inline discussion model**: gaia-space only has flat `PullRequestComment{filePath, lineNumber, commitSha, inReplyToId}` — single line number, no line **range** anchoring (start+end), no resolvable/resolved thread state at the model level (no `resolved: bool` field on the comment/thread), no suggested-edit-on-a-line feature, no per-thread chat channel.
- **Suggested edits**: absent — no accept/reject/reopen-suggested-edit flow.
- **CODEOWNERS file support**: no actual file parsing (root or `.space/`-equivalent dir), no gitignore-glob pattern matching, no last-match-wins precedence, no branch-specific CODEOWNERS, no role/team owners (only flat owner-ID lists).
- **Merge-strategy governance at repo level**: no per-repo allow/deny of merge vs squash vs rebase, no commit-message-template options (title-only / title+description / title+commits for squash).
- **Branch protection nesting**: flat rule vs. Space's nested `ProtectedBranch{qualityGate, mergeOptions, safeMerge}`; no regex-vs-glob pattern toggle field, no distinguishing allow-lists per action beyond booleans (`restrictPushes`+`allowedPusherIds` covers push only, not separate create/delete/force-push allow-lists).
- **Suggested reviewers** (absence-aware): absent.
- **File-ownership-aware review** ("only show files I own", per-participant `hasOwnedFiles`/`ownsAllFiles`/`reviewOnlyOwnedFiles`): absent.
- **Per-user review progress** (`viewedFilesCount`/`totalFilesToReviewCount`) and collapse-when-read tree state: absent.
- **"Jump to next X" navigation** (unresolved discussions/unread/suggestions/code issues/files): absent — no jumper-provider equivalent in UI.
- **Review list quick filters + aggregated status enum**: gaia-space filters only by `repositoryId/authorId/status` — no "Needs my attention"/"Needs my review" computed filters, no single aggregated-status badge combining CI+merge+review state (`CodeReviewAggregatedStatus`-style).
- **AI code issues / generate-a-fix**: absent.
- **Auto-delete-source-branch / auto-transition-linked-issue-status on merge**: absent (no equivalent of `MergeSelectOptions.deleteSourceBranch` / `targetStatusesForLinkedIssues`).
- **External issue tracker linking + webhook event catalog**: absent — no `ExternalCodeReviewLink` equivalent, no webhook events for review/discussion lifecycle.
- **GitHub/GitLab import interop**: absent (only fork-from-within-gaia-space, not import-from-external-host).
- **Commit-set review** (review arbitrary commits without a branch/MR): absent — gaia-space PRs are always branch-vs-branch.

### PARTIAL
- **Branch protection**: present but flatter/simpler than Space's nested model (see MISSING above for specifics); no persistence beyond in-memory list either (`BranchProtectionService._protectionRules`/`_codeOwners` are plain in-memory `List`s, same non-persistence issue as PRs).
- **Code review approvals**: gaia-space has `PullRequestReview.state` as free-text; Space models it as a typed 2-state `ReviewerState{Accepted,Rejected}` on the participant plus separate discussion-based "commented" — i.e. Space separates *approval state* from *commenting*, gaia-space conflates them into one `state` string.
- **CODEOWNERS**: data shape exists (`CodeOwnerConfiguration`) but is a simplified owner-ID-list-per-path map, not real `CODEOWNERS`-file parsing/precedence/role-owners.
- **Diff line model**: gaia-space's `GitDiffLine{type: addition/deletion/context, oldLineNum, newLineNum}` is comparable in spirit to Space's `DiffLine`/`DiffLineRange`, but Space's is generalized across inline+side-by-side with an explicit `LinesRangeMapping`/`BindingType` translation layer; gaia-space's diff viewer likely derives side-by-side positions ad hoc from the same flat hunk list (worth verifying in `diff_viewer.dart` internals if side-by-side alignment bugs appear).
- **Persistence**: `drift`/`sqlite3_flutter_libs` are pubspec dependencies but **not used** by any of the PR/branch-protection/code-owner services inspected — all current state is in-memory singletons that reset on app restart. This is an architectural gap independent of feature parity: even the features gaia-space "has" don't survive a restart yet.
