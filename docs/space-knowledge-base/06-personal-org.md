# Personal / Org Layer — JetBrains Space Knowledge Base

Domain: everything the personal-productivity/org-directory layer covers that 01-05
skipped — To-Do lists, Absences/Vacations, Org Chart/Locations/Offices, Member
Profile depth, Blogs (as distinct from the Document record), Notifications +
Subscriptions, Global Search (Goto/FTS), Personal/Project Dashboards (feed/highlights).

Sources:
- Decompiled Android client: `~/Downloads/space-clients/android/jadx-out/sources/circlet/`
  — `todo/` (59 files), `absences/` (22), `client/api/{Todo*,Absence*,TD_Location,
  TD_MemberProfile,TD_MemberLocation}.java`, `teamdir/` (5), `profile/` (37),
  `blogs/` (226) + `client/api/ArticleRecord.java`, `notification/` (8),
  `subscriptions/` (36), `gotoEverything/` (82) + `advancedSearch/` (26),
  `landing/` (7) + `client/api/dashboards/` (45+ widget-settings classes),
  `android/ui/{todo,absence,profile,myProfile,blogs,gotoScreens,dashboard,team}/`.
  Kotlin `@Metadata(d2=...)` strings recovered exact field/enum names (obfuscated
  bytecode names ignored, annotation strings used instead — same method as 01-05).
- Live docs: `jetbrains.com/help/space/*` — **contrary to 01-05's finding that most
  pages 404**, a good fraction of the *personal/org* pages are still live directly
  (not just via Wayback): `to-do-list.html`, `vacation-and-other-absences.html`,
  `inform-others-of-your-absence.html`, `absence-history.html`,
  `create-and-edit-locations.html`, `advanced-team-directory.html`,
  `teams-and-members.html`, `find-a-member.html`, `edit-user-profiles.html`,
  `find-anything-in-chats.html`, `notifications.html` all returned 200 on
  2026-07-26 fetch. `blogs.html` (the HTTP-API-reference page, not a feature
  page) is dead live but has a Wayback snapshot (2021-09-25) and was used.
  `homepage.html` (personal-dashboard feature page) is dead with **no** Wayback
  snapshot — flagged, not fabricated. `blog.jetbrains.com/space/*` posts used
  for feature-intent prose (all live, all carry the "discontinued June 1, 2025"
  banner).
- gaia-space app: `~/projects/gaia-space/` — **not the Flutter/`lib/` tree 01-05
  describe**; current tree is a Tauri (Rust `src-tauri/src/` + React `src/`)
  rewrite, ~2571 lines total, one thin `.rs` module + `ResourceView.tsx` list
  view per domain (Members, Chat, Documents, etc.), no personal/org concepts at
  all yet — see §5.

---

## 1. To-Do Lists

### 1.1 Feature Overview (live doc `to-do-list.html`, blog "Introducing the
Personal To-Do List in Space" 2020-04-30)
"Your to-do list helps you plan and manage your daily tasks and goals. Think of
it as your personal memo pad... The to-do list can also serve you as a
**bookmark folder**: you can add messages, blog posts, documents, issues and
reviews to it. Every item... can be **converted to an issue** and added to any
of your projects." Items default to "due today"; unchecked items roll to the
next day; items can be **postponed** to a specific future date (**Later**
list vs **Today** list). Integrated at launch (2020) with Chats, Blogs, Issues;
decompile shows it later grew to cover Documents and Code Review too.

### 1.2 Real Data Model (decompiled)
- `TodoItemRecord` (`client/api/TodoItemRecord.java`, `ARecord`): `id`,
  `temporaryId`, `archived`, `created`/`updated` (`KotlinXDateTime`), `content`
  (`TodoItemContent`), `_status` (private-backed, see `TodoStatus`), `dueDate`
  (`KotlinXDate`), `dueTime`, `notificationRequired`, `arenaId`.
- `TodoListRecord`: `id`, `list: List<Ref<TodoItemRecord>>`, `arenaId` — one
  list record per member (the personal to-do list container).
- `TodoStatus` (`OrderedEnum`): **`Open`, `Closed`, `Archived`**.
- `TodoOrigin` — where an item was created from: **`UNKNOWN`, `ONBOARDING`,
  `SHORTCUT`, `TODO_PANEL`, `CHAT`, `ISSUE`, `DOCUMENT`, `BLOG`,
  `CODE_REVIEW`** — confirms the "bookmark any entity into your to-do list"
  mechanic is a first-class origin tag, not just free text.
