import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { chatApi, type SourceRef } from "../api/chat";
import { planningApi } from "../api/issues";
import { meetingsApi } from "../api/meetings";
import { personalApi } from "../api/personal";
import { humanError, profileId, profiles } from "../session";
import "./WorkItemDrawer.css";

/** The three shapes a message can become. "Pull Request" is in the briefing's field
 * table but has no create path here: linking a PR is a review-side act, not a
 * message-to-work act, so it is deliberately absent rather than a dead button. */
export type WorkItemKind = "task" | "ticket" | "event";
/** The anchor that will be written onto the created work, plus whatever the opener
 * already knows about it. `channel_id`/`excerpt` are an optimistic preview only —
 * `resolve_source_ref` is the truth and overwrites them once it answers. */
export type WorkItemSource = { entity_type: string; entity_id: string; channel_id?: string; excerpt?: string };

const COPY: Record<WorkItemKind, { heading: string; intro: string; submit: string; busy: string }> = {
  task: { heading: "Aufgabe erstellen", intro: "Diese Aufgabe bleibt mit der Nachricht und dem Channel verbunden.", submit: "Aufgabe erstellen", busy: "Wird erstellt…" },
  ticket: { heading: "Ticket erstellen", intro: "Für Bugs, Features oder Verbesserungen im Bereich Entwicklung.", submit: "Ticket erstellen", busy: "Wird erstellt…" },
  event: { heading: "Termin erstellen", intro: "Dieser Termin erscheint im globalen Kalender und im Channel.", submit: "Termin erstellen", busy: "Wird erstellt…" },
};
const PRIORITIES = [["", "Keine"], ["LOW", "Niedrig"], ["MEDIUM", "Mittel"], ["HIGH", "Hoch"], ["URGENT", "Dringend"]] as const;
/** `datetime-local` value for "the next full hour", so Zeit is never empty-but-required. */
const nextHour = () => {
  const when = new Date(Date.now() + 3_600_000);
  when.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
};
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Turns one message into one piece of work, deliberately: nothing is written until
 * the person submits, the title arrives prefilled but editable, and the source anchor
 * rides along on every create so the work can always lead back into the channel. */
