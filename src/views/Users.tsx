import { createResource, createSignal, For, Show } from "solid-js";
import { usersApi, type CreateUserInput, type Role, type User } from "../api/auth";
import { platformApi } from "../api/platform";
import { humanError } from "../session";
import "./Admin.css";
import "./operatorForm.css";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { GhostPill, PillSelect } from "../components/controls";

/** THE ROLE PICKER WAS OFFERING VALUES THAT DO NOT EXIST. Both selects listed
 *  `member` / `admin`, but `Role` is `GlobalAdmin | GlobalMember | Guest |
 *  LightGuest` and the blank form starts on `GlobalMember`. So the control
 *  never matched its own state: it rested on "member" while the account was a
 *  GlobalMember, and choosing "admin" wrote a role the API does not know.
 *  Converting to PillSelect made this visible, because a PillSelect's value IS
 *  its label — a picker that lies about its value has nothing left to hide
 *  behind. The list is now the real union; `Guest` and `LightGuest` were
 *  unreachable from this screen and now are not. */
const ROLES: Role[] = ["GlobalMember", "GlobalAdmin", "Guest", "LightGuest"];
const roleLabel = (role: Role): string =>
  role === "GlobalAdmin" ? "Administrator"
  : role === "GlobalMember" ? "Member"
  : role === "LightGuest" ? "Light guest"
  : "Guest";

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
      <PageHeader icon="users" title="Users" subline="Login accounts, not profiles" />
      <Show when={error()}><p class="admin-error">{error()}</p></Show>

      <div class="admin-grid">
        <section class="admin-panel">
          <div class="panel-title"><h2>New user</h2></div>
          {/* This form STAYS on the surface: Users is an operator tool and an
             administrator creates accounts in runs (L3 relaxed). L4 is not
             relaxed — the three fields and the two pickers now share one height
             and one radius instead of being boxes with words above them. */}
          <form class="inline-form-col op-form" onSubmit={create}>
            <input class="op-input" aria-label="Username" placeholder="Username" value={form().username} onInput={(e) => setForm({ ...form(), username: e.currentTarget.value })} />
            <input class="op-input" aria-label="Display name" placeholder="Display name" value={form().display_name} onInput={(e) => setForm({ ...form(), display_name: e.currentTarget.value })} />
            <input class="op-input" type="password" aria-label="Password" placeholder="Password" value={form().password} onInput={(e) => setForm({ ...form(), password: e.currentTarget.value })} />
            <PillSelect label="Account role" value={form().role} onChange={(value) => setForm({ ...form(), role: value as Role })}>
              <For each={ROLES}>{(role) => <option value={role}>{roleLabel(role)}</option>}</For>
            </PillSelect>
            <PillSelect label="Linked profile" value={form().profile_id} onChange={(value) => setForm({ ...form(), profile_id: value })}>
              <option value="">No linked profile</option>
              <For each={profiles()?.filter((p) => !p.archived)}>
                {(p) => <option value={p.id}>{p.display_name || p.username}</option>}
              </For>
            </PillSelect>
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
                    <span class="muted">{u.display_name} · {roleLabel(u.role)} · {profileLabel(u.profile_id)}{u.active ? "" : " · inactive"}</span>
                  </div>
                  <div class="row-actions">
                    <GhostPill class="small" onClick={() => startEdit(u)}>Edit</GhostPill>
                    <GhostPill class="small" onClick={() => { setResetTarget(u); setResetPassword(""); }}>Reset password</GhostPill>
                    <GhostPill class="small" onClick={() => toggleActive(u)}>{u.active ? "Deactivate" : "Activate"}</GhostPill>
                    <GhostPill class="small" onClick={() => remove(u)}>Delete</GhostPill>
                  </div>
                </li>
              )}
            </For>
          </ul>
          {/* NOTHING EXISTS YET is the only case — this list has no filter, so it
             can never be filtered to nothing. The form that creates the first
             one is the panel to the left, so the action focuses it rather than
             telling the reader where on the page to look. */}
          <Show when={!users.loading && users()?.length === 0}>
            <EmptyState
              title="No login accounts yet"
              hint="An account is how someone signs in. A profile is who they are — the two are linked, not the same."
              actions={<button class="primary" type="button" onClick={() => document.querySelector<HTMLInputElement>('.admin-view input[aria-label="Username"]')?.focus()}>Create the first account</button>}
            />
          </Show>
        </section>

        <Show when={editing()}>
          {(u) => (
            <section class="admin-panel">
              <div class="panel-title"><h2>Edit {u().username}</h2></div>
              <form class="inline-form-col" onSubmit={saveEdit}>
                <input class="op-input" aria-label="Display name" placeholder="Display name" value={u().display_name} onInput={(e) => setEditing({ ...u(), display_name: e.currentTarget.value })} />
                <PillSelect label="Account role" value={u().role} onChange={(value) => setEditing({ ...u(), role: value as Role })}>
                  <For each={ROLES}>{(role) => <option value={role}>{roleLabel(role)}</option>}</For>
                </PillSelect>
                <label class="matrix-row">
                  <input type="checkbox" checked={u().active} onChange={(e) => setEditing({ ...u(), active: e.currentTarget.checked })} />
                  <span>Active</span>
                </label>
                <button class="primary">Save</button>
                <GhostPill onClick={cancelEdit}>Cancel</GhostPill>
              </form>
            </section>
          )}
        </Show>

        <Show when={resetTarget()}>
          {(u) => (
            <section class="admin-panel">
              <div class="panel-title"><h2>Reset password for {u().username}</h2></div>
              <form class="inline-form-col" onSubmit={submitReset}>
                <input class="op-input" type="password" aria-label="New password" placeholder="New password" value={resetPassword()} onInput={(e) => setResetPassword(e.currentTarget.value)} />
                <button class="primary">Set password</button>
                <GhostPill onClick={() => setResetTarget(null)}>Cancel</GhostPill>
              </form>
            </section>
          )}
        </Show>
      </div>
    </section>
  );
}
