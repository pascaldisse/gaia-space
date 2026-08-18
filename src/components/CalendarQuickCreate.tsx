import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { meetingsApi, type Meeting } from "../api/meetings";
import { personalApi } from "../api/personal";
import { platformApi } from "../api/platform";
import { profileId, profiles, projects, humanError } from "../session";
import { ProfilePicker } from "./Pickers";
import "./CalendarQuickCreate.css";

export type QuickKind = "meeting" | "task" | "deadline";

// Contextual day quick-create. Opened from a calendar day; every form is
// prefilled to that day so a click → type title → done flow never re-enters the
// date. Local-only: reuses the existing create APIs, no schema change.
export default function CalendarQuickCreate(props: {
  kind: QuickKind;
  dayKey: string;            // YYYY-MM-DD of the picked day
  scope: "global" | "project";
  activeProjectId?: string;  // preselected project in project scope
  onClose: () => void;
  onCreated: (kind: QuickKind) => void;
}) {
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const readableDay = createMemo(() => {
    const [y, m, d] = props.dayKey.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  });

  // ── Meeting form ──────────────────────────────────────────────────────
  const [mTitle, setMTitle] = createSignal("");
  const [mStart, setMStart] = createSignal("09:00");
  const [mEnd, setMEnd] = createSignal("10:00");
  const [mLocation, setMLocation] = createSignal("");
  const [mOrganizer, setMOrganizer] = createSignal(profileId());

  // ── Task form ─────────────────────────────────────────────────────────
  const [tContent, setTContent] = createSignal("");
  const [tProject, setTProject] = createSignal(props.scope === "project" ? (props.activeProjectId ?? "") : "");
  const [tAssignees, setTAssignees] = createSignal<string[]>([]);

  // ── Deadline form ─────────────────────────────────────────────────────
  const [dProject, setDProject] = createSignal(props.activeProjectId ?? "");

  const openProjects = createMemo(() => projects()?.filter((p) => !p.archived) ?? []);
  const activePeople = createMemo(() => profiles()?.filter((p) => !p.archived) ?? []);
  const nameOf = (id: string) => { const p = activePeople().find((x) => x.id === id); return p ? (p.display_name || p.username) : id; };
  const addAssignee = (id: string) => { if (!id || tAssignees().includes(id)) return; setTAssignees([...tAssignees(), id]); };
  const removeAssignee = (id: string) => setTAssignees(tAssignees().filter((x) => x !== id));

  const deadlineTarget = createMemo(() => openProjects().find((p) => p.id === dProject()));

  const title = () => props.kind === "meeting" ? "New meeting" : props.kind === "task" ? "New task" : "Set project deadline";
  const epochFromDayTime = (time: string) => {
    const [y, m, d] = props.dayKey.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    return Math.floor(new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0).getTime() / 1000);
  };

  const canSubmit = createMemo(() => {
    if (busy()) return false;
    if (props.kind === "meeting") return mTitle().trim().length > 0 && mStart() < mEnd();
    if (props.kind === "task") return tContent().trim().length > 0;
    return Boolean(dProject());
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!canSubmit()) return;
    setError(""); setBusy(true);
    try {
      if (props.kind === "meeting") {
        const meeting: Meeting = {
          id: crypto.randomUUID(), title: mTitle().trim(), description: null,
          starts_at: epochFromDayTime(mStart()), ends_at: epochFromDayTime(mEnd()),
          rrule: null, location: mLocation().trim() || null,
          organizer_id: mOrganizer().trim() || null, channel_id: null, archived: false,
        };
        await meetingsApi.create(meeting);
      } else if (props.kind === "task") {
        await personalApi.createTodo({
          profile_id: profileId().trim(), content: tContent().trim(), due_date: props.dayKey,
          done: false, source_entity_type: null, source_entity_id: null,
          project_id: tProject() || null, assignee_ids: tAssignees(),
        });
      } else {
        const project = deadlineTarget();
        if (!project) throw new Error("Pick a project.");
        await platformApi.updateProject({ ...project, deadline: props.dayKey });
      }
      props.onCreated(props.kind);
      props.onClose();
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  // ── a11y: Escape closes, focus trapped to the first field on mount ──────
  let dialogRef: HTMLDivElement | undefined;
  let firstFieldRef: HTMLElement | undefined;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); props.onClose(); } };
  onMount(() => { document.addEventListener("keydown", onKey, true); queueMicrotask(() => firstFieldRef?.focus()); });
  onCleanup(() => document.removeEventListener("keydown", onKey, true));

  return (
    <div class="qc-overlay" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="qc-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="qc-title">
        <header class="qc-head">
          <div>
            <h2 id="qc-title" classList={{ [props.kind]: true }}><span class="qc-dot" aria-hidden="true" /> {title()}</h2>
            <p class="qc-day">{readableDay()}</p>
          </div>
          <button type="button" class="qc-x" aria-label="Close" onClick={props.onClose}>×</button>
        </header>

        <Show when={error()}><p class="qc-error" role="alert">{error()}</p></Show>

        <form class="qc-body" onSubmit={submit}>
          <Show when={props.kind === "meeting"}>
            <label class="qc-field">
              <span class="qc-label">Title</span>
              <input ref={(el) => (firstFieldRef = el)} placeholder="e.g. Weekly product sync" value={mTitle()} onInput={(e) => setMTitle(e.currentTarget.value)} />
            </label>
            <div class="qc-row">
              <label class="qc-field"><span class="qc-label">Start</span><input type="time" value={mStart()} onInput={(e) => setMStart(e.currentTarget.value)} /></label>
              <label class="qc-field"><span class="qc-label">End</span><input type="time" value={mEnd()} onInput={(e) => setMEnd(e.currentTarget.value)} /></label>
            </div>
            <Show when={mStart() >= mEnd()}><p class="qc-hint warn">End time must be after the start time.</p></Show>
            <label class="qc-field"><span class="qc-label">Location <small>optional</small></span><input placeholder="Room name or meeting link (https://…)" value={mLocation()} onInput={(e) => setMLocation(e.currentTarget.value)} /></label>
            <div class="qc-field"><ProfilePicker label="Organizer" value={mOrganizer()} onChange={setMOrganizer} /></div>
          </Show>

          <Show when={props.kind === "task"}>
            <label class="qc-field">
              <span class="qc-label">Task</span>
              <input ref={(el) => (firstFieldRef = el)} placeholder="What needs doing?" value={tContent()} onInput={(e) => setTContent(e.currentTarget.value)} />
            </label>
            <label class="qc-field">
              <span class="qc-label">Project <small>optional</small></span>
              <select value={tProject()} onChange={(e) => setTProject(e.currentTarget.value)}>
                <option value="">No project — personal</option>
                <For each={openProjects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </select>
            </label>
            <label class="qc-field">
              <span class="qc-label">Add assignee</span>
              <select value="" onChange={(e) => { addAssignee(e.currentTarget.value); e.currentTarget.value = ""; }}>
                <option value="">Choose a person…</option>
                <For each={activePeople().filter((p) => !tAssignees().includes(p.id))}>{(p) => <option value={p.id}>{p.display_name || p.username}</option>}</For>
              </select>
            </label>
            <Show when={tAssignees().length}>
              <ul class="qc-chips"><For each={tAssignees()}>{(id) => <li class="qc-chip">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => removeAssignee(id)}>×</button></li>}</For></ul>
            </Show>
            <p class="qc-hint">Due <strong>{props.dayKey}</strong> · owner {nameOf(profileId())}</p>
          </Show>

          <Show when={props.kind === "deadline"}>
            <label class="qc-field">
              <span class="qc-label">Project</span>
              <select ref={(el) => (firstFieldRef = el)} value={dProject()} onChange={(e) => setDProject(e.currentTarget.value)} disabled={openProjects().length === 0}>
                <option value="">Choose a project…</option>
                <For each={openProjects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </select>
            </label>
            <Show when={openProjects().length === 0}><p class="qc-hint warn">No open projects to set a deadline for.</p></Show>
            <Show when={deadlineTarget()?.deadline && deadlineTarget()?.deadline !== props.dayKey}>
              <p class="qc-hint warn">Replaces the current deadline ({deadlineTarget()!.deadline}).</p>
            </Show>
            <p class="qc-hint">Deadline set to <strong>{props.dayKey}</strong>.</p>
          </Show>

          <footer class="qc-actions">
            <button type="button" class="qc-cancel" onClick={props.onClose}>Cancel</button>
            <button type="submit" class="qc-submit primary" disabled={!canSubmit()}>{busy() ? "Saving…" : title()}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
