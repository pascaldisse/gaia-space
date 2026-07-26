# 02 — Planning / Issue Tracking (Project Management)

Sources:
- Decompiled Android client (jadx, Kotlin→Java, obfuscated field names but Kotlin `@Metadata` `d2=` annotations preserve real property names/types): `~/Downloads/space-clients/android/jadx-out/sources/circlet/planning/**`, `circlet/client/api/planning/**`, `circlet/client/api/fields/**`, `circlet/platform/api/customFields/**`, `circlet/android/ui/issue/**`.
- Live docs, recovered via Wayback Machine (jetbrains.com/help/space/* returns 404 live — cloud shut down June 2025, no CDN cache left). Snapshots fetched and cached to `/tmp/space-docs/*.md` during this research (not persisted — re-fetch via `web.archive.org/web/<ts>/https://www.jetbrains.com/help/space/<slug>.html` if needed again; CDX index of all archived Space help URLs at the time of research: `http://web.archive.org/cdx/search/cdx?url=jetbrains.com/help/space*&output=json&filter=statuscode:200`).
- gaia-space Flutter clone: `~/projects/gaia-space/lib/`.

---

## 1. Feature Overview (from docs)

Space's project management surface = **Issue Tracker** + **Issue Boards** built on top of it. Every project gets a built-in issue tracker (`issue-tracker.html`). Boards are a separate visualization/workflow layer synced to the tracker (`issue-boards.html`): "An issue board in Space is a project planning and management tool... can be adapted for Kanban, Scrum, or any hybrid system." A project can have multiple boards.

Core concepts, each independently documented:
- **Issues** — unique records (bug/task/feature), assignable, taggable, searchable/filterable/sortable (`issue-tracker.html`).
- **Issue Statuses** — lifecycle stage. 4 predefined: `Open`, `In Progress`, `Done`, `Backlog`. Statuses have a **Type**: resolved / unresolved, plus a color indicator. Fully customizable (add/edit/delete custom statuses) (`issue-statuses.html`).
- **Issue Boards** — columns mapped 1:1 (by default) to issue statuses; dragging a card between columns changes the issue's status and vice versa. Columns are configurable: rename, reorder, add/remove, **merge multiple statuses into one column** (`create-and-configure-an-issue-board.html`, `using-an-issue-board.html`).
- **Backlog** — per-board panel listing all candidate issues not yet on the board; toggle to add/remove. New issues can also be created directly from board columns (`using-an-issue-board.html`). Backlog has two population modes in the API: **Manual** vs **SearchBased** (saved-search-driven) — not mentioned in end-user docs, only in decompile (`BacklogType.java`).
- **Sprints** — fixed time-boxed periods (Scrum). First sprint defaults to calendar month from creation. Auto-rollover of unresolved issues to the next sprint when one ends. Lifecycle: `Planned → Current → Closed`. Force-start ("launch") a planned sprint early, optionally moving unresolved issues from the current sprint. Only Planned/Closed sprints are deletable; Current cannot be deleted (`sprints.html`).
- **Swimlanes** — horizontal grouping lanes on a board (mentioned in 2023 roadmap as "full-blown swimlanes" in progress; not in older help pages but fully implemented in the client — see §2). Group-by dimensions found in decompile: Assignee, Created By, Creation Time, Due Date, Custom Field value.
- **Custom Fields** (v1 UI + v2 HTTP API) — per-project extensible fields on issues. Documented types (`custom-fields-in-issues.html`): **Text, Number, List (single/multi, optionally open-ended/free-add), Checkbox, Date, Date and Time, Percentage, Organization member, Team, Location, Project, Link (URL), Issue (reference)**. Settings: name, description, type, multivalued, required, default value, constraints (min/max, regex pattern + custom error message for Text/Number/Date types), display order (drag to reorder). Field-type superset in the actual client code is much larger — see §2.
- **Time Tracking** — work items (date, duration in minutes, description) logged against a subject (issue) by a user; full CRUD via REST (`time-tracking.html`). Requires permissions `Manage own spent time` / `Manage any spent time` / `View spent time`.
- **Checklists** — separate entity from sub-items; ordered/nested "plan items" (`itemText`, `itemDone`) with move/reorder support, parent/child nesting (`checklists.html`).
- **Sub-items** — a per-issue nested tree of items that can each be (a) plain checklist-style lines, or (b) **converted into a real issue**, or (c) an **existing issue linked in** as a sub-item; supports indent/outdent (Tab) and reordering via toolbar (`subitems-in-issues.html`).
- **Tags** — lightweight per-project labels, hierarchical (`parent` ref), used for categorization/filtering.
- **Filters/Search** — by assignee, creator, tag, title, status, sprint, board, custom field, date ranges, etc. (`search-issues.html`, decompile `filters/` package — 25+ concrete filter VM classes, see §2).
- **Matrix report** — cross-tab report of issues by two axes (status/CF/etc.) — `matrix-report-for-issues.html`, decompile `IssueMatrixReport*`.
- **External issues** — linking/import from external trackers (Jira etc.) — `external-issues.html`, decompile `circlet/client/api/planning/ExternalIssue*`.

---

## 2. Real Data Model (from decompile)

### Core record: `circlet.planning.Issue` (file: `planning/Issue.java`)
Data class implementing `AExtendedEntityRecord, IssueRecord`. Recovered fields (from Kotlin metadata, since jadx obfuscated the Java field names `f63946a`..`f63968y`):

```
id: TID (String)
archived: Boolean
projectId: String?
projectRef: Ref<PR_Project>
trackerRef: Ref<IssueTracker>?
number: Int
createdBy: CPrincipal
creationTime: KDateTime
assignee: Ref<TD_MemberProfile>?
status: Ref<IssueStatus>
dueDate: KotlinXDate?
externalEntityInfo: Ref<ExternalEntityInfoRecord>?
tags: List<Ref<PlanningTag>>
title: String
attachmentsCount: Int?
subItemsCount: Int?
doneSubItemsCount: Int?
deploymentsCount: Int?
commentsCount: Int?
arenaId: String
deletedBy: CPrincipal?
deletedTime: KotlinXDateTime?
spentTime: ADuration?
messageOrigin: Ref<ChannelItemRecord>?
isUsingEntityAttachments: Boolean?
```
Also exposes derived `temporaryId` and `scope: ExtendedTypeScope.Container` (custom-field scope carrier).

Lighter-weight reactive projection used by list/board UIs — `circlet.planning.issue.model.IssueModel` (extends `IssueModelFields`), file `planning/issue/model/IssueModel.java` + `IssueModelFields.java`:
```
IssueModel: id: IssueIdentifier.Id, ref: Ref<Issue>, number: Property<Int>, project: Property<PR_Project>
IssueModelFields: tags: Property<List<Property<PlanningTag>>>, status: Property<IssueStatus>,
  title: Property<String>, assignee: Property<TD_MemberProfile?>, attachmentsCount: Property<Int>,
  subItemsCount: Property<Int>, doneSubItemsCount: Property<Int>, dueDate: Property<KotlinXDate?>
```

### `circlet.client.api.planning.IssueStatus` (file: `client/api/planning/IssueStatus.java`)
```
id: TID, archived: Boolean, name: String, resolved: Boolean, color: String, arenaId: String
```
→ confirms live-doc's "resolved/unresolved status type" + custom color.

### Board / Sprint / Swimlane records (`planning/BoardRecord.java`, `planning/SprintRecord.java`, `planning/SwimlaneRecord.java`)
```
BoardRecord:    id, temporaryId, archived, name: String?, arenaId
SprintRecord:   id, temporaryId, archived, board: Ref<BoardRecord>, name: String?,
                state: SprintState, from: KotlinXDate?, to: KotlinXDate?,
                default: Boolean, description: String?, arenaId
SprintState:    CLOSED | CURRENT | PLANNED   (matches sprints.html lifecycle exactly)
SwimlaneRecord: id, temporaryId, archived, sprint: Ref<SprintRecord>, board: Ref<BoardRecord>,
                name: String?, default: Boolean, arenaId
```

### Backlog type (`planning/BacklogType.java`, sealed)
```
BacklogType.Manual(neverUsed: Boolean)
BacklogType.SearchBased(searchExpression: IssueSearchExpression)
```
→ boards can populate their backlog either by manual issue selection or by a live saved search — not documented anywhere in the end-user help, only visible in the client.

### Tags (`planning/PlanningTag.java`)
```
id: TID, archived: Boolean, projectId: String, parent: Ref<PlanningTag>?, name: String, arenaId
```
→ tags support **hierarchy** (parent tag), not exposed in the basic help article (`tag-an-issue.html` / `manage-issue-tags.html` are UI-only, no mention of nesting).

### Custom fields — type system (`circlet/platform/api/customFields/ExtendedType.java` + `circlet/client/api/fields/type/*`)
`ExtendedType(key, displayName, apiClassName, scopeType: ExtendedTypeScopeType)` is the generic extension-point registry Space uses for anything pluggable (custom field types, but also VCS commit refs, KB documents, etc. reuse the same mechanism — see `circlet/kb/customFields/Document*`, `circlet/code/customFields/VcsCommit*`).

Issue-specific custom field type: `circlet.planning.IssueCFType extends CFType` (file `planning/IssueCFType.java`) — lets a custom field's value literally *be a reference to another Issue* (matches doc's "Issue" field type). There's also `IssueListCFType` for multi-issue-reference fields.

Full concrete `CFType`/`CFValue` implementations found under `client/api/fields/type/` (52 files) — this is the authoritative field-type superset, richer than what the help article documents:
```
StringCFType / StringListCFType          → docs "Text" (+ multi)
IntCFType / IntListCFType                → docs "Number" (+ multi)
EnumCFType / EnumListCFType              → docs "List" (single/multi)
OpenEnumCFType / OpenEnumListCFType      → docs "List" with Open-ended
BooleanCFType                            → docs "Checkbox"
DateCFType                               → docs "Date"
DateTimeCFType                           → docs "Date and Time"
PercentageCFType                         → docs "Percentage"
FractionCFType                           → (undocumented) fractional number
ProfileCFType / ProfileListCFType        → docs "Organization member" (+ multi)
TeamCFType                               → docs "Team"
LocationCFType                           → docs "Location"
ProjectCFType                            → docs "Project"
UrlCFType                                → docs "Link"
ContactCFType / ContactListCFType        → (undocumented) contact-method reference
AutonumberCFType                         → (undocumented) auto-incrementing number
circlet.planning.IssueCFType / IssueListCFType → docs "Issue" (+ multi, planning-specific)
```
Each type has matching `*CFValue`, `*CFInputValue`, `*CFFilter`, and (where relevant) `*CFParameters`/`*CFConstraint`/`*CFUpdateParameters` classes — i.e. every field type has 4-6 companion classes for value/input/filter/constraint, consistent with the docs' "Constraints" (min/max/regex+message) settings section.

Generic custom-field plumbing (`client/api/fields/*`, ~45 files): `CustomField`, `CustomFieldData`, `CustomFieldType`, `CustomFieldValue`, `CustomFieldValueUpdate`, `CustomFieldOrder`, `CFEnumValue`/`CFEnumValueModification` (enum-list value CRUD), `CFConstraint`, `AccessType` (Public/Confidential/Restricted — matches `add-and-edit-custom-fields.html`'s profile-field access levels), `CustomFieldsApi` / `CustomFieldsService` (RPC surface).

**HTTP API (from live `custom-fields-v2.html`, fully recovered):**
```
POST   /api/http/custom-fields-v2/values/{entity}                                   set values (bulk)
GET    /api/http/custom-fields-v2/values/{entity}                                   get all values
POST   /api/http/custom-fields-v2/values/{entity}/{customField}                     set single value
GET    /api/http/custom-fields-v2/values/{entity}/{customField}                     get single value
POST   /api/http/custom-fields-v2/{entityType}/fields                               create field
GET    /api/http/custom-fields-v2/{entityType}/fields                               list fields (?withArchived)
POST   /api/http/custom-fields-v2/{entityType}/fields/reorder                       reorder
GET|PATCH|DELETE /api/http/custom-fields-v2/{entityType}/fields/{customField}       CRUD single field
POST   /api/http/custom-fields-v2/{entityType}/fields/{customField}/archive|restore
POST   /api/http/custom-fields-v2/{entityType}/fields/{customField}/enum-values                    create enum value
GET    /api/http/custom-fields-v2/{entityType}/fields/{customField}/enum-values                    list (paginated, $skip/$top, ordering)
PATCH  /api/http/custom-fields-v2/{entityType}/fields/{customField}/enum-values                    rename
POST   /api/http/custom-fields-v2/{entityType}/fields/{customField}/enum-values/bulk-update
DELETE /api/http/custom-fields-v2/{entityType}/fields/{customField}/enum-values/{enumValueToRemove}
```
`entity` path param is a tagged union: `absence | issue (IssueIdentifier) | membership | profile | team`. `entityType` (for field *definitions*) is: `absence | issueTracker (IssueTrackerIdentifier) | membership | profile | team` — i.e. custom fields are a cross-cutting subsystem, issues are just one consumer (`issueTracker` scope).

### Checklists (`planning/Checklist.java`, `IssueChecklists.java`, `planning/checklist/*`)
`IssueChecklists` is an `ExtRecord<Issue>` (extension record hanging off Issue): `id, projectId, checklists: List<Ref<Checklist>>, arenaId` (+ derived `archived`, `temporaryId`).
Client-side tree logic lives in `planning/checklist/`: `PlanItemsTreeVm`, `PersistentPlanItemsTreeVm`, `PlanTreeItem`, `ChecklistPlanItemsTreeVm` (bulk load, drag/move, "convert to issue" — `convertToIssue` method confirms the sub-items↔issue conversion feature from the docs), `ChecklistTagVM`.

**HTTP API (from live `checklists.html`):**
```
POST   /api/http/checklists/{checklist}/items                    create plan item (top-level or child of parentItem)
POST   /api/http/checklists/{checklist}/items/{planItem}/move    move (targetParent + optional afterItem for ordering)
GET|PATCH|DELETE /api/http/checklists/{checklist}/items/{planItem}   itemText / itemDone patchable
```
`PlanItem` shape (inferred from PATCH body): `{ itemText: string, itemDone: boolean }` + parent/child linkage via `PlanItemIdentifier`.

### Time tracking (`planning/timetracking/*`)
`TimeTrackingItemVM` (file `TimeTrackingItemVM.java`) wraps `Ref<TimeTrackingItem>`; exposes `item`, `subjectRef`, `subject` (lazy-loaded `ARecord`), `delete()`, `toDraft()`, `restartTimer()` — i.e. there's a **running timer** concept (`TimeTrackingTimerVm.java`: `startTimer`, `startedTime`) in addition to manually-logged items. `TimeTrackingSettingsVM` controls whether tracking is `enabled` per project.

**HTTP API (from live `time-tracking.html`):**
```
POST   /api/http/time-tracking/items      create { subject: TimeTrackingSubjectIdentifier, userId, date (full-date), duration (int minutes, >0), description? }
GET    /api/http/time-tracking/items      list ?subject=issue:<IssueIdentifier> (paginated $skip/$top)
PATCH  /api/http/time-tracking/items/{itemId}   partial update (userId/date/duration/description)
DELETE /api/http/time-tracking/items/{itemId}
```
Permissions gate: `Update issues`, `Manage own spent time`, `Manage any spent time`, `View spent time`.
`Issue.spentTime: ADuration?` on the Issue record is the rolled-up total (denormalized).

### Board/Sprint client VM layer (behavioral reference, decompile only — not a wire format)
`circlet.planning.board.SprintVm` (file `board/SprintVm.java`) is the richest single class for board runtime behavior:
- `swimlanes: Property<List<SwimlaneVm>?>`, `defaultSwimlane`, `createSwimlaneVm/createSwimlane/removeSwimlane/updateSwimlane(newName)`.
- `filteredIssuesByExpression` / `filteredIssuesLoading` / `clientFilteredIssues` / `filteredIssues` — layered filtering: server-side `IssueSearchExpression.And(supportExpression, BoardFieldFilter(BOARD=this sprint))` first, then client-side re-filter for optimistic/just-added issues (`optimisticIssueIds`, `lastLoadedIssueIds`).
- `sprintFilterVm: SprintFilterVm` composes `RegularIssuesFiltersVm` + a `PlanningTagsVM`.
- `addIssue(ref, anchor?)`, `addIssues(refs)`, `removeIssue`, `moveBefore`, `containsIssue`.
- Swimlane group-by parameter VMs (`board/swimlane/*`): `AssigneeSwimlaneParameterVm`, `CreatedBySwimlaneParameterVm`, `CreationTimeSwimlaneParameterVm`, `CustomFieldSwimlaneParameterVm`, `DueDateSwimlaneParameterVm` — confirms swimlanes can group by **Assignee, Created By, Creation Time, Due Date, or any Custom Field**.
- `BoardVm` (file `board/BoardVm.java`): `createNewStatus`, `updateBacklogType`, `boardSettings`, `userTeams`.
- Board settings split into dedicated VMs (`board/settings/*`): `BoardGeneralSettingsVm`, `BoardColumnsSettingsVm` (+ `BoardSettingsColumnVm` = one status-group-to-column mapping, matches "combine statuses into one column" from docs), `BoardCardsSettingsVm` (what fields show on a card), `BoardSwimlanesSettingsVm`, `BoardBacklogSettingsVM`.
- Backlog runtime split by `BacklogType`: `board/backlog/services/ManualBacklogIssuesService.java` vs `SearchBackliogIssuesService.java` implementing common `BacklogIssuesService` / `BacklogIssuesFluxModel` (`XBasicFlux<Issues.LazyIssueRef>` with a `size: LifetimedLoadingProperty<Int>`).

### RPC surface — `Boards` service (`planning/api/impl/BoardsProxy*`, ~50 methods; authoritative action list)
```
createBoardInProject, updateBoard, archiveBoard, archiveBoardInProject, getBoard,
projectBoards, findBoards, findBoardOrGetFirstStarred, findBoardAndSprintOrDefault,
getBoardsAndSprintsInProject, getBoardSelectorValues, starredBoards, starredBoardsWidgets,

createSprint, updateSprint, archiveSprint, launchPlannedSprint, findSprints,
findSprintOrGetCurrent, getSprintsCount, projectSprints, projectSprintsInternal,
sprintIssues, updateIssueSprints, bulkAddIssuesSprints, bulkRemoveIssuesSprints,
bulkUpdateIssuesSprints,

createSwimlane, updateSwimlane, removeSwimlane,

addIssueToBoard, removeIssueFromBoard, addIssueToSprint, removeIssueFromSprint,
addIssueToSwimlane, removeIssueFromSwimlane, boardIssues,

findBacklogs, getBacklogIssueRefs, getBacklogIssueLazyRefs,
addIssuesToBacklogs, removeIssuesFromBacklogs, setBacklogsToIssue, setBacklogsToIssues,
changeIssuePositionInBacklog,

allTagsInSprint, preloadBoardAndIssues
```

### Filters (`planning/filters/*`, 30+ classes — authoritative filter dimensions)
`AssigneeIssueFilterVm`, `CreatedByIssueFilterVm`/`CreatedByPrincipalIssueFilterVm`, `CreationTimeIssueFilterVm`, `DueDateIssueFilterVm`, `DateRangeIssueFilterVm`, `StatusIssueFilterVm`, `TagIssueFilterVm`, `CustomFieldIssueFilterVm`, `BoardsIssueFilterVm`/`BoardSprintsIssueFilterVm`, `SubscriberIssueFilterVm`, `TextSearchIssueFilterVm`, `DeploymentFilterVm`, `ImportTransactionIssueFilterVm`, `BacklogIssueFilterVm`, plus generic `SingleValueIssueFilterVm`/`MultiValueIssueFilterVm` base classes and `RegularIssuesFiltersVm`/`RegularIssueQuickFiltersVm` (quick-filter chips) composing them all + `FilteredIssuesVM` (the actual query executor).

### Sub-items vs. Checklists — two distinct systems confirmed
- **Sub-items**: `planning/IssueSubItemsList.java`, `IssueSubItemsListArena.java`, `IssueParents.java`/`IssueParentsArena.java` — a list of *issue* refs (parent/child issue graph), UI in `android/ui/issue/details/IssueSubItemsBottomSheet.java`, `IssueParentView*`. This is issue-to-issue hierarchy (epics/sub-tasks), separate from...
- **Checklists**: `Checklist`/`IssueChecklists`/`checklist/*` — free-text nested to-do trees per issue (see above), independently CRUD'd via `/api/http/checklists/*`, UI in `android/ui/issue/details/IssueChecklistView*`.

---

## 3. Key Features List

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | Issue CRUD w/ number, title, assignee, status, due date, tags | Core | `Issue.java`, `issue-tracker.html` |
| 2 | Custom issue statuses (name, color, resolved/unresolved type) | Core | `IssueStatus.java`, `issue-statuses.html` |
| 3 | Issue Boards (Kanban), multi-board per project | Core | `BoardRecord.java`, `issue-boards.html` |
| 4 | Board columns: rename/reorder/add/remove/merge statuses | Core | `BoardColumnsSettingsVm.java`, `create-and-configure-an-issue-board.html` |
| 5 | Board card field config (what shows on a card) | Feature | `BoardCardsSettingsVm.java` |
| 6 | Backlog panel — manual toggle-add | Core | `ManualBacklogIssuesService.java`, `using-an-issue-board.html` |
| 7 | Backlog — search-based (saved query) auto-population | Advanced (undocumented) | `BacklogType.SearchBased`, `SearchBacklogIssuesService.java` |
| 8 | Sprints: create/edit/delete, schedule (from/to), goal text | Core | `SprintRecord.java`, `sprints.html` |
| 9 | Sprint lifecycle: Planned → Current → Closed, force-launch, issue rollover | Core | `SprintState.java`, `sprints.html` |
| 10 | Swimlanes, default swimlane, group-by (Assignee/CreatedBy/CreationTime/DueDate/CustomField) | Advanced | `board/swimlane/*` |
| 11 | Drag/drop card between columns ⇄ status change | Core | `using-an-issue-board.html` |
| 12 | Tags (hierarchical, per-project) | Core | `PlanningTag.java`, `manage-issue-tags.html` |
| 13 | Custom fields — 15+ types incl. Text/Number/List/Checkbox/Date/DateTime/Percentage/Fraction/Member/Team/Location/Project/Url/Contact/Autonumber/Issue-ref, single & multi-valued, open-ended enums | Core | `client/api/fields/type/*`, `custom-fields-in-issues.html` |
| 14 | Custom field constraints (min/max/regex+message), required, default value, ordering | Core | `CFConstraint.java`, `custom-fields-in-issues.html` |
| 15 | Custom fields v2 full REST CRUD incl. enum-value management | Core | `custom-fields-v2.html` (endpoints above) |
| 16 | Time tracking: log/edit/delete work items (date+duration+desc), running timer, per-project enable toggle, spentTime rollup on Issue | Core | `timetracking/*`, `time-tracking.html` |
| 17 | Checklists: nested plan items, move/reorder, done toggle, separate from sub-items | Core | `checklist/*`, `checklists.html` |
| 18 | Sub-items: nested tree, indent/outdent, convert item→issue, link existing issue as sub-item | Core | `IssueSubItemsList.java`, `subitems-in-issues.html` |
| 19 | Filters: assignee/creator/tag/status/board/sprint/customfield/date-range/text/deployment/subscriber, quick-filter chips | Core | `filters/*` (30+ classes) |
| 20 | Search issues (text + structured expression `IssueSearchExpression`) | Core | `search-issues.html`, `client/api/search/IssueSearchExpression*` |
| 21 | Matrix report (cross-tab by 2 axes) | Advanced | `IssueMatrixReport*.java`, `matrix-report-for-issues.html` |
| 22 | External issue tracker linking/import (e.g. Jira) | Advanced | `client/api/planning/ExternalIssue*.java`, `external-issues.html` |
| 23 | Issue attachments (incl. image previews) | Core | `planning/attachments/*` |
| 24 | Issue comments / activity timeline | Core | `issue-tracker.html` (commentsCount on Issue) |
| 25 | Bulk operations (add/remove/update issues across sprints/backlogs) | Advanced | `bulkAddIssuesSprints` etc. (BoardsProxy) |
| 26 | Starred boards / starred-board widgets (dashboard) | Feature | `starredBoards`, `starredBoardsWidgets` |
| 27 | Export issues to Excel | Feature | `export-issues-to-excel.html` (live doc title only) |
| 28 | Clone an issue / move issue to another project | Feature | `clone-an-issue.html`, `move-an-issue-to-another-project.html` (live doc titles) |

---

## 4. gaia-space Gap Analysis

gaia-space currently models "planning" entirely through **`Project`** (`lib/core/models/project.dart`) — there is no separate `Issue`/`Task` domain model; `task_screen.dart` reuses the `Project` type (imports `project.dart`, aliases usages as `Task`). Two near-duplicate screens exist: `project_screen.dart` and `task_screen.dart`, both ~1800 lines, both implementing the same single-status Kanban pattern independently (candidate for de-duplication regardless of parity work).

### HAVE (exists in gaia-space today)
- **Flat Kanban board**: 3 fixed columns (`To Do` / `In Progress` / `Completed`) via `drag_and_drop_lists` package, `TaskViewType.kanban` vs `.list` toggle. — `task_screen.dart:380-524`, `project_screen.dart:375-519`. Roughly matches Space's *default* 3-status board, but **not configurable** (no custom statuses, no column-to-status remapping, no merging statuses).
- **Status enum**: `ProjectStatus { todo, inProgress, completed }` — fixed, hardcoded, not user-editable. Cf. Space's fully custom `IssueStatus` (name/color/resolved-type, arbitrary count).
- **Assignees**: `List<ProjectRole>` (id/userId/userName/role/avatarUrl) — role-based, not a plain assignee ref. Space's `Issue.assignee` is a single `Ref<TD_MemberProfile>`.
- **Sub-tasks**: `List<SubTask>` (id, title, isCompleted, assignedTo, dueDate) — flat list only, **no nesting**, **no reordering API**, **no convert-to-issue**. Partially covers Space's *Sub-items* concept but is much shallower (Space sub-items nest arbitrarily deep and can promote to full issues).
- **Git references**: `List<GitReference>` (url, title, commitId, branch, pullRequest) — ad hoc equivalent of Space's commit/code-review linking, but not modeled as a generic custom field or arena.
- **Due date, priority (String?), notes (String?), completionPercentage, order (Int?)** — loose scalar fields bolted onto `Project`, functionally overlapping with what Space treats as **custom fields** (Percentage type, Priority as an Enum CF) rather than hardcoded columns.
- **Drag/drop reordering** within and across kanban columns, with order persistence (`_kanbanLists`, `_updateTaskOrder`-style logic) — comparable to Space's board card ordering, but local/manual only (no `changeIssuePositionInBacklog`-style backend concept since there's no backend split of board/backlog).

### MISSING (no equivalent at all)
- **Issue Boards as distinct entities from the task list** — Space separates *Issue* (tracker record) from *Board membership* (an issue can be on 0..n boards/sprints); gaia-space conflates "the task" and "the kanban card" into one `Project`/`Task` object with no board concept.
- **Sprints** — no time-boxed iteration concept, no Planned/Current/Closed lifecycle, no rollover.
- **Swimlanes** — no secondary grouping axis on the board at all.
- **Backlog** (manual or search-based) — no notion of "issues not yet on a board."
- **Custom Fields system** — zero generic/extensible field infrastructure; every "extra" attribute (priority, notes, %complete) is a hardcoded column on `Project` instead of a user-definable field with type/constraints/default/ordering.
- **Time Tracking** — no work-item logging, no timer, no spent-time rollup.
- **Checklists** (as distinct from sub-tasks) — no nested plan-item tree with per-item move/done separate from the flat `SubTask` list.
- **Tags** — no tagging system at all (hierarchical or flat).
- **Filters/Search** — no structured filter system (by assignee/tag/status/date-range/etc.), no saved/quick filters.
- **Issue statuses as configurable data** — statuses are a Dart `enum`, not user-editable records with color/resolved-flag.
- **Board settings** — no per-board column mapping, card-field config, or swimlane config UI.
- **Attachments** as a first-class issue feature (beyond ad hoc `avatarUrl`).
- **Comments / activity timeline** on a task.
- **Matrix reports**, **external issue tracker linking**, **bulk operations**, **starred boards**, **export to Excel**.

### PARTIAL
- **Kanban view** exists but is single-status-set, single-board, non-configurable — would need: (a) extraction of `Issue` as its own model separate from `Project`, (b) a `Board`/`Column` model referencing configurable `Status` records, (c) many-to-many issue↔board membership instead of one embedded status field.
- **Sub-items/checklist** functionality exists only as flat `SubTask` — needs tree structure + move/indent + optional "promote to task" to reach parity with either Space feature.
- **Assignee model** exists but is richer/role-based rather than Space's simple profile-ref — direction differs, not strictly "missing," but incompatible shape for parity mapping (would need adapter or simplification).
- **Custom-field-shaped scalars** (`priority: String?`, `notes: String?`, `completionPercentage: double?`) exist as fixed columns; achieving real parity means generalizing these into the custom-fields system rather than keeping them hardcoded.

### Recommended parity path (priority order, not prescriptive)
1. Split `Task`/`Issue` out of `Project` as its own model; keep `Project` as the container.
2. Introduce a `Status` record (id, name, color, resolved: bool) replacing the `ProjectStatus` enum; make boards reference an ordered list of `Status`.
3. Introduce `Board`/`Column`/`BoardColumn→Status[]` mapping, decoupled from the task's own status field (mirrors Space's column↔status many-to-one).
4. Add a minimal custom-fields engine (type, value, constraints) before re-implementing priority/notes/% as hardcoded fields again elsewhere.
5. Sprints + swimlanes only after boards are decoupled from tasks (they're additive layers on top of the board model).
6. Tags, checklists-as-tree, and time tracking are independent/parallel work — no ordering dependency on the above.
