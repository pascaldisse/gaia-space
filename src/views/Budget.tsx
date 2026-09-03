import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import SheetEditor from "../components/SheetEditor";
import type { Document, SheetDoc } from "../api/documents";
import {
  BUDGET_COLUMNS,
  budgetApi,
  type BudgetDoc,
  type BudgetStatement,
} from "../api/budget";
import "./Budget.css";

export type BudgetProfile = { id: string; username: string; display_name: string; archived?: boolean };
export type BudgetProps = {
  document: Document;
  budget: BudgetDoc;
  profiles: BudgetProfile[];
  profileId: string | null;
  disabled?: boolean;
  onChange: (budget: BudgetDoc) => void;
  onReload: () => Promise<void>;
  onOpenDocument: (id: string) => void;
};

export const currentDate = () => new Date().toISOString().slice(0, 10);
export const currentMonth = () => currentDate().slice(0, 7);
export const formatCents = (cents: number, currency: string) => {
  const amount = `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toFixed(2)}`;
  return `${amount} ${currency === "EUR" ? "€" : currency}`;
};

export default function Budget(props: BudgetProps): JSX.Element {
  const [amount, setAmount] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [date, setDate] = createSignal(currentDate());
  const [paidBy, setPaidBy] = createSignal(props.profileId ?? props.budget.members[0] ?? "");
  const [splitMode, setSplitMode] = createSignal<"everyone" | "picked">("everyone");
  const [split, setSplit] = createSignal<string[]>([]);
  const [adding, setAdding] = createSignal(false);
  const [addError, setAddError] = createSignal<string | null>(null);
  const [month, setMonth] = createSignal(currentMonth());
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<string | null>(null);
  const [memberToAdd, setMemberToAdd] = createSignal("");
  const [statement] = createResource(month, (value) => budgetApi.statement(props.document.id, value));

  const activeProfiles = () => props.profiles.filter((profile) => !profile.archived);
  const memberName = (id: string) => {
    const profile = props.profiles.find((item) => item.id === id);
    return profile?.display_name || profile?.username || id;
  };
  const statementName = (statementValue: BudgetStatement, id: string) =>
    statementValue.members.find((member) => member.profile_id === id)?.name || memberName(id);
  const setPicked = (member: string, picked: boolean) =>
    setSplit((current) => picked ? [...new Set([...current, member])] : current.filter((id) => id !== member));
  const updateMembers = (members: string[]) => {
    props.onChange({ ...props.budget, members });
    if (!members.includes(paidBy())) setPaidBy(members[0] ?? "");
    setSplit((current) => current.filter((id) => members.includes(id)));
  };
  const addExpense = async () => {
    if (!amount().trim() || !description().trim() || !paidBy()) return;
    setAdding(true); setAddError(null);
    try {
      await budgetApi.addExpense(props.document.id, {
        date: date(), paid_by: paidBy(), amount: amount().trim(), description: description().trim(),
        split: splitMode() === "everyone" ? [] : split(),
      });
      setAmount(""); setDescription(""); setSplit([]); setSplitMode("everyone");
      await props.onReload();
    } catch (reason) {
      setAddError(String(reason));
    } finally {
      setAdding(false);
    }
  };
  const exportStatement = async () => {
    setExporting(true); setExportError(null);
    try {
      props.onOpenDocument(await budgetApi.exportStatement(props.document.id, month()));
    } catch (reason) {
      setExportError(String(reason));
    } finally {
      setExporting(false);
    }
  };

  return <section class="budget-view" aria-label="Budget">
    <section class="budget-quick-add paper-card" aria-label="Quick add expense">
      <h2>Quick add</h2>
      <div class="budget-quick-add-fields">
        <label>Amount<input aria-label="Amount" type="number" min="0.01" step="0.01" value={amount()} onInput={(event) => setAmount(event.currentTarget.value)} /></label>
        <label>Description<input aria-label="Description" value={description()} onInput={(event) => setDescription(event.currentTarget.value)} /></label>
        <label>Date<input aria-label="Date" type="date" value={date()} onInput={(event) => setDate(event.currentTarget.value)} /></label>
        <label>Paid by<select aria-label="Paid by" value={paidBy()} onChange={(event) => setPaidBy(event.currentTarget.value)}><For each={props.budget.members}>{member => <option value={member}>{memberName(member)}</option>}</For></select></label>
      </div>
      <fieldset class="budget-split"><legend>Split</legend>
        <label><input type="radio" name="budget-split" checked={splitMode() === "everyone"} onChange={() => setSplitMode("everyone")} /> Everyone</label>
        <label><input type="radio" name="budget-split" checked={splitMode() === "picked"} onChange={() => setSplitMode("picked")} /> Pick members</label>
        <Show when={splitMode() === "picked"}><div class="budget-member-picks"><For each={props.budget.members}>{member => <label><input aria-label={`Split ${memberName(member)}`} type="checkbox" checked={split().includes(member)} onChange={(event) => setPicked(member, event.currentTarget.checked)} /> {memberName(member)}</label>}</For></div></Show>
      </fieldset>
      <button class="primary" disabled={props.disabled || adding() || !amount().trim() || !description().trim() || !paidBy()} onClick={() => void addExpense()}>{adding() ? "Adding…" : "I paid"}</button>
      <Show when={addError()}>{error => <p class="error" role="alert">{error()}</p>}</Show>
    </section>

    <section class="budget-members paper-card" aria-label="Budget members">
      <h2>Members</h2>
      <ul><For each={props.budget.members}>{member => <li><span>{memberName(member)}</span><button type="button" class="ghost small" disabled={props.disabled || props.budget.members.length <= 1} onClick={() => updateMembers(props.budget.members.filter((id) => id !== member))}>Remove</button></li>}</For></ul>
      <div><select aria-label="Add budget member" value={memberToAdd()} onChange={(event) => setMemberToAdd(event.currentTarget.value)}><option value="">Add member…</option><For each={activeProfiles().filter((profile) => !props.budget.members.includes(profile.id))}>{profile => <option value={profile.id}>{profile.display_name || profile.username}</option>}</For></select><button type="button" class="ghost small" disabled={props.disabled || !memberToAdd()} onClick={() => { updateMembers([...props.budget.members, memberToAdd()]); setMemberToAdd(""); }}>Add</button></div>
      <p class="hint">Member changes save with the document’s Save version button.</p>
    </section>

    <section class="budget-grid" aria-label="Budget grid" data-locked-column-ids={BUDGET_COLUMNS.map((column) => column.id).join(",")}>
      <SheetEditor sheet={props.budget as unknown as SheetDoc} onChange={(sheet) => props.onChange({ ...props.budget, ...(sheet as unknown as Pick<BudgetDoc, "columns" | "rows">) })} disabled={props.disabled} lockedColumnIds={BUDGET_COLUMNS.map((column) => column.id)} />
    </section>

    <section class="budget-statement paper-card" aria-label="Statement">
      <div class="budget-statement-head"><h2>Statement</h2><label>Month<input aria-label="Statement month" type="month" value={month()} onInput={(event) => setMonth(event.currentTarget.value)} /></label></div>
      <Show when={statement.loading}><p class="hint">Loading statement…</p></Show>
      <Show when={statement.error}>{error => <p class="error" role="alert">{String(error())}</p>}</Show>
      <Show when={statement()}>{value => <>
        <p>{value().rows_counted} expenses · {formatCents(value().total_cents, value().currency)}</p>
        <table class="budget-statement-table"><thead><tr><th>Member</th><th>Paid</th><th>Share</th><th>Net</th></tr></thead><tbody><For each={value().members}>{member => <tr><th>{member.name}</th><td>{formatCents(member.paid_cents, value().currency)}</td><td>{formatCents(member.share_cents, value().currency)}</td><td>{formatCents(member.net_cents, value().currency)}</td></tr>}</For></tbody></table>
        <h3>Who owes whom</h3><ul class="budget-transfers"><For each={value().transfers}>{transfer => <li>{statementName(value(), transfer.from)} owes {statementName(value(), transfer.to)} {formatCents(transfer.cents, value().currency)}</li>}</For></ul>
      </>}</Show>
      <button class="primary" disabled={exporting()} onClick={() => void exportStatement()}>{exporting() ? "Exporting…" : "Export to page"}</button>
      <Show when={exportError()}>{error => <p class="error" role="alert">{error()}</p>}</Show>
    </section>
  </section>;
}