- `TodoItemContent` / `TodoItemContentKind` / `TodoItemContentMdText` /
  `TodoItemContentText` — item body can be plain text or markdown, plus a
  structured `TodoAnchor` (`id`, `tempId`) linking back to the source entity
  (chat message, issue, etc.) when origin ≠ UNKNOWN/SHORTCUT.
- `TodoDueTimeNotificationEvent` / push payloads `PushTodoReminderPayload`,
  `PushTodoReminderReadPayload` — due-time reminder notifications are their own
  push type.
- `client/api/planning/CreateExternalIssueFromTodoItemRequest` — confirms the
  "convert to issue" action is a dedicated API call, not client-side sugar.
- `client/api/dashboards/ToDoDashboardWidgetSettingsApi`/`...In` — the to-do
  list is also a pluggable **personal-dashboard widget** (§7).
- Client VM layer (`todo/`): `TodoListVm`/`TodoListVmImpl`, `TodoEditorVm`
  (create/edit), `TodoEditorDateMode` (Today/Tomorrow/custom date),
  `TodoPostponeDateCalculator`, `TodoItemCategory`/`TodoItemCategoryInTree`
  (Today/Later grouping + overdue), `TodoTreeItemInterface`/`TodoFilteredTreeModel`
  (tree grouping by category), `TodoIndicatorVm` (unread/due-count badge).
- Permissions: `common/permissions/{ViewTodoTask,EditTodoTask,TodoRights}` —
  scoped per-member (your own list only; no shared/team to-do list concept
  found in decompile).

### 1.3 Key Features List
- Personal, single-list-per-member (`TodoListRecord` 1:1 member), not project-scoped.
- Today / Later views; auto-rollover of unchecked items to next day; explicit postpone-to-date.
- Bookmark-from-anywhere: chat message, blog post, document, issue, code review → tagged with `TodoOrigin` + `TodoAnchor` back-reference.
- One-click "convert to issue" (dedicated API, carries origin context).
- Due date + due time + optional reminder notification (push).
- Status lifecycle: Open → Closed → Archived (soft states, not deleted).
- Markdown-capable item body.
- Surfaced as a homepage dashboard widget (`ToDoDashboardWidgetSettings*`).

---

## 2. Absences / Vacations

### 2.1 Feature Overview (live docs `vacation-and-other-absences.html`,
`inform-others-of-your-absence.html`, `absence-history.html`,
`advanced-team-directory.html`; blog "Manage Employee/Vacations in Space" 2020)
"Space makes each employee's availability — present and planned — visible to
all organization members. Whenever you're home sick, planning a vacation, or
going on a business trip — your teammates will be informed and able to adjust
their work plans." Flow: member posts a planned absence with dates + reason →
**Team Lead approval** required (reason itself stays confidential, visible
only to Team Lead + HR/authorized staff, though a status like "on vacation"
can be shared publicly) → absence appears in Team Lead's approval queue, in the
member's Absence History, on Team-directory Calendar tab, and (if subscribed)
in personal/channel notification feeds.

### 2.2 Real Data Model (decompiled)
- `AbsenceRecord` (`client/api/AbsenceRecord.java`, extends
  `fields.AExtendedEntityRecord` — i.e. it participates in the **generic
  Custom Fields engine** the 00-INDEX cross-cutting section flags): `id`,
  `archived`, `member: Ref<TD_MemberProfile>`, `icon`, `reason:
  AbsenceReasonRecord`, `description`, `since`/`till: KotlinXDate`,
  `location: Ref<TD_Location>`, `available: Boolean`, `approval:
  AbsenceApproval`, `category`, `customFields:
  List<CustomColumnValuesWithSchemaData>`, `arenaId`.
