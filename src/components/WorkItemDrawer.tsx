import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { chatApi, type SourceRef } from "../api/chat";
import { meetingsApi } from "../api/meetings";
import { personalApi } from "../api/personal";
import { humanError, isWeb, profileId, profiles } from "../session";
import { newId } from "../api/ids";
import { NO_ORGANIZER } from "../calendar";
import { PillMenu } from "./controls";
import DateField from "./DateField";
import DateTimeField from "./DateTimeField";
import "./WorkItemDrawer.css";

/** The three shapes a message can become. "Pull Request" is in the briefing's field
 * table but has no create path here: linking a PR is a review-side act, not a
 * message-to-work act, so it is deliberately absent rather than a dead button.
 * `"dev"` used to be `"ticket"` (a separate tracker entity, Issue): task unification
 * folded it into a plain task with `category: "dev"`, filed on the project's Dev tab —
 * same create act, same drawer, one fewer entity in the product. */
export type WorkItemKind = "task" | "dev" | "event";
/** The anchor that will be written onto the created work, plus whatever the opener
 * already knows about it. `channel_id`/`excerpt` are an optimistic preview only —
 * `resolve_source_ref` is the truth and overwrites them once it answers. */
export type WorkItemSource = { entity_type: string; entity_id: string; channel_id?: string; excerpt?: string };

