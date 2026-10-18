import { createSignal, For, Show } from "solid-js";
import { api, type Commit, type RebaseAction, type RebaseOutcome, type RebaseRow, type ResetMode } from "../api";
import { GhostPill, PillSelect } from "../components/controls";
import "./HistoryOps.css";

/* History ops, Fork-style: cherry-pick / revert / reset on the selected commit, and an
 * interactive-rebase todo editor (`rebase_plan` -> edit actions -> `rebase_apply`).
 * Every default lives in this block, nothing is inlined at call sites. */
export const REBASE_ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];
export const RESET_MODES: ResetMode[] = ["soft", "mixed", "hard"];
export const RESET_DEFAULT: ResetMode = "mixed";

export default function HistoryOps(props: {
  path: string;
  commit: Commit;
  /** called after any op changed the repository so the page refetches */
  onChanged: () => void;
}) {
  const [mode, setMode] = createSignal<ResetMode>(RESET_DEFAULT);
  const [note, setNote] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [rebaseOpen, setRebaseOpen] = createSignal(false);
  const [plan, setPlan] = createSignal<RebaseRow[]>([]);
  const [outcome, setOutcome] = createSignal<RebaseOutcome | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      setNote(r ? `${label}: ${String(r).slice(0, 8)}` : label);
      props.onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openRebase() {
    setError(null);
    setOutcome(null);
    try {
      setPlan(await api.repoRebasePlan(props.path, props.commit.id));
      setRebaseOpen(true);
    } catch (e) {
      setError(String(e));
    }
  }
  function setRow(i: number, patch: Partial<RebaseRow>) {
    setPlan((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  async function applyRebase() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.repoRebaseApply(props.path, props.commit.id, plan());
      setOutcome(out);
      if (out.status === "done") {
        setRebaseOpen(false);
        setNote(out.message);
      }
      props.onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function abortRebase() {
    await run("rebase aborted", async () => {
      await api.repoRebaseAbort(props.path);
      setOutcome(null);
      setRebaseOpen(false);
    });
  }

  return (
    <section class="history-ops" data-testid="history-ops" aria-label="History ops">
      <h4>History ops</h4>
      <div class="history-ops-bar">
        <GhostPill disabled={busy()} onClick={() => run("cherry-picked", () => api.repoCherryPick(props.path, props.commit.id))}>Cherry-pick</GhostPill>
        <GhostPill disabled={busy()} onClick={() => run("reverted", () => api.repoRevert(props.path, props.commit.id))}>Revert</GhostPill>
        <span class="history-ops-reset">
          <PillSelect label="Reset mode" value={mode()} onChange={(v: string) => setMode(v as ResetMode)}>
            <For each={RESET_MODES}>{(m) => <option value={m}>{m}</option>}</For>
          </PillSelect>
          <GhostPill disabled={busy()} onClick={() => run(`reset --${mode()}`, () => api.repoReset(props.path, props.commit.id, mode()))}>Reset here</GhostPill>
        </span>
        <GhostPill disabled={busy()} onClick={openRebase}>Rebase onto this…</GhostPill>
      </div>
      <Show when={error()}><p class="history-ops-error" role="alert">{error()}</p></Show>
      <Show when={note()}><p class="hint">{note()}</p></Show>

      <Show when={rebaseOpen()}>
        <div class="rebase-editor" data-testid="rebase-editor">
          <div class="rebase-head">Interactive rebase onto <code>{props.commit.short_id}</code> — {plan().length} commits</div>
          <table class="rebase-plan">
            <thead><tr><th>Action</th><th>Commit</th><th>Message</th></tr></thead>
            <tbody>
              <For each={plan()} fallback={<tr><td colspan="3" class="hint">Nothing after this commit.</td></tr>}>
                {(row, i) => (
                  <tr classList={{ dropped: row.action === "drop" }} data-action={row.action}>
                    <td>
                      <select aria-label={`Action for ${row.id.slice(0, 8)}`} value={row.action} onChange={(e) => setRow(i(), { action: e.currentTarget.value as RebaseAction })}>
                        <For each={REBASE_ACTIONS}>{(a) => <option value={a} selected={a === row.action}>{a}</option>}</For>
                      </select>
                    </td>
                    <td class="mono">{row.id.slice(0, 8)}</td>
                    <td>
                      <Show when={row.action === "reword"} fallback={<span class="rebase-summary">{row.summary}</span>}>
                        <input type="text" aria-label="New message" value={row.message ?? row.summary} onInput={(e) => setRow(i(), { message: e.currentTarget.value })} />
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <div class="rebase-actions">
            <button type="button" class="primary" disabled={busy() || !plan().length} onClick={applyRebase}>Start rebase</button>
            <button type="button" onClick={() => setRebaseOpen(false)}>Cancel</button>
          </div>
        </div>
      </Show>
      <Show when={outcome()?.status === "conflict"}>
        <div class="rebase-conflict" role="alert" data-testid="rebase-conflict">
          <strong>Rebase stopped.</strong> {outcome()!.message}
          <code class="abort-cmd">{outcome()!.abort_command}</code>
          <button type="button" onClick={abortRebase}>Abort rebase</button>
        </div>
      </Show>
    </section>
  );
}