- `AbsenceReasonRecord` (org-configurable, separate table — matches "Vacation
  (official vacations)" example from the blog): `id`, `archived`, `name`,
  `description`, `defaultAvailability: Boolean`, `approvalRequired: Boolean`,
  `icon`, `etag`, `category`, `arenaId`.
- `AbsenceApproval`: `approved: Boolean`, `approvedBy: Ref<TD_MemberProfile>`,
  `approvedAt: KDateTime` — single-approver model, not a multi-step workflow.
- `AbsenceCategories`: `RemoteWork`, `None` (a built-in category distinct from
  reason, used to flag "still working, just remote" vs a true absence).
- `AlterAbsenceMode`: `ADD`, `EDIT` (client VM mode enum for the create/edit form).
- Events/subscriptions: `AbsenceCreated`, `AbsenceUpdated`, `AbsenceDeleted`,
  `AbsenceApproved`, `AbsenceApprovalRevoked`, `AbsenceCommonSubscriptionFilter`
  — absences are a first-class subscribable event source (feeds directly into
  §6's Subscriptions system, matching 04's note that Chat channels can
  subscribe to "Issues, Blogs, Absences, etc.").
- Chat integration: `M2AbsenceItemContent`/`...ApprovedContent`/
  `...DeletedContent`/`...UpdatedContent` — an absence request/approval renders
  as a rich, actionable card *inside chat* (approve/reject buttons live in
  `android/ui/chat/utils/ActionsListenerUtils` — `approveAbsence`,
  `checkAbsence`, `deleteAbsenceApprove`).
- Permissions (`common/permissions/`): `ViewAbsences`, `EditAbsences`,
  `EditPastAbsences` (retroactive edit is a separate right), `ApproveAbsences`,
  `ViewAbsenceApproval`, `ViewAbsenceTypes`/`EditAbsenceTypes` (managing the
  reason catalog is its own right), `ViewAbsenceReason`.
- Personal history/list VMs: `ProfileAbsenceHistoryVM` (per-profile, "all your
  absences: past, current, scheduled" per the doc), `AlterAbsencesVM` (bulk
  create/edit), `LocationsListVm` (location picker for the absence form —
  "location" here doubles as "which office's holiday calendar applies", tying
  into §3's Locations and `meetings/vm/ProfileAbsencesAndHolidaysVM` +
  `holidays/WorkingDaysVm` for public-holiday overlay).
- Landing/dashboard surface: `landing/EventsAndAbsencesVM` (birthdays +
  calendar events + all-holidays + absences on the personal homepage, §7) and
  `android/ui/dashboard/{AbsencesAdapter,AbsencesItemViewModel,AbsencesUtilsKt}`.

### 2.3 Key Features List
- Reason catalog is org-configurable (`AbsenceReasonRecord`), not a fixed enum — each reason has its own default-availability + approval-required flags.
- Confidential-by-default reason, visible availability status.
- Single Team-Lead-or-delegate approval step (`AbsenceApproval`), surfaced as an actionable chat card.
- Per-member absence history + org-wide "Advanced Team Directory → Calendar" view (needs on-prem "advanced team directory" optional feature flag).
- Absences use the shared Custom Fields engine — orgs can attach extra structured metadata (e.g. cost-center, backup-contact) without schema changes.
- Full event stream (created/updated/deleted/approved/revoked) feeds Subscriptions (§6) and Locations' working-hours/holiday calendar (§3).
- RemoteWork is a built-in non-absence category (distinguishes "away" from "working elsewhere").

---

## 3. Org Chart / Locations / Offices / Team Directory

### 3.1 Feature Overview (live docs `advanced-team-directory.html`,
`teams-and-members.html`, `create-and-edit-locations.html`, `find-a-member.html`)
"Teams is a directory that represents your actual organization structure. It
can be flat and simple or have a complex multi-level hierarchy with parent and
child teams (sub-teams)" (05 already covers this `TD_Team` hierarchy/roles
layer in depth — not re-documented here). **Advanced Team Directory** is a
separate optional admin-enabled feature: adds Positions, Managers, a
company-wide **Feed** (join/leave/role-change events), a **Members** search
tab, and a **Calendar** tab (org-wide absence overview). **Locations**
"represent the actual locations of your organization facilities — be it a
single office or multiple buildings around the world," nested by type:
**Region → Campus → Building → Floor → Room / Conference Room**, each with
time zone, custom working schedule, phones/emails, equipment (booking
prerequisite for Meetings), address, description.

### 3.2 Real Data Model (decompiled)
- `TD_Location` (`client/api/TD_Location.java`, `ARecord`): `id`, `name`,
  `timezone: ATimeZoneWithOffset`, `tz`, `workdays: Integer[]`,
  `phones/emails: String[]`, `equipment: String[]` (legacy) +
  `equipment2: List<TD_LocationEquipmentTypeRecord>` (typed, replaces the
  string list), `description`, `address`, `parent: Ref<TD_Location>`
  (self-referential — the nesting), `type` (see `LocationType`), `mapId`
  (floor-plan image), `capacity: Int?`, `channelId` (a chat channel bound to
  the location — notifications), `archived`, `arenaId`.
