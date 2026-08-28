import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { planningApi, type Issue, type Status } from "../api/issues";
import { ProfilePicker } from "./Pickers";
import { humanError } from "../session";
import "./WorkItemDrawer.css";

/**
 * "New issue", as a drawer (GAIA Space redesign, stage 6b).
 *
 * WHY NOT WorkItemDrawer: that drawer turns a MESSAGE into work. It requires a source
 * anchor (`entity_type`/`entity_id`), resolves it over `resolve_source_ref`, shows a
 * "Source" card, and writes the anchor onto the created issue. Creating an issue from
 * the Issues page has no source message, so reusing it would mean inventing an anchor
 * and showing a permanently unresolvable source card. Its copy is German, too, and this
 * surface stays English until the translation lane runs. So: a thin drawer of the same
 * shape, sharing WorkItemDrawer.css, carrying exactly the fields the removed
 * "NEW ISSUE" column carried — title, description, status, assignee, due date.
 */
export default function IssueCreateDrawer(props: {
  projectId: string;
  statuses: Status[];
  onClose: () => void;
  onCreated: (issue: Issue) => void;
}) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [statusId, setStatusId] = createSignal("");
  const [assigneeId, setAssigneeId] = createSignal("");
  const [dueDate, setDueDate] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let firstField!: HTMLInputElement;

  const close = () => { if (!busy()) props.onClose(); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    firstField?.focus();
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const heading = title().trim();
    if (!props.projectId) { setError("Pick a project first."); return; }
    if (!heading) { setError("Enter a ticket title."); return; }
    setError(""); setBusy(true);
    try {
      const issue = await planningApi.createIssue({
        project_id: props.projectId, title: heading, description: description().trim() || null,
        status_id: statusId() || null, assignee_id: assigneeId() || null, created_by: null,
        due_date: dueDate() || null, priority: null, archived: false,
      });
      props.onCreated(issue);
      props.onClose();
    } catch (reason) {
      setError(humanError(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div class="wid-root">
    <div class="wid-backdrop" onClick={close} aria-hidden="true" />
    <aside class="wid-panel" role="dialog" aria-modal="true" aria-labelledby="icd-heading">
      <header class="wid-head">
        <h2 id="icd-heading">New ticket</h2>
        <p>Tracked work: a bug, a feature or an improvement.</p>
      </header>
      <form class="wid-form" onSubmit={submit}>
        <label class="wid-field"><span>Title</span>
          <input class="wid-input" ref={firstField} aria-label="Ticket title" value={title()} placeholder="What needs doing?" onInput={(event) => setTitle(event.currentTarget.value)} />
        </label>
        <label class="wid-field"><span>Description</span>
          <textarea class="wid-input" aria-label="Ticket description" value={description()} placeholder="Context, steps, acceptance" onInput={(event) => setDescription(event.currentTarget.value)} />
        </label>
        <label class="wid-field"><span>Status</span>
          <select class="wid-input" aria-label="Ticket status" value={statusId()} onChange={(event) => setStatusId(event.currentTarget.value)}>
            <option value="">No status</option>
            <For each={props.statuses}>{(status) => <option value={status.id}>{status.name}</option>}</For>
          </select>
        </label>
        <div class="wid-field"><ProfilePicker label="Assignee" value={assigneeId()} onChange={setAssigneeId} allowAll /></div>
        <label class="wid-field"><span>Due date</span>
          <input class="wid-input" type="date" aria-label="Due date" value={dueDate()} onInput={(event) => setDueDate(event.currentTarget.value)} />
        </label>
        <Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={busy()}>Cancel</button>
          <button type="submit" class="wid-btn wid-primary" disabled={busy() || !title().trim()}>{busy() ? "Creating…" : "Create ticket"}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
