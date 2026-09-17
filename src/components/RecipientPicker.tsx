import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js";
import "./RecipientPicker.css";
import { Avatar } from "./Avatar";
import NewChannelDialog from "./NewChannelDialog";
import { chatApi, newId, type Channel, type ChannelSummary } from "../api/chat";
import { authApi } from "../api/auth";
import { actingProfileId, bumpChannels, isDirectMessage } from "../chatIdentity";
import { humanError, isWeb, projects } from "../session";
import { linkEntity } from "../router";

export type PersonCandidate = { id: string; username: string; display_name: string; archived?: boolean };

const labelOf = (person: PersonCandidate | undefined) => person?.display_name || person?.username || "?";

export async function findExistingDirectChannel(
  channels: ChannelSummary[],
  selfId: string,
  otherId: string,
  listMembers: (channelId: string) => Promise<{ profile_id: string }[]> = chatApi.listChannelMembers,
): Promise<ChannelSummary | undefined> {
  const candidates = channels.filter((channel) => !channel.archived && isDirectMessage(channel));
  for (const channel of candidates) {
    const members = await listMembers(channel.id);
    const ids = new Set(members.map((member) => member.profile_id));
    if (ids.size === 2 && ids.has(selfId) && ids.has(otherId)) return channel;
  }
  return undefined;
}

type Entry =
  | { kind: "person"; id: string; label: string; sub: string; activity: number }
  | { kind: "channel"; id: string; label: string; sub: string; activity: number };

const letterOf = (label: string) => {
  const ch = label.trim()[0]?.toUpperCase() ?? "";
  return /[A-Z]/.test(ch) ? ch : "#";
};