- `LocationType` (`circlet.common.locations.LocationType`, `OrderedEnum`):
  **`Region, Campus, Building, Floor, Room, ConferenceRoom`** — exact 1:1
  match with the live doc's list; each has `canBeChildOf(parent)`,
  `canHaveMap()`, `canHaveCapacity()` rules (e.g. only Room/ConferenceRoom get
  capacity + map booking, matching "Make sure to specify the correct
  equipment for conference rooms — required for trouble-free booking").
- `TD_LocationEquipmentTypeRecord`: `id`, `name`, `archived`, `arenaId` —
  org-defined equipment catalog (projector, whiteboard, etc.), referenced by
  `equipment2` and used by Meetings' room-booking filter.
- `TD_MemberLocation` (desk/seat assignment, not just office pick): `id`,
  `location: Ref<TD_Location>`, `locationMapPoints:
  List<TD_LocationMapPoint>` (an x/y point on the floor map = desk booking),
  `since`/`till: KotlinXDate`, `member`, `archived`. `MemberLocationsProxy`
  (`client/api/impl/`) exposes `getMemberLocation`/`createMemberLocation`/
  `updateMemberLocation`/`deleteMemberLocation`/`getLocationStats`.
  `ProfileLocationsRecord` (`ExtRecord<TD_MemberProfile>`): `id`, `locations:
  List<TD_MemberLocation>`, `arenaId` — a member can have several
  location/desk assignments over time (history, not just current).
- `teamdir/TeamDirectoryVm`/`TeamDirectoryVmKt`/`TeamDirectoryStateKt` +
  `MatchResults`/`SearchResult` — the directory search/filter VM behind
  "Teams" nav + `find-a-member.html`'s "browse all org members" flow; filters
  by **Position** and **Location** per the live doc.
- `features/Locations.java` — Locations is itself a gate-able optional feature
  flag (same pattern as Advanced Team Directory).

### 3.3 Key Features List
- Typed, nested location hierarchy (6 fixed types) with per-type structural rules — not a free-form tree.
- Per-location time zone + custom working schedule (feeds absence/holiday calculations, §2).
- Per-location equipment catalog, required for conference-room booking (Meetings dependency).
- Desk/seat booking via floor-map point (`TD_LocationMapPoint`) with date-ranged history, not just a static "office" field on the profile.
- Location bound to its own chat channel (location-scoped notifications/subscriptions).
- Team Directory search filters by Position + Location; Advanced Team Directory adds company Feed + org-wide Calendar (both admin-gated optional features, same gating mechanism as most Space add-ons).
- 05's `TD_Team` parent/child hierarchy + Position/Manager fields are the *reporting-line* org chart; `TD_Location` is the *physical* org chart — two separate trees that combine in the UI (Directory sidebar lists "teams, locations, and positions" together per the live doc).

---

## 4. Member Profile Depth

### 4.1 Feature Overview (live doc `edit-user-profiles.html`)
"All user information, including personal and work-related records, is stored
in a personal profile." Editable via **Profile Settings → Personal Data**:
first/last name, username, birthday, gender, short intro, avatar. Separate
tabs for team memberships, locations, and contact methods.

### 4.2 Real Data Model (decompiled)
- `TD_MemberProfile` (`client/api/TD_MemberProfile.java`, extends
  `AExtendedEntityRecord`, scope `ExtendedTypeScope.Org` — i.e. **also** rides
  the shared Custom Fields engine, per 00-INDEX finding #2): `id`, `username`,
  `name: TD_ProfileName` (`firstName`, `lastName`), `speaksEnglish: Boolean`,
  `smallAvatar`/`avatar`/`profilePicture`, `languages:
  List<TD_ProfileLanguage>`, `archived`, `notAMember`, `suspended:
  Boolean?`, `suspendedAt`, `joined: KotlinXDate`, `leftAt`, `external:
  Boolean?` (external/guest user flag), `externalLight`, `arenaId`.
  Notably **no bio/birthday/gender/phone fields on the core record** — those
  live as Custom Field values (matches "Personal Data" edit form above being a
  generic form, not hardcoded columns) and/or in separate ext records like
  `ProfileLocationsRecord`, `ProfileEmailStatus`, contact records below.
- `ProfileEmailStatus` (`profile/ProfileEmailStatus.java`) — per-profile email
  verification/status enum (separate from the login-email/2FA machinery 05 covers).
- Contact methods: `android/ui/profile/ContactMessenger` — `type:
  ContactMessenger.Protocol` (**`TWITTER, SLACK, TELEGRAM, SKYPE, ICQ, XMPP,
  SPACE`**) + `login` + `startChatUri` synthesizer (deep-links straight into
  the external messenger). This is a fixed enum client-side, unlike most
  other "extra data" which routes through Custom Fields.
- `WeightedProfile` (`profile/WeightedProfile.java`) — search-ranking wrapper
  used by directory/mention/assignee pickers.
- `ProfilesBatchSourceProvider` / `PrincipalsBatchSourceProvider` — paged
  member-list data sources shared by every picker (assignee selector, invite
  dialog, mention autocomplete) — one canonical member-search backend reused
  org-wide, not reimplemented per feature.
- `android/ui/myProfile/*` (own-profile screen: `MyProfileFragment`,
  `MyProfilePresenter.showUserInfo`) vs `android/ui/profile/profileScreen/*`
  (viewing *someone else's* profile — separate fragment stacks, tabbed
  (`ProfileViewPagerAdapter`) — About / Teams / Contacts-style tabs implied by
  `ProfileItemsAdapter`/`ProfileItemDiffCallback`).
- `principals/ProjectPrincipal.java` + `PrincipalExtKt` — a "Principal" is the
  generic actor abstraction (member OR application OR external) that
  permissions/assignment/mentions resolve against — profile is one concrete
  Principal kind (ties into 05's Right/Role model: Rights are granted to
  Principals, not just raw member IDs).

### 4.3 Key Features List
- Core identity record intentionally thin; personal-data fields (birthday, gender, bio) are Custom Field instances on the profile's `ExtendedTypeScope.Org`, not hardcoded columns — same generic-engine pattern 00-INDEX flags for Absences/Documents/KB.
- Fixed messenger-contact enum (Twitter/Slack/Telegram/Skype/ICQ/XMPP/Space) with deep-link "start chat" URIs, separate from the Custom Fields system.
- Own-profile vs other-profile UI are structurally different screens (edit-capable vs read-only tabbed viewer).
- Member = one concrete kind of the shared `Principal` abstraction (apps/external users are the other kinds) — permissions, mentions, and assignment all resolve through Principal, not User directly.
- One shared paged batch-source for all member pickers org-wide (assignee, invite, mention, directory search all hit the same provider).
- suspended/notAMember/external/archived are four **distinct** boolean-ish states on a profile (temporarily suspended vs left-but-kept-record vs external/guest vs hard-archived) — gaia-space parity work should not collapse these into one `isActive` flag.

---

## 5. Blogs (vs the Document record)

### 5.1 Feature Overview (blog "Introducing Documents in Space" 2020-10-27;
Wayback snapshot of `blogs.html` HTTP-API-reference, 2021-09-25)
Space's "Blog" is explicitly **not** the same record type as a Project/Personal
Document, even though authoring starts the same way: "you can create an
article from the My Documents section if you want to first create a draft and
work on it privately," then **publish to Blog** (a distinct, dedicated
publish action/endpoint) or move it to Project Documents instead — three
different destinations for what began as one private draft.

