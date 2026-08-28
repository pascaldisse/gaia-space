import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { chatApi, newId, type Channel, type ChannelContentType } from "../api/chat";
import { authApi } from "../api/auth";
import { actingProfileId } from "../chatIdentity";
import { humanError, isWeb } from "../session";
import { PillMenu } from "./controls";
import "./WorkItemDrawer.css";

/**
 * "New conversation", moved out of Chat's legacy sidebar (stage 6b).
 *
 * The chat-first shell already draws the channel list, so Chat's own sidebar no longer
 * renders — but creating a conversation must not vanish with it. This is the same act
 * as before (`create_channel` with the acting profile as first member, a DM naming both
 * people), rendered as the shell's `+` drawer instead of a permanent form column.
 * It borrows the work-item drawer's stylesheet so both drawers speak one language.
 */
export default function NewChannelDialog(props: {
  /** Pre-binds the new channel to the project whose `+` was pressed. */
  projectId?: string;
  projectLabel?: string;
  onClose: () => void;
  onCreated?: (channelId: string) => void;
}) {
  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<ChannelContentType>("public");
  const [recipientId, setRecipientId] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let firstField!: HTMLInputElement;

  const [profiles] = createResource(() => chatApi.listProfiles());
  const [directory] = createResource(() => (isWeb() ? authApi.directory() : Promise.resolve([])));
  const candidates = () =>
    (isWeb()
      ? (directory() ?? []).map((user) => ({ id: user.profile_id, username: user.username, display_name: user.display_name, archived: false }))
      : (profiles() ?? [])
    ).filter((profile) => !profile.archived && profile.id !== actingProfileId());
  const nameOf = (id: string | null) =>
    (profiles() ?? []).find((profile) => profile.id === id)?.display_name ?? "?";

  const close = () => { if (!busy()) props.onClose(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    firstField?.focus();
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const profile = actingProfileId();
    const direct = kind() === "dm";
    const title = direct ? `${nameOf(profile)} · ${nameOf(recipientId())}` : name().trim();
    if (!profile) { setError("Your profile is still loading."); return; }
    if (!title || (direct && !recipientId())) { setError(direct ? "Choose someone to message." : "Enter a channel name."); return; }
    setError(""); setBusy(true);
    const channel: Channel = {
      id: newId("chan"),
      content_type: kind(),
      name: title,
      description: null,
      project_id: props.projectId ?? null,
      archived: false,
    };
    try {
      await chatApi.createChannel(channel, direct ? [profile, recipientId()] : [profile]);
      props.onCreated?.(channel.id);
      props.onClose();
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div class="wid-root">
    <div class="wid-backdrop" onClick={close} aria-hidden="true" />
    <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="ncd-heading">
      <header class="wid-head">
        <h2 id="ncd-heading">New conversation</h2>
        <p>{props.projectLabel ? `A channel in ${props.projectLabel}.` : "A channel or a direct message."}</p>
      </header>
      <form class="wid-form" onSubmit={submit}>
        {/* Four fixed kinds — the shortest possible list, and every word ours. */}
        <div class="wid-field"><span>Type</span>
          <PillMenu label="Conversation type" value={kind()} onChange={(value) => setKind(value as ChannelContentType)}
            options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
              { value: "dm", label: "Direct message" },
              { value: "entity-bound", label: "Entity-bound" },
            ]} />
        </div>
        <Show when={kind() !== "dm"} fallback={
          <label class="wid-field"><span>To</span>
            <select class="wid-input" aria-label="Direct message recipient" value={recipientId()} disabled={!candidates().length} onChange={(event) => setRecipientId(event.currentTarget.value)}>
              <option value="">{candidates().length ? "Choose user…" : "No other active users"}</option>
              <For each={candidates()}>{(person) => <option value={person.id}>{person.display_name} (@{person.username})</option>}</For>
            </select>
          </label>
        }>
          <label class="wid-field"><span>Channel name</span>
            <input class="wid-input" ref={firstField} value={name()} placeholder="e.g. product" onInput={(event) => setName(event.currentTarget.value)} />
          </label>
        </Show>
        <Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={busy()}>Cancel</button>
          <button type="submit" class="wid-btn wid-primary" disabled={busy()}>{busy() ? "Creating…" : kind() === "dm" ? "Start chat" : "Create"}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
