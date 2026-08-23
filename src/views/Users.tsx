import { createResource, createSignal, For, Show } from "solid-js";
import { usersApi, type CreateUserInput, type Role, type User } from "../api/auth";
import { platformApi } from "../api/platform";
import { humanError } from "../session";
import "./Admin.css";
import { WorkspaceHeader } from "../components/WorkspaceHeader";

const blankForm = (): CreateUserInput & { profile_id: string } => ({
  username: "", display_name: "", password: "", role: "GlobalMember", profile_id: "",
});

/** Admin-only, web-mode-only: manage login accounts (separate from profiles). */
export default function Users() {
  const [users, { refetch: reload }] = createResource(() => usersApi.list());
  const [profiles] = createResource(() => platformApi.profiles());
  const [form, setForm] = createSignal(blankForm());
  const [editing, setEditing] = createSignal<User | null>(null);
  const [error, setError] = createSignal("");
  const [resetTarget, setResetTarget] = createSignal<User | null>(null);
  const [resetPassword, setResetPassword] = createSignal("");

  const profileLabel = (id: string) => {
    const p = profiles()?.find((x) => x.id === id);
    return p ? `${p.display_name || p.username} (${p.id})` : id;
  };

  const create = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    try {
      const f = form();
      if (!f.username.trim() || !f.display_name.trim() || !f.password) {
        throw new Error("Username, display name, and password are required.");
      }
      await usersApi.create({
        username: f.username.trim(),
        display_name: f.display_name.trim(),
        password: f.password,
        role: f.role,
        profile_id: f.profile_id || null,
      });
      setForm(blankForm());
      reload();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const startEdit = (u: User) => setEditing(u);
  const cancelEdit = () => setEditing(null);
  const saveEdit = async (e: SubmitEvent) => {
    e.preventDefault();
    const u = editing();
    if (!u) return;
    setError("");
    try {
      await usersApi.update(u.id, { display_name: u.display_name, role: u.role, active: u.active });
      setEditing(null);
      reload();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const toggleActive = async (u: User) => {
    setError("");
    try {
      await usersApi.update(u.id, { active: !u.active });
      reload();
    } catch (e) {
      setError(humanError(e));
    }
  };

  const submitReset = async (e: SubmitEvent) => {
    e.preventDefault();
    const u = resetTarget();
    if (!u) return;
    setError("");
    try {
      if (!resetPassword()) throw new Error("Enter a new password.");
      await usersApi.update(u.id, { password: resetPassword() });
      setResetTarget(null);
      setResetPassword("");
    } catch (e) {
      setError(humanError(e));
    }
  };

  const remove = async (u: User) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    setError("");
    try {
      await usersApi.remove(u.id);
      reload();
    } catch (e) {
      setError(humanError(e));
    }
  };

  return (
    <section class="admin-view">
      <WorkspaceHeader icon="users" title="Users">Login accounts for the web app. Separate from profiles (who someone is) — a user account is how they sign in.</WorkspaceHeader>
      <Show when={error()}><p class="admin-error">{error()}</p></Show>

      <div class="admin-grid">
        <section class="admin-panel">
          <div class="panel-title"><h2>New user</h2></div>
          <form class="inline-form-col" onSubmit={create}>
            <input placeholder="Username" value={form().username} onInput={(e) => setForm({ ...form(), username: e.currentTarget.value })} />
            <input placeholder="Display name" value={form().display_name} onInput={(e) => setForm({ ...form(), display_name: e.currentTarget.value })} />
            <input type="password" placeholder="Password" value={form().password} onInput={(e) => setForm({ ...form(), password: e.currentTarget.value })} />
            <select value={form().role} onChange={(e) => setForm({ ...form(), role: e.currentTarget.value as Role })}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <select value={form().profile_id} onChange={(e) => setForm({ ...form(), profile_id: e.currentTarget.value })}>
              <option value="">No linked profile</option>
              <For each={profiles()?.filter((p) => !p.archived)}>
                {(p) => <option value={p.id}>{p.display_name || p.username} ({p.id})</option>}
              </For>
            </select>
            <button class="primary">Create user</button>
          </form>
        </section>

        <section class="admin-panel">
          <div class="panel-title"><h2>Accounts</h2></div>
          <ul class="entity-list">
            <For each={users()}>
              {(u) => (
                <li classList={{ archived: !u.active }}>
                  <div>
                    <strong>{u.username}</strong>
                    <span class="muted">{u.display_name} · {u.role} · {profileLabel(u.profile_id)}{u.active ? "" : " · inactive"}</span>
                  </div>
                  <div class="row-actions">
                    <button class="ghost small" onClick={() => startEdit(u)}>Edit</button>
                    <button class="ghost small" onClick={() => { setResetTarget(u); setResetPassword(""); }}>Reset password</button>
                    <button class="ghost small" onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Activate"}</button>
                    <button class="ghost small" onClick={() => remove(u)}>Delete</button>
                  </div>
                </li>
              )}
            </For>
          </ul>
          <Show when={users()?.length === 0}><p class="empty-state">No user accounts yet.</p></Show>
        </section>

        <Show when={editing()}>
          {(u) => (
            <section class="admin-panel">
              <div class="panel-title"><h2>Edit {u().username}</h2></div>
              <form class="inline-form-col" onSubmit={saveEdit}>
                <input placeholder="Display name" value={u().display_name} onInput={(e) => setEditing({ ...u(), display_name: e.currentTarget.value })} />
                <select value={u().role} onChange={(e) => setEditing({ ...u(), role: e.currentTarget.value as Role })}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
                <label class="matrix-row">
                  <input type="checkbox" checked={u().active} onChange={(e) => setEditing({ ...u(), active: e.currentTarget.checked })} />
                  <span>Active</span>
                </label>
                <button class="primary">Save</button>
                <button type="button" onClick={cancelEdit}>Cancel</button>
              </form>
            </section>
          )}
        </Show>

        <Show when={resetTarget()}>
          {(u) => (
            <section class="admin-panel">
              <div class="panel-title"><h2>Reset password for {u().username}</h2></div>
              <form class="inline-form-col" onSubmit={submitReset}>
                <input type="password" placeholder="New password" value={resetPassword()} onInput={(e) => setResetPassword(e.currentTarget.value)} />
                <button class="primary">Set password</button>
                <button type="button" onClick={() => setResetTarget(null)}>Cancel</button>
              </form>
            </section>
          )}
        </Show>
      </div>
    </section>
  );
}