### 5.2 Real Data Model (decompiled + Wayback HTTP-API-reference)
- `ArticleRecord` (`client/api/ArticleRecord.java`, `ARecord`, its own table —
  confirms it is *not* a `Document` subtype): `id`, `archived`, `title`,
  `created: KDateTime`, `author: Ref<TD_MemberProfile>`, `aliases:
  List<BG_ArticleAlias>` (redirect/slug history), `archivedBy`/`archivedAt`,
  `arenaId`.
- `BG_Stats` (`blogs/api/BG_Stats.java`): `totalBlogs: Int`, `teams:
  Pair<Ref<TD_Team>,Int>[]`, `projects: Pair<Ref<PR_Project>,Int>[]`,
  `locations: Pair<Ref<TD_Location>,Int>[]` — blog posts are countable/
  filterable by team, project, **and location** (location-targeted company
  news — matches the personal-dashboard blog-post feed being affected by "your
  location" per the Dashboards blog post, §7).
- REST surface (`blogs.html` HTTP-API-reference, Wayback 2021-09-25):
  `GET /api/http/blogs/articles` (filters: `term`, `dateFrom`, `dateTo`,
  `authorId`, `teamId`, `locationId`, `forProfile`), `GET
  /api/http/blogs/articles/{id}`, `POST
  /api/http/blogs/articles/drafts/{draftId}/publish` (the publish-a-draft
  step — the draft itself lives in the Documents/`draft/` system 04 covers
  until this call promotes it to an `ArticleRecord`).
- Other supporting types: `BlogPublicationDetails`/`...In` (publish-time
  metadata: target team/project/location), `BlogNotificationsLevel`,
  `BlogCommonSubscriptionFilter`/`...In`, `BlogsFilter`,
  `M2BlogItemContent`/`...Preview` (chat unfurl card for a shared blog link),
  `GoToEverythingItemArticleDetails` (blog articles are indexed in Goto/Search,
  §6), `BlogCalendarEvent`/`CalendarEvent` (a published article can carry an
  associated calendar event — e.g. an all-hands announcement with an RSVP).
- Client VM/UI: `blogs/SearchItemPresentationArticle` (search-result card),
  `android/ui/blogs/{BlogsFragment,BlogsContract,BlogsPresenter}` (list +
  subscribe/toggle), `TimeToReadKt` (estimated reading time), and note the
  **To-Do** integration point: `TodoOrigin.BLOG`.

### 5.3 Key Features List
- Separate `ArticleRecord` table, own REST namespace (`/api/http/blogs/*`) — architecturally distinct from `DocumentRecord`/`DocumentFolder`, not a Document subtype/discriminator like project docs vs personal docs are (04 §2.2).
- Draft → Publish is a one-way promotion (`.../drafts/{draftId}/publish`) from the Documents draft system into this separate Article table; publishing target = a specific team, project, or location.
- Filterable/countable by author, team, project, location, and free-text term.
- Aliases array = redirect-safe slug history (renaming a published article keeps old links working).
- Own notification-subscription filter type (`BlogCommonSubscriptionFilter`) feeding §6's Subscriptions system, and its own chat-unfurl content type for shared links.
- Indexed into Goto/Search (§6) and the personal/location dashboard feed (§7), and can trigger a personal To-Do item (`TodoOrigin.BLOG`) when bookmarked from chat.

---

## 6. Notifications + Subscriptions

### 6.1 Feature Overview (live doc `notifications.html`; blog "Introducing
Subscriptions: a Universal Way to Manage Notifications in Space" 2021-08-05)
"All notifications that are relevant to you are posted to your notification
feeds in Chats. Notification feeds are your personal read-only channels that
are only visible to you." Default feed = **`#Spacebox`**, pre-subscribed to a
curated event set (documents shared with you, meeting invites, absence/
membership approvals, automation job results, etc. — 60+ subscribable event
types total). Three subscription kinds: **personal feed** subscriptions
(your events → your private feed(s), unlimited extra feeds allowed),
**channel** subscriptions (org/team/project/location events → a shared group
channel, Organization-plan-gated), and **webhook** subscriptions ("coming
soon" — external delivery, per-app). Two axes: **Personal** (events tied to
your teams/projects/locations) vs **Custom** (broader event set: any project's
new issues, any repo's commits, etc., permission-gated).

### 6.2 Real Data Model (decompiled)
- `notification/WebNotificationsServiceVm(Impl)` — in-app notification feed
  service: `newEvent: Source<WebNotificationEventVm>`,
  `filterEvents(lifetime, isApplicable)`. `WebNotificationEventVm` wraps
  `client.api.WebNotificationEvent` + an `onRead` callback — this is the
  client-side reactive feed the `#Spacebox`/custom feeds render from.
  `WebNotificationsServiceVmWrapperImpl` — decorator variant (used where a
  `Property`-backed source is adapted to the same interface, e.g. mobile).
- `subscriptions/SubscriptionVm` (single subscription's edit VM):
  `application: Ref<ES_App>` (webhook subscriptions target an app),
  `requestedAuthorizations`, `subscriptionId`, `name`, `enabled: Boolean`,
  `subjectInfo: EventSubjectInfoDTO` (what team/project/location/channel this
  subscription is scoped to), `eventTypes: List<EventTypeVm>`, `filters:
  SubscriptionFilterVm` (per-domain filter, e.g. `AbsenceCommonSubscriptionFilter`,
  `BlogCommonSubscriptionFilter`, `RepoPushSubscriptionFilter` from 01),
  `subjectsRegistry`, `editors: SubscriptionEditors`, `featureFlags`.
- `subscriptions/EventTypeVm`: `eventTypeInfo: EventTypeInfoDTO`, `enabled:
  MutableProperty<Boolean>` — one row per toggle in the subscription editor
  UI ("choose events you want to be notified about").
- `subscriptions/ProfileSubscriptionsInFeedVm` — the **personal-feed**
  subscription manager: `me`, `workspace`, `feed: PrivateFeed`,
  `getEditorVms(): List<SubscriptionFilterVmProvider>` — one editor per
  subscribable domain, dynamically assembled (matches "60+ subscribable
  events" — implemented as a provider registry, not a hardcoded list).
- `subscriptions/PersonalSubscriptionTargetVm` — per-target editor:
  `targetCode`, `description`, `featureFlag`, `allEvents:
  List<PersonalSubscriptionE...>` (truncated in decompile but confirms a
  discrete event-list per target/domain).
- `subscriptions/SubjectsRegistry` — maps subject types (team/project/
  location/channel/whole-org) → available event types, i.e. the engine behind
  "you can subscribe to new issues in a project, commits by an author, blogs
  for a location" from the blog post.
- Per-channel notification prefs (finer-grained than the feed-subscription
  system, channel-local): `android/ui/chatInfo/notifications/
  ChatInfoSubscriptionModel` — `changeAllowNotification`, `changeEmails`,
  `changePushes`, `selectNotificationAllMessages`,
  `selectNotificationOnlyMentions`, `selectNotifyAllThreads`,
  `selectNotificationThreadsIFollow` — the "email + push + which threads"
  toggles per channel, separate from the event-subscription system above.
- `client/api/push/{PushTodoReminderPayload,...}` — push payloads are typed
  per feature (To-Do reminder is its own payload type, not a generic "you
  have a notification" blob).

### 6.3 Key Features List
- Central architectural point: notifications are NOT per-feature bolt-ons — every domain (absences, blogs, issues, repos, documents, meetings) registers its event types + filter class into one shared Subscription/EventType/SubjectsRegistry engine, and one shared in-app feed service (`WebNotificationsServiceVm`) renders all of them.
- Two independent notification systems coexist: (a) event-subscriptions → feeds/channels/webhooks (org/domain-wide), and (b) per-channel notification prefs (`ChatInfoSubscriptionModel`) for allow/email/push/thread-scope — gaia-space would need both, not just one, for parity.
- Personal feeds are just special read-only chat channels (`PrivateFeed`) — reuses the Chat/Channel model 04 already flags as foundational; no separate "notification" storage table.
- Subscription targeting spans four scopes: whole-org, team, project, location — location-scoped notifications (e.g. "new absences at the Munich office") are a real, distinct scope, not just team/project.
- Webhook-subscriptions reuse the same `SubscriptionVm`/`application: Ref<ES_App>` shape as personal/channel ones (unified model across human + app consumers), matching 05's Principal-based rights model.

---

## 7. Global Search (Goto / Full-Text) + Personal & Project Dashboards (Feed/Highlights)

### 7.1 Feature Overview
- **Goto (quick nav)** — live doc `find-anything-in-chats.html` / `getting-
  started.html`: "**Control+K**" to jump straight to any team/project/person/
  channel by name (instant, fuzzy, non-content match).
- **Full-text search** — same docs: "**Control+Shift+F**" searches content
  *inside* repositories, channels/messages, documents, and member profiles;
  scope narrows to current context (current channel) by default, can be
  widened to "Chats" / "Messages" / all-org.
- **Dashboards** — blog "Dashboards with a Personal Touch" 2020-03-17: two
  kinds. **Personal Dashboard** (the post-login homepage) shows "your schedule
  for the day, absences you've planned, new blog posts and upcoming events,
  the list of projects you work on with commit-history links, and the team
  calendars/absences of people you follow" — content is auto-derived from
  team membership + location + explicit "Follow" relationships (follow a team
  via favorites, follow a person via their profile's Follow button).
  **Project Dashboard** shows project members/teams, your code reviews, your
  project issues, project checklists, and repositories used.

### 7.2 Real Data Model (decompiled)
- Goto: `gotoEverything.GotoScope`/`GotoScopeEntity` (`key`, `sectionSize`),
  `GotoSources` (implements `SearchSourcesModel` — a registry of
  `WeightedBatchSourceProvider`s, one per entity kind, matching the
  member/project/team/channel breadth of Control+K), `GotoItem` (`key`,
  `weight`, `text`, `details: GotoItemDetails`, `icon`, `star`, `count`,
  `status: UserStatusBadge`, `hasUnread`, `link`, `section`, `location:
  routing.Location`), `ExecuteItem`/`ExecuteCustomAction` (goto results that
  trigger an action, e.g. "create new X", rather than navigate), `NavigateToItem`.
- Full-text: `advancedSearch.WeightedFullTextSearchDataSource(Lite)`,
  `CommonSearchContext`, and `gotoEverything.FTSItem` (`key`, `weight`,
  `ftsScore: Double`, `icon: FTSItemIcon`, `location`, `snippets:
  List<SearchHitMatch>`, `summary`, `links: List<SearchHitLink>`,
  `breadcrumbs: List<FTSBreadcrumb>`) — the ranked-snippet result shape behind
  Control+Shift+F; `SearchHitMatchType` differentiates title vs body vs
  author-name matches.
- `gotoEverything.SearchVm` — top-level VM combining goto + FTS, aware of
  `me`, `preferredLanguage`, feature flags, and a SpaceCode-vs-Space mode flag.
- Dashboards: `client/api/dashboards/` is a **widget-plugin system**, not a
  fixed layout — `DashboardWidgetApi`/`DashboardWidgetIn` (generic
  widget-instance record) + `DashboardWidgetSettingsApi`/`...In` (base
  settings), specialized per widget type: `PersonalDashboardWidgetApi`,
  `ProjectDashboardWidgetApi`, and concrete settings classes for each widget
  kind — `ToDoDashboardWidgetSettings*` (§1), `FollowedProfilesDashboardWidgetSettings*`
  + `FollowedColleagueSettingsData`/`FollowedEntityDTO`/`FollowedMembersSettings`
  (the "Follow" mechanic from the blog, as structured data), `IssuesWidgetSettingsData`,
  `ReviewsWidgetSettingsData`, `ProjectIssuesDashboardWidgetSettings*`,
  `ProjectMembersDashboardWidgetSettings*`, `ProjectRepositoriesDashboardWidgetSettings*`,
  `ProjectDocumentsDashboardWidgetSettings*`, `ProjectCodeReviewsDashboardWidgetSettings*`,
  `ProjectDescriptionDashboardWidgetSettings*`, `RepositoriesDashboardWidgetSettings*`,
  `BillingDashboardWidgetSettings*`, plus `DashboardPreferencesRecord`
  (per-member widget layout/order) and `DashboardContainerType`
  (Personal vs Project container).
- `landing/EventsAndAbsencesVM` — the personal-dashboard's calendar+absences
  panel specifically: `calendarStateRecord`, `calendarEvents:
  List<MeetingRecord>`, `allHolidays: List<PublicHolidayRecord>` (truncated in
  decompile but field present), plus birthdays per the metadata list —
  confirms "new blog posts and upcoming events" from the blog post is backed
  by real typed sub-VMs, not a single unstructured feed blob.

### 7.3 Key Features List
- Two-tier search UX with distinct data shapes: Goto (`GotoItem`, weighted, entity-directory, instant) vs FTS (`FTSItem`, ranked snippets, breadcrumbs, content search) — gaia-space parity needs both, not one "search bar."
- Goto sources are a pluggable provider registry (`GotoSources implements SearchSourcesModel`) — same "generic engine, per-domain plugin" pattern as Custom Fields (00-INDEX #2) and Subscriptions (§6) — a recurring Space architectural idiom worth replicating once, not per-feature.
- Dashboards are widget-instance + widget-settings pairs stored per member (`DashboardPreferencesRecord`), not a hardcoded homepage layout — 15+ concrete widget types found, each independently configurable and (for project dashboards) reusable across every project.
- "Follow" (a team via favorites, a person via profile button) is structured data (`FollowedEntityDTO`/`FollowedMembersSettings`) driving the Followed-Profiles widget — distinct from team *membership*, and distinct from Subscriptions (§6): following affects what you see on your dashboard, subscribing affects what notifies you.
- Personal dashboard content is genuinely computed from three signals — team membership, location, explicit follows — each traceable to a concrete field/record above, not vague "personalization."

---

## 8. gaia-space Gap Analysis

Current gaia-space (`~/projects/gaia-space/`) is **not** the Flutter/`lib/`
tree 01-05 evaluated — the repo has since been rebuilt as a Tauri app
(`src-tauri/src/` Rust backend: `chat.rs`, `db.rs`, `documents.rs`, `git.rs`,
`issues.rs`, `meetings.rs`, `pipelines.rs`, `platform.rs`, `review.rs`,
`lib.rs`/`main.rs`; `src/` React frontend: one `ResourceView.tsx` generic
list/detail component reused per domain view — `Members.tsx` is 3 lines
rendering `ResourceView` over `api.listProfiles`), ~2,571 lines total, and is
explicitly a **git spine + skeleton**: no `todo`, `absences`, `teamdir`/org-
chart, `locations`, member-profile-depth, `blogs`(-as-distinct-from-Document),
`notification`/`subscriptions`, or `gotoEverything`/global-search code exists
anywhere in `src-tauri/src/` or `src/` today — so for every feature in §1–§7
the gap is effectively **100%** (nothing to compare against yet, not even a
mocked placeholder), the same "gap ≈ everything" situation the earlier
domains found for CI/CD and Collaboration, just more so since this whole
personal/org layer has zero surface area (not even a stub route) rather than
a partial/mocked one.

---

## Raw material / scratch
Research scratch (searches, intermediate greps) kept under
`docs/space-knowledge-base/.scratch/` during this pass, deleted before
returning per task rules — no artifacts left behind beyond this file.
