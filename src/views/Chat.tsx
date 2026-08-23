import { createResource, createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { useDeepLink, linkProps, route } from "../router";
import { currentUser, isWeb } from "../session";
import { authApi } from "../api/auth";
import "../App.css";
import "./Chat.css";
import {
  chatApi,
  newId,
  type Channel,
  type ChannelContentType,
  type ChannelSummary,
  type MessageView,
  type NewMessageAttachment,
  type ProfileLite,
} from "../api/chat";
import { applicationsApi } from "../api/applications";
import { applyCommand, COMMAND_FANOUT_LIMIT, mapWithLimit, mergeCommandListings, slashPrefix, type CommandEntry } from "../chatCommands";

const GROUP_ORDER: { key: ChannelContentType; label: string }[] = [
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "dm", label: "Direct Messages" },
  { key: "entity-bound", label: "Entity Discussions" },
];

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀"];
const POLL_OPTIONS = [
  { label: "2s", ms: 2000 },
  { label: "5s", ms: 5000 },
  { label: "10s", ms: 10000 },
  { label: "off", ms: 0 },
];

function when(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Chat() {
  const [error, setError] = createSignal<string | null>(null);
  const fail = (e: unknown) => setError(String(e));

  // Desktop can act as any profile. Web chat is always bound to the authenticated profile.
  const [profiles] = createResource<ProfileLite[]>(() => chatApi.listProfiles());
  const [directory] = createResource(() => isWeb() ? authApi.directory() : Promise.resolve([]));
  const directCandidates = () => (isWeb()
    ? (directory() ?? []).map((user) => ({ id: user.profile_id, username: user.username, display_name: user.display_name, archived: false }))
    : (profiles() ?? [])
  ).filter((profile) => !profile.archived && profile.id !== actingProfileId());
  const recipientsLoading = () => isWeb() ? directory.loading : profiles.loading;
  const [actingProfileId, setActingProfileId] = createSignal<string | null>(null);
  createEffect(() => {
    const authenticated = currentUser()?.profile_id;
    if (isWeb() && authenticated) { setActingProfileId(authenticated); return; }
    const list = profiles();
    if (list && list.length && !actingProfileId()) setActingProfileId(list[0].id);
  });

  // polling
  const [pollMs, setPollMs] = createSignal(5000);

  // channels (sidebar), grouped by content_type, with unread + member meta
  const [channels, { refetch: refetchChannels }] = createResource(actingProfileId, (id) =>
    id ? chatApi.listChannelsWithMeta(id) : Promise.resolve<ChannelSummary[]>([]),
  );
  const grouped = () => {
    const groups: Record<string, ChannelSummary[]> = { public: [], private: [], dm: [], "entity-bound": [] };
    for (const c of channels() ?? []) (groups[c.content_type] ??= []).push(c);
    return groups;
  };

  const [activeChannelId, setActiveChannelId] = createSignal<string | null>(null);
  // Default to the first channel once, on load only. Afterwards the URL owns the selection,
  // so back-navigating to the view-only URL (which clears the channel below) must not
  // immediately re-select the first channel.
  let didAutoSelect = false;
  createEffect(() => {
    if (didAutoSelect) return;
    const list = channels();
    if (list && list.length) { didAutoSelect = true; if (!activeChannelId() && !route().entityId) setActiveChannelId(list[0].id); }
  });
  const activeChannel = () => channels()?.find((c) => c.id === activeChannelId()) ?? null;
  useDeepLink("channel", (id) => setActiveChannelId(id), () => setActiveChannelId(null));

  // mark-read whenever the active channel (for the active profile) changes
  createEffect(() => {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (ch && p) chatApi.markChannelRead(ch, p).then(refetchChannels).catch(fail);
  });

  // messages in the active channel (root pane, thread replies excluded)
  const messageKey = () => {
    const ch = activeChannelId();
    return ch ? { ch, p: actingProfileId() } : null;
  };
  const [messages, { refetch: refetchMessages }] = createResource(messageKey, (k) =>
    chatApi.listMessages(k.ch, k.p),
  );

  // thread panel — only the root message id is pinned; the displayed root object
  // is derived live from the messages() resource so edits/reactions/reply-count
  // on it stay in sync instead of showing a frozen click-time snapshot.
  const [threadRootId, setThreadRootId] = createSignal<string | null>(null);
  const threadRoot = () => {
    const id = threadRootId();
    if (!id) return null;
    return messages()?.find((m) => m.id === id) ?? null;
  };
  const threadKey = () => {
    const id = threadRootId();
    return id ? { id, p: actingProfileId() } : null;
  };
  const [threadReplies, { refetch: refetchThread }] = createResource(threadKey, (k) =>
    chatApi.listThreadReplies(k.id, k.p),
  );

  // channel members
  const [members, { refetch: refetchMembers }] = createResource(activeChannelId, (id) =>
    id ? chatApi.listChannelMembers(id) : Promise.resolve([]),
  );
  const memberIds = () => new Set((members() ?? []).map((m) => m.profile_id));
  const [showMembers, setShowMembers] = createSignal(false);

  // polling loop — refreshes whatever is currently on screen
  createEffect(() => {
    const ms = pollMs();
    if (!ms) return;
    const t = setInterval(() => {
      refetchChannels();
      refetchMessages();
      if (threadRootId()) refetchThread();
      refetchMembers();
    }, ms);
    onCleanup(() => clearInterval(t));
  });

  // ---- composing ----
  // A pending attachment carries its own lifecycle: one bad file (too large, unreadable,
  // rejected by the backend) must not discard the ones that are fine.
  type PendingAttachment = NewMessageAttachment & { state: "loading" | "uploading" | "completed" | "failed"; error?: string };
  const [draft, setDraft] = createSignal("");
  const [draftAttachments, setDraftAttachments] = createSignal<PendingAttachment[]>([]);
  const [draftMentionIds, setDraftMentionIds] = createSignal<string[]>([]);
  const [threadAttachments, setThreadAttachments] = createSignal<PendingAttachment[]>([]);
  const [threadMentionIds, setThreadMentionIds] = createSignal<string[]>([]);
  const mentionQuery = (text: string) => text.match(/(?:^|\s)@([^\s@]*)$/)?.[1].toLocaleLowerCase() ?? null;
  const mentionCandidates = (text: string) => {
    const query = mentionQuery(text);
    if (query === null) return [];
    return (profiles() ?? []).filter((profile) => !profile.archived && profile.id !== actingProfileId() && [profile.display_name, profile.username].some((value) => value.toLocaleLowerCase().includes(query))).slice(0, 5);
  };
  function selectMention(kind: "draft" | "thread", profile: ProfileLite) {
    const text = kind === "draft" ? draft() : threadDraft();
    const replace = text.replace(/(?:^|\s)@([^\s@]*)$/, (match) => match.startsWith(" ") ? ` @${profile.display_name} ` : `@${profile.display_name} `);
    if (kind === "draft") { setDraft(replace); setDraftMentionIds((ids) => ids.includes(profile.id) ? ids : [...ids, profile.id]); }
    else { setThreadDraft(replace); setThreadMentionIds((ids) => ids.includes(profile.id) ? ids : [...ids, profile.id]); }
  }
  // ---- slash commands: asked of each bot's endpoint, never read from a local catalog ----
  const [chatbots] = createResource(async () => {
    const applications = await applicationsApi.applications();
    const lists = await Promise.all(
      applications
        .filter((application) => !application.archived)
        .map((application) => applicationsApi.chatbots(application.id).catch(() => [])),
    );
    return lists.flat();
  });
  const commandPrefix = () => slashPrefix(draft());
  const [commandEntries, setCommandEntries] = createSignal<CommandEntry[]>([]);
  createEffect(() => {
    const prefix = commandPrefix();
    const profile = actingProfileId();
    const bots = chatbots() ?? [];
    if (prefix === null || !profile || !bots.length) { setCommandEntries([]); return; }
    let live = true;
    onCleanup(() => { live = false; });
    // Debounced AND bounded: one keystroke must not fan out to every bot endpoint at
    // once, and a superseded query stops dispatching instead of running to completion.
    const timer = setTimeout(async () => {
      const answers = await mapWithLimit(bots, COMMAND_FANOUT_LIMIT, async (bot) => {
        try {
          return { listing: await applicationsApi.chatbotCommands(bot.id, profile, prefix), bot_name: bot.display_name };
        } catch { return null; }
      }, () => !live);
      if (!live) return;
      setCommandEntries(mergeCommandListings(answers.filter((a) => a !== null) as { listing: Awaited<ReturnType<typeof applicationsApi.chatbotCommands>>; bot_name: string }[]));
    }, 150);
    onCleanup(() => clearTimeout(timer));
  });
  function selectCommand(entry: CommandEntry) { setDraft(applyCommand(entry.name)); setCommandEntries([]); }

  async function queueAttachments(files: FileList | null, setAttachments: (value: PendingAttachment[] | ((items: PendingAttachment[]) => PendingAttachment[])) => void) {
    if (!files) return;
    // settled, not all-or-nothing: an oversized file is reported as its own failed chip
    const loaded = await Promise.all([...files].map((file) => new Promise<PendingAttachment>((resolve) => {
      const base = { id: newId("attachment"), file_name: file.name, mime_type: file.type || "application/octet-stream", byte_length: file.size };
      if (file.size > 10 * 1024 * 1024) { resolve({ ...base, data_url: "", state: "failed", error: `${file.name} exceeds the 10 MiB attachment limit` }); return; }
      const reader = new FileReader();
      reader.onerror = () => resolve({ ...base, data_url: "", state: "failed", error: reader.error?.message ?? `Could not read ${file.name}` });
      reader.onload = () => resolve({ ...base, data_url: String(reader.result), state: "loading" });
      reader.readAsDataURL(file);
    })));
    setAttachments((items) => [...items, ...loaded]);
    const rejected = loaded.filter((item) => item.state === "failed");
    if (rejected.length) fail(new Error(rejected.map((item) => item.error).join("; ")));
  }

  /// Stores every attachment the backend accepts and leaves the rest in the composer,
  /// marked failed, so a retry reuses the same message instead of posting a duplicate.
  async function saveAttachments(
    messageId: string,
    attachments: PendingAttachment[],
    setAttachments: (value: PendingAttachment[] | ((items: PendingAttachment[]) => PendingAttachment[])) => void,
  ): Promise<boolean> {
    const uploadable = attachments.filter((item) => item.state !== "failed" || item.data_url);
    setAttachments((items) => items.map((item) => uploadable.some((u) => u.id === item.id) ? { ...item, state: "uploading", error: undefined } : item));
    const results = await Promise.all(uploadable.map(async (attachment) => {
      try {
        await chatApi.addMessageAttachment(messageId, { id: attachment.id, file_name: attachment.file_name, mime_type: attachment.mime_type, byte_length: attachment.byte_length, data_url: attachment.data_url, upload_state: "completed" });
        return { id: attachment.id, error: null as string | null };
      } catch (e) {
        return { id: attachment.id, error: e instanceof Error ? e.message : String(e) };
      }
    }));
    const failures = results.filter((r) => r.error);
    setAttachments((items) => items
      .filter((item) => failures.some((f) => f.id === item.id) || !uploadable.some((u) => u.id === item.id))
      .map((item) => {
        const failure = failures.find((f) => f.id === item.id);
        return failure ? { ...item, state: "failed" as const, error: failure.error ?? "upload failed" } : item;
      }));
    if (failures.length) fail(new Error(failures.map((f) => f.error).join("; ")));
    return failures.length === 0;
  }

  // The message id of a post whose attachments partly failed: a retry attaches to it
  // rather than creating a second message.
  const [draftMessageId, setDraftMessageId] = createSignal<string | null>(null);
  const [threadMessageId, setThreadMessageId] = createSignal<string | null>(null);
  async function retryDraftAttachments() {
    const id = draftMessageId();
    if (!id) return;
    if (await saveAttachments(id, draftAttachments().filter((a) => a.data_url), setDraftAttachments)) setDraftMessageId(null);
    refetchMessages();
  }
  async function retryThreadAttachments() {
    const id = threadMessageId();
    if (!id) return;
    if (await saveAttachments(id, threadAttachments().filter((a) => a.data_url), setThreadAttachments)) setThreadMessageId(null);
    refetchThread(); refetchMessages();
  }
  async function sendMessage() {
    const ch = activeChannelId();
    const p = actingProfileId();
    const text = draft().trim();
    const attachments = draftAttachments();
    // a half-posted message is finished, never duplicated
    if (draftMessageId()) { await retryDraftAttachments(); return; }
    if (!ch || !p || (!text && !attachments.length)) return;
    try {
      const message = await chatApi.createMessage({
        id: newId("msg"),
        channel_id: ch,
        author_id: p,
        text,
        created_at: Math.floor(Date.now() / 1000),
        edited_at: null,
        thread_of: null,
        archived: false,
        mention_ids: draftMentionIds(),
      });
      const ok = await saveAttachments(message.id, attachments, setDraftAttachments);
      setDraftMessageId(ok ? null : message.id);
      setDraft(""); setDraftMentionIds([]);
      refetchMessages();
      refetchChannels();
    } catch (e) {
      fail(e);
    }
  }

  const [threadDraft, setThreadDraft] = createSignal("");
  async function sendThreadReply() {
    const root = threadRoot();
    const p = actingProfileId();
    const text = threadDraft().trim();
    const attachments = threadAttachments();
    if (threadMessageId()) { await retryThreadAttachments(); return; }
    if (!root || !p || (!text && !attachments.length)) return;
    try {
      const message = await chatApi.createMessage({
        id: newId("msg"),
        channel_id: root.channel_id,
        author_id: p,
        text,
        created_at: Math.floor(Date.now() / 1000),
        edited_at: null,
        thread_of: root.id,
        archived: false,
        mention_ids: threadMentionIds(),
      });
      const ok = await saveAttachments(message.id, attachments, setThreadAttachments);
      setThreadMessageId(ok ? null : message.id);
      setThreadDraft(""); setThreadMentionIds([]);
      refetchThread();
      refetchMessages();
      refetchChannels();
    } catch (e) {
      fail(e);
    }
  }

  async function deleteAttachment(id: string) {
    try {
      await chatApi.removeMessageAttachment(id);
      refetchMessages();
      refetchThread();
    } catch (e) { fail(e); }
  }

  // ---- edit / delete ----
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal("");
  function startEdit(m: MessageView) {
    setEditingId(m.id);
    setEditText(m.text);
  }
  async function saveEdit() {
    const id = editingId();
    if (!id) return;
    try {
      await chatApi.updateMessage(id, editText());
      setEditingId(null);
      refetchMessages();
      refetchThread();
    } catch (e) {
      fail(e);
    }
  }
  async function removeMessage(id: string) {
    try {
      await chatApi.deleteMessage(id);
      refetchMessages();
      refetchThread();
      refetchChannels();
      if (threadRootId() === id) setThreadRootId(null);
    } catch (e) {
      fail(e);
    }
  }

  // ---- reactions ----
  async function toggleReaction(m: MessageView, emoji: string, inThread: boolean) {
    const p = actingProfileId();
    if (!p) return;
    try {
      const mine = m.reactions.find((r) => r.emoji === emoji)?.mine;
      if (mine) await chatApi.removeReaction(m.id, p, emoji);
      else await chatApi.addReaction(m.id, p, emoji);
      refetchMessages();
      if (inThread) refetchThread();
    } catch (e) {
      fail(e);
    }
  }

  // ---- channel creation ----
  const [newChannelName, setNewChannelName] = createSignal("");
  const [newChannelType, setNewChannelType] = createSignal<ChannelContentType>("public");
  const [directRecipientId, setDirectRecipientId] = createSignal("");
  async function createChannel() {
    const p = actingProfileId();
    const recipient = directRecipientId();
    const direct = newChannelType() === "dm";
    const name = direct
      ? `${profileName(p)} · ${profileName(recipient)}`
      : newChannelName().trim();
    if (!name || !p || (direct && !recipient)) return;
    const channel: Channel = {
      id: newId("chan"),
      content_type: newChannelType(),
      name,
      description: null,
      project_id: null,
      archived: false,
    };
    try {
      await chatApi.createChannel(channel, direct ? [p, recipient] : [p]);
      setNewChannelName("");
      setDirectRecipientId("");
      refetchChannels();
      setActiveChannelId(channel.id);
    } catch (e) {
      fail(e);
    }
  }

  // ---- membership actions ----
  async function joinActive() {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch || !p) return;
    await chatApi.joinChannel(ch, p).catch(fail);
    refetchMembers();
    refetchChannels();
  }
  async function leaveActive() {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch || !p) return;
    await chatApi.leaveChannel(ch, p).catch(fail);
    refetchMembers();
    refetchChannels();
  }
  async function addMember(profileId: string) {
    const ch = activeChannelId();
    if (!ch || !profileId) return;
    await chatApi.addChannelMember(ch, profileId, false).catch(fail);
    refetchMembers();
  }
  async function removeMember(profileId: string) {
    const ch = activeChannelId();
    if (!ch) return;
    await chatApi.removeChannelMember(ch, profileId).catch(fail);
    refetchMembers();
  }

  function profileName(id: string | null) {
    if (!id) return "—";
    return profiles()?.find((p) => p.id === id)?.display_name ?? id;
  }

  function renderMessage(m: MessageView, inThread: boolean) {
    const mine = () => m.author_id === actingProfileId();
    return (
      <div class="message-row">
        <Show
          when={editingId() === m.id}
          fallback={
            <>
              <div class="message-head">
                <span class="message-author">{profileName(m.author_id)}</span>
                <span class="message-time">{when(m.created_at)}</span>
                <Show when={m.edited_at}>
                  <span class="message-edited">(edited)</span>
                </Show>
              </div>
              <div class="message-text">{m.text}</div>
              <Show when={(m.attachments ?? []).length}><div class="message-attachments"><For each={m.attachments ?? []}>{(attachment) => (
                <div class="attachment-card">
                  <Show when={attachment.mime_type.startsWith("image/")} fallback={<Show when={attachment.mime_type.startsWith("video/")} fallback={<Show when={attachment.mime_type.startsWith("audio/")} fallback={<a href={attachment.data_url} download={attachment.file_name}>📎 {attachment.file_name}</a>}><audio controls src={attachment.data_url} /></Show>}><video controls src={attachment.data_url} /></Show>}><img src={attachment.data_url} alt={attachment.file_name} /></Show>
                  <a href={attachment.data_url} download={attachment.file_name} class="attachment-name">{attachment.file_name}</a>
                  <Show when={attachment.upload_state !== "completed"}>
                    <span class={`attachment-state state-${attachment.upload_state}`}>{attachment.upload_state === "failed" ? `⚠ ${attachment.error ?? "upload failed"}` : "⏳ uploading"}</span>
                  </Show>
                  <button class="attachment-remove" title="Remove attachment" onClick={() => deleteAttachment(attachment.id)}>×</button>
                </div>
              )}</For></div></Show>
            </>
          }
        >
          <div class="edit-box">
            <textarea value={editText()} onInput={(e) => setEditText(e.currentTarget.value)} />
            <div class="row-actions">
              <button class="ghost small" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button class="primary" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        </Show>

        <div class="reaction-row">
          <For each={m.reactions}>
            {(r) => (
              <span
                class="reaction-chip"
                classList={{ mine: r.mine }}
                onClick={() => toggleReaction(m, r.emoji, inThread)}
              >
                {r.emoji} {r.count}
              </span>
            )}
          </For>
          <span class="reaction-add">
            <For each={QUICK_EMOJI}>
              {(e) => (
                <span class="reaction-chip ghost" onClick={() => toggleReaction(m, e, inThread)}>
                  {e}
                </span>
              )}
            </For>
          </span>
        </div>

        <div class="message-actions">
          <Show when={mine()}>
            <button class="ghost small" onClick={() => startEdit(m)}>
              edit
            </button>
            <button class="ghost small" onClick={() => removeMessage(m.id)}>
              delete
            </button>
          </Show>
          <Show when={!inThread}>
            <button class="ghost small" onClick={() => setThreadRootId(m.id)}>
              reply in thread
            </button>
          </Show>
        </div>

        <Show when={!inThread && m.reply_count > 0}>
          <div class="thread-badge" onClick={() => setThreadRootId(m.id)}>
            {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"} →
          </div>
        </Show>
      </div>
    );
  }

  return (
    <div class="chat-shell">
      <Show when={error()}>
        <div class="error-bar" onClick={() => setError(null)}>
          {error()}
        </div>
      </Show>

      <aside class="chat-sidebar">
        <div class="chat-profile-picker">
          <span class="section-label" style="padding:0">
            Acting as
          </span>
          <select
            value={actingProfileId() ?? ""}
            disabled={isWeb()}
            title={isWeb() ? "Chat identity is fixed to your signed-in account" : undefined}
            onChange={(e) => setActingProfileId(e.currentTarget.value || null)}
          >
            <For each={profiles()?.filter((p) => !p.archived)}>{(p) => <option value={p.id} selected={p.id === actingProfileId()}>{p.display_name}</option>}</For>
          </select>
        </div>

        <div class="channel-groups">
          <For each={GROUP_ORDER}>
            {(group) => (
              <Show when={grouped()[group.key]?.length}>
                <div class="section-label">{group.label}</div>
                <ul class="channel-list">
                  <For each={grouped()[group.key]}>
                    {(c) => (
                      <li
                        classList={{ active: c.id === activeChannelId() }}
                      >
                        <a class="row-link" {...linkProps({ view: "Chat", entityType: "channel", entityId: c.id })}>
                        <span class="channel-name">{c.name ?? c.content_type}</span>
                        <Show when={c.unread_count > 0}>
                          <span class="unread-badge">{c.unread_count}</span>
                        </Show>
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            )}
          </For>
          <Show when={!channels()?.length}>
            <p class="hint">No channels yet — create one below.</p>
          </Show>
        </div>

        <div class="new-channel-form">
          <div class="section-label" style="padding:0">
            New conversation
          </div>
          <Show when={newChannelType() !== "dm"}>
            <input
              placeholder="Channel name"
              value={newChannelName()}
              onInput={(e) => setNewChannelName(e.currentTarget.value)}
            />
          </Show>
          <select
            value={newChannelType()}
            onChange={(e) => setNewChannelType(e.currentTarget.value as ChannelContentType)}
          >
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="dm">Direct message</option>
            <option value="entity-bound">Entity-bound</option>
          </select>
          <Show when={newChannelType() === "dm"}>
            <label class="recipient-picker">To
              <select aria-label="Direct message recipient" value={directRecipientId()} disabled={recipientsLoading() || !directCandidates().length} onChange={(e) => setDirectRecipientId(e.currentTarget.value)}>
                <option value="">{recipientsLoading() ? "Loading users…" : directCandidates().length ? "Choose user…" : "No other active users"}</option>
                <For each={directCandidates()}>
                  {(p) => <option value={p.id}>{p.display_name} (@{p.username})</option>}
                </For>
              </select>
            </label>
            <Show when={!recipientsLoading() && !directCandidates().length}>
              <small class="hint">Add an account in Users first.</small>
            </Show>
          </Show>
          <button class="primary" onClick={createChannel} disabled={newChannelType() === "dm" ? !directRecipientId() : !newChannelName().trim()}>
            {newChannelType() === "dm" ? "Start chat" : "Create"}
          </button>
        </div>

        <div class="poll-picker">
          Refresh:
          <For each={POLL_OPTIONS}>
            {(opt) => (
              <button
                class="ghost small"
                classList={{ active: pollMs() === opt.ms }}
                onClick={() => setPollMs(opt.ms)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </aside>

      <section class="chat-center">
        <header class="chat-topbar">
          <Show when={activeChannel()} fallback={<span class="hint">No channel selected</span>}>
            <strong>{activeChannel()!.name ?? activeChannel()!.content_type}</strong>
            <span class="branch-chip">{activeChannel()!.content_type}</span>
          </Show>
          <div class="members-toggle">
            <button class="ghost small" onClick={() => setShowMembers((v) => !v)}>
              members ({members()?.length ?? 0})
            </button>
          </div>
        </header>

        <div class="message-pane">
          <Show when={!messages.loading} fallback={<p class="hint">Loading messages…</p>}>
            <Show when={messages()?.length} fallback={<p class="hint pad">No messages yet — say hello.</p>}>
              <For each={messages()}>{(m) => renderMessage(m, false)}</For>
            </Show>
          </Show>
        </div>

        <Show when={activeChannelId()}>
          <div class="composer composer-wrap">
            <textarea
              placeholder="Message…"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <label class="attachment-button" title="Attach files">📎<input type="file" multiple onChange={(e) => { queueAttachments(e.currentTarget.files, setDraftAttachments); e.currentTarget.value = ""; }} /></label>
            <button class="primary" onClick={sendMessage} disabled={!draft().trim() && !draftAttachments().length}>Send</button>
            <Show when={mentionCandidates(draft()).length}><div class="mention-menu"><For each={mentionCandidates(draft())}>{(profile) => <button type="button" onClick={() => selectMention("draft", profile)}>@{profile.display_name}</button>}</For></div></Show>
            <Show when={commandEntries().length}><div class="mention-menu command-menu"><For each={commandEntries()}>{(entry) => <button type="button" onClick={() => selectCommand(entry)}>/{entry.name} <span class="hint">{entry.bot_name}{entry.description ? ` — ${entry.description}` : ""}{entry.source === "registration" ? " (declared)" : ""}</span></button>}</For></div></Show>
            <Show when={draftAttachments().length}><div class="pending-attachments">
              <For each={draftAttachments()}>{(attachment) => (
                <span class={`attachment-chip state-${attachment.state}`} title={attachment.error ?? attachment.state}>
                  <Show when={attachment.state === "uploading"}>⏳ </Show><Show when={attachment.state === "failed"}>⚠ </Show>{attachment.file_name}
                  <Show when={attachment.state === "failed" && attachment.data_url && draftMessageId()}>
                    <button class="attachment-retry" onClick={retryDraftAttachments}>Retry</button>
                  </Show>
                  <button class="attachment-remove" onClick={() => setDraftAttachments((items) => items.filter((item) => item.id !== attachment.id))}>×</button>
                </span>
              )}</For>
            </div></Show>
          </div>
        </Show>
      </section>

      <Show when={showMembers() || threadRoot()}>
      <aside class="chat-detail">
        <Show when={showMembers()}>
          <div class="members-panel">
            <div class="section-label" style="padding:0 0 0.4em">
              Members
            </div>
            <ul>
              <For each={members()}>
                {(m) => (
                  <li>
                    <span>
                      {profileName(m.profile_id)} {m.administrator ? "★" : ""}
                    </span>
                    <button class="ghost small" onClick={() => removeMember(m.profile_id)}>
                      ×
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <select onChange={(e) => e.currentTarget.value && addMember(e.currentTarget.value)}>
              <option value="">+ add member…</option>
              <For each={profiles()?.filter((p) => !memberIds().has(p.id))}>
                {(p) => <option value={p.id}>{p.display_name}</option>}
              </For>
            </select>
            <div class="row-actions">
              <Show
                when={actingProfileId() && memberIds().has(actingProfileId()!)}
                fallback={
                  <button class="ghost small" onClick={joinActive}>
                    Join
                  </button>
                }
              >
                <button class="ghost small" onClick={leaveActive}>
                  Leave
                </button>
              </Show>
            </div>
          </div>
        </Show>

        <Show
          when={threadRoot()}
          fallback={<p class="hint pad">Select a message’s “reply in thread” to open its thread.</p>}
        >
          <div class="thread-header">
            <strong>Thread</strong>
            <button class="ghost small" onClick={() => setThreadRootId(null)}>
              ×
            </button>
          </div>
          <div class="message-pane">
            {renderMessage(threadRoot()!, false)}
            <hr />
            <Show when={!threadReplies.loading} fallback={<p class="hint">Loading thread…</p>}>
              <For each={threadReplies()}>{(m) => renderMessage(m, true)}</For>
            </Show>
          </div>
          <div class="composer composer-wrap">
            <textarea
              placeholder="Reply in thread…"
              value={threadDraft()}
              onInput={(e) => setThreadDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendThreadReply();
                }
              }}
            />
            <label class="attachment-button" title="Attach files">📎<input type="file" multiple onChange={(e) => { queueAttachments(e.currentTarget.files, setThreadAttachments); e.currentTarget.value = ""; }} /></label>
            <button class="primary" onClick={sendThreadReply} disabled={!threadDraft().trim() && !threadAttachments().length}>Reply</button>
            <Show when={mentionCandidates(threadDraft()).length}><div class="mention-menu"><For each={mentionCandidates(threadDraft())}>{(profile) => <button type="button" onClick={() => selectMention("thread", profile)}>@{profile.display_name}</button>}</For></div></Show>
            <Show when={threadAttachments().length}><div class="pending-attachments">
              <For each={threadAttachments()}>{(attachment) => (
                <span class={`attachment-chip state-${attachment.state}`} title={attachment.error ?? attachment.state}>
                  <Show when={attachment.state === "uploading"}>⏳ </Show><Show when={attachment.state === "failed"}>⚠ </Show>{attachment.file_name}
                  <Show when={attachment.state === "failed" && attachment.data_url && threadMessageId()}>
                    <button class="attachment-retry" onClick={retryThreadAttachments}>Retry</button>
                  </Show>
                  <button class="attachment-remove" onClick={() => setThreadAttachments((items) => items.filter((item) => item.id !== attachment.id))}>×</button>
                </span>
              )}</For>
            </div></Show>
          </div>
        </Show>
      </aside>
      </Show>
    </div>
  );
}
