import { createSignal, Show } from "solid-js";
import { changePassword, currentUser, humanError, logout } from "../session";
import { Icon } from "./Icon";

/** Web-mode sidebar footer: who's logged in, logout, change-password. Not shown in Tauri. */
export default function AccountFooter() {
  const [open, setOpen] = createSignal(false);
  const [current, setCurrent] = createSignal("");
  const [next, setNext] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [error, setError] = createSignal("");
  const [ok, setOk] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(""); setOk("");
    if (next() !== confirm()) { setError("New password and confirmation don't match."); return; }
    setBusy(true);
    try {
      await changePassword(current(), next());
      setOk("Password changed.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer class="nav-footer">
      <div class="nav-footer-row">
        <span class="nav-footer-user" title={currentUser()?.username}>{currentUser()?.display_name ?? currentUser()?.username}</span>
        <button class="ghost small" title="Change password" aria-label="Change password" onClick={() => setOpen((v) => !v)}><Icon name="key" size={15} /></button>
        <button class="ghost small" title="Log out" aria-label="Log out" onClick={() => void logout()}><Icon name="power" size={15} /></button>
      </div>
      <Show when={open()}>
        <form class="nav-footer-pw" onSubmit={submit}>
          <Show when={error()}><div class="error">{error()}</div></Show>
          <Show when={ok()}><div class="ok">{ok()}</div></Show>
          <input type="password" placeholder="Current password" value={current()} onInput={(e) => setCurrent(e.currentTarget.value)} required />
          <input type="password" placeholder="New password" value={next()} onInput={(e) => setNext(e.currentTarget.value)} required />
          <input type="password" placeholder="Confirm new password" value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} required />
          <button class="primary" type="submit" disabled={busy()}>{busy() ? "Saving…" : "Change password"}</button>
        </form>
      </Show>
    </footer>
  );
}
