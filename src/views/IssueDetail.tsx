import { createResource, createSignal, For, Show } from "solid-js";
import { planningApi, type Checklist, type ChecklistItem, type Issue, type Status } from "../api/issues";
import { ProfilePicker } from "../components/Pickers";
import { humanError, profiles } from "../session";
import "./IssueDetail.css";

/** An issue IS the card: title, description, assignee, due date, status,
 *  checklists (its to-do list), tags, time and sub-items — one surface,
 *  used by the board and by any other view that opens an issue. */
export default function IssueDetail(props: { issueId: string; statuses?: Status[]; onChanged?: () => void; onClose?: () => void }) {
  const [error, setError] = createSignal("");
  const [detail, { refetch }] = createResource(() => props.issueId, id => id ? planningApi.issue(id) : Promise.resolve(null));
  const [draft, setDraft] = createSignal<Issue>();
  const issue = () => draft() ?? detail()?.issue;
  const [checklistTitle, setChecklistTitle] = createSignal("");
  const [minutes, setMinutes] = createSignal("");

  const nameOf = (id: string | null) => { if (!id) return "Unassigned"; const p = profiles()?.find(x => x.id === id); return p ? (p.display_name || p.username) : id; };
  const patch = (change: Partial<Issue>) => { const current = issue(); if (current) setDraft({ ...current, ...change }); };
  const save = async () => { const current = issue(); if (!current) return; try { await planningApi.updateIssue(current); setDraft(undefined); await refetch(); props.onChanged?.(); } catch (reason) { setError(humanError(reason)); } };
  const addChecklist = async () => { const title = checklistTitle().trim(); if (!title) return; try { await planningApi.saveChecklist({ issue_id: props.issueId, title }); setChecklistTitle(""); await refetch(); } catch (reason) { setError(humanError(reason)); } };
  const logTime = async () => { const value = Number(minutes()); if (!Number.isFinite(value) || value <= 0) return; try { await planningApi.saveTime({ issue_id: props.issueId, profile_id: "", entry_date: new Date().toISOString().slice(0, 10), duration_minutes: value, description: null }); setMinutes(""); await refetch(); } catch (reason) { setError(humanError(reason)); } };

  return <aside class="issue-detail-panel">
    <Show when={error()}><p class="planning-error" role="alert">{error()}</p></Show>
    <Show when={issue()} fallback={<p class="hint pad">Loading issue…</p>}>{item =>
      <>
        <header class="idp-head">
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
          <div class="idp-field"><span class="field-label">Assignee</span>
            <ProfilePicker label="" value={item().assignee_id ?? ""} allowAll onChange={id => { patch({ assignee_id: id || null }); void save(); }} />
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

        <Show when={detail()?.tags?.length}>
          <section class="idp-section"><h3>Tags</h3><div class="chips"><For each={detail()?.tags}>{tag => <span class="task-tag project">{tag.name}</span>}</For></div></section>
        </Show>

        <section class="idp-section">
          <h3>Time <small>{detail()?.time_total_minutes ?? 0} min</small></h3>
          <div class="inline-form"><input type="number" min="1" placeholder="Minutes" value={minutes()} onInput={e => setMinutes(e.currentTarget.value)} /><button onClick={logTime}>Log</button></div>
        </section>

        <Show when={detail()?.children?.length}>
          <section class="idp-section"><h3>Sub-items</h3><For each={detail()?.children}>{child => <p class="idp-child">#{child.number} {child.title}</p>}</For></section>
        </Show>

        <p class="idp-owner">Assigned to {nameOf(item().assignee_id)}</p>
      </>
    }</Show>
  </aside>;
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
