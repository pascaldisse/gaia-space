import { createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Checklist, type ChecklistItem, type Issue, type IssueAttachment, type PlanningTag, type Status, type TimeEntry } from "../api/issues";
import { personalApi } from "../api/personal";
import { currentUser, humanError, profileId, profiles, projects, reloadProfiles } from "../session";
import "./IssueDetail.css";

/** An issue IS the card: title, description, assignee, due date, status,
 *  checklists (its to-do list), tags, time and sub-items — one surface,
 *  used by the board and by any other view that opens an issue. */
export default function IssueDetail(props: { issueId: string; statuses?: Status[]; onChanged?: () => void; onClose?: () => void }) {
  const [error, setError] = createSignal("");
  // A sub-item IS an issue: opening one shows this same surface, with a way back.
  const [openId, setOpenId] = createSignal<string>();
  const [trail, setTrail] = createSignal<{ id: string; label: string }[]>([]);
  const currentId = () => openId() ?? props.issueId;
  const [detail, { refetch }] = createResource(currentId, id => id ? planningApi.issue(id) : Promise.resolve(null));
  const [draft, setDraft] = createSignal<Issue>();
  const issue = () => draft() ?? detail()?.issue;
  const [members] = createResource(() => issue()?.project_id, id => id ? personalApi.projectMemberIds(id) : Promise.resolve([]));
  if (!profiles()) void reloadProfiles().catch(() => undefined);
  // The owner (or an admin) may bring somebody onto the project by assigning
  // them; everybody else picks from the people already on it.
  const mayAdmit = () => { const p = projects()?.find(x => x.id === issue()?.project_id); return currentUser()?.role === "admin" || (!!p && p.created_by === profileId()); };
  const candidates = () => (profiles() ?? []).filter(p => !p.archived && !assignees().includes(p.id) && (mayAdmit() || (members() ?? []).includes(p.id)));
  const assignees = () => issue()?.assignee_ids ?? [];
  const setAssignees = async (ids: string[]) => {
    const current = issue(); if (!current) return;
    setDraft({ ...current, assignee_ids: ids, assignee_id: ids[0] ?? null });
    try { await planningApi.setAssignees(current.id, ids); setDraft(undefined); await refetch(); props.onChanged?.(); }
    catch (reason) { setError(humanError(reason)); setDraft(undefined); await refetch(); }
  };
  const openChild = (child: Issue) => { const from = issue(); if (from) setTrail([...trail(), { id: from.id, label: `#${from.number} ${from.title}` }]); setDraft(undefined); setOpenId(child.id); };
  const back = () => { const path = trail(); const previous = path[path.length - 1]; if (!previous) return; setTrail(path.slice(0, -1)); setDraft(undefined); setOpenId(path.length === 1 ? undefined : previous.id); };
  const [checklistTitle, setChecklistTitle] = createSignal("");
  const [tagName, setTagName] = createSignal("");
  const [minutes, setMinutes] = createSignal("");
  const [workDate, setWorkDate] = createSignal(new Date().toISOString().slice(0, 10));
  const [workDescription, setWorkDescription] = createSignal("");
  const [childTitle, setChildTitle] = createSignal("");
const addAttachments = async (files: FileList | null) => {
const id = currentId(); if (!id || !files?.length) return;
try {
for (const file of [...files]) {
if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} exceeds the 10 MiB attachment limit`);
const data_url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`)); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
await planningApi.addAttachment(id, { id: `issue-attachment-${crypto.randomUUID()}`, file_name: file.name, mime_type: file.type || "application/octet-stream", byte_length: file.size, data_url });
}
await refetch(); props.onChanged?.();
} catch (reason) { setError(humanError(reason)); }
};
const removeAttachment = async (attachment: IssueAttachment) => { try { await planningApi.deleteAttachment(attachment.id); await refetch(); props.onChanged?.(); } catch (reason) { setError(humanError(reason)); } };
  const [availableTags, { refetch: reloadTags }] = createResource(() => issue()?.project_id, id => id ? planningApi.tags(id) : Promise.resolve([]));
  const [timeEntries, { refetch: reloadTimeEntries }] = createResource(currentId, id => id ? planningApi.time(id) : Promise.resolve([]));
  // A sub-item is a real issue in the same project, linked PARENT_CHILD — so it
  // can carry its own assignee, date and checklists like any other work.
  const addChild = async () => {
    const parent = issue(); const title = childTitle().trim();
    if (!parent || !title) return;
    try {
      const child = await planningApi.createIssue({ project_id: parent.project_id, title, description: null, status_id: parent.status_id, assignee_id: null, created_by: null, due_date: null, priority: null, archived: false, assignee_ids: [] });
      await planningApi.addChild(parent.id, child.id);
      setChildTitle(""); await refetch(); props.onChanged?.();
    } catch (reason) { setError(humanError(reason)); }
  };

  const nameOf = (id: string | null) => { if (!id) return "Unassigned"; const p = profiles()?.find(x => x.id === id); return p ? (p.display_name || p.username) : id; };
  const patch = (change: Partial<Issue>) => { const current = issue(); if (current) setDraft({ ...current, ...change }); };
  const save = async () => { const current = issue(); if (!current) return; try { await planningApi.updateIssue(current); setDraft(undefined); await refetch(); props.onChanged?.(); } catch (reason) { setError(humanError(reason)); } };
  const addChecklist = async () => { const title = checklistTitle().trim(); const id = currentId(); if (!id || !title) return; try { await planningApi.saveChecklist({ issue_id: id, title }); setChecklistTitle(""); await refetch(); } catch (reason) { setError(humanError(reason)); } };
  const currentTags = () => detail()?.tags ?? [];
  const setTags = async (next: PlanningTag[]) => { const item = issue(); if (!item) return; try { await planningApi.setTags(item.id, next.map(tag => tag.id)); await refetch(); await reloadTags(); props.onChanged?.(); } catch (reason) { setError(humanError(reason)); } };
  const toggleTag = (tag: PlanningTag) => { const exists = currentTags().some(current => current.id === tag.id); void setTags(exists ? currentTags().filter(current => current.id !== tag.id) : [...currentTags(), tag]); };
  const addTag = async () => { const item = issue(); const name = tagName().trim(); if (!item || !name) return; try { const tag = await planningApi.saveTag({ project_id: item.project_id, parent_id: null, name, archived: false }); setTagName(""); await setTags([...currentTags(), tag]); } catch (reason) { setError(humanError(reason)); } };
  const logTime = async () => {
    const duration_minutes = Number(minutes()); const issue_id = currentId(); const profile_id = profileId();
    if (!issue_id || !profile_id) { setError("Select the profile logging this work."); return; }
    if (!Number.isInteger(duration_minutes) || duration_minutes <= 0) { setError("Duration must be a positive whole number of minutes."); return; }
    try {
      await planningApi.saveTime({ issue_id, profile_id, entry_date: workDate(), duration_minutes, description: workDescription().trim() || null });
      setMinutes(""); setWorkDescription(""); await refetch(); await reloadTimeEntries(); props.onChanged?.();
    } catch (reason) { setError(humanError(reason)); }
  };

  return <aside class="issue-detail-panel">
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    <Show when={issue()} fallback={<p class="hint pad">Loading issue…</p>}>{item =>
      <>
        <header class="idp-head">
          <Show when={trail().length}><button class="ghost idp-back" onClick={back}>← {trail()[trail().length - 1].label}</button></Show>
          <span class="idp-number">#{item().number}</span>
          <div class="idp-head-actions">
            <button class="ghost" onClick={async () => { try { await planningApi.archiveIssue(item().id, !item().archived); await refetch(); props.onChanged?.(); } catch (reason) { setError(humanError(reason)); } }}>{item().archived ? "Restore" : "Archive"}</button>
            <Show when={props.onClose}><button class="ghost" aria-label="Close issue" onClick={() => props.onClose?.()}>×</button></Show>
          </div>
        </header>

        <input class="idp-title" value={item().title} onInput={e => patch({ title: e.currentTarget.value })} onBlur={save} />
        <textarea class="idp-description" placeholder="Add a description…" value={item().description ?? ""} onInput={e => patch({ description: e.currentTarget.value || null })} onBlur={save} />

        <div class="idp-fields">
          <label>Status
            <select value={item().status_id ?? ""} onChange={e => { patch({ status_id: e.currentTarget.value || null }); void save(); }}>
              <option value="">No status</option>
              <For each={props.statuses}>{status => <option value={status.id}>{status.name}</option>}</For>
            </select>
          </label>
          <div class="idp-field"><span class="field-label">Assignees</span>
            <select value="" aria-label="Add assignee" onChange={e => { const id = e.currentTarget.value; e.currentTarget.value = ""; if (id) void setAssignees([...assignees(), id]); }}>
              <option value="">{mayAdmit() ? "Add anybody…" : "Add project member…"}</option>
              <For each={candidates()}>{p => <option value={p.id}>{p.display_name || p.username}{(members() ?? []).includes(p.id) ? "" : " — joins the project"}</option>}</For>
            </select>
            <Show when={assignees().length} fallback={<p class="hint">Nobody assigned yet.</p>}>
              <ul class="assignee-chips"><For each={assignees()}>{id =>
                <li class="assignee-chip">{nameOf(id)}<button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => void setAssignees(assignees().filter(x => x !== id))}>×</button></li>
              }</For></ul>
            </Show>
            <Show when={!members.loading && !candidates().length && !mayAdmit()}><p class="hint">Only project members can be assigned — the project owner adds people in Project settings.</p></Show>
          </div>
          <label>Due date
            <input type="date" value={item().due_date ?? ""} onChange={e => { patch({ due_date: e.currentTarget.value || null }); void save(); }} />
          </label>
          <label>Priority
            <select value={item().priority ?? ""} onChange={e => { patch({ priority: e.currentTarget.value || null }); void save(); }}>
              <option value="">None</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
        </div>

        <section class="idp-section">
          <h3>To-do lists</h3>
          <For each={detail()?.checklists}>{list => <ChecklistBlock list={list} />}</For>
          <div class="inline-form">
            <input placeholder="New checklist (e.g. Acceptance)" value={checklistTitle()} onInput={e => setChecklistTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addChecklist(); } }} />
            <button onClick={addChecklist}>Add list</button>
          </div>
        </section>

        <section class="idp-section">
          <h3>Tags</h3>
          <Show when={currentTags().length}><div class="chips"><For each={currentTags()}>{tag => <span class="task-tag project">{tag.name}</span>}</For></div></Show>
          <div class="tag-picker"><For each={availableTags()}>{tag => <button type="button" classList={{ selected: currentTags().some(current => current.id === tag.id) }} onClick={() => toggleTag(tag)}>{tag.name}</button>}</For></div>
          <div class="inline-form"><input aria-label="New tag" placeholder="New tag" value={tagName()} onInput={event => setTagName(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void addTag(); } }} /><button type="button" onClick={addTag}>Add tag</button></div>
        </section>

        <section class="idp-section">
          <h3>Time tracking <small>{detail()?.time_total_minutes ?? 0} min</small></h3>
          <div class="time-form"><input aria-label="Work date" type="date" value={workDate()} onInput={event => setWorkDate(event.currentTarget.value)} /><input aria-label="Duration in minutes" type="number" min="1" step="1" placeholder="Minutes" value={minutes()} onInput={event => setMinutes(event.currentTarget.value)} /><input aria-label="Work description" placeholder="What did you do?" value={workDescription()} onInput={event => setWorkDescription(event.currentTarget.value)} /><button type="button" onClick={logTime}>Log time</button></div>
          <Show when={timeEntries()?.length}><ul class="time-entries"><For each={timeEntries()}>{entry => <TimeEntryRow entry={entry} nameOf={nameOf} />}</For></ul></Show>
        </section>

        <section class="idp-section">
          <h3>Sub-items<small>{detail()?.children?.length ?? 0}</small></h3>
          <For each={detail()?.children}>{child =>
            <div class="checklist-item idp-child-row" classList={{ done: !!props.statuses?.find(s => s.id === child.status_id)?.resolved }}>
              <button type="button" class="idp-child link" onClick={() => openChild(child)}>#{child.number} {child.title}</button>
              <span class="idp-child-people">
                <Show when={child.assignee_ids?.length} fallback={<span class="task-tag">Unassigned</span>}>
                  <For each={child.assignee_ids}>{id => <span class="task-tag assignee">{nameOf(id)}</span>}</For>
                </Show>
                <Show when={child.due_date}>{due => <span class="task-tag due">{due()}</span>}</Show>
              </span>
            </div>
          }</For>
          <div class="inline-form">
            <input placeholder="New sub-item" value={childTitle()} onInput={e => setChildTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addChild(); } }} />
            <button onClick={addChild}>Add</button>
          </div>
        </section>

        <p class="idp-owner">Assigned to {assignees().length ? assignees().map(nameOf).join(", ") : "nobody"}</p>
      </>
    }</Show>
  </aside>;
}

