// Chat (m2) API surface — thin invoke() wrappers over src-tauri/src/chat.rs.
// Kept standalone from ../api.ts (owned by another lane): types + calls needed by
// views/Chat.tsx + views/Chat.css only.
import { invoke } from "@tauri-apps/api/core";

export type ChannelContentType = "dm" | "private" | "public" | "entity-bound";

export type Channel = {
  id: string;
  content_type: string;
  name: string | null;
  description: string | null;
  project_id: string | null;
  archived: boolean;
read_only?: boolean;
};

export type ChannelSummary = Channel & {
  member_count: number;
  unread_count: number;
  last_message_at: number | null;
};
// A thread is its own channel; its root stays in `parent_channel_id` and is not repeated.
export type ThreadChannel = Channel & { root_message_id: string; parent_channel_id: string; skip_first_message: boolean; title: string | null; always_show: boolean; };
// A thread waiting on you, complete enough to render a worklist row without a second call.
export type UnreadThread = { channel_id: string; parent_channel_id: string; parent_channel_name: string | null; root_message_id: string; root_excerpt: string; unread_count: number; last_reply_at: number | null; last_reply_author: string | null };
/** A thread channel's id is `thread:<root message id>` (`ensure_thread_channel_impl`).
 *  That format is the backend's invariant, decoded in ONE place so a URL naming a
 *  thread can be reopened at its root instead of dead-ending on "No channel selected". */
export const threadRootOf = (channelId: string): string | null =>
  channelId.startsWith("thread:") ? channelId.slice("thread:".length) : null;

export type ChannelNotificationPreference = { profile_id:string; channel_id:string; email_enabled:boolean; push_enabled:boolean; thread_scope:"all"|"followed"|"none"; };
export type ChannelMember = {
  channel_id: string;
  profile_id: string;
  administrator: boolean;
};

export type Reaction = { emoji: string; count: number; mine: boolean };

// A poll option carries its tally and whether *I* picked it — never who else did.
export type PollOptionResult = {
  id: string;
  position: number;
  text: string;
  vote_count: number;
  me_voted: boolean;
};
export type PollView = {
  id: string;
  message_id: string;
  channel_id: string;
  author_id: string;
  question: string;
  multiple_choice: boolean;
  anonymous: boolean;
  closed_at: number | null;
  created_at: number;
  updated_at: number;
  options: PollOptionResult[];
  // Distinct people, not ballots: a multi-choice poll never reports turnout > electorate.
  voter_count: number;
};

// `thread_key` is "" for the channel-root composer, else the root message id.
export type MessageDraft = {
  channel_id: string;
  author_id: string;
  thread_key: string;
  text: string;
  updated_at: number;
};

export type TypingParticipant = {
  channel_id: string;
  profile_id: string;
  updated_at: number;
};

// A scheduled message is an unsent intent: it lives outside the message list until its
// delivery run posts it. `scheduled_at` is UTC epoch seconds, never a local wall clock.
export type ScheduledStatus = "pending" | "sent" | "cancelled";
export type ScheduledMessage = {
  id: string;
  channel_id: string;
  author_id: string;
  text: string;
  thread_of: string | null;
  scheduled_at: number;
  status: ScheduledStatus;
  sent_message_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};
