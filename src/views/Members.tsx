import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import { platformApi, type Profile, type Team, type TeamMembership, type Role } from "../api/platform";
import { Icon } from "../components/Icon";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import "./Members.css";

const blankProfile = () => ({ id: "", username: "", display_name: "", email: "" });
const blankTeam = () => ({ name: "", description: "" });

export default function Members() {
  const [profiles, { refetch: reloadProfiles }] = createResource(() => platformApi.profiles());
  const [teams, { refetch: reloadTeams }] = createResource(() => platformApi.teams());
  const [roles] = createResource(() => platformApi.roles());
  const [profileForm, setProfileForm] = createSignal(blankProfile());
  const [editingProfile, setEditingProfile] = createSignal<Profile | null>(null);
  const [teamForm, setTeamForm] = createSignal(blankTeam());
  const [selectedTeam, setSelectedTeam] = createSignal<Team | null>(null);
  const [memberProfileId, setMemberProfileId] = createSignal("");
  const [memberRoleId, setMemberRoleId] = createSignal("");
  const [error, setError] = createSignal("");
  const [showArchived, setShowArchived] = createSignal(false);

  const [memberships, { refetch: reloadMemberships }] = createResource(
    () => selectedTeam()?.id,
    (teamId) => (teamId ? platformApi.memberships(teamId) : Promise.resolve([] as TeamMembership[])),
  );

  const visibleProfiles = createMemo(() => (profiles() ?? []).filter((p) => showArchived() || !p.archived));
  const visibleTeams = createMemo(() => (teams() ?? []).filter((t) => showArchived() || !t.archived));
  const activeProfileCount = () => (profiles() ?? []).filter((p) => !p.archived).length;
  const activeTeamCount = () => (teams() ?? []).filter((t) => !t.archived).length;
  const hasArchived = () => [...(profiles() ?? []), ...(teams() ?? [])].some((item) => item.archived);

  const saveProfile = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const f = profileForm();
      if (!f.username.trim() || !f.display_name.trim()) throw new Error("Username and display name are required.");
      const existing = editingProfile();
      if (existing) {
        await platformApi.updateProfile({ ...existing, username: f.username.trim(), display_name: f.display_name.trim(), email: f.email || null });
      } else {
        await platformApi.createProfile({ id: `profile-${Date.now().toString(16)}`, username: f.username.trim(), display_name: f.display_name.trim(), email: f.email || null, archived: false });
      }
      setProfileForm(blankProfile());
      setEditingProfile(null);
      setError("");
      reloadProfiles();
    } catch (e) { setError(String(e)); }
  };
  const editProfile = (p: Profile) => { setEditingProfile(p); setProfileForm({ id: p.id, username: p.username, display_name: p.display_name, email: p.email ?? "" }); };
  const cancelEdit = () => { setEditingProfile(null); setProfileForm(blankProfile()); };
  const toggleArchiveProfile = async (p: Profile) => { try { await platformApi.updateProfile({ ...p, archived: !p.archived }); reloadProfiles(); } catch (e) { setError(String(e)); } };

  const saveTeam = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const f = teamForm();
      if (!f.name.trim()) throw new Error("Team name is required.");
      const team = await platformApi.createTeam({ name: f.name.trim(), description: f.description || null, parent_id: null });
      setTeamForm(blankTeam());
      setError("");
      reloadTeams();
      setSelectedTeam(team);
    } catch (e) { setError(String(e)); }
  };
  const toggleArchiveTeam = async (t: Team) => { try { await platformApi.archiveTeam(t.id, !t.archived); reloadTeams(); } catch (e) { setError(String(e)); } };

  const addMember = async () => {
    const team = selectedTeam();
    if (!team || !memberProfileId()) return;
    try {
      await platformApi.addMembership({ profile_id: memberProfileId(), team_id: team.id, role_id: memberRoleId() || null });
      setMemberProfileId(""); setMemberRoleId("");
      reloadMemberships();
    } catch (e) { setError(String(e)); }
  };
  const removeMember = async (m: TeamMembership) => { try { await platformApi.removeMembership(m.id); reloadMemberships(); } catch (e) { setError(String(e)); } };
  const profileName = (id: string) => profiles()?.find((p) => p.id === id)?.display_name ?? id;
  const roleName = (id: string | null) => (id ? roles()?.find((r: Role) => r.id === id)?.name ?? id : "No role");
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "·";

  return (
    <section class="org-view">
      <WorkspaceHeader icon="org" title="Organization" actions={
        <Show when={hasArchived()}>
          <label class="org-archived-toggle">
            <input type="checkbox" checked={showArchived()} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
            Show archived
          </label>
        </Show>
      }>
        Your people and structure in one place — manage <strong>profiles</strong>, shape the
        <strong> team org-chart</strong>, and assign per-team roles.
      </WorkspaceHeader>

      <Show when={error()}><p class="org-error" onClick={() => setError("")}>{error()}</p></Show>

      <div class="org-layout">
        {/* ── People ── */}
        <section class="org-panel">
          <div class="panel-title">
            <h2>People</h2>
            <Show when={profiles()}><span class="count-chip">{activeProfileCount()}</span></Show>
          </div>

          <form class="org-form" onSubmit={saveProfile}>
            <input placeholder="Display name" value={profileForm().display_name} onInput={(e) => setProfileForm({ ...profileForm(), display_name: e.currentTarget.value })} />
            <input placeholder="Username" value={profileForm().username} onInput={(e) => setProfileForm({ ...profileForm(), username: e.currentTarget.value })} />
            <input placeholder="Email (optional)" value={profileForm().email} onInput={(e) => setProfileForm({ ...profileForm(), email: e.currentTarget.value })} />
            <div class="row-buttons">
              <button class="primary">{editingProfile() ? "Save changes" : "Add person"}</button>
              <Show when={editingProfile()}><button type="button" class="ghost" onClick={cancelEdit}>Cancel</button></Show>
            </div>
          </form>

          <Show when={profiles.loading}><p class="org-hint">Loading…</p></Show>
          <Show when={profiles() && visibleProfiles().length === 0}>
            <div class="org-empty-inline">
              <div class="org-empty-icon" aria-hidden="true"><Icon name="user" size={22} /></div>
              <p>No people yet. Add your first teammate above to start the directory.</p>
            </div>
          </Show>

          <ul class="org-list">
            <For each={visibleProfiles()}>{(p) =>
              <li classList={{ archived: p.archived }}>
                <span class="avatar" aria-hidden="true">{initials(p.display_name || p.username)}</span>
                <div class="org-list-text">
                  <strong>{p.display_name}</strong>
                  <span class="org-sub"><code>@{p.username}</code><Show when={p.email}><span class="dot">·</span><span class="muted">{p.email}</span></Show></span>
                </div>
                <div class="row-buttons hover-actions">
                  <button class="ghost small" onClick={() => editProfile(p)}>Edit</button>
                  <button class="ghost small" onClick={() => toggleArchiveProfile(p)}>{p.archived ? "Restore" : "Archive"}</button>
                </div>
              </li>
            }</For>
          </ul>
        </section>

        {/* ── Teams ── */}
        <section class="org-panel">
          <div class="panel-title">
            <h2>Teams</h2>
            <Show when={teams()}><span class="count-chip">{activeTeamCount()}</span></Show>
          </div>

          <form class="org-form-inline" onSubmit={saveTeam}>
            <input placeholder="New team name" value={teamForm().name} onInput={(e) => setTeamForm({ ...teamForm(), name: e.currentTarget.value })} />
            <button class="primary">Add</button>
          </form>

          <Show when={teams() && visibleTeams().length === 0}>
            <div class="org-empty-inline">
              <div class="org-empty-icon" aria-hidden="true"><Icon name="org" size={22} /></div>
              <p>No teams yet. Create one above, then add members on the right.</p>
            </div>
          </Show>

          <ul class="org-team-list">
            <For each={visibleTeams()}>{(t) =>
              <li classList={{ active: selectedTeam()?.id === t.id, archived: t.archived }} onClick={() => setSelectedTeam(t)}>
                <span class="team-icon" aria-hidden="true"><Icon name="org" size={15} /></span>
                <strong>{t.name}</strong>
                <button class="ghost small hover-actions" onClick={(ev) => { ev.stopPropagation(); toggleArchiveTeam(t); }}>{t.archived ? "Restore" : "Archive"}</button>
              </li>
            }</For>
          </ul>
        </section>

        {/* ── Membership ── */}
        <section class="org-panel">
          <div class="panel-title"><h2>Membership</h2></div>
          <Show
            when={selectedTeam()}
            fallback={
              <div class="org-empty-inline tall">
                <div class="org-empty-icon" aria-hidden="true"><Icon name="users" size={22} /></div>
                <p>Select a team to see and manage who belongs to it.</p>
              </div>
            }
          >
            {(team) => <>
              <p class="org-selected-team"><span class="team-icon" aria-hidden="true"><Icon name="org" size={14} /></span>{team().name}</p>
              <div class="org-form">
                <select value={memberProfileId()} onChange={(e) => setMemberProfileId(e.currentTarget.value)}>
                  <option value="">Choose a person…</option>
                  <For each={visibleProfiles()}>{(p) => <option value={p.id}>{p.display_name}</option>}</For>
                </select>
                <select value={memberRoleId()} onChange={(e) => setMemberRoleId(e.currentTarget.value)}>
                  <option value="">No per-team role</option>
                  <For each={roles()}>{(r) => <option value={r.id}>{r.name}</option>}</For>
                </select>
                <button class="primary" onClick={addMember} disabled={!memberProfileId()}>Add to team</button>
              </div>

              <Show when={memberships() && memberships()!.length === 0 && !memberships.loading}>
                <div class="org-empty-inline"><p>No members yet — add the first person above.</p></div>
              </Show>
              <ul class="org-list">
                <For each={memberships()}>{(m) =>
                  <li>
                    <span class="avatar" aria-hidden="true">{initials(profileName(m.profile_id))}</span>
                    <div class="org-list-text">
                      <strong>{profileName(m.profile_id)}</strong>
                      <span class="org-sub"><span class="role-pill" classList={{ none: !m.role_id }}>{roleName(m.role_id)}</span></span>
                    </div>
                    <button class="ghost small hover-actions" onClick={() => removeMember(m)}>Remove</button>
                  </li>
                }</For>
              </ul>
            </>}
          </Show>
        </section>
      </div>
    </section>
  );
}