export default function RecipientPicker(props: { onClose: () => void }) {
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [groupMode, setGroupMode] = createSignal(false);
  const [groupSelected, setGroupSelected] = createSignal<string[]>([]);
  const [groupName, setGroupName] = createSignal("");
  const [showComposer, setShowComposer] = createSignal(false);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let searchField!: HTMLInputElement;

  const meId = () => actingProfileId() ?? "";

  const [profiles] = createResource(() => chatApi.listProfiles());
  const [directory] = createResource(() => (isWeb() ? authApi.directory() : Promise.resolve([])));
  const candidates = (): PersonCandidate[] =>
    (isWeb()
      ? (directory() ?? []).map((user) => ({ id: user.profile_id, username: user.username, display_name: user.display_name, archived: false }))
      : (profiles() ?? [])
    ).filter((profile) => !profile.archived && profile.id !== meId());

  const [channels] = createResource(
    () => meId(),
    (id) => (id ? chatApi.listChannelsWithMeta(id) : Promise.resolve<ChannelSummary[]>([])),
  );
  const projectLabel = (projectId: string | null) =>
    (projectId && projects()?.find((project) => project.id === projectId)?.name) || "Channel";

  const rawEntries = createMemo<Entry[]>(() => [
    ...candidates().map((person): Entry => ({ kind: "person", id: person.id, label: labelOf(person), sub: `@${person.username}`, activity: 0 })),
    ...(channels() ?? [])
      .filter((channel) => !channel.archived && !isDirectMessage(channel))
      .map((channel): Entry => ({
        kind: "channel",
        id: channel.id,
        label: channel.name ?? channel.content_type,
        sub: projectLabel(channel.project_id),
        activity: channel.last_message_at ?? 0,
      })),
  ]);

  const term = () => query().trim().toLowerCase();
  const scoped = () => (groupMode() ? rawEntries().filter((entry) => entry.kind === "person") : rawEntries());
  const filtered = createMemo(() =>
    scoped().filter((entry) => !term() || entry.label.toLowerCase().includes(term()) || entry.sub.toLowerCase().includes(term())),
  );

  const recent = createMemo(() =>
    term() ? [] : [...filtered()].filter((entry) => entry.kind === "channel" && entry.activity > 0).sort((a, b) => b.activity - a.activity).slice(0, 5),
  );
  const recentIds = createMemo(() => new Set(recent().map((entry) => `${entry.kind}:${entry.id}`)));
  const rest = createMemo(() =>
    [...filtered()].filter((entry) => !recentIds().has(`${entry.kind}:${entry.id}`)).sort((a, b) => a.label.localeCompare(b.label)),
  );
  /** The flat order keyboard nav and Enter act on — Recent first, then the A–Z list,
   *  exactly the order rendered, so "first result" and "first thing on screen" agree. */
  const flat = createMemo(() => [...recent(), ...rest()]);

  const letterSections = createMemo(() => {
    const sections: { letter: string; entries: Entry[] }[] = [];
    for (const entry of rest()) {
      const letter = letterOf(entry.label);
      const last = sections[sections.length - 1];
      if (last && last.letter === letter) last.entries.push(entry);
      else sections.push({ letter, entries: [entry] });
    }
    return sections;
  });
  const availableLetters = createMemo(() => new Set(letterSections().map((section) => section.letter)));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const close = () => { if (!busy()) props.onClose(); };

  const openChannel = (id: string) => { linkEntity("channel", id); props.onClose(); };

  /** Person picked, normal mode: reuse the exact DM the sidebar's own "+" would make
   *  (`content_type: "dm"`, memberIds `[me, them]`) — open it if it already exists. */
  const openDirect = async (personId: string) => {
    if (busy()) return;
    const self = meId();
    if (!self) { setError("Your profile is still loading."); return; }
    setError(""); setBusy(true);
    try {
      const existing = await findExistingDirectChannel(channels() ?? [], self, personId);
      if (existing) { openChannel(existing.id); return; }
      const other = candidates().find((person) => person.id === personId);
      const channel: Channel = {
        id: newId("chan"),
        content_type: "dm",
        name: `${nameOf(self)} \u00b7 ${labelOf(other)}`,
        description: null,
        project_id: null,
        archived: false,
      };
      const created = await chatApi.createChannel(channel, [self, personId]);
      bumpChannels();
      openChannel(created.id);
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string) => labelOf((profiles() ?? []).find((profile) => profile.id === id));

  const toggleGroupMember = (id: string) =>
    setGroupSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  /** Group picked: the SAME creation call as a 1:1 DM, just more memberIds and a real
   *  name — `isDirectMessage` already reads 3+ members as a channel, not a dm row. */
  const createGroup = async () => {
    const self = meId();
    const members = groupSelected();
    const title = groupName().trim();
    if (!self || !members.length || !title) return;
    setError(""); setBusy(true);
    try {
      const channel: Channel = { id: newId("chan"), content_type: "private", name: title, description: null, project_id: null, archived: false };
      const created = await chatApi.createChannel(channel, [self, ...members]);
      bumpChannels();
      openChannel(created.id);
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  const pick = (entry: Entry) => {
    if (groupMode()) { if (entry.kind === "person") toggleGroupMember(entry.id); return; }
    if (entry.kind === "person") void openDirect(entry.id);
    else openChannel(entry.id);
  };

  onMount(() => { requestAnimationFrame(() => searchField?.focus()); });

  const move = (delta: number) => {
    const total = flat().length;
    if (!total) return;
    setSelectedIndex((current) => (current + delta + total) % total);
  };
  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); if (groupMode()) setGroupMode(false); else close(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); move(-1); return; }
    if (event.key === "Enter") { event.preventDefault(); const target = flat()[selectedIndex()] ?? flat()[0]; if (target) pick(target); }
  };
  const scrollToLetter = (letter: string) =>
    document.getElementById(`rp-letter-${letter}`)?.scrollIntoView({ block: "start" });

  return (
    <Show when={!showComposer()} fallback={
      <NewChannelDialog onClose={() => setShowComposer(false)} onCreated={(id) => { bumpChannels(); openChannel(id); }} />
    }>
      <div class="rp-root">
        <div class="rp-backdrop" onClick={close} aria-hidden="true" />
        <section class="rp-panel" role="dialog" aria-modal="true" aria-label="New message">
          <header class="rp-head">
            <button type="button" class="rp-close" aria-label="Close" onClick={close} disabled={busy()}>✕</button>
            <h2>{groupMode() ? "New group" : "New message"}</h2>
          </header>
          <div class="rp-search">
            <input
              ref={searchField}
              type="search"
              value={query()}
              placeholder={groupMode() ? "Add people…" : "Search people and channels"}
              aria-label={groupMode() ? "Add people" : "Search people and channels"}
              onInput={(event) => { setQuery(event.currentTarget.value); setSelectedIndex(0); }}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <Show when={groupMode()}>
            <div class="rp-group-name">
              <input
                type="text"
                value={groupName()}
                placeholder="Group name"
                aria-label="Group name"
                onInput={(event) => setGroupName(event.currentTarget.value)}
              />
            </div>
          </Show>
          <Show when={error()}><p class="rp-error" role="alert">{error()}</p></Show>
          <Show when={!groupMode()}>
            <div class="rp-actions">
              <button type="button" class="rp-action-row" onClick={() => { setGroupMode(true); setQuery(""); setGroupSelected([]); setGroupName(""); }}>
                <span class="rp-action-icon" aria-hidden="true">➕</span>New group
              </button>
              <button type="button" class="rp-action-row" onClick={() => setShowComposer(true)}>
                <span class="rp-action-icon" aria-hidden="true">#</span>New channel
              </button>
            </div>
          </Show>
          <div class="rp-body">
            <Show when={groupMode()} fallback={
              <div class="rp-list">
                <Show when={recent().length}>
                  <div class="rp-section-label">Recent</div>
                  <For each={recent()}>{(entry) => (
                    <button type="button" class="rp-row" classList={{ active: flat().indexOf(entry) === selectedIndex() }} onClick={() => pick(entry)}>
                      <Avatar name={entry.label} variant={entry.kind === "channel" ? "project" : "person"} />
                      <span class="rp-row-text"><strong>{entry.label}</strong><small>{entry.sub}</small></span>
                    </button>
                  )}</For>
                </Show>
                <For each={letterSections()}>{(section) => (
                  <div>
                    <div class="rp-letter-header" id={`rp-letter-${section.letter}`}>{section.letter}</div>
                    <For each={section.entries}>{(entry) => (
                      <button type="button" class="rp-row" classList={{ active: flat().indexOf(entry) === selectedIndex() }} onClick={() => pick(entry)}>
                        <Avatar name={entry.label} variant={entry.kind === "channel" ? "project" : "person"} />
                        <span class="rp-row-text"><strong>{entry.label}</strong><small>{entry.sub}</small></span>
                      </button>
                    )}</For>
                  </div>
                )}</For>
                <Show when={!flat().length}><p class="rp-empty">No matches.</p></Show>
              </div>
            }>
              <div class="rp-list">
                <For each={filtered()}>{(entry) => (
                  <button type="button" class="rp-row" onClick={() => pick(entry)}>
                    <span class="rp-check" classList={{ checked: groupSelected().includes(entry.id) }} aria-hidden="true" />
                    <Avatar name={entry.label} variant="person" />
                    <span class="rp-row-text"><strong>{entry.label}</strong><small>{entry.sub}</small></span>
                  </button>
                )}</For>
              </div>
            </Show>
          </div>
          <Show when={!groupMode() && !term() && availableLetters().size > 3}>
            <nav class="rp-rail" aria-hidden="true">
              <For each={alphabet}>{(letter) => (
                <button type="button" disabled={!availableLetters().has(letter)} onClick={() => scrollToLetter(letter)}>{letter}</button>
              )}</For>
            </nav>
          </Show>
          <Show when={groupMode()}>
            <footer class="rp-footer">
              <button type="button" class="rp-btn" onClick={() => setGroupMode(false)} disabled={busy()}>Cancel</button>
              <button type="button" class="rp-btn rp-primary" onClick={createGroup} disabled={busy() || !groupSelected().length || !groupName().trim()}>
                {busy() ? "Creating…" : `Create group (${groupSelected().length})`}
              </button>
            </footer>
          </Show>
        </section>
      </div>
    </Show>
  );
}
