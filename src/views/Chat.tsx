import { createResource, createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { useDeepLink, linkProps, route } from "../router";
import { currentUser, isWeb, projects, reloadProjects } from "../session";
import { navLayout } from "../nav";
import { actingProfileId, bumpChannels, setActingProfileId } from "../chatIdentity";
import { authApi } from "../api/auth";
import DateTimeField from "../components/DateTimeField";
import ContextMenu, { type ContextMenuItem } from "../components/ContextMenu";
import WorkItemDrawer, { type WorkItemKind } from "../components/WorkItemDrawer";
import { openPath } from "@tauri-apps/plugin-opener";
import { Icon } from "../components/Icon";
import "../App.css";
import "./Chat.css";
import {
  chatApi,
  newId,
  threadRootOf,
  type Channel,
  type ChannelContentType,
  type ChannelSummary,
  type MentionView,
  type ChannelNotificationPreference,
  type MessageView,
  type NewMessageAttachment,
  type MentionPayload,
  type ProfileLite,
  type ScheduledMessage,
  type PollView,
} from "../api/chat";
// Rows per history page. One knob, used by both the live window and "load older";
// the server clamps it anyway, so this is a preference, never a trusted limit.
const PAGE_SIZE = 50;
import {
  applyPage,
  beginLoad,
  failLoad,
  initialPaging,
  resetPaging,
  visibleMessages,
} from "../messagePaging";
import { ballotAfterClick, optionShare, pollDraftError, pollIsOpen, POLL_MIN_OPTIONS } from "../poll";
import { applicationsApi } from "../api/applications";
import { personalApi } from "../api/personal";
import { platformApi } from "../api/platform";
import { applyCommand, COMMAND_FANOUT_LIMIT, mapWithLimit, mergeCommandListings, slashPrefix, type CommandEntry } from "../chatCommands";
import { canSendDraft, uploadableAttachments } from "../chatAttachments";
import { insertMention, mentionCandidates as candidatesFor, survivingMentions as survivorsOf, type MentionTarget, type MentionTargetRef } from "../chatMentions";
import { UI_LOCALE } from "../calendar";

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

/** Two-letter monogram for the message avatar (light shell only). */
const avatarInitials = (label: string) =>
  label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";

function when(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(UI_LOCALE, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * `embedded` — the caller already draws a channel list and a channel title, so Chat must
 * NOT draw its own. It is a real conditional, not CSS: a hidden-but-mounted sidebar still
 * fetches, still tab-traps, and still shows a second "new conversation" form. The chat-first
 * layout is embedded by definition (SpaceShell owns the sidebar), which is why the default
 * also consults `navLayout()` — the plain grouped/flat layouts keep the legacy sidebar.
 */
export default function Chat(props: { embedded?: boolean } = {}) {
  const showLegacySidebar = () => !props.embedded && navLayout() !== "chat-first";
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
  // The acting profile lives in src/chatIdentity.ts: in the chat-first layout the picker
  // is in the shell, so shell and view must read one cell. The seeding rule is unchanged.
  createEffect(() => {
    const authenticated = currentUser()?.profile_id;
    if (isWeb() && authenticated) { setActingProfileId(authenticated); return; }
    // No seeding from profiles()[0] any more: that guessed an identity (it picked the
    // organisation profile here) and locked the caller out of their own private feed.
    // chatIdentity falls back to the session profile, which is the real answer.
  });

  // polling
  const [pollMs, setPollMs] = createSignal(5000);

  // channels (sidebar), grouped by content_type, with unread + member meta
  const [channels, { refetch: refetchChannels }] = createResource(actingProfileId, (id) =>
    id ? chatApi.listChannelsWithMeta(id) : Promise.resolve<ChannelSummary[]>([]),
  );
  createEffect(() => { const id = actingProfileId(); if (id) void chatApi.privateFeed(id).then(refetchChannels).catch(fail); });
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

  /** ── A MESSAGE BECOMES WORK ────────────────────────────────────────────────
   *
   *  The whole machine for this existed and was reachable from nowhere: a finished
   *  `WorkItemDrawer`, a `resolve_source_ref` command on both backends, and the
   *  `source_entity_type/_id` anchor on issues, meetings and documents — imported by
   *  its own test and by nothing else. A channel card even ADVERTISED the mapping
   *  (Task / Ticket / Date) without offering it.
   *
   *  The trigger belongs on the MESSAGE, because that is where the person is when
   *  they realise the message is work — not on a side card, and not in a page header.
   *  One entry, three kinds: the reader decides whether this is a task, a defect or
   *  a date; the application must not guess that from the words. */
  const [workMenu, setWorkMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [workDraft, setWorkDraft] = createSignal<{ kind: WorkItemKind; messageId: string; excerpt: string } | null>(null);
  const openWorkMenu = (event: MouseEvent, message: MessageView) => {
    event.preventDefault();
    event.stopPropagation();
    const start = (kind: WorkItemKind) => () =>
      setWorkDraft({ kind, messageId: message.id, excerpt: (message.text ?? "").trim().slice(0, 120) });
    setWorkMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "Task", onSelect: start("task") },
        { label: "Ticket", onSelect: start("ticket") },
        { label: "Date", onSelect: start("event") },
      ],
    });
  };
  const preferenceKey = () => { const profile_id=actingProfileId(), channel_id=activeChannelId(); return profile_id&&channel_id ? {profile_id,channel_id} : null; };
  const [notificationPreference, { refetch: refetchNotificationPreference }] = createResource(preferenceKey, key => chatApi.channelNotificationPreference(key.profile_id, key.channel_id));
  const updateNotificationPreference = async (patch: Partial<ChannelNotificationPreference>) => { const current=notificationPreference(); if (!current) return; try { await chatApi.saveChannelNotificationPreference({...current,...patch}); await refetchNotificationPreference(); } catch (e) { fail(e); } };
  // A thread is addressed by its OWN channel id, but it is not a peer channel and
  // cannot be "selected": it opens as a panel over its parent (resolved below).
  // Selecting it here would blank the pane — which is exactly what such a URL did.
  useDeepLink("channel", (id) => { if (!threadRootOf(id)) setActiveChannelId(id); }, () => setActiveChannelId(null));

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
  // The live window is the newest page, not the whole channel: a long history must not
  // be one unbounded query, and paging older is the same call with a cursor.
  const [messagePage, { refetch: refetchMessages }] = createResource(messageKey, (k) =>
    chatApi.listMessagesPage({ channelId: k.ch, limit: PAGE_SIZE, actingProfileId: k.p }),
  );
  const messages = Object.assign(() => messagePage()?.messages, {
    get loading() {
      return messagePage.loading;
    },
  });
  // History paging: `messages()` is the live newest window; older pages accumulate in
  // `paging` and are merged for display (ordered, de-duplicated, race-guarded — see
  // src/messagePaging.ts). Switching channel/profile resets it, which also invalidates
  // any page still in flight for the channel we just left.
  const [paging, setPaging] = createSignal(initialPaging());
  createEffect(() => {
    messageKey();
    setPaging((state) => resetPaging(state));
  });
  const shownMessages = () => visibleMessages(paging(), messages());
  // Before any older page is pulled, the continuation point is the live page's own
  // cursor — one order, one cursor space, no second source of truth.
  const olderCursor = () => paging().cursor ?? messagePage()?.next_cursor ?? null;
  const canLoadOlder = () => paging().hasMore && olderCursor() !== null;
  const loadOlder = async () => {
    const key = messageKey();
    if (!key) return;
    const cursor = olderCursor();
    if (!cursor) return;
    const started = beginLoad(paging());
    if (!started.started) return;
    setPaging(started.state);
    try {
      const pageResult = await chatApi.listMessagesPage({
        channelId: key.ch,
        cursor,
        limit: PAGE_SIZE,
        actingProfileId: key.p,
      });
      setPaging((state) => applyPage(state, started.ticket, pageResult));
    } catch (e) {
      setPaging((state) => failLoad(state, started.ticket, e));
    }
  };
  const unfurlLinks = async (messageId: string) => {
    try {
      await chatApi.unfurlMessageLinks(messageId, actingProfileId());
      await refetchMessages();
    } catch (e) {
      fail(e);
    }
  };
  const [pinnedMessages, { refetch: refetchPinnedMessages }] = createResource(messageKey, (k) =>
    chatApi.listPinnedMessages(k.ch, k.p),
  );
  const [showPinned, setShowPinned] = createSignal(false);

  // thread panel — only the root message id is pinned; the displayed root object
  // is derived live from the messages() resource so edits/reactions/reply-count
  // on it stay in sync instead of showing a frozen click-time snapshot.
  const [threadRootId, setThreadRootId] = createSignal<string | null>(null);
  const threadRoot = () => {
    const id = threadRootId();
    if (!id) return null;
    return shownMessages().find((m) => m.id === id) ?? null;
  };
  const threadKey = () => {
    const id = threadRootId();
    return id ? { id, p: actingProfileId() } : null;
  };
  // Reopening a thread FROM A URL — the attention worklist links here. The root's own
  // channel comes from the existing anchor resolver, so no new grammar and no new read.
  useDeepLink("channel", (id) => {
    const root = threadRootOf(id);
    if (!root || threadRootId() === root) return;
    chatApi.resolveSourceRef("message", root)
      .then((ref) => { setActiveChannelId(ref.channel_id); setThreadRootId(root); })
      .catch(fail);
  });
  // A content thread is a real channel, linked to its root message. The root stays
  // in the parent pane (`skip_first_message`), while this resource owns only replies.
  const [threadChannel] = createResource(threadKey, (k) =>
    chatApi.ensureThreadChannel(k.id, null, k.p),
  );
  // Reading a thread is reading a channel. Without this the replies stayed "unread"
  // after you had them open, and the worklist row they produce would never clear.
  createEffect(() => {
    const thread = threadChannel();
    const p = actingProfileId();
    if (thread && p) chatApi.markChannelRead(thread.id, p).catch(fail);
  });
  const threadPageKey = () => {
    const k = threadKey(); const thread = threadChannel();
    return k && thread ? { ...k, channelId: thread.id } : null;
  };
  // Threads use the same cursor protocol as channel history, avoiding an
  // unbounded side-pane query for long discussions.
  const [threadPage, { refetch: refetchThread }] = createResource(threadPageKey, (k) =>
    chatApi.listMessagesPage({ channelId: k.channelId, limit: PAGE_SIZE, actingProfileId: k.p }),
  );
  const [threadPaging, setThreadPaging] = createSignal(initialPaging());
  createEffect(() => {
    threadKey();
    setThreadPaging((state) => resetPaging(state));
  });
  const shownThreadReplies = () => visibleMessages(threadPaging(), threadPage()?.messages);
  const olderThreadCursor = () => threadPaging().cursor ?? threadPage()?.next_cursor ?? null;
  const canLoadOlderThread = () => threadPaging().hasMore && olderThreadCursor() !== null;
  const loadOlderThread = async () => {
    const key = threadPageKey();
    const cursor = olderThreadCursor();
    if (!key || !cursor) return;
    const started = beginLoad(threadPaging());
    if (!started.started) return;
    setThreadPaging(started.state);
    try {
      const page = await chatApi.listMessagesPage({ channelId: key.channelId, cursor, limit: PAGE_SIZE, actingProfileId: key.p });
      setThreadPaging((state) => applyPage(state, started.ticket, page));
    } catch (e) {
      setThreadPaging((state) => failLoad(state, started.ticket, e));
    }
  };

  // channel members
  const [members, { refetch: refetchMembers }] = createResource(activeChannelId, (id) =>
    id ? chatApi.listChannelMembers(id) : Promise.resolve([]),
  );
  const memberIds = () => new Set((members() ?? []).map((m) => m.profile_id));
  const [showMembers, setShowMembers] = createSignal(false);
  /** A project-bound channel does not own its membership: the project's people ARE the
   *  channel's people (backend `EFFECTIVE_MEMBERS_SQL`). So this panel must not offer
   *  add/remove/join/leave there — the acts would be refused — and says where they live. */
  const inheritsMembers = () => !!activeChannel()?.project_id;
  const memberProject = () => {
    const owner = activeChannel()?.project_id;
    if (!owner) return undefined;
    if (!projects()) void reloadProjects().catch(() => undefined);
    return projects()?.find((p) => p.id === owner);
  };

  // polling loop — refreshes whatever is currently on screen
  createEffect(() => {
    const ms = pollMs();
    if (!ms) return;
    const t = setInterval(() => {
      refetchChannels();
      refetchMessages();
      refetchPinnedMessages();
      if (threadRootId()) refetchThread();
      refetchMembers();
      refetchMentions();
    }, ms);
    onCleanup(() => clearInterval(t));
  });

  // ---- mentions inbox (KB §04: MentionsFolderVM / getTotalUnreadMentions) ----
  const [mentions, { refetch: refetchMentions }] = createResource(actingProfileId, (id) =>
    id ? chatApi.listMentionsForProfile(id) : Promise.resolve([] as MentionView[]),
  );
  const unreadMentions = () => (mentions() ?? []).filter((mention) => !mention.read);
  const [showMentions, setShowMentions] = createSignal(false);
  // Opening a mention is reading it: jump to the message's channel and retire the alert.
  async function openMention(mention: MentionView) {
    setActiveChannelId(mention.channel_id);
    if (mention.thread_of) setThreadRootId(mention.thread_of);
    setShowMentions(false);
    if (!mention.read) {
      try { await personalApi.markRead(mention.notification_id); } catch (e) { fail(e); }
      refetchMentions();
    }
  }

  // ---- composing ----
  // A pending attachment carries its own lifecycle: one bad file (too large, unreadable,
  // rejected by the backend) must not discard the ones that are fine.
  type PendingAttachment = NewMessageAttachment & { state: "loading" | "uploading" | "completed" | "failed"; error?: string };
  const [draft, setDraft] = createSignal("");
  const [draftAttachments, setDraftAttachments] = createSignal<PendingAttachment[]>([]);

  // ---- draft persistence + typing presence ----
  // Intervals are tunable, not baked in: a slower poll trades freshness for load.
  const DRAFT_SAVE_DELAY_MS = Number(import.meta.env.VITE_CHAT_DRAFT_SAVE_MS ?? 600);
  const TYPING_POLL_MS = Number(import.meta.env.VITE_CHAT_TYPING_POLL_MS ?? 3000);
  // Re-beat well inside the server TTL so a live typist never flickers off.
  const TYPING_BEAT_MS = Number(import.meta.env.VITE_CHAT_TYPING_BEAT_MS ?? 4000);
  let draftSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastBeatAt = 0;
  // Guards the load→save race: restoring a draft into the box must not be echoed back
  // as a save, and a channel switch must not write the old body into the new channel.
  let restoring = false;

  // Restore the persisted body whenever the (channel, profile) pair changes.
  createEffect(() => {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch || !p) return;
    restoring = true;
    setDraft("");
    chatApi
      .getMessageDraft(ch, p)
      .then((stored) => {
        if (activeChannelId() === ch && actingProfileId() === p) setDraft(stored?.text ?? "");
      })
      .catch(fail)
      .finally(() => { restoring = false; });
  });

  function onDraftInput(value: string) {
    setDraft(value);
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch || !p || restoring) return;
    // Debounced: one write per pause, not one per keystroke.
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      chatApi.saveMessageDraft(ch, p, value).catch(fail);
    }, DRAFT_SAVE_DELAY_MS);
    const now = Date.now();
    if (now - lastBeatAt >= TYPING_BEAT_MS) {
      lastBeatAt = now;
      chatApi.setChannelTyping(ch, p, true).catch(fail);
    }
  }

  // Sent or cleared: drop the stored draft and retract the beat at once, so nobody
  // sees "typing…" from someone who already pressed Send.
  function clearDraftState() {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    lastBeatAt = 0;
    if (!ch || !p) return;
    chatApi.deleteMessageDraft(ch, p).catch(fail);
    chatApi.setChannelTyping(ch, p, false).catch(fail);
  }

  // ---- polls ----
  // A poll is the content of the message that carries it, so the list is keyed by
  // message id and the card renders inside that message row.
  const [polls, setPolls] = createSignal<PollView[]>([]);
  const [pollOpen, setPollOpen] = createSignal(false);
  const [pollQuestion, setPollQuestion] = createSignal("");
  const [pollOptions, setPollOptions] = createSignal<string[]>(["", ""]);
  const [pollMultiple, setPollMultiple] = createSignal(false);
  const [pollAnonymous, setPollAnonymous] = createSignal(false);
  const pollFor = (messageId: string) => polls().find((p) => p.message_id === messageId);

  function refreshPolls() {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch) { setPolls([]); return; }
    chatApi
      .listChannelPolls(ch, p)
      .then((rows) => { if (activeChannelId() === ch) setPolls(rows); })
      .catch(fail);
  }
  createEffect(() => { activeChannelId(); actingProfileId(); refreshPolls(); });

  function resetPollForm() {
    setPollOpen(false);
    setPollQuestion("");
    setPollOptions(["", ""]);
    setPollMultiple(false);
    setPollAnonymous(false);
  }
  async function submitPoll() {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch || !p) return;
    const problem = pollDraftError(pollQuestion(), pollOptions());
    if (problem) { setError(problem); return; }
    try {
      await chatApi.createPoll({
        id: newId("poll"),
        channelId: ch,
        authorId: p,
        question: pollQuestion().trim(),
        options: pollOptions().map((o) => o.trim()).filter(Boolean),
        multipleChoice: pollMultiple(),
        anonymous: pollAnonymous(),
      });
      resetPollForm();
      refreshPolls();
      refetchMessages();
    } catch (e) { fail(e); }
  }
  // The click decides the whole ballot (single choice replaces, multiple toggles); the
  // server answers with the new tally, so the card never guesses the count locally.
  async function clickPollOption(poll: PollView, optionId: string) {
    const p = actingProfileId();
    if (!p || !pollIsOpen(poll)) return;
    try {
      const updated = await chatApi.votePoll(poll.id, p, ballotAfterClick(poll, optionId));
      setPolls((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch (e) { fail(e); }
  }
  async function closePoll(poll: PollView) {
    const p = actingProfileId();
    if (!p) return;
    try {
      const updated = await chatApi.closePoll(poll.id, p);
      setPolls((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch (e) { fail(e); }
  }

  // ---- scheduled messages ----
  // The picker speaks local wall clock (that is what a human schedules in); the wire
  // carries UTC epoch seconds only, so the conversion happens exactly here.
  const [scheduleAt, setScheduleAt] = createSignal("");
  const [scheduleOpen, setScheduleOpen] = createSignal(false);
  const [scheduleEditId, setScheduleEditId] = createSignal<string | null>(null);
  // null targets the channel composer; a root id targets that thread's composer.
  const [scheduleThreadOf, setScheduleThreadOf] = createSignal<string | null>(null);
  const [scheduled, setScheduled] = createSignal<ScheduledMessage[]>([]);

  function localToEpochSecs(value: string): number | null {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  function epochToLocalInput(secs: number): string {
    const d = new Date(secs * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const scheduledLabel = (row: ScheduledMessage) =>
    new Date(row.scheduled_at * 1000).toLocaleString(UI_LOCALE);

  function refreshScheduled() {
    const ch = activeChannelId();
    const p = actingProfileId();
    if (!ch || !p) { setScheduled([]); return; }
    chatApi
      .listScheduledMessages(p, ch, "pending")
      .then((rows) => {
        if (activeChannelId() === ch && actingProfileId() === p) setScheduled(rows);
      })
      .catch(fail);
  }
  createEffect(() => { activeChannelId(); actingProfileId(); refreshScheduled(); });

  function resetScheduleForm() {
    setScheduleOpen(false);
    setScheduleEditId(null);
    setScheduleThreadOf(null);
    setScheduleAt("");
  }

  // One button, two meanings: with an edit target it reschedules/rewrites that intent,
  // otherwise it postpones whatever is in the composer.
  async function submitSchedule() {
    const ch = activeChannelId();
    const p = actingProfileId();
    const when = localToEpochSecs(scheduleAt());
    if (!ch || !p || when === null) return;
    const editing = scheduleEditId();
    const threadOf = scheduleThreadOf();
    const text = (threadOf ? threadDraft() : draft()).trim();
    try {
      if (editing) {
        await chatApi.updateScheduledMessage(editing, p, text ? text : null, when);
      } else {
        if (!text) return;
        await chatApi.scheduleMessage({ id: newId("sched"), channelId: ch, authorId: p, text, threadOf, scheduledAt: when });
      }
      if (threadOf) setThreadDraft("");
      else { setDraft(""); clearDraftState(); }
      resetScheduleForm();
      refreshScheduled();
    } catch (e) {
      fail(e);
    }
  }

  function editScheduled(row: ScheduledMessage) {
    setScheduleThreadOf(row.thread_of);
    if (row.thread_of) setThreadDraft(row.text);
    else setDraft(row.text);
    setScheduleAt(epochToLocalInput(row.scheduled_at));
    setScheduleEditId(row.id);
    setScheduleOpen(true);
  }

  async function cancelScheduled(row: ScheduledMessage) {
    const p = actingProfileId();
    if (!p) return;
    try {
      await chatApi.cancelScheduledMessage(row.id, p);
      if (scheduleEditId() === row.id) resetScheduleForm();
      refreshScheduled();
    } catch (e) {
      fail(e);
    }
  }

  const [typingUsers, setTypingUsers] = createSignal<string[]>([]);
  createEffect(() => {
    const ch = activeChannelId();
    const p = actingProfileId();
    setTypingUsers([]);
    if (!ch || !p) return;
    const poll = () =>
      chatApi
        .listChannelTyping(ch, p)
        .then((rows) => {
          if (activeChannelId() === ch && actingProfileId() === p)
            setTypingUsers(rows.map((r) => r.profile_id));
        })
        .catch(() => {});
    void poll();
    const timer = setInterval(poll, TYPING_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });
  const typingLabel = () => {
    const names = typingUsers().map((id) => profileName(id));
    if (!names.length) return "";
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names.length} people are typing…`;
  };
  const [draftMentionIds, setDraftMentionIds] = createSignal<MentionTargetRef[]>([]);
  const [threadAttachments, setThreadAttachments] = createSignal<PendingAttachment[]>([]);
  const [threadMentionIds, setThreadMentionIds] = createSignal<MentionTargetRef[]>([]);
  const [mentionTeams] = createResource(() => platformApi.teams());
  // Only someone who can read the channel is offered: a private channel must not leak
  // its non-members a notification (the backend drops such a mention anyway, so an
  // unrestricted list would just promise a delivery that never happens).
  const mentionable = () => {
    const ids = memberIds();
    const open = activeChannel()?.content_type;
    const everyone = open === "public" || open === "entity-bound";
    return (profiles() ?? []).filter((profile) => !profile.archived && profile.id !== actingProfileId() && (everyone || ids.has(profile.id)));
  };
  const mentionTargets = (): MentionTarget[] => [
    ...mentionable().map((profile) => ({ kind: "profile" as const, id: profile.id, name: profile.display_name, secondary: profile.username })),
    ...(mentionTeams() ?? []).filter((team) => !team.archived).map((team) => ({ kind: "team" as const, id: team.id, name: team.name })),
  ];
  const mentionCandidates = (text: string) => candidatesFor(text, mentionTargets());
  const mentionPayload = (targets: MentionTargetRef[]): MentionPayload[] => targets.map((target) => ({ target_type: target.kind, target_id: target.id }));
  function selectMention(kind: "draft" | "thread" | "edit", target: MentionTarget) {
    const text = kind === "draft" ? draft() : kind === "thread" ? threadDraft() : editText();
    const replace = insertMention(text, target);
    const add = (targets: MentionTargetRef[]) => targets.some((item) => item.id === target.id && item.kind === target.kind) ? targets : [...targets, { kind: target.kind, id: target.id }];
    if (kind === "draft") { setDraft(replace); setDraftMentionIds(add); }
    else if (kind === "thread") { setThreadDraft(replace); setThreadMentionIds(add); }
    else { setEditText(replace); setEditMentionIds(add); }
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
    // Only a readable payload can be uploaded; a chip that never produced one stays in
    // the composer as its own failure instead of becoming an empty backend row.
    const uploadable = uploadableAttachments(attachments);
    if (!uploadable.length) return attachments.length === 0;
    setAttachments((items) => items.map((item) => uploadable.some((u) => u.id === item.id) ? { ...item, state: "uploading", error: undefined } : item));
    const results = await Promise.all(uploadable.map(async (attachment) => {
      try {
        // The row is written before the upload is claimed done, so a reload in the middle
        // still shows the attachment as uploading/failed with its retry, rather than
        // losing it. `completed` is asserted only once the payload is actually stored.
        await chatApi.addMessageAttachment(messageId, { id: attachment.id, file_name: attachment.file_name, mime_type: attachment.mime_type, byte_length: attachment.byte_length, data_url: attachment.data_url, upload_state: "uploading" });
        await chatApi.setMessageAttachmentState(messageId, attachment.id, "completed");
        return { id: attachment.id, error: null as string | null };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // If the row exists, carry the failure into the database so the retry survives a
        // reload; if the insert itself failed there is nothing to mark.
        await chatApi.setMessageAttachmentState(messageId, attachment.id, "failed", message).catch(() => {});
        return { id: attachment.id, error: message };
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
    if (!ch || !p) return;
    // Chips that never produced a payload are not content: an empty text carrying only
    // failed files must not post an empty message.
    if (!canSendDraft(text, attachments)) return;
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
        mention_targets: mentionPayload(draftMentionIds()),
      });
      const ok = await saveAttachments(message.id, attachments, setDraftAttachments);
      setDraftMessageId(ok ? null : message.id);
      setDraft(""); setDraftMentionIds([]);
      clearDraftState();
      refetchMessages();
      refetchChannels();
    } catch (e) {
      fail(e);
    }
  }

  const [threadDraft, setThreadDraft] = createSignal("");
  async function sendThreadReply() {
    const root = threadRoot();
    const thread = threadChannel();
    const p = actingProfileId();
    const text = threadDraft().trim();
    const attachments = threadAttachments();
    if (threadMessageId()) { await retryThreadAttachments(); return; }
    if (!root || !thread || !p) return;
    if (!canSendDraft(text, attachments)) return;
    try {
      const message = await chatApi.createMessage({
        id: newId("msg"),
        channel_id: thread.id,
        author_id: p,
        text,
        created_at: Math.floor(Date.now() / 1000),
        edited_at: null,
        thread_of: null,
        archived: false,
        mention_targets: mentionPayload(threadMentionIds()),
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

  /** Open a file from a message the way the system opens files. A failure is said out
   *  loud — a click that quietly does nothing is what this replaces. */
  async function openAttachment(attachment: { id: string; file_name: string }) {
    try {
      const path = await chatApi.stageAttachment(attachment.id);
      await openPath(path);
    } catch (reason) {
      fail(`Could not open ${attachment.file_name}: ${String(reason)}`);
    }
  }

  async function deleteAttachment(messageId: string, id: string) {
    try {
      await chatApi.removeMessageAttachment(messageId, id);
      refetchMessages();
      refetchThread();
    } catch (e) { fail(e); }
  }

  // ---- edit / delete ----
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editText, setEditText] = createSignal("");
  // An edit carries the mention list it started with, so saving is a diff against the
  // stored one: a name deleted from the text loses its mention, the rest stay put.
  const [editMentionIds, setEditMentionIds] = createSignal<MentionTargetRef[]>([]);
  function startEdit(m: MessageView) {
    setEditingId(m.id);
    setEditText(m.text);
    setEditMentionIds((m.mention_targets ?? (m.mention_ids ?? []).map((id) => ({ target_type: "profile" as const, target_id: id }))).map((target) => ({ kind: target.target_type, id: target.target_id })));
  }
  // A mention only survives while its name is still written in the text; dropping the
  // "@name" is how a user un-mentions someone, and the row must follow the text.
  const survivingMentions = (text: string, targets: MentionTargetRef[]) => survivorsOf(text, targets, mentionTargets());
  async function saveEdit() {
    const id = editingId();
    if (!id) return;
    try {
      await chatApi.updateMessage(id, editText(), mentionPayload(survivingMentions(editText(), editMentionIds())));
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

  async function togglePinned(m: MessageView) {
    try {
      await chatApi.setMessagePinned(m.id, !m.pinned);
      refetchMessages(); refetchPinnedMessages();
      if (threadRootId()) refetchThread();
    } catch (e) { fail(e); }
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
      // The shell's sidebar keeps its own read of the list — tell it to re-read, or a
      // conversation created here exists everywhere except in the list beside it.
      bumpChannels();
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

  function absenceCard(text: string) {
    try { const card = JSON.parse(text) as { profile_id:string; date_from:string; date_to:string; availability:string; action:string }; return card; } catch { return null; }
  }
  function renderMessage(m: MessageView, inThread: boolean) {
    const mine = () => m.author_id === actingProfileId();
    const card = () => m.content_kind === "absence-card" ? absenceCard(m.text) : null;
    return (
      <div class="message-row">
        {/* Avatar circle: markup only, `display:none` by default (Chat.css). It becomes
            visible under `.theme-space-light` — the chat-first shell — so the dark theme
            renders exactly what it rendered before. */}
        <span class="message-avatar" aria-hidden="true">{avatarInitials(profileName(m.author_id))}</span>
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
              <Show when={m.content_kind === "poll" && pollFor(m.id)}>
                {(poll) => (
                  <div class="poll-card">
                    <div class="poll-question">
                      <Icon name="poll" size={15} /> {poll().question}
                      <Show when={poll().multiple_choice}><span class="hint"> · pick several</span></Show>
                      <Show when={poll().anonymous}><span class="hint"> · anonymous</span></Show>
                      <Show when={!pollIsOpen(poll())}><span class="hint"> · closed</span></Show>
                    </div>
                    <For each={poll().options}>{(option) => (
                      <button
                        type="button"
                        class={`poll-option${option.me_voted ? " mine" : ""}`}
                        aria-pressed={option.me_voted}
                        disabled={!pollIsOpen(poll())}
                        onClick={() => clickPollOption(poll(), option.id)}
                      >
                        <span class="poll-bar" style={{ width: `${optionShare(option, poll().voter_count)}%` }} />
                        <span class="poll-option-text">{option.text}</span>
                        <span class="poll-option-count">{option.vote_count}</span>
                      </button>
                    )}</For>
                    <div class="poll-foot">
                      <span class="hint">{poll().voter_count} voted</span>
                      <Show when={pollIsOpen(poll()) && poll().author_id === actingProfileId()}>
                        <button type="button" class="ghost small" onClick={() => closePoll(poll())}>Close poll</button>
                      </Show>
                    </div>
                  </div>
                )}
              </Show>
              <Show when={m.content_kind !== "poll"}>
              <Show when={card()} fallback={<div class={`message-text${(m.mention_ids ?? []).includes(actingProfileId() ?? "") ? " mentions-me" : ""}`}>{m.text}</div>}>
                {(absence) => <div class="absence-chat-card"><strong>Time off {absence().action.replace("absence.", "")}</strong><span>{profileName(absence().profile_id)} · {absence().date_from} → {absence().date_to}</span><small>{absence().availability}</small><a {...linkProps({ view: "Absences" })}>Open time off</a></div>}
              </Show>
              </Show>
              <Show when={(m.links ?? []).length}><div class="message-links"><For each={m.links ?? []}>{(link) => (
                <div class={`link-card status-${link.status}`}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">{link.title ?? link.url}</a>
                  <Show when={link.site_name}><span class="hint"> · {link.site_name}</span></Show>
                  <Show when={link.description}><div class="link-description">{link.description}</div></Show>
                  <Show when={link.status === "pending"}>
                    <button type="button" class="ghost small" onClick={() => unfurlLinks(m.id)}>Show preview</button>
                  </Show>
                  <Show when={link.status !== "pending" && link.status !== "ok"}>
                    <span class="hint">No preview ({link.error ?? link.status})</span>
                  </Show>
                </div>
              )}</For></div></Show>
              <Show when={(m.attachments ?? []).length}><div class="message-attachments"><For each={m.attachments ?? []}>{(attachment) => {
                /* ONE FILE, ONE NAME. The card printed the file name TWICE for anything
                   that is not an image: once inside the paperclip link (the fallback)
                   and again in a second link below it — which reads as two uploads.
                   The name is stated once, beside the paperclip; a picture, a video or
                   a sound shows itself and carries the name under the preview. */
                const kind = () => attachment.mime_type.startsWith("image/") ? "image"
                  : attachment.mime_type.startsWith("video/") ? "video"
                  : attachment.mime_type.startsWith("audio/") ? "audio" : "file";
                return (
                  <div class="attachment-card" classList={{ [`is-${kind()}`]: true }}>
                    <Show when={kind() === "image"}><img src={attachment.data_url} alt={attachment.file_name} /></Show>
                    <Show when={kind() === "video"}><video controls src={attachment.data_url} /></Show>
                    <Show when={kind() === "audio"}><audio controls src={attachment.data_url} /></Show>
                    <div class="attachment-line">
                      {/* THE DESKTOP HAS NO DOWNLOAD MANAGER. `<a download>` on a data
                          URL is a download in a browser and NOTHING in WKWebView, which
                          is why clicking a file in a message did nothing at all. On the
                          desktop the bytes are written to a real path and handed to the
                          system's default application; the web build keeps the anchor. */}
                      <a
                        class="attachment-link"
                        href={attachment.data_url}
                        download={attachment.file_name}
                        onClick={(event) => {
                          if (isWeb()) return;
                          event.preventDefault();
                          void openAttachment(attachment);
                        }}
                      >
                        <Icon name="paperclip" size={14} />
                        <span class="attachment-name">{attachment.file_name}</span>
                      </a>
                      <Show when={attachment.upload_state !== "completed"}>
                        <span class={`attachment-state state-${attachment.upload_state}`}>{attachment.upload_state === "failed" ? `Upload failed: ${attachment.error ?? "unknown reason"}` : "Uploading…"}</span>
                      </Show>
                      {/* Quiet until wanted: removing somebody's file is not an act to
                          offer as loudly as opening it. */}
                      <button class="attachment-remove" title="Remove attachment" aria-label={`Remove ${attachment.file_name}`} onClick={() => deleteAttachment(attachment.message_id, attachment.id)}>×</button>
                    </div>
                  </div>
                );
              }}</For></div></Show>
            </>
          }
        >
          <div class="edit-box">
            <Show when={mentionCandidates(editText()).length}><div class="mention-menu"><For each={mentionCandidates(editText())}>{(profile) => <button type="button" onClick={() => selectMention("edit", profile)}>@{profile.name} <Show when={profile.kind === "team"}><span class="mention-kind">team</span></Show></button>}</For></div></Show>
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

        <Show when={!activeChannel()?.read_only}><div class="reaction-row">
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
        </div></Show>

        <Show when={!activeChannel()?.read_only}><div class="message-actions">
          <Show when={mine()}>
            <button class="ghost small" onClick={() => startEdit(m)}>
              edit
            </button>
            <button class="ghost small" onClick={() => removeMessage(m.id)}>
              delete
            </button>
          </Show>
          <button class="ghost small" onClick={() => togglePinned(m)}>
            {m.pinned ? "unpin" : "pin"}
          </button>
          <Show when={!inThread}>
            <button class="ghost small" onClick={() => setThreadRootId(m.id)}>
              reply in thread
            </button>
          </Show>
          {/* Lowercase like its neighbours: this row is a set of quiet verbs, not a
              row of act-buttons. */}
          <button class="ghost small" onClick={(event) => openWorkMenu(event, m)}>
            make work
          </button>
        </div></Show>

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

      <Show when={showLegacySidebar()}>
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
      </Show>

      <section class="chat-center">
        <header class="chat-topbar">
          <Show when={activeChannel()} fallback={<span class="hint">No channel selected</span>}>
            <strong>{activeChannel()!.name ?? activeChannel()!.content_type}</strong>
            <span class="branch-chip">{activeChannel()!.content_type}</span>
          </Show>
          <div class="members-toggle">
            <button class="ghost small" onClick={() => setShowPinned((v) => !v)}>
              pinned <Show when={pinnedMessages()?.length}><span class="mention-badge">{pinnedMessages()!.length}</span></Show>
            </button>
            <button class="ghost small" onClick={() => setShowMentions((v) => !v)}>
              mentions
              <Show when={unreadMentions().length}>
                <span class="mention-badge">{unreadMentions().length}</span>
              </Show>
            </button>
            <Show when={notificationPreference()}>{pref => <details class="chat-notification-settings"><summary>Notifications</summary><label><input type="checkbox" checked={pref().email_enabled} onChange={e=>void updateNotificationPreference({email_enabled:e.currentTarget.checked})}/> Email</label><label><input type="checkbox" checked={pref().push_enabled} onChange={e=>void updateNotificationPreference({push_enabled:e.currentTarget.checked})}/> Push</label><label>Threads <select value={pref().thread_scope} onChange={e=>void updateNotificationPreference({thread_scope:e.currentTarget.value as ChannelNotificationPreference["thread_scope"]})}><option value="all">All</option><option value="followed">Followed</option><option value="none">None</option></select></label></details>}</Show>
            <Show when={!activeChannel()?.read_only}><button class="ghost small" onClick={() => setShowMembers((v) => !v)}>members ({members()?.length ?? 0})</button></Show>
          </div>
        </header>

        <Show when={showPinned()}>
        <div class="mentions-panel">
          <Show when={(pinnedMessages() ?? []).length} fallback={<p class="hint pad">No pinned messages.</p>}>
            <For each={pinnedMessages()}>{(message) => <button type="button" class="mention-item" onClick={() => setThreadRootId(message.id)}><span class="mention-who">{profileName(message.author_id)}</span><span class="mention-what">📌 {message.text}</span><span class="mention-when">{when(message.created_at)}</span></button>}</For>
          </Show>
        </div>
      </Show>
      <Show when={showMentions()}>
          <div class="mentions-panel">
            <Show when={(mentions() ?? []).length} fallback={<p class="hint pad">Nobody has mentioned you yet.</p>}>
              <For each={mentions()}>{(mention) => (
                <button type="button" class={`mention-item${mention.read ? "" : " unread"}`} onClick={() => openMention(mention)}>
                  <span class="mention-where">{mention.channel_name ?? mention.channel_id}</span>
                  <span class="mention-who">{profileName(mention.author_id)}</span>
                  <Show when={mention.mention_target?.target_type === "team"}><span class="mention-kind">team</span></Show>
                  <span class="mention-what">{mention.text}</span>
                  <span class="mention-when">{when(mention.created_at)}</span>
                </button>
              )}</For>
            </Show>
          </div>
        </Show>

        {/* Without the legacy sidebar the refresh cadence would be unreachable, so it
            rides here as a compact control next to the channel's messages. Polling still
            runs by itself; this only says how often, plus one immediate refresh. */}
        <Show when={!showLegacySidebar()}>
          <div class="chat-pane-tools" aria-label="Message refresh">
            <button class="chat-tool-btn" type="button" title="Refresh now" aria-label="Refresh now" onClick={() => { void refetchMessages(); void refetchChannels(); }}>⟳</button>
            <For each={POLL_OPTIONS}>
              {(opt) => (
                <button class="chat-tool-btn" type="button" classList={{ active: pollMs() === opt.ms }} onClick={() => setPollMs(opt.ms)}>{opt.label}</button>
              )}
            </For>
          </div>
        </Show>

        <div class="message-pane">
          {/* Honest empty state: with no channel selected there is nothing to say hello in. */}
          <Show when={activeChannelId() || showLegacySidebar()} fallback={
            <div class="chat-empty-state" role="status">
              <h2>No conversation selected</h2>
              <p>Choose a channel on the left, or create one with the + next to a project.</p>
            </div>
          }>
          <Show when={!messages.loading} fallback={<p class="hint">Loading messages…</p>}>
            <Show when={shownMessages().length} fallback={<p class="hint pad">No messages yet — say hello.</p>}>
              <Show when={canLoadOlder() || paging().error}>
                <div class="history-pager">
                  <Show when={paging().error}>
                    <span class="hint" role="alert">Could not load older messages: {paging().error}</span>
                  </Show>
                  <button
                    type="button"
                    class="ghost small"
                    disabled={paging().loading}
                    onClick={loadOlder}
                  >
                    {paging().loading ? "Loading…" : paging().error ? "Retry" : "Load older messages"}
                  </button>
                </div>
              </Show>
              <For each={shownMessages()}>{(m) => renderMessage(m, false)}</For>
            </Show>
          </Show>
          </Show>
        </div>

        <Show when={activeChannelId() && !activeChannel()?.read_only} fallback={<Show when={activeChannelId() && activeChannel()?.read_only}><p class="hint pad">This private feed is read-only. Notifications arrive here automatically.</p></Show>}>
          <Show when={typingLabel()}>
            <div class="typing-indicator" aria-live="polite">{typingLabel()}</div>
          </Show>
          <Show when={scheduled().length}>
            <div class="scheduled-panel">
              <span class="hint">Scheduled ({scheduled().length})</span>
              <For each={scheduled()}>{(row) => (
                <div class="scheduled-row">
                  <span class="scheduled-when">{scheduledLabel(row)}</span>
                  <span class="scheduled-text">{row.text}</span>
                  <Show when={row.error}><span class="scheduled-error" title={row.error ?? ""}>⚠</span></Show>
                  <button type="button" onClick={() => editScheduled(row)}>Edit</button>
                  <button type="button" onClick={() => cancelScheduled(row)}>Cancel</button>
                </div>
              )}</For>
            </div>
          </Show>
          <Show when={pollOpen()}>
            <div class="poll-form">
              <input
                type="text"
                aria-label="Poll question"
                placeholder="Ask something…"
                value={pollQuestion()}
                onInput={(e) => setPollQuestion(e.currentTarget.value)}
              />
              <For each={pollOptions()}>{(option, index) => (
                <div class="poll-form-option">
                  <input
                    type="text"
                    aria-label={`Option ${index() + 1}`}
                    placeholder={`Option ${index() + 1}`}
                    value={option}
                    onInput={(e) => { const v = e.currentTarget.value; setPollOptions((os) => os.map((o, i) => (i === index() ? v : o))); }}
                  />
                  <Show when={pollOptions().length > POLL_MIN_OPTIONS}>
                    <button type="button" onClick={() => setPollOptions((os) => os.filter((_, i) => i !== index()))}>×</button>
                  </Show>
                </div>
              )}</For>
              <div class="poll-form-actions">
                <button type="button" onClick={() => setPollOptions((os) => [...os, ""])}>Add option</button>
                <label><input type="checkbox" checked={pollMultiple()} onChange={(e) => setPollMultiple(e.currentTarget.checked)} /> Multiple choice</label>
                <label><input type="checkbox" checked={pollAnonymous()} onChange={(e) => setPollAnonymous(e.currentTarget.checked)} /> Anonymous</label>
                <button type="button" class="primary" onClick={submitPoll} disabled={!!pollDraftError(pollQuestion(), pollOptions())}>Create poll</button>
                <button type="button" onClick={resetPollForm}>Dismiss</button>
              </div>
            </div>
          </Show>
          <Show when={scheduleOpen()}>
            <div class="schedule-form">
              {/* The day is chosen in the product's own month grid; the clock stays
                  a wheel. The stored value is the same `YYYY-MM-DDTHH:mm` as before,
                  and an incomplete pair writes nothing, so Schedule stays disabled. */}
              <DateTimeField
                label="Send at"
                timeLabel="Send at time"
                value={scheduleAt()}
                onChange={setScheduleAt}
              />
              <button type="button" class="primary" onClick={submitSchedule} disabled={!scheduleAt()}>
                {scheduleEditId() ? "Reschedule" : "Schedule"}
              </button>
              <button type="button" onClick={resetScheduleForm}>Dismiss</button>
            </div>
          </Show>
          <div class="composer composer-wrap">
            {/* Real affordances only: this line states what the composer actually does.
                Hidden by default; the light shell shows it as the prototype's hint row. */}
            {/* The hint says what the KEYBOARD does. It used to list "📎 file · 🕒 later
                · 📊 poll" as well — the same three acts that sit as buttons two
                centimetres below, in emoji the operating system draws in its own
                colours. A caption that repeats its own controls is furniture. */}
            <div class="composer-hint" aria-hidden="true">Enter to send · Shift+Enter for a new line</div>
            <textarea
              placeholder="Message…"
              value={draft()}
              onInput={(e) => onDraftInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <label class="attachment-button" title="Attach files" aria-label="Attach files">
              <Icon name="paperclip" size={17} />
              <input type="file" multiple onChange={(e) => { queueAttachments(e.currentTarget.files, setDraftAttachments); e.currentTarget.value = ""; }} />
            </label>
            <button class="primary" onClick={sendMessage} disabled={!draft().trim() && !draftAttachments().length}>Send</button>
            <button type="button" class="schedule-button" title="Send later" aria-label="Send later" onClick={() => { setScheduleThreadOf(null); setScheduleOpen((v) => !v); }}><Icon name="clock" size={17} /></button>
            <button type="button" class="poll-button" title="Create a poll" aria-label="Create a poll" onClick={() => setPollOpen((v) => !v)}><Icon name="poll" size={17} /></button>
            <Show when={mentionCandidates(draft()).length}><div class="mention-menu"><For each={mentionCandidates(draft())}>{(profile) => <button type="button" onClick={() => selectMention("draft", profile)}>@{profile.name} <Show when={profile.kind === "team"}><span class="mention-kind">team</span></Show></button>}</For></div></Show>
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
              Members ({members()?.length ?? 0})
            </div>
            <ul>
              <For each={members()}>
                {(m) => (
                  <li>
                    <span>
                      {profileName(m.profile_id)} {m.administrator ? "★" : ""}
                    </span>
                    <Show when={!inheritsMembers()}>
                      <button class="ghost small" onClick={() => removeMember(m.profile_id)}>
                        ×
                      </button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            {/* INHERITED, and it says so — with the one link that can actually change it. */}
            <Show when={inheritsMembers()} fallback={<>
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
            </>}>
              <p class="hint members-inherited">
                Everyone in {memberProject()?.name ?? "this project"} is in this channel.
                Membership is managed with the project.
              </p>
              <a
                class="row-link members-manage"
                {...linkProps({ view: "Project Settings", projectId: activeChannel()!.project_id! })}
              >
                Manage project members →
              </a>
            </Show>
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
            <Show when={canLoadOlderThread() || threadPaging().error}>
              <div class="history-pager">
                <Show when={threadPaging().error}><span class="hint" role="alert">Could not load older replies: {threadPaging().error}</span></Show>
                <button class="ghost small" onClick={loadOlderThread} disabled={threadPaging().loading}>
                  {threadPaging().loading ? "Loading…" : threadPaging().error ? "Retry" : "Load older replies"}
                </button>
              </div>
            </Show>
            <Show when={!threadPage.loading} fallback={<p class="hint">Loading thread…</p>}>
              <For each={shownThreadReplies()}>{(m) => renderMessage(m, true)}</For>
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
            <label class="attachment-button" title="Attach files" aria-label="Attach files">
              <Icon name="paperclip" size={17} />
              <input type="file" multiple onChange={(e) => { queueAttachments(e.currentTarget.files, setThreadAttachments); e.currentTarget.value = ""; }} />
            </label>
            <button class="primary" onClick={sendThreadReply} disabled={!threadChannel() || (!threadDraft().trim() && !threadAttachments().length)}>Reply</button>
            <button type="button" class="schedule-button" title="Schedule reply" onClick={() => { setScheduleThreadOf(threadRoot()!.id); setScheduleOpen(true); }}>🕒</button>
            <Show when={mentionCandidates(threadDraft()).length}><div class="mention-menu"><For each={mentionCandidates(threadDraft())}>{(profile) => <button type="button" onClick={() => selectMention("thread", profile)}>@{profile.name} <Show when={profile.kind === "team"}><span class="mention-kind">team</span></Show></button>}</For></div></Show>
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

      <Show when={workMenu()}>
        {(menu) => <ContextMenu x={menu().x} y={menu().y} items={menu().items} onClose={() => setWorkMenu(null)} />}
      </Show>
      {/* The drawer is the SECOND step on purpose: the menu decides WHAT is being
          made, the drawer fills it in. Nothing is written until the person submits,
          and the created work carries the message as its source anchor. */}
      <Show when={workDraft()}>
        {(draft) => (
          <WorkItemDrawer
            kind={draft().kind}
            source={{ entity_type: "message", entity_id: draft().messageId, channel_id: activeChannelId() ?? undefined, excerpt: draft().excerpt }}
            projectId={activeChannel()?.project_id ?? undefined}
            prefillTitle={draft().excerpt}
            onClose={() => setWorkDraft(null)}
            onCreated={() => setWorkDraft(null)}
          />
        )}
      </Show>
    </div>
  );
}