function TimeEntryRow(props: { entry: TimeEntry; nameOf: (id: string | null) => string }) {
  return <li><time>{props.entry.entry_date}</time><strong>{props.entry.duration_minutes} min</strong><span>{props.entry.description || "No description"}</span><small>{props.nameOf(props.entry.profile_id)}</small></li>;
}

/** One checklist with its items — the "an issue can be a to-do list" case. */
function ChecklistBlock(props: { list: Checklist }) {
  const [items, { refetch }] = createResource(() => props.list.id, id => planningApi.items(id));
  const [text, setText] = createSignal("");
  const done = () => items()?.filter((i: ChecklistItem) => i.item_done).length ?? 0;
  const add = async () => { const value = text().trim(); if (!value) return; await planningApi.saveItem({ checklist_id: props.list.id, parent_id: null, item_text: value, item_done: false }); setText(""); refetch(); };
  return <div class="checklist">
    <div class="checklist-head"><strong>{props.list.title}</strong><small>{done()}/{items()?.length ?? 0}</small></div>
    <For each={items()}>{item =>
      <label class="checklist-item" classList={{ done: item.item_done }}>
        <input type="checkbox" checked={item.item_done} onChange={async e => { await planningApi.toggleItem(item.id, e.currentTarget.checked); refetch(); }} />
        <span>{item.item_text}</span>
      </label>
    }</For>
    <div class="inline-form">
      <input placeholder="Add item" value={text()} onInput={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
      <button onClick={add}>+</button>
    </div>
  </div>;
}