export default function WorkItemDrawer(props: {
  kind: WorkItemKind;
  source: WorkItemSource;
  projectId?: string;
  prefillTitle?: string;
  onClose: () => void;
  onCreated?: (kind: WorkItemKind, id: string) => void;
}) {
  const [title, setTitle] = createSignal(props.prefillTitle?.trim() || props.source.excerpt?.trim() || "");
  const [body, setBody] = createSignal("");
  const [ownerId, setOwnerId] = createSignal("");
  const [helperIds, setHelperIds] = createSignal<string[]>([]);
  const [dueDate, setDueDate] = createSignal("");
  const [startsAt, setStartsAt] = createSignal(nextHour());
  const [minutes, setMinutes] = createSignal(60);
  const [priority, setPriority] = createSignal("");
  const [typeTagId, setTypeTagId] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let panel!: HTMLElement;
  let firstField!: HTMLInputElement;

  // The source is READ, never written here: this resolves the anchor the drawer will
  // save so the person sees what will be linked before anything is created.
  const [resolved] = createResource(
    () => [props.source.entity_type, props.source.entity_id] as const,
    ([entity_type, entity_id]) => chatApi.resolveSourceRef(entity_type, entity_id).catch(() => null as SourceRef | null),
  );
  const [memberIds] = createResource(() => props.projectId, id => id ? personalApi.projectMemberIds(id) : Promise.resolve<string[]>([]));
  const [tags] = createResource(() => props.kind === "ticket" ? props.projectId : undefined, id => id ? planningApi.tags(id) : Promise.resolve([]));
  // Assignment is restricted to the project: a channel guest is not silently made
  // responsible for project work.
  const people = createMemo(() => (profiles() ?? []).filter(person => !person.archived && (memberIds() ?? []).includes(person.id)));
  const sourceExcerpt = () => resolved()?.excerpt || props.source.excerpt || "";
  const sourceChannel = () => resolved()?.channel_name || resolved()?.channel_id || props.source.channel_id || "";
  const toggleHelper = (id: string) => setHelperIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  // Zuständig first, Mitwirkende after — order is the responsibility order.
  const everyone = () => [ownerId(), ...helperIds().filter(id => id !== ownerId())].filter(Boolean);

  const close = () => { if (!busy()) props.onClose(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(node => node.offsetParent !== null || node === document.activeElement);
    if (!items.length) return;
    const [first, last] = [items[0], items[items.length - 1]];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !panel.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    firstField?.focus();
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  const anchor = () => ({ source_entity_type: props.source.entity_type, source_entity_id: props.source.entity_id });
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const heading = title().trim();
    if (!heading) { setError("Bitte einen Titel eingeben."); return; }
    setError(""); setBusy(true);
    try {
      if (props.kind === "task") {
        if (!profileId()) throw new Error("Dein Profil wird noch geladen.");
        const todo = await personalApi.createTodo({
          profile_id: profileId(), content: heading, notes: body().trim() || null,
          due_date: dueDate() || null, project_id: props.projectId ?? null, done: false,
          ...anchor(), assignee_ids: everyone(), content_kind: "text",
        });
        props.onCreated?.("task", todo.id);
      } else if (props.kind === "ticket") {
        if (!props.projectId) throw new Error("Ein Ticket braucht ein Projekt.");
        const issue = await planningApi.createIssue({
          project_id: props.projectId, title: heading, description: body().trim() || null,
          status_id: null, assignee_id: ownerId() || null, assignee_ids: everyone(),
          created_by: profileId() || null, due_date: null, priority: priority() || null,
          archived: false, ...anchor(),
        });
        // "Typ" is a planning tag, not a column (see the deviation note on `tags`).
        if (typeTagId()) await planningApi.setTags(issue.id, [typeTagId()]);
        props.onCreated?.("ticket", issue.id);
      } else {
        const starts = Math.floor(new Date(startsAt()).getTime() / 1000);
        if (!Number.isFinite(starts)) throw new Error("Bitte eine gültige Zeit wählen.");
        const id = crypto.randomUUID();
        await meetingsApi.create({
          id, title: heading, description: body().trim() || null,
          starts_at: starts, ends_at: starts + Math.max(1, minutes()) * 60,
          rrule: null, location: null, organizer_id: profileId() || null,
          channel_id: resolved()?.channel_id ?? props.source.channel_id ?? null,
          visibility: "participants", modification_preference: "organizer-only", archived: false,
          video_provider: null, video_room_id: null, join_url: null, video_status: "scheduled",
          video_started_at: null, video_ended_at: null, video_ended_by: null, ...anchor(),
        });
        for (const person of everyone()) await meetingsApi.invite(id, person);
        props.onCreated?.("event", id);
      }
      props.onClose();
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div class="wid-root">
    <div class="wid-backdrop" onClick={close} aria-hidden="true" />
    <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="wid-heading" ref={panel}>
      <header class="wid-head">
        <h2 id="wid-heading">{COPY[props.kind].heading}</h2>
        <p>{COPY[props.kind].intro}</p>
      </header>
      <form class="wid-form" onSubmit={submit}>
        <Show when={props.kind === "ticket"}>
          <label class="wid-field"><span>Typ</span>
            <Show when={(tags() ?? []).length} fallback={<select class="wid-input" disabled><option>Keine Ticket-Typen in diesem Projekt</option></select>}>
              <select class="wid-input" value={typeTagId()} onChange={event => setTypeTagId(event.currentTarget.value)}>
                <option value="">Ohne Typ</option>
                <For each={tags()}>{tag => <option value={tag.id}>{tag.name}</option>}</For>
              </select>
            </Show>
          </label>
        </Show>
        <label class="wid-field"><span>Titel</span>
          {/* Prefilled from the message, always editable: work is created deliberately. */}
          <input class="wid-input" ref={firstField} value={title()} onInput={event => setTitle(event.currentTarget.value)} placeholder="Worum geht es?" />
        </label>
        <Show when={props.kind === "event"} fallback={
          <label class="wid-field"><span>Beschreibung</span>
            <textarea class="wid-input" value={body()} onInput={event => setBody(event.currentTarget.value)} placeholder="Kontext aus der Nachricht" />
          </label>
        }>
          <div class="wid-field wid-when"><span>Zeit</span>
            <div class="wid-when-row">
              <input class="wid-input" type="datetime-local" aria-label="Zeit" value={startsAt()} onInput={event => setStartsAt(event.currentTarget.value)} />
              <select class="wid-input" aria-label="Dauer" value={String(minutes())} onChange={event => setMinutes(Number(event.currentTarget.value))}>
                <For each={[15, 30, 45, 60, 90, 120]}>{value => <option value={String(value)}>{value} Min.</option>}</For>
              </select>
            </div>
          </div>
        </Show>
        <Show when={props.kind !== "event"}>
          <label class="wid-field"><span>Zuständig</span>
            <select class="wid-input" value={ownerId()} onChange={event => setOwnerId(event.currentTarget.value)}>
              <option value="">Niemand</option>
              <For each={people()}>{person => <option value={person.id}>{person.display_name || person.username}</option>}</For>
            </select>
          </label>
        </Show>
        <Show when={props.kind !== "ticket"}>
          <fieldset class="wid-field wid-people"><legend>{props.kind === "event" ? "Teilnehmende" : "Mitwirkende"}</legend>
            <Show when={people().length} fallback={<p class="wid-hint">Dieses Projekt hat noch keine Mitglieder.</p>}>
              <For each={people()}>{person => <label class="wid-person">
                <input type="checkbox" checked={helperIds().includes(person.id)} onChange={() => toggleHelper(person.id)} />
                <span>{person.display_name || person.username}</span>
              </label>}</For>
            </Show>
          </fieldset>
        </Show>
        <Show when={props.kind === "task"}>
          <label class="wid-field"><span>Fällig</span>
            <input class="wid-input" type="date" value={dueDate()} onInput={event => setDueDate(event.currentTarget.value)} />
          </label>
        </Show>
        <Show when={props.kind === "ticket"}>
          <label class="wid-field"><span>Priorität</span>
            <select class="wid-input" value={priority()} onChange={event => setPriority(event.currentTarget.value)}>
              <For each={PRIORITIES}>{([value, label]) => <option value={value}>{label}</option>}</For>
            </select>
          </label>
        </Show>
        <Show when={props.kind === "event"}>
          <label class="wid-field"><span>Vorbereitung</span>
            <textarea class="wid-input" value={body()} onInput={event => setBody(event.currentTarget.value)} placeholder="Was vorher geklärt sein muss" />
          </label>
        </Show>
        {/* Quelle is shown, never edited: the anchor is a fact about where this came
            from, so the person can see exactly what will be linked before submitting. */}
        <section class="wid-field wid-source" aria-label="Quelle">
          <span>Quelle</span>
          <div class="wid-source-card">
            <Show when={!resolved.loading} fallback={<p class="wid-hint">Quelle wird geladen…</p>}>
              <p class="wid-source-line">
                <Show when={sourceChannel()} fallback={<em>Unbekannter Channel</em>}>{name => <strong>#{name()}</strong>}</Show>
                <Show when={resolved()?.author_name}>{name => <span> · {name()}</span>}</Show>
              </p>
              <Show when={sourceExcerpt()} fallback={<p class="wid-hint">Diese Nachricht ist nicht mehr abrufbar — die Verknüpfung bleibt trotzdem erhalten.</p>}>
                <p class="wid-source-excerpt">{sourceExcerpt()}</p>
              </Show>
            </Show>
          </div>
        </section>
        <Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={busy()}>Abbrechen</button>
          <button type="submit" class="wid-btn wid-primary" disabled={busy() || !title().trim()}>{busy() ? COPY[props.kind].busy : COPY[props.kind].submit}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
