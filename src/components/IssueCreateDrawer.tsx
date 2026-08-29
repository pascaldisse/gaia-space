import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { planningApi, type Issue, type Status } from "../api/issues";
import { PillMenu } from "./controls";
import DateField from "./DateField";
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
/** The wire values the server stores; the labels are what a person reads. `URGENT`
 *  exists in the model and stays offered — dropping it here would make a ticket
 *  created in the drawer unable to say the one thing that matters most. */
const PRIORITIES = [
  { value: "", label: "No priority" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
] as const;

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
  // The column this drawer replaced never offered priority, so every ticket was
  // created without one even though `issues.priority` has always existed and the
  // list already paints a pill for it. The field was there; the door was missing.
  const [priority, setPriority] = createSignal("");
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
        due_date: dueDate() || null, priority: priority() || null, archived: false,
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
        {/* STATUS AND PRIORITY ARE PillMenus, NOT SELECTS (stage 13). These two are
            the controls the product owner clicked: short, closed lists of our own
            words, where the OPEN state was macOS's grey system popup and nothing
            of the redesign survived the click. A `<label>` cannot wrap them — a
            caption labels a form CONTROL, and the control here is a button — so
            the caption sits beside it in a div and names it via `label`. */}
        <div class="wid-field"><span>Status</span>
          <PillMenu label="Ticket status" value={statusId()} onChange={setStatusId}
            options={[{ value: "", label: "No status" }, ...props.statuses.map(status => ({ value: status.id, label: status.name }))]} />
        </div>
        {/* A DRAWER IS A FORM, not a filter row: here a visible caption is correct
            and stays. What was wrong was WHICH caption — the picker printed its own,
            in the picker's voice, next to five fields captioned in the form's voice.
            So the form supplies the caption and the control goes silent. */}
        <div class="wid-field"><span>Assignee</span><ProfilePicker label="Assignee" labelHidden value={assigneeId()} onChange={setAssigneeId} allowAll /></div>
        <div class="wid-field"><span>Priority</span>
          <PillMenu label="Ticket priority" value={priority()} onChange={setPriority} options={[...PRIORITIES]} />
        </div>
        {/* A div, not a label: the date is a button that opens the product's own
            month grid, and a <label> around a button is a wrong statement. */}
        <div class="wid-field"><span>Due date</span>
          <DateField label="Due date" value={dueDate()} onChange={setDueDate} placeholder="No due date" />
        </div>
        <Show when={error()}><p class="wid-error" role="alert">{error()}</p></Show>
        <footer class="wid-actions">
          <button type="button" class="wid-btn" onClick={close} disabled={busy()}>Cancel</button>
          <button type="submit" class="wid-btn wid-primary" disabled={busy() || !title().trim()}>{busy() ? "Creating…" : "Create ticket"}</button>
        </footer>
      </form>
    </aside>
  </div>;
}
