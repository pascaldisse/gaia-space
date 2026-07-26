# Team Collaboration — Chat, Documents/Knowledge Base, Meetings, Calendar

Sources: live docs jetbrains.com/help/space/* (fetched 2026-07-26, many paths already 404
post-shutdown) + decompiled Android client
`~/Downloads/space-clients/android/jadx-out/sources/circlet/` (Kotlin→Java via jadx).
Internal codename confirmed: chat = `m2` package, `circlet.client.api` = shared KMM wire API
(class names below are exact, taken from JADX `@Metadata(d2 = {...})` Kotlin signature strings,
which survive obfuscation even though method/field names in bytecode are minified to single
letters `a()`, `b()`, `f26770a`, etc.).

---

## 1. Chat (`m2`)

### 1.1 Feature Overview (live docs)
jetbrains.com/help/space/chats.html:
> "Chats is the primary place to communicate with your colleagues and stay updated. It serves
> not only as a messenger, but also as your personal inbox for receiving notifications,
> requests, and alerts." Three activity types: **Conversation channels**, **Notification
> feeds**, **Direct messaging**.

- Channels: public (open org-wide) or private (owner-permission to join). Default personal
  feed `#Spacebox` aggregates meeting/issue/absence/automation notifications; users can create
  more personal feeds.
- messaging-options-attachments-mentions.html: attach file/image/video/**poll**; `@mention`
  people; full Markdown incl. Mermaid diagrams; **schedule/delay message delivery** (DMs,
  channel messages, thread replies, issue comments) with per-recipient local-time/availability
  awareness; reschedule/cancel from a "Scheduled messages" panel.
- Per-message hover actions: edit/delete (own), add to To-Do List, **start thread**, add
  **reaction** (emoji). Overflow menu: quote, copy link, **pin**, create issue from message,
  unsubscribe from replies.
- create-and-manage-channels.html: create channel (name, description, public/private,
  subscribers incl. teams); manage: favorite/pin, rename, archive, convert public→private,
  delete; **subscribe a channel to arbitrary event sources** (Issues, Blogs, Absences, etc.)
  with per-source filters — requires authorization for global/project events.

### 1.2 Real Data Model (decompiled `circlet.client.api` / `circlet.m2.*`)

**Channel record** — `M2ChannelRecord` (`circlet/client/api/M2ChannelRecord.java`), implements
`ARecord`:
```
arenaId: String, id: String, contact: M2ChannelContact, totalMessages: Int,
lastMessage: MessageInfo?, participants: List<ChannelParticipant>?,
channelArchived: Boolean?, archived: Boolean
```
Wrapped by `M2ChannelContentRecord` (`ExtRecord<M2ChannelRecord>`) which carries the
polymorphic `content: M2ChannelContentInfo`. Concrete channel content classes (all implement
`M2ChannelContentInfo`, most also `M2ChannelContactInfo`):
- `M2SharedChannelContent` — project/team channel: `name, group(TID), access: M2.Access,
  description, iconId, notificationDefaults, teams: List<Ref<TD_Team>>, canEdit, project:
  Ref<PR_Project>`, `canHaveThreads=true`, `canHavePinnedMessages=true`,
  `channelType: ChannelTypeShared`.
- `M2ChannelContentNamedPrivateChannel` — user-named private channel: `name,
  notificationDefaults, canHaveThreads, color: PrivateFeedColor, icon`.
- `M2ChannelContentMember` — 1:1 chat: `member: Ref<TD_MemberProfile>, notificationDefaults,
  memberTeams`, `channelType: ChannelTypeP2P`.
- `M2PrivateConversationChannelContent` — multi-person "conversation": `channelId, subject,
  members: List<Ref<TD_MemberProfile>>, notificationDefaults`,
  `channelType: ChannelTypeConversation`, `predefinedMentions`.
- `M2ChannelContentApplication` — bot/app channel: `app: Ref<ES_App>, notificationDefaults`,
  `channelType: ChannelTypeA2P`.
- `M2ChannelContentThread` — thread-as-channel: `record: Ref<ChannelItemRecord>` (parent
  message), `parent: Ref<M2ChannelRecord>`.
- `M2ChannelContentArticle` — blog/article comment channel: `article, articleContent, details,
  channel` (all Refs).

**Message record** — `ChannelItemRecord` (`circlet/client/api/ChannelItemRecord.java`),
implements `ARecord`, 21 constructor params:
```
text: String, details: M2ItemContentDetails, author: CPrincipal, created: KDateTime,
time: Long, reactions: Ref<AllReactionsToItemRecord>, thread: Ref<M2ChannelRecord>?,
projectedItem: Ref<ChannelItemRecord>?, attachments: List<AttachmentInfo>?,
externalId: String?, pending: Boolean?, arenaId: String, id: TID, archived: Boolean,
temporaryId: String?, edited: KDateTime?, pinned: Boolean?,
suggestedParticipants: List<CPrincipal>?, mentions: List<EntityMention>?,
channelId: String?, importerAppId: String?
```
`details: M2ItemContentDetails` is the polymorphic message-content interface
(`M2ItemContentDetails.java`) with capability flags returned as methods (minified to
`a()..n()` in the jar but named in Kotlin metadata): `canStartThread, canAddReaction, canEdit,
canCopyLink, canDelete, canQuote, canReply, canSkipSender, canPin, showExtensions,
senderFromContent(resolver), linkFromContent(resolver), customThread(arenaMgr), customExtId,
isCompact`.

Concrete `M2ItemContentDetails` implementations found:
- `M2TextItemContent` — plain chat text: `markdown: Boolean?, mentions: List<EntityMention>?`.
  All capability flags hardcoded true except `showExtensions=false`.
- `mc.MCMessage` (rich message v2, package `circlet.client.api.mc`) — `style: MessageStyle,
  outline: MCOutline?, content: List<MCElement>, extension: M2ItemContentDetails?`; exposes
  `textContent(): Sequence<String>`; delegates all `can*` flags to `extension` if present. This
  is the block-based rich-content model (MCElement tree) that superseded plain markdown text.
- Membership/system events (`circlet.client.api.td.*`): `M2MemberJoinsContent`,
  `M2MemberLeavesContent`, `M2MembershipCreatedContent`, `M2MembershipRequestedContent`,
  `M2MembershipTerminatedContent`.
- Absence events: `M2AbsenceItemContent`, `M2AbsenceItemApprovedContent`,
  `M2AbsenceItemApproveDeletedContent`, `M2AbsenceItemDeletedContent`,
  `M2AbsenceItemUpdatedContent`.
- Task/automation events: `M2TaskExecutionSucceedItemContent`,
  `M2TaskExecutionFailureItemContent`, `M2ExternalStatusSucceedItemContent`,
  `M2ExternalStatusFailureItemContent`.
- Draft/editor presence: `M2DraftEditorAddedItemContent`, `M2DraftEditorTeamAddedItemContent`.
- To-Do content: `TodoItemContent`, `TodoItemContentText`, `TodoItemContentMdText`.
- Poll: `M2PollContent`.
- Scheduled ("postponed") message: `circlet.m2.message.PostponedMessageDetails` — thin
  `M2ItemContentDetails` wrapper `{markdown: Boolean?}`, all `can*` true except reply.

**Reactions**: `EmojiReaction {emoji: String, count: Int, meReacted: Boolean}`
(`EmojiReactionRecord`/`EmojiReactionArena` = server-side arena),
`AllReactionsToItemRecord`/`AllReactionsToItemArena` = the reactions-container Ref hung off
`ChannelItemRecord.reactions`. `ReactionsGroup` interface `{name}` groups named reaction sets
(e.g. article reactions via `ArticleReactions`). `ReactionsV2` is a newer reactions API
(`ReactionsV2Proxy`, `ReactionsV2Kt`).

**Threads**: no separate "Thread" entity — a thread *is* a channel. `CustomThread` (glue object
returned by `M2ItemContentDetails.customThread(arenaManager)`):
```
channel: Ref<M2ChannelRecord>, skipFirstMessage: Boolean, title: String?, alwaysShow: Boolean?
```
default title `"Code discussion"` (used for review/PR-attached threads).
`M2ChannelContentThread.record` links the thread-channel back to its parent message.
VM layer: `m2/threads/M2ChannelContentThreadVM`, `M2ThreadPanelVM`, `M2PlainThreadPreviewVm`,
`M2CustomChannelThreadPreviewVm`, `LazyInlineThreadVM`.

**Attachments**: `AttachmentInfo` on `ChannelItemRecord.attachments`; upload lifecycle states in
`m2/attachments/`: `LoadingAttachment`, `AttachmentIsUploading`, `AttachmentUploadCompleted`,
`AttachmentUploadFailed`.

**Drafts**: `chat.M2Draft`/`M2DraftsArena` (server-persisted draft per channel),
`m2.channel.M2DraftContainer`/`M2DraftSnapshot`/`M2DraftsVm` (client-side draft cache +
sync-to-server).

**Typing indicator**: `M2Typing` DTO + `M2.subscribeForTyping(lifetime, channels)` /
`M2.sendTyping(...)`.

**Stickers**: `stickers/` package — `StickerPackWithStickers`, `StickerPackSection`,
`StickerSelectorVM` (`sendSticker`, `recentlyUsedStickersArena`, `allPacksFlux`).

**Saved messages / labels**: `M2.savedMessages`, `savedMessages.SavedMessage`,
`savedMessages.SavedMessageLabel`, `addSavedMessage/removeSavedMessage`,
`addSavedMessageLabel/renameSavedMessageLabel/changeSavedMessageLabelColor`,
`labelSavedMessage/unlabelSavedMessage`.

**Unread/read state**: `chat.M2UnreadStatus`, `M2.readAll/readChannel/readMessage/
readMessagesWithGaps/getTotalUnread/getTotalUnreadMentions/markMessageAsUnread/
markChannelAsUnread`. Client VMs: `chats/UnreadChatsVMImpl`, `m2/mentions/MentionsFolderVM`
(mentions inbox), `ChatFolderVM`.

### 1.3 Key Features List (chat API surface, `circlet/client/api/M2.java`, ~562 lines,
`interface M2 : Api`, one method per line unless noted)
- Channel lifecycle: `getChannel, waitForChannel, createChannel(name, description, private),
  archiveChannel, restoreArchivedChannel, deleteChannel, renameChannel, changeChannelIcon,
  convertPublicChannelToPrivateChannel, isChannelNameFree, findSharedChannel`.
- Conversations (ad-hoc multi-person DMs): `startConversation(profileIds, subject),
  updateConversationSubject, convertConversationToPrivateChannel`.
- Membership: `invite, invite2, addUsers, remove, removeUsers, inviteTeam, addTeams,
  removeTeam, removeTeams, setAdministrator, processMentionInvite`.
- Messaging: `sendMessages(channelId, messages: List<NewMessage>, time), editMessage,
  deleteMessage, alterMessage, applyModifications(modifications: List<ChatModification>),
  checkDelivered(temporaryIds), checkMessageExists`.
- Scheduled messages ("postponed"): `getPostponedMessage, sendPostponedMessage(postpone:
  KotlinXDateTime), alterPostponedMessage, deletePostponedMessage, sendNowPostponedMessage` —
  matches live-docs "Delay or schedule the delivery of your message" feature exactly.
- Mentions: `resolvedMentionPatterns, resolveMentions, resolveMentionsV2(lines)`.
- Pinning: `pinMessage, pinnedMessages`.
- History paging: `range2(position, limit, skipProjectedItem) → ChatHistoryRange`, `load3(from,
  direction: LoadDirection)`.
- Reading/unread: `readAll, readGroup, readChannel, readMessage, readMessagesWithGaps,
  getTotalUnread, getTotalUnreadMentions, markMessageAsUnread, markChannelAsUnread`.
- Discovery: `allChannels(quickFilter: AllChannelsFilter, sortColumn, publicOnly, withArchived,
  subscriber), inbox, spaceCodeInbox(sortOrder: InboxSortOrder, filter: InboxFilter),
  teamSubscribers, subscribers2, peopleForInvite, teamForInvite`.
- Notifications config: `customNotificationContacts, customNotificationContactCounts,
  notificationScheme, updateContactNotificationSettings(subscribed, notificationLevel),
  resetContactNotificationSettings, subscribeToAllThreads`.
- Saved messages: (see §1.2).
- Home/org list UX: `pin(channelId,pinned), movePinned, hideTabLabels, collapseContacts,
  hideGroup, hideResolvedReviews, hideResolvedIssues, reorderGroups, duplicateInHome,
  setInboxFilter, setInboxSortOrder`.
- Slack export: `exportsToSlack, startExportToSlack, deleteExport, disableEmailMatch`.
- Link unfurling: `resolveSyncUnfurls(links, location: UnfurlLocation)`.
- Typing: `sendTyping, subscribeForTyping`.
- `startThread`, `resolveP2PChannel`, `resolveA2PChannel(application)`.

---

## 2. Documents / Knowledge Base

### 2.1 Feature Overview (live docs, my-documents.html + project-documentation.html)
- **Personal "My Documents"**: private drafts area. Document types: Text document, Blog post
  draft, Checklist (own type, can't publish), uploaded File (pdf/word/image/audio/video,
  not editable in Space, some previewable).
- Lifecycle: create in private folder (hidden) → optionally **share** (viewer/editor rights,
  can't publish/move) → **publish to Blog** (moves it, keeps co-author rights, reversible via
  unpublish) OR **move/copy to a Project** (one-way; once moved, permissions become the
  project's, sharing settings are overridden and can be lost).
- Editors: Rich Text (WYSIWYG) or Markdown (with live preview); Mermaid diagrams in Markdown
  mode; drag/drop or paste images; **grammar/spell-check + sentence-completion autocomplete**
  in Rich Text mode (configurable/disableable).
- Browsing: tabs **All** (everything ever viewed/edited, cross-location) / **Folders**
  (own private tree) / **Archive** (soft-deleted, restorable or permanently deletable — archive
  is a required first step before delete). Folder-level description field. Folder-level and
  document-level access grants (Viewer/Editor, member or team).
- **Version history** (history-of-changes.html / my-documents.html#history-of-changes):
  "see what changes have been made ... who made them and when"; **compare versions**; **preview
  a version**; **restore/roll back** to any earlier version via a left-panel version list +
  Restore button.
- Project Documents: same 4 doc types, organized as folder hierarchy ("books" in KB terms);
  requires ≥1 root folder before adding content; same All/Folders/Archive tabs; search by
  title+content.
- Import pipeline: standalone Dockerized importer (`space-documents-import`, open-sourced on
  GitHub) pulls from local folder or Atlassian Confluence into a project's root doc folder;
  only `.md` becomes an editable Space Document, everything else becomes an uneditable File.

### 2.2 Real Data Model (decompiled)

**Document** — `circlet/client/api/Document.java`, `ARecord` + `DraftHeaderInfo`, 25 fields:
```
id: TID, containerLinkId: String?, containerInfo: DocumentContainerInfo,
title: String, alias: String, shared: Boolean,
publicationDetails2: PublicationDetails?, publicationDetails: PublicationDetails?,
folderRef: Ref<DocumentFolder>?, bodyType: DocumentBodyType, bodyInfo: DocumentBodyInfo,
archived: Boolean, deleted: Boolean?, archivedBy: CPrincipal?, archivedAt: KDateTime?,
author: TD_MemberProfile?, createdBy: CPrincipal?, created: KDateTime?,
modifiedBy: CPrincipal?, modified: KDateTime?, grantedRights: List<String>?,
accessOrdinal: Int?, isUsingEntityAttachments: Boolean?, redirectUrl: String?, arenaId: String
```
**Folder** — `DocumentFolder.java` (extends `DocumentFolderBase`): `id, archived,
containerLinkId, containerInfo: DocumentContainerInfo, parent: Ref<DocumentFolder>?,
subfoldersCount: Int, documentsCount: Int, name, isRestricted: Boolean?, alias, created,
createdBy, updated, updatedBy, cover: Ref<Document>?, grantedRights, temporaryId, arenaId`.
`DocumentContainerType`/`DocumentContainerInfo` disambiguate personal vs. project vs. KB-book
containers — same `Document`/`DocumentFolder` records are reused across My Documents, Project
Documents, and Knowledge Base (KB just adds `KB_Book`/`KB_Article` wrapper records, §2.3).

**Body types**: `DocumentBodyType` enum backs `bodyInfo`; create/update are generic-typed:
`DocumentBodyCreateIn<Body: DocumentBodyInfo>`/`DocumentBodyUpdateIn<Body: DocumentBodyInfo>`
each just carry `bodyType`. `DraftDocumentType` (seen on `ArticleContentRecord`) enumerates
concrete body kinds (rich text vs. markdown vs. checklist, mirrored for blog articles).

**Access**: `DocumentAccess {permissions: List<DocumentAccessRecipient>, inherited}`,
`FolderAccess {permissions: List<FolderAccessRecipient>, inherited, restricted: Boolean}`.
`DocumentMode` enum: `VIEW, EDIT, SIDE_BY_SIDE` (an OrderedEnum) — i.e. the client supports a
live side-by-side raw/preview editing mode, not just toggle.

**Versioning / history** — two parallel services found:
- `circlet.client.api.DocumentHistoryService : Api` — `restore2(documentId, date:
  KotlinXDateTime, contentRestoreDetails: DocumentContentRestoreDetails)`,
  `getChangeGroups(documentId, batchInfo, clientTimezone) → DocumentChangeGroupsBatch`. This
  is the "Show version history" + "Restore" flow from the docs, grouped by change (likely
  batches of near-simultaneous edits into one history entry).
- `circlet.collab.api.TextDocumentHistoryService : Api` — lower-level collab/CRDT history:
  `getModel(documentId, version: TextDocumentVersion, baseVersion: KOption<TextDocumentVersion>)
  → TextDocumentHistoryModel`. `TextDocumentVersion {resetCounter: Long, version: Long?}`.
  Diff variants: `TextDocumentHistoryModelDiff`, `...DiffFull`, `...DiffSimple`,
  `TextDocumentHistoryModelSimple`. This is the realtime co-editing (OT/CRDT-like) versioning
  substrate underneath rich-text documents, separate from the discrete "snapshot" history the
  end-user sees.

**Documents API surface** — `circlet/client/api/Documents.java` (`interface Documents : Api`,
~247 lines): `document, documentWithEffectiveRights, getDocumentByAlias, createDocument2(title,
folderTid, bodyIn, publicationDetailsIn, published), update(updateIn, KOption),
rootFolder(containerId, containerType), copyDocument, moveDocument2, starred: DocumentsStars,
findDocumentByBody, archiveDocument, deleteDocumentForever, replaceFolderCover/
removeFolderCover, getOrCreateFolderDescription, createFolder2, renameFolder2, removeFolder2,
moveFolder2, folderByAlias2, folderByAliasWithEffectiveRights, restoreDocument, userLeft2,
documentOwnAccess: DocumentAccess, folderOwnAccess: FolderAccess, updateDocumentAccess,
updateFolderAccess, updateEditorsAndTeams(addEditorIds, addTeamIds, removeEditorIds,
removeTeamIds), editors2, editorsTeams2, addEditor2, addFolderEditor, removeEditor2,
removeFolderEditor, addEditorsTeam2, addFolderEditorsTeam, removeEditorsTeam2,
removeFolderEditorsTeam2, recordReadAndGetUserMeta, changeDocumentMode(mode: DocumentMode),
stats: DocumentsStats, statsToCount, formatMigrationEnabled, filterDocuments(containerInfoIn,
batchInfo, query, sortBy, order)`.
A second, cleaner interface `DocumentsUniversalApi` exists (likely the newer/simplified surface
used by mobile+external integrations): `createDocument, getDocument, copyDocument,
moveDocument, updateDocument, archiveDocument, removeDocument, restoreDocument, createFolder,
moveFolder, listFolders(parentFolder, withArchived, sortBy, order, batchInfo), listDocuments,
getFolder, removeFolder, setFolderIntroduction/removeFolderIntroduction, renameFolder`.

### 2.3 Knowledge Base (`circlet.kb`)
KB is Documents + a project/team "Book" grouping layer, confirmed by decompile:
- `KB_Book` (`ARecord`): `id, archived, name, summary, updated: Long, updatedBy: CPrincipal,
  alias, contexts: List<KB_BookContext>, project: Ref<PR_Project>?, temporaryId, arenaId`.
  `KbBookContextKind`/`KbNoneContext`/`KbProjectContext` scope a book to org-wide, a project, or
  none.
- `KB_Folder` (extends `DocumentFolderWithChildrenBase`): `id, archived, name, parent:
  Ref<KB_Folder>?, subfolders: List<Ref<KB_Folder>>, articles: List<Ref<KB_Article>>, book:
  Ref<KB_Book>, cover, alias, created, createdBy, updated, updatedBy` +
  `subfoldersCount/documentsCount` computed props.
- `KB_Article` (`ARecord`): `id, archived, title, book: Ref<KB_Book>, folder: Ref<KB_Folder>?,
  documentId: String?, documentRef: Ref<Document>?, created, createdBy, updated, updatedBy,
  alias, temporaryId, arenaId` — i.e. **an article is a thin pointer wrapping a `Document`**,
  same body/versioning machinery as §2.2 applies.
- `KB_RootFolder`/`KbRootFolderArena`, `KB_BookComplete` (book + its full folder tree, used by
  `getBooksComplete`), `KbBookPermissions`, `KbBookValidation`.
- `KnowledgeBaseService : Api` (`circlet/kb/KnowledgeBaseService.java`): `editBook(name,
  summary), getBookByAlias, getBookByAliasLegacy(contextKind, contextId), getRootFolders(WithRights),
  filterDocuments, filterFolders2, getBooksComplete(contextKind), createBook(name, summary,
  contextKind, contextId), getArticleByAlias(bookTid, alias), archiveBook, getBookPermissions,
  getBooksPermissions, getBookCompleteByAlias, getBooksWithRight(rightCode), moveBook(project),
  getBook, bookEditorProfiles/addBookEditorProfile/removeBookEditorProfile,
  bookEditorTeams/addBookEditorTeam/removeBookEditorTeam,
  updateBookEditorsAndTeams(add/removeEditorIds, add/removeTeamIds, silent), filterBooks2`.
- Search/goto support: `kb/search/`, `kb/p003goto/` (GoToEverything for KB), `KbLocationsKt`
  (deep-link routing), `mobile/` subpackage for the KB mobile surface, `customFields/` (KB
  articles can carry custom fields like issues do).

### 2.4 Article reactions / channel binding
`ArticleChannelRecord` (`ExtRecord<ArticleRecord>`): `channel: Ref<M2ChannelRecord>,
channelContent: Ref<M2ChannelContentRecord>, reactions: Ref<AllReactionsToItemRecord>` — every
KB/blog article has an attached comment channel and reactions bucket, reusing the chat (§1)
data model wholesale. `ArticleDetailsRecord`: `event: Ref<MeetingRecord>?, teams, locations,
externalEntityInfo` — an article can be linked to a meeting (meeting notes use-case) and to
teams/locations.

---

## 3. Meetings

### 3.1 Feature Overview (live docs, meetings.html)
- Entry points: Dashboard/profile Calendar widget (upcoming), personal Calendar → Meetings tab
  (all + history, filter by author/title), another person's profile → Calendar tab,
  Administration → Meetings (org-wide search/filter by participants/locations/dates).
- **Book a meeting**: title + description; **Single** or **Recurring** (Day/Week/Month/Yearly
  frequency, interval N, specific weekdays for weekly, day-of-month or "Nth weekday" for
  monthly, optional end date or repeat count, or indefinite); time+duration via timeline
  slider; **Privacy**: participants-only vs. everyone, with an option restricting edit rights
  to participants only; participants = people or teams; **room booking** with conflict/overlap
  detection against room bookings and participant absences/other meetings; multiple
  locations for hybrid/AV meetings; equipment requirements (Google Meet hardware, Polycom,
  Projector); system suggests best-fit rooms by participant location + equipment + time.
- Notifications land in `#Spacebox` (or a custom feed); per-event unsubscribe; can redirect
  meeting notifications to a **chat channel subscription** instead of/in addition to invites.

### 3.2 Real Data Model (decompiled `circlet.meetings` + `circlet.client.api`)

**`DTO_Meeting`** (`ARecord`, package `circlet.meetings`), ~30 fields:
```
id, archived, summary, description,
locations: Array<Ref<TD_Location>>, profiles: Array<Ref<TD_MemberProfile>>,
teams: Array<Ref<TD_Team>>, occurrenceRule: CalendarEventSpec,
origin: MeetingOrigin, googleMeetLink: String?,
visibility: MeetingVisibility, modificationPreference: MeetingModificationPreference,
joiningPreference: MeetingJoiningPreference, organizer: MeetingOrganizer, etag: Long,
googleEventId: String?, privateDataSubstituted: Boolean, canModify: Boolean,
canDelete: Boolean, canJoin: Boolean, externalParticipants: Array<String>,
linkToExternalSource: String?, eventAttachments: Array<MeetingAttachment>,
conferenceData: EventConferenceData?, channelRef: Ref<M2ChannelRecord>?,
externalSource: EventExternalSource?, calendar: Ref<CalendarInfo>?,
canLeaveOrRsvp: Boolean?, arenaId,
+ computed: temporaryId, recurrentParentId, busyStatus: BusyStatus
```
Every meeting has its own **chat channel** (`channelRef`) — confirms the docs' implicit "meeting
discussion" pattern reuses §1's channel/message model. `MeetingOrigin` distinguishes
Space-native vs. Google-imported vs. external-source meetings (`googleEventId`,
`externalSource`, `linkToExternalSource`, `privateDataSubstituted` for privacy-redacted
imported events).

**RSVP** — `DTO_MeetingRSVP` (`ARecord`): `id, archived, member: Ref<TD_MemberProfile>,
meeting: Ref<DTO_Meeting>, status: EventParticipationStatus, arenaId`.

**Recurrence** — `circlet.common.calendar.CalendarEventSpec`: `start/end: KotlinXDateTime,
recurrenceRule: RecurrenceRule?, allDay: Boolean, timezone: ATimeZone, parentId: TID?
(links recurring-instance to series), initialMeetingStart, busyStatus, nextChainId`. Has
`isIdenticalTo(otherSpec)` and a `Parser` companion (RRULE-style parsing). `RecurrenceRule
{freq: RecurrenceRuleFreq, ends: RecurrenceRuleEnds}`.

**Meetings API** — `circlet.meetings.Meetings : Api` (~90 lines): `calcLocalStartShifts,
bookMeeting(summary, description, occurrenceRule, locations, profiles, externalParticipants,
teams, visibility, modificationPreference, joiningPreference, notifyOnExport, organizer,
conferenceData, attachments, calendarId), patchMeeting(id, ...Diff<T> for
locations/profiles/externalParticipants/teams, targetDate, modificationKind:
RecurrentModification), isParticipant, updateParticipantStatus(status,
RecurrentModification), getParticipantStatuses/getExternalParticipantStatuses/
getProfileParticipantStatuses/getProfileParticipantRecords, joinMeeting/leaveMeeting,
deleteMeeting(targetDate, RecurrentModification), meetingById,
meetingsByConferenceData, meetings(batchInfo, summaryQuery, locationsQuery, date-range filters,
includePrivate, includeArchived, includeMeetingInstances), getMeetingOccurrencesForPeriod,
getOccurrencesForPeriod(meetingIds[]), getNextMeetingOccurrence, suggestParticipants(query,
allowExternalParticipants), extractBuildings, suggestLocations(building, start, end,
recurrenceRule, adjustmentTimezone, ignore, clientTimezone), locationsAvailability,
buildingAvailability, findEventParticipationConflicts(conflictsToSkip: CalendarEventType[]),
triggerExternalMeetingsImport, get/setOrgMeetingsTimezone, resolveMeetingInstance,
calcParticipantsDistribution(conferenceRooms), scheduleUpdates (subscription channel),
getPrecedingChainMeeting, reclaimConferenceRoom/addConferenceRoom/removeConferenceRoom`.
`RecurrentModification` enum (this instance / this-and-following / all) governs edits to
recurring series — matches "you can change it later" language in the docs.

**Room/location suggestion**: `meetings.Building`, `BuildingWithKey`, `BuildingSuggestionEntry`,
`LocationSuggestion`, `ScoredMeetingLocation`, `UnavailableMeetingLocation`,
`MeetingsLocationStatus`, `DataSegment`/`Segment` (free/busy time-slices),
`ConflictingEvent`/`EventParticipationConflicts` — directly backs the "available time slots …
conflict details" UI described in the docs.

---

## 4. Calendar

### 4.1 Feature Overview (live docs, calendar.html)
- Personal calendar aggregates meetings, absences, and optionally to-do/issue due dates
  (toggle). Views: Day/Week/Month + a list-style "Schedule" tab. Tabs to jump into full
  Meetings / Absences lists.
- Create event: "New" → New meeting / New absence, or drag on the grid to pick a slot+duration.
- Customize: hide/show weekends, working hours, issues, to-dos, declined-but-invited meetings.
- View another member's calendar via their profile (used to find a free slot before booking).
- **CalDAV sync** to external calendar apps (documented for Thunderbird 91+ and macOS
  Calendar.app; also works with iOS/Android CalDAV clients, DAVx5, CalDAV-Sync, Evolution, eM
  Client, Outlook CalDav Synchronizer) via server URL
  `https://<domain>.jetbrains.space/` + username + password-or-personal-token.

### 4.2 Real Data Model (decompiled)
- `CalendarInfo` (`ARecord`): `id, name, defaultColor, freeBusyOnly: Boolean, readOnly: Boolean,
  exposeToCalDav: Boolean, exposeToGoogle: Boolean, sourceUrl: String?, syncAttemptCount: Int?,
  archived, arenaId` — i.e. a user can have multiple named calendars (not just one "My
  Calendar"), each independently toggle CalDAV/Google exposure; `sourceUrl`+
  `syncAttemptCount` imply external-calendar-subscription (ICS feed import) support beyond
  plain CalDAV export.
- `CalendarEvents : Api` (`circlet/client/api/CalendarEvents.java`): `profileCalendarEvents(
  batchInfo, profileId, kinds: CalendarEventKind[], startingAfter, endingBefore) →
  Batch<CalendarEventRef>, locationCalendarEvents(batchInfo, locationId, date range) →
  Batch<Ref<ARecord>>, customProfileEvents(profileId, date range) →
  List<CalendarEventDeclaration>`. `CalendarEventKind` enumerates the mergeable event sources
  (meeting / absence / issue-due / todo-due / custom).
- `CalendarEventRef`, `CalendarEventDeclaration`, `CalendarEventObject`,
  `CalendarEventType` (used above in meeting-conflict filtering), `CalendarOptions` (the
  hide/show weekends/working-hours/issues/todos/declined toggles from the UI),
  `CalendarExtendedInfo`, `CalendarIcsInfo` (ICS feed metadata — confirms subscribe-by-URL
  import), `CalendarService`/`CalendarServiceOld` (`Api` — legacy+current calendar settings
  service), `client/api/calendar/events/CalendarEventInterval(Impl)` (recurrence-expansion
  interval helper shared with Meetings).
- Shared recurrence engine: `circlet.common.calendar.CalendarEventSpec`/`RecurrenceRule` (see
  §3.2) is used by both Meetings and generic Calendar events.
- Personal per-device calendar rendering settings: `circlet.platform.api.settings.
  CalendarViewSetting`.

---

## 5. gaia-space Gap Analysis (`~/projects/gaia-space/lib/`)

Scanned: `lib/core/models/`, `lib/core/services/`, `lib/ui/screens/home/`. Grep across all
`.dart` for chat/message/meeting/calendar/document/knowledge hits only **Discord integration**
(`discord_integration.dart`, `discord_service.dart`, `discord_integration_screen.dart` — an
external Discord-bot bridge, not a native chat system) and a single flat **Document**
model+screen. No `meeting`, `calendar`, or native `chat`/`m2` files exist anywhere in `lib/`.

### Chat — MISSING (entirely)
- No `Channel`/`Message`/`Thread`/`Reaction` models, no chat screen, no chat service. The only
  message-shaped code is `DiscordMessage`/`DiscordChannel`/`DiscordReaction`
  (`lib/core/models/discord_integration.dart`), which models Discord's wire format for an
  external bot integration — not usable as-is for native team chat (no channel visibility
  concept, no threads, no scheduling, no mentions-resolution, no pins, no drafts).
- Gap vs. Space: public/private channels, DMs, group conversations, notification feeds
  (`#Spacebox`), threads-as-channels, reactions, pinning, scheduled/postponed messages, typing
  indicators, drafts, saved messages+labels, stickers, polls, read/unread + mention tracking,
  channel↔event subscriptions, Slack export.
- Nothing to partially credit — 0% coverage.

### Documents — PARTIAL
- Have: `Document` model (`lib/core/models/document.dart`) — flat: `id, title, content,
  description, authorId, authorName, createdAt, updatedAt, type (markdown/text/code), tags,
  projectId, workspaceId`. `DocumentType` enum is a much narrower analog of Space's
  `bodyType` (no rich-text/checklist/blog-post distinction; `code` type has no Space
  equivalent). `document_screen.dart` (578 lines) is a Riverpod `StateNotifier<List<Document>>`
  CRUD UI over **hardcoded mock data**, no real backend/persistence call.
- Missing: folders/hierarchy (`DocumentFolder`, root-folder requirement), personal vs. project
  vs. KB containers (`DocumentContainerInfo`/`ContainerType`), sharing/access
  (`DocumentAccess`/`FolderAccess`, viewer/editor grants, per-team grants), publish-to-blog
  workflow, move/copy-to-project semantics, archive→delete two-step lifecycle, **version
  history + restore** (`DocumentHistoryService`, `TextDocumentHistoryService`), checklist
  document type, file-upload document type, folder cover image/description, document modes
  (VIEW/EDIT/SIDE_BY_SIDE), search-by-title-and-content, Confluence/local-folder import.
- Knowledge Base layer (Books/`KB_Book`, KB folders, KB articles, per-book editor
  teams/permissions, KB search/goto) — **entirely missing**, no analog at all.
- Estimate: ~10% coverage (single-level CRUD only, mocked, no versioning/sharing/hierarchy).

### Meetings — MISSING (entirely)
- No model, service, or screen. No `DTO_Meeting` analog, no RSVP, no recurrence
  (`CalendarEventSpec`/`RecurrenceRule`), no room/location booking or conflict detection, no
  meeting-linked chat channel, no meeting notifications.

### Calendar — MISSING (entirely)
- No model, service, or screen. No day/week/month/schedule views, no CalDAV export, no
  per-user multi-calendar support, no absence/todo/issue aggregation toggles.

### Summary table
| Area | Coverage | Notes |
|---|---|---|
| Chat (channels/messages/threads/reactions) | 0% | Discord bridge only, not native |
| Documents (CRUD) | ~10% | flat mock CRUD, no folders/sharing/versioning |
| Knowledge Base | 0% | no Book/Folder/Article layer |
| Meetings | 0% | nothing |
| Calendar | 0% | nothing |
