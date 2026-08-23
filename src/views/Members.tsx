import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  platformApi,
  type Profile,
  type Role,
  type Team,
  type TeamMembership,
  type MemberLocation,
  type ProfileEmailStatus,
  type MessengerContact,
} from "../api/platform";
import { personalApi, type Absence, type CalendarItem } from "../api/personal";
import { blogsApi, type BlogPost } from "../api/blogs";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { linkProps, useDeepLink } from "../router";
import { profileId } from "../session";
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
  const [allMemberships] = createResource(() => platformApi.memberships());
  const [locations, { refetch: refetchLocations }] = createResource(() =>
    platformApi.memberLocations(),
  );
  const [profileDraft, setProfileDraft] = createSignal(newProfile());
  const [profileEditing, setProfileEditing] = createSignal<Profile | null>(
    null,
  );
  const [selectedProfile, setSelectedProfile] = createSignal<Profile | null>(
    null,
  );
  const [profileTab, setProfileTab] = createSignal<
    "profile" | "contact" | "calendar"
  >("profile");
  const [emailStatus, { refetch: refetchEmailStatus }] = createResource(
    () => selectedProfile()?.id ?? profileEditing()?.id,
    (id) =>
      id ? platformApi.getProfileEmailStatus(id) : Promise.resolve(null),
  );
  const [contacts, { refetch: refetchContacts }] = createResource(
    () => selectedProfile()?.id ?? profileEditing()?.id,
    (id) =>
      id
        ? platformApi.messengerContacts(id)
        : Promise.resolve([] as MessengerContact[]),
  );
  const [contactDraft, setContactDraft] = createSignal({
    contact_type: "",
    login: "",
    deep_link: "",
  });
  const [teamDraft, setTeamDraft] = createSignal(newTeam());
  const [activeTeam, setActiveTeam] = createSignal<Team | null>(null);
  const [memberId, setMemberId] = createSignal("");
  const [roleId, setRoleId] = createSignal("");
  const [problem, setProblem] = createSignal("");
  const [includeArchived, setIncludeArchived] = createSignal(false);
  const [directoryQuery, setDirectoryQuery] = createSignal("");
  const [positionFilter, setPositionFilter] = createSignal("");
  const [locationFilter, setLocationFilter] = createSignal("");
  const [locationProfileId, setLocationProfileId] = createSignal("");
  const [locationDraft, setLocationDraft] = createSignal("");
  const [locationType, setLocationType] = createSignal("Building");
  const today = new Date().toISOString().slice(0, 10);
  const [absences] = createResource(() => personalApi.currentAbsences(today));
  const [feed] = createResource(
    () => activeTeam()?.id ?? "",
    (teamId) => blogsApi.list(teamId ? { team_id: teamId } : {}),
  );
  const [profileCalendar] = createResource(
    () => selectedProfile()?.id ?? profileEditing()?.id,
    (id) => {
      if (!id) return Promise.resolve([] as CalendarItem[]);
      const start = Math.floor(Date.now() / 1000);
      const end = start + 14 * 86400;
      return personalApi.calendar(
        id,
        start,
        end,
        today,
        new Date(end * 1000).toISOString().slice(0, 10),
      );
    },
  );
  const absenceFor = (profileId: string) =>
    (absences() ?? []).find(
      (absence: Absence) => absence.profile_id === profileId,
    );
  const recentFeed = createMemo(() =>
    [...((feed() ?? []) as BlogPost[])]
      .filter((post) => !post.archived)
      .sort((a, b) => b.published_at - a.published_at)
      .slice(0, 8),
  );
  const stamp = (seconds: number) => new Date(seconds * 1000).toLocaleString();
  const [memberships, { refetch: refetchMemberships }] = createResource(
    () => activeTeam()?.id,
    (id) =>
      id
        ? platformApi.memberships(id)
        : Promise.resolve([] as TeamMembership[]),
  );

  const positions = createMemo(() =>
    [
      ...new Set(
        (allMemberships() ?? []).flatMap((membership) => {
          const role = roles()?.find(
            (item: Role) => item.id === membership.role_id,
          );
          return role ? [role.name] : [];
        }),
      ),
    ].sort(),
  );
  const locationNames = createMemo(() =>
    [
      ...new Set((locations() ?? []).map((location) => location.location)),
    ].sort(),
  );
  const listedProfiles = createMemo(() => {
    const query = directoryQuery().trim().toLocaleLowerCase();
    return (profiles() ?? []).filter((profile) => {
      if (!includeArchived() && profile.archived) return false;
      if (
        query &&
        ![profile.display_name, profile.username, profile.email ?? ""].some(
          (value) => value.toLocaleLowerCase().includes(query),
        )
      )
        return false;
      const membershipsForProfile = (allMemberships() ?? []).filter(
        (item) => item.profile_id === profile.id,
      );
      if (
        positionFilter() &&
        !membershipsForProfile.some(
          (item) => roleName(item.role_id) === positionFilter(),
        )
      )
        return false;
      return (
        !locationFilter() ||
        (locations() ?? []).some(
          (item) =>
            item.profile_id === profile.id &&
            item.location === locationFilter(),
        )
      );
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
    setSelectedProfile(profile);
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
  let linkedProfile = "";
  useDeepLink(
    "profile",
    (id) => {
      if (id === linkedProfile) return;
      const profile = profiles()?.find((item) => item.id === id);
      if (profile) {
        linkedProfile = id;
        openProfile(profile);
      }
    },
    () => {
      linkedProfile = "";
      abandonEdit();
    },
  );

  const openProfile = (profile: Profile) => {
    setSelectedProfile(profile);
    setProfileTab("profile");
  };
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
    } catch (error) {
      setProblem(String(error));
    }
  };
  const addLocation = async () => {
    if (!locationProfileId() || !locationDraft().trim()) return;
    try {
      await platformApi.addMemberLocation(
        locationProfileId(),
        locationDraft().trim(),
        locationType(),
      );
      setLocationDraft("");
      setProblem("");
      refetchLocations();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const removeLocation = async (location: MemberLocation) => {
    try {
      await platformApi.removeMemberLocation(location.id);
      setProblem("");
      refetchLocations();
    } catch (error) {
      setProblem(String(error));
    }
  };
  const setEmailVerification = async (status: ProfileEmailStatus["status"]) => {
    const profile = profileEditing();
    if (!profile) return;
    try {
      await platformApi.setProfileEmailStatus({
        profile_id: profile.id,
        status,
        verified_at:
          status === "verified" ? Math.floor(Date.now() / 1000) : null,
      });
      refetchEmailStatus();
      setProblem("");
    } catch (error) {
      setProblem(String(error));
    }
  };
  const saveContact = async () => {
    const profile = profileEditing();
    const value = contactDraft();
    if (!profile || !value.contact_type.trim() || !value.login.trim()) return;
    try {
      await platformApi.saveMessengerContact({
        profile_id: profile.id,
        contact_type: value.contact_type.trim(),
        login: value.login.trim(),
        deep_link: value.deep_link.trim() || null,
      });
      setContactDraft({ contact_type: "", login: "", deep_link: "" });
      refetchContacts();
      setProblem("");
    } catch (error) {
      setProblem(String(error));
    }
  };
  const archiveProfile = async (profile: Profile) => {
    try {
      await platformApi.updateProfile({
        ...profile,
        archived: !profile.archived,
      });
      setProblem("");
      refetchProfiles();
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
    } catch (error) {
      setProblem(String(error));
    }
  };
  const removeMembership = async (membership: TeamMembership) => {
    try {
      await platformApi.removeMembership(membership.id);
      setProblem("");
      refetchMemberships();
    } catch (error) {
      setProblem(String(error));
    }
  };

  return (
    <section class="org-view">
      <WorkspaceHeader
        icon="org"
        title="Organization"
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
      >
        Your people and structure in one place — manage{" "}
        <strong>profiles</strong>, shape the <strong>team org-chart</strong>,
        and assign per-team roles.
      </WorkspaceHeader>
      <Show when={problem()}>
        <p class="org-error" onClick={() => setProblem("")}>
          {problem()}
        </p>
      </Show>
      <div class="org-layout">
        <section class="org-panel">
          <div class="panel-title">
            <h2>People</h2>
            <Show when={profiles()}>
              <span class="count-chip">{profileCount()}</span>
            </Show>
          </div>
          <div class="org-form">
            <input
              aria-label="Search directory"
              placeholder="Search people"
              value={directoryQuery()}
              onInput={(event) => setDirectoryQuery(event.currentTarget.value)}
            />
            <select
              aria-label="Filter by position"
              value={positionFilter()}
              onChange={(event) => setPositionFilter(event.currentTarget.value)}
            >
              <option value="">All positions</option>
              <For each={positions()}>
                {(position) => <option value={position}>{position}</option>}
              </For>
            </select>
            <select
              aria-label="Filter by location"
              value={locationFilter()}
              onChange={(event) => setLocationFilter(event.currentTarget.value)}
            >
              <option value="">All locations</option>
              <For each={locationNames()}>
                {(location) => <option value={location}>{location}</option>}
              </For>
            </select>
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
            <Show when={profileEditing()}>
              <section class="org-form" aria-label="Profile communication">
                <label>
                  Email status{" "}
                  <select
                    value={emailStatus()?.status ?? "unverified"}
                    onChange={(event) =>
                      setEmailVerification(
                        event.currentTarget
                          .value as ProfileEmailStatus["status"],
                      )
                    }
                  >
                    <option value="unverified">Unverified</option>
                    <option value="verified">Verified</option>
                    <option value="bounced">Bounced</option>
                  </select>
                </label>
                <For each={contacts() ?? []}>
                  {(contact) => (
                    <p class="org-sub">
                      {contact.contact_type}:{" "}
                      {contact.deep_link ? (
                        <a href={contact.deep_link}>{contact.login}</a>
                      ) : (
                        contact.login
                      )}
                    </p>
                  )}
                </For>
                <div class="org-form-inline">
                  <input
                    aria-label="Messenger type"
                    placeholder="Messenger"
                    value={contactDraft().contact_type}
                    onInput={(event) =>
                      setContactDraft({
                        ...contactDraft(),
                        contact_type: event.currentTarget.value,
                      })
                    }
                  />
                  <input
                    aria-label="Messenger login"
                    placeholder="Login"
                    value={contactDraft().login}
                    onInput={(event) =>
                      setContactDraft({
                        ...contactDraft(),
                        login: event.currentTarget.value,
                      })
                    }
                  />
                  <input
                    aria-label="Messenger deep link"
                    placeholder="Deep link (optional)"
                    value={contactDraft().deep_link}
                    onInput={(event) =>
                      setContactDraft({
                        ...contactDraft(),
                        deep_link: event.currentTarget.value,
                      })
                    }
                  />
                  <button type="button" class="ghost" onClick={saveContact}>
                    Add contact
                  </button>
                </div>
              </section>
            </Show>
            <Show
              when={profileEditing() && (profileCalendar() ?? []).length > 0}
            >
              <section class="org-form" aria-label="Upcoming calendar">
                <p class="org-sub">
                  <strong>Next 14 days</strong>
                </p>
                <For each={profileCalendar() ?? []}>
                  {(item) => (
                    <p class="org-sub">
                      {stamp(item.starts_at)} · {item.kind} · {item.title}
                    </p>
                  )}
                </For>
              </section>
            </Show>
            <select
              aria-label="Person location"
              value={locationProfileId()}
              onChange={(event) =>
                setLocationProfileId(event.currentTarget.value)
              }
            >
              <option value="">Assign location to…</option>
              <For each={listedProfiles()}>
                {(profile) => (
                  <option value={profile.id}>{profile.display_name}</option>
                )}
              </For>
            </select>
            <input
              aria-label="Location name"
              placeholder="Location"
              value={locationDraft()}
              onInput={(event) => setLocationDraft(event.currentTarget.value)}
            />
            <select
              aria-label="Location type"
              value={locationType()}
              onChange={(event) => setLocationType(event.currentTarget.value)}
            >
              <For
                each={[
                  "Region",
                  "Campus",
                  "Building",
                  "Floor",
                  "Room",
                  "ConferenceRoom",
                ]}
              >
                {(type) => <option value={type}>{type}</option>}
              </For>
            </select>
            <button
              type="button"
              class="ghost"
              disabled={!locationProfileId() || !locationDraft().trim()}
              onClick={addLocation}
            >
              Add location
            </button>
          </div>
          <Show when={(locations() ?? []).length > 0}>
            <ul class="org-list">
              <For each={locations()}>
                {(location) => (
                  <li>
                    <div class="org-list-text">
                      <strong>{location.location}</strong>
                      <span class="org-sub">
                        {personName(location.profile_id)} ·{" "}
                        {location.location_type}
                      </span>
                    </div>
                    <button
                      class="ghost small"
                      onClick={() => removeLocation(location)}
                    >
                      Remove
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
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
          <Show when={selectedProfile()}>
            {(profile) => (
              <section class="org-form" aria-label="Profile viewer">
                <div class="panel-title">
                  <h3>{profile().display_name}</h3>
                  <button
                    type="button"
                    class="ghost small"
                    onClick={() => setSelectedProfile(null)}
                  >
                    Close
                  </button>
                </div>
                <div class="row-buttons">
                  <button
                    type="button"
                    class="ghost small"
                    classList={{ active: profileTab() === "profile" }}
                    onClick={() => setProfileTab("profile")}
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    class="ghost small"
                    classList={{ active: profileTab() === "contact" }}
                    onClick={() => setProfileTab("contact")}
                  >
                    Contact
                  </button>
                  <button
                    type="button"
                    class="ghost small"
                    classList={{ active: profileTab() === "calendar" }}
                    onClick={() => setProfileTab("calendar")}
                  >
                    Calendar
                  </button>
                  <Show when={profile().id === profileId()}>
                    <button
                      type="button"
                      class="primary small"
                      onClick={() => beginEdit(profile())}
                    >
                      Edit my profile
                    </button>
                  </Show>
                </div>
                <Show when={profileTab() === "profile"}>
                  <p class="org-sub">
                    <code>@{profile().username}</code>
                    <Show when={profile().email}>
                      <span class="dot">·</span>
                      {profile().email}
                    </Show>
                  </p>
                </Show>
                <Show when={profileTab() === "contact"}>
                  <p class="org-sub">
                    Email status: {emailStatus()?.status ?? "unverified"}
                  </p>
                  <For each={contacts() ?? []}>
                    {(contact) => (
                      <p class="org-sub">
                        {contact.contact_type}:{" "}
                        {contact.deep_link ? (
                          <a href={contact.deep_link}>{contact.login}</a>
                        ) : (
                          contact.login
                        )}
                      </p>
                    )}
                  </For>
                </Show>
                <Show when={profileTab() === "calendar"}>
                  <For each={profileCalendar() ?? []}>
                    {(item) => (
                      <p class="org-sub">
                        {stamp(item.starts_at)} · {item.kind} · {item.title}
                      </p>
                    )}
                  </For>
                  <Show when={(profileCalendar() ?? []).length === 0}>
                    <p class="org-sub">
                      No calendar items in the next 14 days.
                    </p>
                  </Show>
                </Show>
              </section>
            )}
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
                        onClick={() => openProfile(profile)}
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
                      <Show when={absenceFor(profile.id)}>
                        {(absence) => (
                          <>
                            <span class="dot">·</span>
                            <span class="role-pill">
                              {absence().availability === "away"
                                ? "Away"
                                : absence().availability === "partial"
                                  ? "Partly away"
                                  : "Available"}{" "}
                              · {absence().reason_type}
                            </span>
                          </>
                        )}
                      </Show>
                    </span>
                  </div>
                  <div class="row-buttons hover-actions">
                    <button
                      class="ghost small"
                      onClick={() => beginEdit(profile)}
                    >
                      Edit
                    </button>
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
                        <button
                          class="ghost small hover-actions"
                          onClick={() => removeMembership(membership)}
                        >
                          Remove
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </>
            )}
          </Show>
          <div class="panel-title">
            <h2>
              {activeTeam() ? `${activeTeam()!.name} feed` : "Company feed"}
            </h2>
          </div>
          <Show when={recentFeed().length === 0}>
            <p class="org-hint">No posts published yet.</p>
          </Show>
          <ul class="org-list">
            <For each={recentFeed()}>
              {(post) => (
                <li>
                  <div class="org-list-text">
                    <strong>{post.title}</strong>
                    <span class="org-sub">
                      {personName(post.author_id)} · {stamp(post.published_at)}
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
    </section>
  );
}