// UNVERIFIED: V119 currently creates team rows; chat command serialization must accept this wire shape.
export type MentionPayload = { target_type: "profile" | "team" | "issue" | "document"; target_id: string };
export type Message = {
  id: string;
  channel_id: string;
  author_id: string | null;
  text: string;
  created_at: number;
  edited_at: number | null;
  thread_of: string | null;
  archived: boolean;
  pinned?: boolean;
  // "poll" marks the message that carries a poll: its text is the question, and the
  // tally lives in `message_polls` (fetched separately, never inlined here).
  content_kind?: "text" | "absence-card" | "poll";
  // Legacy profile ids remain while clients migrate to typed targets.
  mention_ids?: string[];
  mention_targets?: MentionPayload[];
};
// Upload lifecycle (KB §04 collaboration): a row can exist before its bytes are stored,
// so the state is persisted rather than inferred from the row's presence.
export type AttachmentUploadState = "loading" | "uploading" | "completed" | "failed";
export type MessageAttachment = { id: string; message_id: string; file_name: string; mime_type: string; byte_length: number; data_url: string; upload_state: AttachmentUploadState; error: string | null };
export type NewMessageAttachment = Omit<MessageAttachment, "message_id" | "upload_state" | "error"> & { upload_state?: AttachmentUploadState };
// A link the backend extracted from the message text, plus whatever unfurling learned.
// Text only — no image/thumbnail URL crosses this seam, so nothing external is ever
// loaded by the client on behalf of a message.
export type MessageLinkStatus = "pending" | "ok" | "refused" | "failed";
export type MessageLink = {
  url: string;
  position: number;
  status: MessageLinkStatus;
  title: string | null;
  description: string | null;
  site_name: string | null;
  error: string | null;
  fetched_at: number | null;
};
export type MessageView = Message & { reply_count: number; reactions: Reaction[]; attachments: MessageAttachment[]; links?: MessageLink[]; };
// One page of history, newest-first. `next_cursor` is opaque: it is a position handed
// back verbatim, never parsed or built by the client.
export type MessagePage = { messages: MessageView[]; next_cursor: string | null; has_more: boolean };
export type MentionView = MessageView & { channel_name: string | null; notification_id: string; read: boolean; mention_target?: MentionPayload };

// Minimal profile shape — read-only call into the existing platform::list_profiles
// command (not owned by this lane; only invoked, never redefined here).
export type ProfileLite = {
  id: string;
  username: string;
  display_name: string; archived?: boolean };

