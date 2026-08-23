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

export type ChannelNotificationPreference = { profile_id:string; channel_id:string; email_enabled:boolean; push_enabled:boolean; thread_scope:"all"|"followed"|"none"; };
export type ChannelMember = {
  channel_id: string;
  profile_id: string;
  administrator: boolean;
};

export type Reaction = { emoji: string; count: number; mine: boolean };

export type Message = {
  id: string;
  channel_id: string;
  author_id: string | null;
  text: string;
  created_at: number;
  edited_at: number | null;
  thread_of: string | null;
  archived: boolean;
  mention_ids?: string[];
};
export type MessageAttachment = { id: string; message_id: string; file_name: string; mime_type: string; byte_length: number; data_url: string };
export type NewMessageAttachment = Omit<MessageAttachment, "message_id">;
export type MessageView = Message & { reply_count: number; reactions: Reaction[]; attachments: MessageAttachment[]; };

// Minimal profile shape — read-only call into the existing platform::list_profiles
// command (not owned by this lane; only invoked, never redefined here).
export type ProfileLite = {
  id: string;
  username: string;
  display_name: string; archived?: boolean };

export const chatApi = {
  // profiles (acting-user picker for local, auth-less app)
  listProfiles: () => invoke<ProfileLite[]>("list_profiles"),

  // channels
  listChannels: () => invoke<Channel[]>("list_channels"),
  listChannelsWithMeta: (profileId: string) =>
    invoke<ChannelSummary[]>("list_channels_with_meta", { profileId }),
  getChannel: (id: string) => invoke<Channel | null>("get_channel", { id }),
privateFeed: (profileId:string) => invoke<Channel>("private_feed", {profileId}),
channelNotificationPreference: (profileId:string,channelId:string) => invoke<ChannelNotificationPreference>("get_channel_notification_preference", {profileId,channelId}),
saveChannelNotificationPreference: (preference:ChannelNotificationPreference) => invoke<ChannelNotificationPreference>("save_channel_notification_preference", {preference}),
  createChannel: (channel: Channel, memberIds: string[]) =>
    invoke<Channel>("create_channel", { channel, memberIds }),
  updateChannel: (channel: Channel) => invoke<void>("update_channel", { channel }),
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

  // messages
  listMessages: (channelId: string, actingProfileId?: string | null) =>
    invoke<MessageView[]>("list_messages", { channelId, actingProfileId: actingProfileId ?? null }),
  listThreadReplies: (threadOf: string, actingProfileId?: string | null) =>
    invoke<MessageView[]>("list_thread_replies", { threadOf, actingProfileId: actingProfileId ?? null }),
  createMessage: (message: Message) => invoke<MessageView>("create_message", { message }),
  addMessageAttachment: (messageId: string, attachment: NewMessageAttachment) => invoke<MessageAttachment>("add_message_attachment", { messageId, attachment }),
  updateMessage: (id: string, text: string) => invoke<MessageView>("update_message", { id, text }),
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