const COPY: Record<WorkItemKind, { heading: string; intro: string; submit: string; busy: string }> = {
  task: { heading: "Create task", intro: "This task stays linked to the message and the channel.", submit: "Create task", busy: "Creating…" },
  dev: { heading: "Create dev task", intro: "For bugs, features or improvements — filed on the project's Dev tab.", submit: "Create task", busy: "Creating…" },
  event: { heading: "Create date", intro: "This date appears in the global calendar and in the channel.", submit: "Create date", busy: "Creating…" },
};
/** `datetime-local` value for "the next full hour", so Time is never empty-but-required. */
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
  onCreated?: (kind: WorkItemKind, id: string, projectId?: string) => void;
}) {
  const [title, setTitle] = createSignal(props.prefillTitle?.trim() || props.source.excerpt?.trim() || "");
  const [body, setBody] = createSignal("");
  const [ownerId, setOwnerId] = createSignal("");
  const [helperIds, setHelperIds] = createSignal<string[]>([]);
  const [dueDate, setDueDate] = createSignal("");
  const [startsAt, setStartsAt] = createSignal(nextHour());
  const [minutes, setMinutes] = createSignal(60);
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
  // Assignment is restricted to the project: a channel guest is not silently made
  // responsible for project work.
  const people = createMemo(() => (profiles() ?? []).filter(person => !person.archived && (memberIds() ?? []).includes(person.id)));
  const sourceExcerpt = () => resolved()?.excerpt || props.source.excerpt || "";
  const sourceChannel = () => resolved()?.channel_name || resolved()?.channel_id || props.source.channel_id || "";
  const toggleHelper = (id: string) => setHelperIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  // Owner first, Contributors after — order is the responsibility order.
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
    if (!heading) { setError("Please enter a title."); return; }
    setError(""); setBusy(true);
    try {
      if (props.kind === "task" || props.kind === "dev") {
        if (!profileId()) throw new Error("Your profile is still loading.");
        if (props.kind === "dev" && !props.projectId) throw new Error("A dev task needs a project.");
        const todo = await personalApi.createTodo({
          profile_id: profileId(), content: heading, notes: body().trim() || null,
          due_date: dueDate() || null, project_id: props.projectId ?? null, done: false,
          category: props.kind === "dev" ? "dev" : null,
          ...anchor(), assignee_ids: everyone(), content_kind: "text",
        });
        props.onCreated?.(props.kind, todo.id, props.projectId);
      } else {
        const starts = Math.floor(new Date(startsAt()).getTime() / 1000);
        if (!Number.isFinite(starts)) throw new Error("Please pick a valid time.");
        // HTTP carries the authenticated web session; desktop IPC has no rebinding.
        const organizer = profileId() || null;
        if (!organizer && !isWeb()) throw new Error(NO_ORGANIZER);
        const id = newId();
        await meetingsApi.create({
          id, title: heading, description: body().trim() || null,
          starts_at: starts, ends_at: starts + Math.max(1, minutes()) * 60,
          rrule: null, location: null, organizer_id: organizer,
          channel_id: resolved()?.channel_id ?? props.source.channel_id ?? null,
          visibility: "participants", modification_preference: "organizer-only", archived: false,
          video_provider: null, video_room_id: null, join_url: null, meeting_url: null, video_status: "scheduled",
          video_started_at: null, video_ended_at: null, video_ended_by: null, ...anchor(),
        });
        /* The meeting exists now. An invite that is refused is reported as itself and
           does not undo — or deny — the meeting that was already created. */
        let inviteFailed = false;
        for (const person of everyone()) {
          try { await meetingsApi.invite(id, person); }
          catch (reason) { inviteFailed = true; setError(humanError(reason)); }
        }
        props.onCreated?.("event", id, props.projectId);
        // Keep the error mounted: closing immediately makes a refused invite silent.
        if (inviteFailed) return;
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
        <label class="wid-field"><span>Title</span>
          {/* Prefilled from the message, always editable: work is created deliberately. */}
          <input class="wid-input" ref={firstField} value={title()} onInput={event => setTitle(event.currentTarget.value)} placeholder="What is this about?" />
        </label>
        <Show when={props.kind === "event"} fallback={
          <label class="wid-field"><span>Description</span>
            <textarea class="wid-input" value={body()} onInput={event => setBody(event.currentTarget.value)} placeholder="Context from the message" />
          </label>
        }>
          <div class="wid-field wid-when"><span>Time</span>
            <div class="wid-when-row">
              {/* The day is chosen in the product's grid, the clock stays a wheel. */}
              <DateTimeField label="Time" timeLabel="Time of day" value={startsAt()} onChange={setStartsAt} clearable={false} />
              <PillMenu label="Duration" value={String(minutes())} onChange={value => setMinutes(Number(value))}
                options={[15, 30, 45, 60, 90, 120].map(value => ({ value: String(value), label: `${value} min` }))} />
            </div>
          </div>
        </Show>
        <Show when={props.kind !== "event"}>
          <label class="wid-field"><span>Owner</span>
            <select class="wid-input" value={ownerId()} onChange={event => setOwnerId(event.currentTarget.value)}>
              <option value="">Nobody</option>
              <For each={people()}>{person => <option value={person.id}>{person.display_name || person.username}</option>}</For>
            </select>
          </label>
        </Show>
        <fieldset class="wid-field wid-people"><legend>{props.kind === "event" ? "Participants" : "Contributors"}</legend>
          <Show when={people().length} fallback={<p class="wid-hint">This project has no members yet.</p>}>
            <For each={people()}>{person => <label class="wid-person">
              <input type="checkbox" checked={helperIds().includes(person.id)} onChange={() => toggleHelper(person.id)} />
              <span>{person.display_name || person.username}</span>
            </label>}</For>
          </Show>
        </fieldset>
        <Show when={props.kind === "task" || props.kind === "dev"}>
          {/* A caption plus a BUTTON: a <label> may not wrap a control that opens a
              popover, so the field is a div and the control carries its own name. */}
          <div class="wid-field"><span>Due</span>
            <DateField label="Due" value={dueDate()} onChange={setDueDate} placeholder="No due date" />
          </div>
        </Show>
        <Show when={props.kind === "event"}>
          <label class="wid-field"><span>Preparation</span>
            <textarea class="wid-input" value={body()} onInput={event => setBody(event.currentTarget.value)} placeholder="What has to be settled beforehand" />
          </label>
        </Show>
        {/* Source is shown, never edited: the anchor is a fact about where this came
            from, so the person can see exactly what will be linked before submitting. */}
        <section class="wid-field wid-source" aria-label="Source">
          <span>Source</span>
          <div class="wid-source-card">
            <Show when={!resolved.loading} fallback={<p class="wid-hint">Loading source…</p>}>
              <p class="wid-source-line">
                <Show when={sourceChannel()} fallback={<em>Unknown channel</em>}>{name => <strong>#{name()}</strong>}</Show>
                <Show when={resolved()?.author_name}>{name => <span> · {name()}</span>}</Show>
              </p>
              <Show when={sourceExcerpt()} fallback={<p class="wid-hint">This message is no longer available — the link is kept anyway.</p>}>
                <p class="wid-source-excerpt">{sourceExcerpt()}</p>
              </Show>
            </Show>
          </div>
        </section>
        <Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={busy()}>Cancel</button>
          <button type="submit" class="wid-btn wid-primary" disabled={busy() || !title().trim()}>{busy() ? COPY[props.kind].busy : COPY[props.kind].submit}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