// Enough of an anchor's target to render a back-link into the conversation that
// produced a task/ticket/meeting. `excerpt` is a one-line preview, never the body.
export type SourceRef = { entity_type: string; entity_id: string; channel_id: string; channel_name: string | null; author_name: string | null; created_at: number; excerpt: string };
export const chatApi = {
  // profiles (acting-user picker for local, auth-less app)
  listProfiles: () => invoke<ProfileLite[]>("list_profiles"),

  // channels
  listChannels: () => invoke<Channel[]>("list_channels"),
  listChannelsWithMeta: (profileId: string) =>
    invoke<ChannelSummary[]>("list_channels_with_meta", { profileId }),
  // Threads are filtered OUT of listChannelsWithMeta on purpose; this is the only
  // way a surface learns that replies are waiting in one.
  listUnreadThreads: (profileId: string) => invoke<UnreadThread[]>("list_unread_threads", { profileId }),
  getChannel: (id: string) => invoke<Channel | null>("get_channel", { id }),
privateFeed: (profileId:string) => invoke<Channel>("private_feed", {profileId}),
channelNotificationPreference: (profileId:string,channelId:string) => invoke<ChannelNotificationPreference>("get_channel_notification_preference", {profileId,channelId}),
saveChannelNotificationPreference: (preference:ChannelNotificationPreference) => invoke<ChannelNotificationPreference>("save_channel_notification_preference", {preference}),
  createChannel: (channel: Channel, memberIds: string[]) =>
    invoke<Channel>("create_channel", { channel, memberIds }),
  updateChannel: (channel: Channel) => invoke<void>("update_channel", { channel }),
  /** Ends a conversation for everyone: the channel, its messages and everything
   *  hanging off them. Always ask first (ConfirmDialog). */
  deleteChannel: (id: string, actorId: string) => invoke<void>("delete_channel", { id, actorId }),
  joinChannel: (channelId: string, profileId: string) =>
    invoke<void>("join_channel", { channelId, profileId }),
  leaveChannel: (channelId: string, profileId: string) =>
    invoke<void>("leave_channel", { channelId, profileId }),
  // `memberId`, not `profileId`: the web transport rewrites any profile id in a
  // request to the caller's own, so naming somebody else needs a different key.
  addChannelMember: (channelId: string, memberId: string, administrator: boolean) =>
    invoke<void>("add_channel_member", { channelId, memberId, administrator }),
  removeChannelMember: (channelId: string, memberId: string) =>
    invoke<void>("remove_channel_member", { channelId, memberId }),
  listChannelMembers: (channelId: string) =>
    invoke<ChannelMember[]>("list_channel_members", { channelId }),
  createEntityChannel: (entityType: string, entityId: string, name?: string | null) =>
    invoke<Channel>("create_entity_channel", { entityType, entityId, name: name ?? null }),
  getChannelByEntity: (entityType: string, entityId: string) =>
    invoke<Channel | null>("get_channel_by_entity", { entityType, entityId }),
  // Turns a work item's `(source_entity_type, source_entity_id)` anchor back into a
  // clickable origin. Rejects (never returns null) when the source is gone or the
  // kind is unknown, so a dead link is visible instead of an empty source card.
  resolveSourceRef: (entityType: string, entityId: string) =>
    invoke<SourceRef>("resolve_source_ref", { entityType, entityId }),
  // Idempotent: opening a root creates its backing channel once, guarded by the parent ACL.
  ensureThreadChannel: (rootMessageId: string, title?: string | null, actingProfileId?: string | null) =>
    invoke<ThreadChannel>("ensure_thread_channel", { rootMessageId, title: title ?? null, actingProfileId: actingProfileId ?? null }),

  // messages
  listMessages: (channelId: string, actingProfileId?: string | null) =>
    invoke<MessageView[]>("list_messages", { channelId, actingProfileId: actingProfileId ?? null }),
  // Paged history: omit `cursor` for the newest page, then pass back `next_cursor`.
// `limit` is clamped server-side, so asking for more than the ceiling is not an error.
listMessagesPage: (
input: { channelId: string; threadOf?: string | null; cursor?: string | null; limit?: number | null; actingProfileId?: string | null },
) =>
invoke<MessagePage>("list_messages_page", {
channelId: input.channelId,
threadOf: input.threadOf ?? null,
cursor: input.cursor ?? null,
limit: input.limit ?? null,
actingProfileId: input.actingProfileId ?? null,
}),
// Explicit unfurl of a message's pending links. The server fetches, guarded; the client
// never requests a third-party URL itself.
unfurlMessageLinks: (messageId: string, actingProfileId?: string | null) =>
invoke<MessageLink[]>("unfurl_message_links", { messageId, actingProfileId: actingProfileId ?? null }),
listPinnedMessages: (channelId: string, actingProfileId?: string | null) =>
    invoke<MessageView[]>("list_pinned_messages", { channelId, actingProfileId: actingProfileId ?? null }),
  setMessagePinned: (id: string, pinned: boolean) =>
    invoke<MessageView>("set_message_pinned", { id, pinned }),

  // drafts: one unsent body per (channel, author, thread); saving "" clears it
  saveMessageDraft: (channelId: string, authorId: string, text: string, threadKey?: string | null) =>
    invoke<MessageDraft | null>("save_message_draft", { channelId, authorId, text, threadKey: threadKey ?? "" }),
  getMessageDraft: (channelId: string, authorId: string, threadKey?: string | null) =>
    invoke<MessageDraft | null>("get_message_draft", { channelId, authorId, threadKey: threadKey ?? "" }),
  listMessageDrafts: (authorId: string) =>
    invoke<MessageDraft[]>("list_message_drafts", { authorId }),
  deleteMessageDraft: (channelId: string, authorId: string, threadKey?: string | null) =>
    invoke<boolean>("delete_message_draft", { channelId, authorId, threadKey: threadKey ?? "" }),

  // typing presence: beats expire server-side, so a dead client cannot stick
  setChannelTyping: (channelId: string, profileId: string, typing: boolean) =>
    invoke<void>("set_channel_typing", { channelId, profileId, typing }),
  listChannelTyping: (channelId: string, actingProfileId?: string | null, ttlSecs?: number | null) =>
    invoke<TypingParticipant[]>("list_channel_typing", { channelId, actingProfileId: actingProfileId ?? null, ttlSecs: ttlSecs ?? null }),
  // scheduled messages: create/list/edit/cancel are author-scoped; delivery is the server's
  scheduleMessage: (
    input: { id: string; channelId: string; authorId: string; text: string; scheduledAt: number; threadOf?: string | null },
  ) =>
    invoke<ScheduledMessage>("schedule_message", {
      id: input.id,
      channelId: input.channelId,
      authorId: input.authorId,
      text: input.text,
      threadOf: input.threadOf ?? null,
      scheduledAt: input.scheduledAt,
    }),
  listScheduledMessages: (authorId: string, channelId?: string | null, status?: ScheduledStatus | null) =>
    invoke<ScheduledMessage[]>("list_scheduled_messages", { authorId, channelId: channelId ?? null, status: status ?? null }),
  getScheduledMessage: (id: string, authorId: string) =>
    invoke<ScheduledMessage>("get_scheduled_message", { id, authorId }),
  // `null` on a field means "leave it alone" — text and time move independently.
  updateScheduledMessage: (id: string, authorId: string, text?: string | null, scheduledAt?: number | null) =>
    invoke<ScheduledMessage>("update_scheduled_message", { id, authorId, text: text ?? null, scheduledAt: scheduledAt ?? null }),
  cancelScheduledMessage: (id: string, authorId: string) =>
    invoke<ScheduledMessage>("cancel_scheduled_message", { id, authorId }),

  // polls: a poll is the content of the message that carries it. The read model is an
  // aggregate (counts + my own picks) — individual ballots never cross this seam.
  createPoll: (
    input: { id: string; channelId: string; authorId: string; question: string; options: string[]; multipleChoice?: boolean; anonymous?: boolean },
  ) =>
    invoke<PollView>("create_poll", {
      id: input.id,
      channelId: input.channelId,
      authorId: input.authorId,
      question: input.question,
      options: input.options,
      multipleChoice: input.multipleChoice ?? null,
      anonymous: input.anonymous ?? null,
    }),
  getPoll: (id: string, actingProfileId?: string | null) =>
    invoke<PollView>("get_poll", { id, actingProfileId: actingProfileId ?? null }),
  listChannelPolls: (channelId: string, actingProfileId?: string | null) =>
    invoke<PollView[]>("list_channel_polls", { channelId, actingProfileId: actingProfileId ?? null }),
  // An empty `optionIds` withdraws the ballot; a single-choice poll refuses more than one.
  votePoll: (pollId: string, voterId: string, optionIds: string[]) =>
    invoke<PollView>("vote_poll", { pollId, voterId, optionIds }),
  closePoll: (pollId: string, authorId: string) =>
    invoke<PollView>("close_poll", { pollId, authorId }),
  listThreadReplies: (threadOf: string, actingProfileId?: string | null) =>
    invoke<MessageView[]>("list_thread_replies", { threadOf, actingProfileId: actingProfileId ?? null }),
  createMessage: (message: Message) => invoke<MessageView>("create_message", { message }),
  addMessageAttachment: (messageId: string, attachment: NewMessageAttachment) => invoke<MessageAttachment>("add_message_attachment", { messageId, attachment }),
  // The message id scopes every attachment write: the backend refuses an attachment id
  // that does not belong to the named message, and authorizes against that message.
  setMessageAttachmentState: (messageId: string, id: string, state: AttachmentUploadState, error?: string | null) =>
    invoke<MessageAttachment>("set_message_attachment_state", { messageId, id, state, error: error ?? null }),
  removeMessageAttachment: (messageId: string, id: string) => invoke<void>("remove_message_attachment", { messageId, id }),
  // `mentionTargets` omitted (null) means "leave the mentions alone"; an array replaces them
  // wholesale, so removing a name from the text also removes the notification.
  updateMessage: (id: string, text: string, mentionTargets?: MentionPayload[] | null) =>
    invoke<MessageView>("update_message", { id, text, mentionTargets: mentionTargets ?? null }),

  // mentions inbox / badge (KB §04: MentionsFolderVM, getTotalUnreadMentions)
  listMentionsForProfile: (profileId: string, unreadOnly?: boolean) =>
    invoke<MentionView[]>("list_mentions_for_profile", { profileId, unreadOnly: unreadOnly ?? null }),
  countUnreadMentions: (profileId: string) =>
    invoke<number>("count_unread_mentions", { profileId }),
  deleteMessage: (id: string) => invoke<void>("delete_message", { id }),

  // reactions
  addReaction: (messageId: string, profileId: string, emoji: string) =>
    invoke<Reaction[]>("add_reaction", { messageId, profileId, emoji }),
  removeReaction: (messageId: string, profileId: string, emoji: string) =>
    invoke<Reaction[]>("remove_reaction", { messageId, profileId, emoji }),

  // read state
  markChannelRead: (channelId: string, profileId: string, messageId?: string | null) =>
    invoke<void>("mark_channel_read", { channelId, profileId, messageId: messageId ?? null }),
};

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
