import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  platformApi,
  type Profile,
  type Role,
  type Team,
  type TeamMembership,
  type MembershipEditRequest,
  type MemberLocation,
  type DirectoryFeedEvent,
  type MessengerContact,
} from "../api/platform";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import PageHeader from "../components/PageHeader";
import { linkProps, useDeepLink } from "../router";
import { profileId as sessionProfileId } from "../session";
import "./Members.css";

const newProfile = () => ({
  id: "",
  username: "",
  display_name: "",
  email: "",
});
const newTeam = () => ({ name: "", description: "" });

export default function Members() {
  const [profiles, { refetch: refetchProfiles }] = createResource(() =>
    platformApi.profiles(),
  );
  const [teams, { refetch: refetchTeams }] = createResource(() =>
    platformApi.teams(),
  );
  const [roles] = createResource(() => platformApi.roles());
  const [allMemberships, { refetch: refetchAllMemberships }] = createResource(() => platformApi.memberships());
  const [membershipEdits, { refetch: refetchMembershipEdits }] = createResource(() => platformApi.membershipEditRequests());
  const [locations, { refetch: refetchLocations }] = createResource(() => platformApi.memberLocations());
  const [directoryFeed, { refetch: refetchDirectoryFeed }] = createResource(() => platformApi.directoryFeed());
  const [directoryCalendar] = createResource(() => platformApi.directoryCalendar());
  const [profileDraft, setProfileDraft] = createSignal(newProfile());
  const [profileEditing, setProfileEditing] = createSignal<Profile | null>(
    null,
  );
  const [selectedProfile, setSelectedProfile] = createSignal<Profile | null>(null);
  const [profileTab, setProfileTab] = createSignal<"about" | "teams" | "contacts">("about");
  const [teamDraft, setTeamDraft] = createSignal(newTeam());
  const [activeTeam, setActiveTeam] = createSignal<Team | null>(null);
  const [memberId, setMemberId] = createSignal("");
  const [roleId, setRoleId] = createSignal("");
  const [approverId, setApproverId] = createSignal("");
  const [problem, setProblem] = createSignal("");
  const [includeArchived, setIncludeArchived] = createSignal(false);
  const [directoryQuery, setDirectoryQuery] = createSignal("");
  const [positionFilter, setPositionFilter] = createSignal("");
  const [locationFilter, setLocationFilter] = createSignal("");
  const [locationProfileId, setLocationProfileId] = createSignal("");
  const [locationDraft, setLocationDraft] = createSignal("");
  const [locationType, setLocationType] = createSignal("Building");
  const [profileMemberships] = createResource(
    () => selectedProfile()?.id,
    (id) => id ? platformApi.memberships(undefined, id) : Promise.resolve([] as TeamMembership[]),
  );
  const [profileContacts, { refetch: refetchProfileContacts }] = createResource(
    () => selectedProfile()?.id,
    (id) => id ? platformApi.messengerContacts(id) : Promise.resolve([] as MessengerContact[]),
  );
  const [profileEmailStatus, { refetch: refetchProfileEmailStatus }] = createResource(
    () => selectedProfile()?.id,
    (id) => id ? platformApi.getProfileEmailStatus(id) : Promise.resolve(null),
  );
  const [contactDraft, setContactDraft] = createSignal({ contact_type: "Telegram", login: "" });
  const [memberships, { refetch: refetchMemberships }] = createResource(
    () => activeTeam()?.id,
    (id) =>
      id
        ? platformApi.memberships(id)
        : Promise.resolve([] as TeamMembership[]),
  );

  const positions = createMemo(() => [...new Set((allMemberships() ?? []).flatMap((membership) => {
    const role = roles()?.find((item: Role) => item.id === membership.role_id);
    return role ? [role.name] : [];
  }))].sort());
  const locationNames = createMemo(() => [...new Set((locations() ?? []).map((location) => location.location))].sort());
  const listedProfiles = createMemo(() => {
    const query = directoryQuery().trim().toLocaleLowerCase();
    return (profiles() ?? []).filter((profile) => {
      if (!includeArchived() && profile.archived) return false;
      if (query && ![profile.display_name, profile.username, profile.email ?? ""].some((value) => value.toLocaleLowerCase().includes(query))) return false;
      const membershipsForProfile = (allMemberships() ?? []).filter((item) => item.profile_id === profile.id);
      if (positionFilter() && !membershipsForProfile.some((item) => roleName(item.role_id) === positionFilter())) return false;
      return !locationFilter() || (locations() ?? []).some((item) => item.profile_id === profile.id && item.location === locationFilter());
    });
  });
  const listedTeams = createMemo(() =>
    (teams() ?? []).filter((team) => includeArchived() || !team.archived),
  );
  const hasArchived = createMemo(() =>
    [...(profiles() ?? []), ...(teams() ?? [])].some((item) => item.archived),
  );
  const profileCount = createMemo(
    () => (profiles() ?? []).filter((profile) => !profile.archived).length,
  );
  const teamCount = createMemo(
    () => (teams() ?? []).filter((team) => !team.archived).length,
  );
  const personName = (id: string) =>
    profiles()?.find((profile) => profile.id === id)?.display_name ?? id;
  const roleName = (id: string | null) =>
    id
      ? (roles()?.find((role: Role) => role.id === id)?.name ?? id)
      : "No role";

  const beginEdit = (profile: Profile) => {
    setProfileEditing(profile);
    setProfileDraft({
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      email: profile.email ?? "",
    });
  };
  const abandonEdit = () => {
    setProfileEditing(null);
    setProfileDraft(newProfile());
  };
  const ownProfileId = () => sessionProfileId() || profiles()?.find((profile) => !profile.archived)?.id || "";
  const isOwnProfile = () => selectedProfile()?.id === ownProfileId();
  const selectProfile = (profile: Profile) => {
    setSelectedProfile(profile);
    setProfileTab("about");
    if (profile.id === ownProfileId()) beginEdit(profile);
  };
  const saveEmailStatus = async (status: "unverified" | "verified" | "bounced") => {
    const profile = selectedProfile();
    if (!profile) return;
    try { await platformApi.setProfileEmailStatus({ profile_id: profile.id, status, verified_at: status === "verified" ? Math.floor(Date.now() / 1000) : null }); setProblem(""); refetchProfileEmailStatus(); }
    catch (error) { setProblem(String(error)); }
  };
  const saveMessengerContact = async () => {
    const profile = selectedProfile(); const draft = contactDraft();
    if (!profile || !draft.login.trim()) return;
    try { await platformApi.saveMessengerContact({ profile_id: profile.id, contact_type: draft.contact_type, login: draft.login.trim(), deep_link: null }); setContactDraft({ contact_type: "Telegram", login: "" }); setProblem(""); refetchProfileContacts(); }
    catch (error) { setProblem(String(error)); }
  };
  const removeMessengerContact = async (contact: MessengerContact) => {
    if (!contact.id) return;
    try { await platformApi.deleteMessengerContact(contact.id, contact.profile_id); setProblem(""); refetchProfileContacts(); }
    catch (error) { setProblem(String(error)); }
  };
  const feedText = (event: DirectoryFeedEvent) => {
    const team = event.team_name ? ` · ${event.team_name}` : "";
    if (event.event_type === "member.joined") return `${event.profile_name} joined the organization`;
    if (event.event_type === "member.left") return `${event.profile_name} left the organization`;
    if (event.event_type === "team.joined") return `${event.profile_name} joined${team}`;
    if (event.event_type === "team.left") return `${event.profile_name} left${team}`;
    return `${event.profile_name} changed role${event.role_name ? ` to ${event.role_name}` : ""}${team}`;
  };
  let linkedProfile = "";
  useDeepLink(
    "profile",
    (id) => {
      if (id === linkedProfile) return;
      const profile = profiles()?.find((item) => item.id === id);
      if (profile) {
        linkedProfile = id;
        selectProfile(profile);
      }
    },
    () => {
      linkedProfile = "";
      abandonEdit();
    },
  );

  const saveProfile = async (event: SubmitEvent) => {
    event.preventDefault();
    const value = profileDraft();
    try {
      if (!value.username.trim() || !value.display_name.trim())
        throw new Error("Username and display name are required.");
      const existing = profileEditing();
      if (existing) {
        await platformApi.updateProfile({
          ...existing,
          username: value.username.trim(),
          display_name: value.display_name.trim(),
          email: value.email.trim() || null,
        });
      } else {
        await platformApi.createProfile({
          id: `profile-${Date.now().toString(16)}`,
          username: value.username.trim(),
          display_name: value.display_name.trim(),
          email: value.email.trim() || null,
          archived: false,
        });
      }
      abandonEdit();
      setProblem("");
      refetchProfiles();
      refetchDirectoryFeed();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const addLocation = async () => {
    if (!locationProfileId() || !locationDraft().trim()) return;
    try { await platformApi.addMemberLocation(locationProfileId(), locationDraft().trim(), locationType()); setLocationDraft(""); setProblem(""); refetchLocations(); }
    catch (error) { setProblem(String(error)); }
  };
  const removeLocation = async (location: MemberLocation) => {
    try { await platformApi.removeMemberLocation(location.id); setProblem(""); refetchLocations(); }
    catch (error) { setProblem(String(error)); }
  };
  const archiveProfile = async (profile: Profile) => {
    try {
      await platformApi.updateProfile({
        ...profile,
        archived: !profile.archived,
      });
      setProblem("");
      refetchProfiles();
      refetchDirectoryFeed();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const saveTeam = async (event: SubmitEvent) => {
    event.preventDefault();
    try {
      const value = teamDraft();
      if (!value.name.trim()) throw new Error("Team name is required.");
      const team = await platformApi.createTeam({
        name: value.name.trim(),
        description: value.description.trim() || null,
        parent_id: null,
      });
      setTeamDraft(newTeam());
      setActiveTeam(team);
      setProblem("");
      refetchTeams();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const archiveTeam = async (team: Team) => {
    try {
      await platformApi.archiveTeam(team.id, !team.archived);
      setProblem("");
      refetchTeams();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const addMembership = async () => {
    const team = activeTeam();
    if (!team || !memberId()) return;
    try {
      await platformApi.addMembership({
        profile_id: memberId(),
        team_id: team.id,
        role_id: roleId() || null,
      });
      setMemberId("");
      setRoleId("");
      setProblem("");
      refetchMemberships();
      refetchAllMemberships();
      refetchDirectoryFeed();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const removeMembership = async (membership: TeamMembership) => {
    try {
      await platformApi.removeMembership(membership.id);
      setProblem("");
      refetchMemberships();
      refetchAllMemberships();
      refetchDirectoryFeed();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const requestMembershipArchive = async (membership: TeamMembership) => {
    try { await platformApi.requestMembershipEdit({ ...membership, archived: !membership.archived }, membership.profile_id); setProblem(""); refetchMembershipEdits(); }
    catch (error) { setProblem(String(error)); }
  };
  const decideMembershipEdit = async (request: MembershipEditRequest, approve: boolean) => {
    if (!approverId()) { setProblem("Choose an approver before deciding a membership edit."); return; }
    try { await platformApi.decideMembershipEdit(request.id, approverId(), approve); setProblem(""); refetchMembershipEdits(); refetchMemberships(); }
    catch (error) { setProblem(String(error)); }
  };

  return (
    <section class="org-view">
      <PageHeader
        title="Organization"
        subline="People, teams and roles"
        actions={
          <Show when={hasArchived()}>
            <label class="org-archived-toggle">
              <input
                type="checkbox"
                checked={includeArchived()}
                onChange={(event) =>
                  setIncludeArchived(event.currentTarget.checked)
                }
              />{" "}
              Show archived
            </label>
          </Show>
        }
      />
      <Show when={problem()}>
        <p class="org-error" onClick={() => setProblem("")}>
          {problem()}
        </p>
      </Show>
      <Show when={selectedProfile()}>{(profile) => (
        <section class="org-profile-panel" aria-label="Profile detail">
          <div class="panel-title"><Avatar name={profile().display_name || profile().username} size={34} /><div><h2>{isOwnProfile() ? "My profile" : profile().display_name}</h2><span class="org-sub"><code>@{profile().username}</code>{profile().email ? <><span class="dot">·</span>{profile().email}</> : null}</span></div><button class="ghost small" onClick={() => { setSelectedProfile(null); abandonEdit(); }}>Close</button></div>
          <Show when={isOwnProfile()} fallback={<>
            <div class="org-profile-tabs" role="tablist"><button classList={{ active: profileTab() === "about" }} onClick={() => setProfileTab("about")}>About</button><button classList={{ active: profileTab() === "teams" }} onClick={() => setProfileTab("teams")}>Teams</button><button classList={{ active: profileTab() === "contacts" }} onClick={() => setProfileTab("contacts")}>Contacts</button></div>
            <Show when={profileTab() === "about"}><p class="org-profile-readonly">Username <strong>@{profile().username}</strong></p><p class="org-profile-readonly">Email <strong>{profile().email ?? "Not set"}</strong></p></Show>
            <Show when={profileTab() === "teams"}><ul class="org-list"><For each={profileMemberships()}>{(membership) => <li><strong>{teams()?.find((team) => team.id === membership.team_id)?.name ?? membership.team_id}</strong><span class="role-pill">{roleName(membership.role_id)}</span></li>}</For></ul><Show when={(profileMemberships() ?? []).length === 0}><p class="org-hint">No team memberships.</p></Show></Show>
            <Show when={profileTab() === "contacts"}><ul class="org-list"><For each={profileContacts()}>{(contact) => <li><strong>{contact.contact_type}</strong><span class="org-sub">{contact.login}</span><Show when={contact.deep_link}>{(link) => <a href={link()} target="_blank" rel="noreferrer">Open chat</a>}</Show></li>}</For></ul><Show when={(profileContacts() ?? []).length === 0}><p class="org-hint">No contact methods shared.</p></Show></Show>
          </>}>
            <form class="org-profile-edit" onSubmit={saveProfile} aria-label="My profile">
              <label>Display name<input value={profileDraft().display_name} onInput={(event) => setProfileDraft({ ...profileDraft(), display_name: event.currentTarget.value })} /></label>
              <label>Username<input value={profileDraft().username} onInput={(event) => setProfileDraft({ ...profileDraft(), username: event.currentTarget.value })} /></label>
              <label>Email<input type="email" value={profileDraft().email} onInput={(event) => setProfileDraft({ ...profileDraft(), email: event.currentTarget.value })} /></label>
              <button class="primary">Save my profile</button>
            </form>
            <section class="org-profile-settings" aria-label="Email status">
              <label>Email status<select value={profileEmailStatus()?.status ?? "unverified"} onChange={(event) => void saveEmailStatus(event.currentTarget.value as "unverified" | "verified" | "bounced")}><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="bounced">Bounced</option></select></label>
              <span class="org-hint">{profileEmailStatus()?.verified_at ? `Verified ${new Date(profileEmailStatus()!.verified_at! * 1000).toLocaleDateString()}` : "No verified email timestamp"}</span>
            </section>
            <section class="org-profile-settings" aria-label="Messenger contacts">
              <div class="panel-title"><h2>Messenger contacts</h2></div>
              <form class="org-form-inline" onSubmit={(event) => { event.preventDefault(); void saveMessengerContact(); }}><select aria-label="Messenger type" value={contactDraft().contact_type} onChange={(event) => setContactDraft({ ...contactDraft(), contact_type: event.currentTarget.value })}><For each={["Twitter", "Slack", "Telegram", "Skype", "ICQ", "XMPP", "Space"]}>{(type) => <option value={type}>{type}</option>}</For></select><input aria-label="Messenger login" placeholder="Username or address" value={contactDraft().login} onInput={(event) => setContactDraft({ ...contactDraft(), login: event.currentTarget.value })}/><button class="ghost">Add contact</button></form>
              <ul class="org-list"><For each={profileContacts()}>{(contact) => <li><strong>{contact.contact_type}</strong><span class="org-sub">{contact.login}</span><Show when={contact.deep_link}>{(link) => <a href={link()} target="_blank" rel="noreferrer">Open chat</a>}</Show><button class="ghost small" onClick={() => void removeMessengerContact(contact)}>Remove</button></li>}</For></ul>
            </section>
          </Show>
        </section>
      )}</Show>
      <div class="org-layout">
        <section class="org-panel">
          <div class="panel-title">
            <h2>People</h2>
            <Show when={profiles()}>
              <span class="count-chip">{profileCount()}</span>
            </Show>
          </div>
          <div class="org-form">
            <input aria-label="Search directory" placeholder="Search people" value={directoryQuery()} onInput={(event) => setDirectoryQuery(event.currentTarget.value)} />
            <select aria-label="Filter by position" value={positionFilter()} onChange={(event) => setPositionFilter(event.currentTarget.value)}><option value="">All positions</option><For each={positions()}>{(position) => <option value={position}>{position}</option>}</For></select>
            <select aria-label="Filter by location" value={locationFilter()} onChange={(event) => setLocationFilter(event.currentTarget.value)}><option value="">All locations</option><For each={locationNames()}>{(location) => <option value={location}>{location}</option>}</For></select>
          </div>
          <form class="org-form" onSubmit={saveProfile}>
            <input
              placeholder="Display name"
              value={profileDraft().display_name}
              onInput={(event) =>
                setProfileDraft({
                  ...profileDraft(),
                  display_name: event.currentTarget.value,
                })
              }
            />
            <input
              placeholder="Username"
              value={profileDraft().username}
              onInput={(event) =>
                setProfileDraft({
                  ...profileDraft(),
                  username: event.currentTarget.value,
                })
              }
            />
            <input
              placeholder="Email (optional)"
              value={profileDraft().email}
              onInput={(event) =>
                setProfileDraft({
                  ...profileDraft(),
                  email: event.currentTarget.value,
                })
              }
            />
            <div class="row-buttons">
              <button class="primary">
                {profileEditing() ? "Save changes" : "Add person"}
              </button>
              <Show when={profileEditing()}>
                <button type="button" class="ghost" onClick={abandonEdit}>
                  Cancel
                </button>
              </Show>
            </div>
          </form>
          <div class="org-form">
            <select aria-label="Person location" value={locationProfileId()} onChange={(event) => setLocationProfileId(event.currentTarget.value)}><option value="">Assign location to…</option><For each={listedProfiles()}>{(profile) => <option value={profile.id}>{profile.display_name}</option>}</For></select>
            <input aria-label="Location name" placeholder="Location" value={locationDraft()} onInput={(event) => setLocationDraft(event.currentTarget.value)} />
            <select aria-label="Location type" value={locationType()} onChange={(event) => setLocationType(event.currentTarget.value)}><For each={["Region", "Campus", "Building", "Floor", "Room", "ConferenceRoom"]}>{(type) => <option value={type}>{type}</option>}</For></select>
            <button type="button" class="ghost" disabled={!locationProfileId() || !locationDraft().trim()} onClick={addLocation}>Add location</button>
          </div>
          <Show when={(locations() ?? []).length > 0}><ul class="org-list"><For each={locations()}>{(location) => <li><div class="org-list-text"><strong>{location.location}</strong><span class="org-sub">{personName(location.profile_id)} · {location.location_type}</span></div><button class="ghost small" onClick={() => removeLocation(location)}>Remove</button></li>}</For></ul></Show>
          <Show when={profiles.loading}>
            <p class="org-hint">Loading…</p>
          </Show>
          <Show when={profiles() && listedProfiles().length === 0}>
            <div class="org-empty-inline">
              <div class="org-empty-icon">
                <Icon name="user" size={22} />
              </div>
              <p>
                No people yet. Add your first teammate above to start the
                directory.
              </p>
            </div>
          </Show>
          <ul class="org-list">
            <For each={listedProfiles()}>
              {(profile) => (
                <li classList={{ archived: profile.archived }}>
                  <Avatar
                    name={profile.display_name || profile.username}
                    size={30}
                  />
                  <div class="org-list-text">
                    <strong>
                      <a
                        {...linkProps({
                          view: "Members",
                          entityType: "profile",
                          entityId: profile.id,
                        })}
                        onClick={() => selectProfile(profile)}
                      >
                        {profile.display_name}
                      </a>
                    </strong>
                    <span class="org-sub">
                      <code>@{profile.username}</code>
                      <Show when={profile.email}>
                        <span class="dot">·</span>
                        <span class="muted">{profile.email}</span>
                      </Show>
                    </span>
                  </div>
                  <div class="row-buttons hover-actions">
                    <button class="ghost small" onClick={() => selectProfile(profile)}>View profile</button>
                    <button
                      class="ghost small"
                      onClick={() => archiveProfile(profile)}
                    >
                      {profile.archived ? "Restore" : "Archive"}
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
        <section class="org-panel">
          <div class="panel-title">
            <h2>Teams</h2>
            <Show when={teams()}>
              <span class="count-chip">{teamCount()}</span>
            </Show>
          </div>
          <form class="org-form-inline" onSubmit={saveTeam}>
            <input
              placeholder="New team name"
              value={teamDraft().name}
              onInput={(event) =>
                setTeamDraft({
                  ...teamDraft(),
                  name: event.currentTarget.value,
                })
              }
            />
            <button class="primary">Add</button>
          </form>
          <Show when={teams() && listedTeams().length === 0}>
            <div class="org-empty-inline">
              <div class="org-empty-icon">
                <Icon name="org" size={22} />
              </div>
              <p>
                No teams yet. Create one above, then add members on the right.
              </p>
            </div>
          </Show>
          <ul class="org-team-list">
            <For each={listedTeams()}>
              {(team) => (
                <li
                  classList={{
                    active: activeTeam()?.id === team.id,
                    archived: team.archived,
                  }}
                  onClick={() => setActiveTeam(team)}
                >
                  <span class="team-icon">
                    <Icon name="org" size={15} />
                  </span>
                  <strong>{team.name}</strong>
                  <button
                    class="ghost small hover-actions"
                    onClick={(event) => {
                      event.stopPropagation();
                      archiveTeam(team);
                    }}
                  >
                    {team.archived ? "Restore" : "Archive"}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
        <section class="org-panel">
          <div class="panel-title">
            <h2>Membership</h2>
          </div>
          <Show
            when={activeTeam()}
            fallback={
              <div class="org-empty-inline tall">
                <div class="org-empty-icon">
                  <Icon name="users" size={22} />
                </div>
                <p>Select a team to see and manage who belongs to it.</p>
              </div>
            }
          >
            {(team) => (
              <>
                <p class="org-selected-team">
                  <span class="team-icon">
                    <Icon name="org" size={14} />
                  </span>
                  {team().name}
                </p>
                <div class="org-form">
                  <select
                    value={memberId()}
                    onChange={(event) => setMemberId(event.currentTarget.value)}
                  >
                    <option value="">Choose a person…</option>
                    <For each={listedProfiles()}>
                      {(profile) => (
                        <option value={profile.id}>
                          {profile.display_name}
                        </option>
                      )}
                    </For>
                  </select>
                  <select
                    value={roleId()}
                    onChange={(event) => setRoleId(event.currentTarget.value)}
                  >
                    <option value="">No per-team role</option>
                    <For each={roles()}>
                      {(role) => <option value={role.id}>{role.name}</option>}
                    </For>
                  </select>
                  <button
                    class="primary"
                    onClick={addMembership}
                    disabled={!memberId()}
                  >
                    Add to team
                  </button>
                </div>
                <Show
                  when={
                    memberships() &&
                    memberships()!.length === 0 &&
                    !memberships.loading
                  }
                >
                  <div class="org-empty-inline">
                    <p>No members yet — add the first person above.</p>
                  </div>
                </Show>
                <div class="org-form">
                  <select value={approverId()} onChange={(event) => setApproverId(event.currentTarget.value)} aria-label="Membership edit approver">
                    <option value="">Choose edit approver…</option>
                    <For each={profiles()}>{(profile) => <option value={profile.id}>{profile.display_name}</option>}</For>
                  </select>
                </div>
                <Show when={(membershipEdits() ?? []).filter((request) => request.status === "PENDING" && memberships()?.some((membership) => membership.id === request.membership_id)).length}>
                  <ul class="org-list"> <For each={(membershipEdits() ?? []).filter((request) => request.status === "PENDING" && memberships()?.some((membership) => membership.id === request.membership_id))}>{(request) => <li><span>Pending edit for {personName(request.requested_by)}</span><button class="ghost small" onClick={() => decideMembershipEdit(request, true)}>Approve</button><button class="ghost small" onClick={() => decideMembershipEdit(request, false)}>Reject</button></li>}</For></ul>
                </Show>
                <ul class="org-list">
                  <For each={memberships()}>
                    {(membership) => (
                      <li>
                        <Avatar
                          name={personName(membership.profile_id)}
                          size={30}
                        />
                        <div class="org-list-text">
                          <strong>{personName(membership.profile_id)}</strong>
                          <span class="org-sub">
                            <span
                              class="role-pill"
                              classList={{ none: !membership.role_id }}
                            >
                              {roleName(membership.role_id)}
                            </span>
                          </span>
                        </div>
                        <button class="ghost small hover-actions" onClick={() => requestMembershipArchive(membership)}>
                          Request {membership.archived ? "restore" : "archive"}
                        </button>
                        <button class="ghost small hover-actions" onClick={() => removeMembership(membership)}>
                          Remove
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </>
            )}
          </Show>
        </section>
      </div>
      <div class="org-directory-addons">
        <section class="org-panel" aria-label="Company feed"><div class="panel-title"><h2>Company feed</h2><span class="org-hint">Member and role activity</span></div><Show when={directoryFeed.loading}><p class="org-hint">Loading activity…</p></Show><Show when={!directoryFeed.loading && (directoryFeed() ?? []).length === 0}><p class="org-hint">No directory activity yet.</p></Show><ul class="org-list"><For each={directoryFeed()}>{(event) => <li><Avatar name={event.profile_name} size={28} /><div class="org-list-text"><strong>{feedText(event)}</strong><span class="org-sub">{new Date(event.created_at * 1000).toLocaleDateString()}</span></div></li>}</For></ul></section>
        <section class="org-panel" aria-label="Organization calendar"><div class="panel-title"><h2>Organization calendar</h2><span class="org-hint">Approved time off</span></div><Show when={directoryCalendar.loading}><p class="org-hint">Loading calendar…</p></Show><Show when={!directoryCalendar.loading && (directoryCalendar() ?? []).length === 0}><p class="org-hint">No approved absences.</p></Show><ul class="org-list"><For each={directoryCalendar()}>{(absence) => <li><Avatar name={absence.profile_name} size={28} /><div class="org-list-text"><strong>{absence.profile_name} · {absence.reason_type}</strong><span class="org-sub">{absence.date_from} – {absence.date_to} · {absence.availability}</span></div></li>}</For></ul></section>
      </div>
    </section>
  );
}
