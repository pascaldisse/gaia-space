import { createResource, createSignal, For, Show } from "solid-js";
import { platformApi, type Profile, type Team, type TeamMembership, type Role } from "../api/platform";
import "./Members.css";
import { useDeepLink, linkProps } from "../router";

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

  const [memberships, { refetch: reloadMemberships }] = createResource(
    () => selectedTeam()?.id,
    (teamId) => (teamId ? platformApi.memberships(teamId) : Promise.resolve([] as TeamMembership[])),
  );

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
      reloadProfiles();
    } catch (e) { setError(String(e)); }
  };
  useDeepLink("profile", (id) => { if (editingProfile()?.id === id) return; const found = profiles()?.find(p => p.id === id); if (found) { setEditingProfile(found); setProfileForm({ id: found.id, username: found.username, display_name: found.display_name, email: found.email ?? "" }); } }, () => { if (editingProfile()) { setEditingProfile(null); setProfileForm(blankProfile()); } });
  const toggleArchiveProfile = async (p: Profile) => { try { await platformApi.updateProfile({ ...p, archived: !p.archived }); reloadProfiles(); } catch (e) { setError(String(e)); } };

  const saveTeam = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const f = teamForm();
      if (!f.name.trim()) throw new Error("Team name is required.");
      const team = await platformApi.createTeam({ name: f.name.trim(), description: f.description || null, parent_id: null });
      setTeamForm(blankTeam());
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
  const profileName = (id: string) => profiles()?.find(p => p.id === id)?.display_name ?? id;
  const roleName = (id: string | null) => (id ? roles()?.find((r: Role) => r.id === id)?.name ?? id : "—");

  return <section class="members-view">
    <header class="members-head"><div><h1>Members</h1><p>Organization directory: profiles and the team org-chart with per-team membership roles.</p></div></header>
    <Show when={error()}><p class="members-error">{error()}</p></Show>
    <div class="members-layout">
      <section class="members-panel">
        <div class="panel-title"><h2>Profiles</h2></div>
        <form class="inline-form-col" onSubmit={saveProfile}>
          <input placeholder="Username" value={profileForm().username} onInput={e => setProfileForm({ ...profileForm(), username: e.currentTarget.value })} />
          <input placeholder="Display name" value={profileForm().display_name} onInput={e => setProfileForm({ ...profileForm(), display_name: e.currentTarget.value })} />
          <input placeholder="Email (optional)" value={profileForm().email} onInput={e => setProfileForm({ ...profileForm(), email: e.currentTarget.value })} />
          <div class="row-buttons"><button class="primary">{editingProfile() ? "Save" : "Add profile"}</button><Show when={editingProfile()}><button type="button" class="ghost" onClick={() => { setEditingProfile(null); setProfileForm(blankProfile()); }}>Cancel</button></Show></div>
        </form>
        <Show when={profiles.loading}><p class="hint">Loading…</p></Show>
        <ul class="entity-list"><For each={profiles()}>{p =>
          <li classList={{ archived: p.archived }}>
            <a class="row-link" {...linkProps({ view: "Members", entityType: "profile", entityId: p.id })}><strong>{p.display_name}</strong><code>@{p.username}</code><Show when={p.email}><span class="muted">{p.email}</span></Show></a>
            <div class="row-buttons"><a class="ghost" {...linkProps({ view: "Members", entityType: "profile", entityId: p.id })}>Edit</a><button class="ghost" onClick={() => toggleArchiveProfile(p)}>{p.archived ? "Restore" : "Archive"}</button></div>
          </li>
        }</For></ul>
      </section>

      <section class="members-panel">
        <div class="panel-title"><h2>Teams</h2></div>
        <form class="inline-form" onSubmit={saveTeam}>
          <input placeholder="New team name" value={teamForm().name} onInput={e => setTeamForm({ ...teamForm(), name: e.currentTarget.value })} />
          <button class="primary">Add</button>
        </form>
        <ul class="entity-list compact"><For each={teams()}>{t =>
          <li classList={{ active: selectedTeam()?.id === t.id, archived: t.archived }} onClick={() => setSelectedTeam(t)}>
            <strong>{t.name}</strong>
            <button class="ghost small" onClick={(ev) => { ev.stopPropagation(); toggleArchiveTeam(t); }}>{t.archived ? "Restore" : "Archive"}</button>
          </li>
        }</For></ul>
      </section>

      <section class="members-panel">
        <div class="panel-title"><h2>Membership</h2></div>
        <Show when={selectedTeam()} fallback={<p class="hint pad">Select a team to manage its members.</p>}>
          {team => <>
            <p class="muted">{team().name}</p>
            <div class="inline-form-col">
              <select value={memberProfileId()} onChange={e => setMemberProfileId(e.currentTarget.value)}>
                <option value="">Choose profile…</option>
                <For each={profiles()}>{p => <option value={p.id}>{p.display_name}</option>}</For>
              </select>
              <select value={memberRoleId()} onChange={e => setMemberRoleId(e.currentTarget.value)}>
                <option value="">No per-team role</option>
                <For each={roles()}>{r => <option value={r.id}>{r.name}</option>}</For>
              </select>
              <button class="primary" onClick={addMember}>Add member</button>
            </div>
            <ul class="entity-list"><For each={memberships()}>{m =>
              <li><div><strong>{profileName(m.profile_id)}</strong><span class="muted">{roleName(m.role_id)}</span></div><button class="ghost" onClick={() => removeMember(m)}>Remove</button></li>
            }</For></ul>
            <Show when={memberships()?.length === 0}><p class="empty-state">No members yet.</p></Show>
          </>}
        </Show>
      </section>
    </div>
  </section>;
}
