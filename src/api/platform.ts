import { invoke } from "@tauri-apps/api/core";

export type Profile = { id: string; username: string; display_name: string; email: string | null; archived: boolean };
export type ProfileEmailStatus = { profile_id: string; status: "unverified" | "verified" | "bounced"; verified_at: number | null };
export type MessengerContact = { id?: string; profile_id: string; contact_type: string; login: string; deep_link: string | null };
export type Principal = { id: string; kind: "profile" | "application" | "external"; profile_id: string | null; label: string };
export type Organization = { id:string; name:string; slogan:string|null; logo_id:string|null; timezone:string; onboarding_required:boolean; allow_domains_edit:boolean };
export type OrgSettings = { org_id:string; available_right_codes:string[]; is_space_code:boolean; is_space_code_only:boolean };
export type MemberLocation = { id: string; profile_id: string; location: string; location_type: string };
export type DeskAssignment = { id?:string; profile_id:string; location_id:string; seat_label:string|null; map_x:number; map_y:number; since_date:string; till_date:string|null };
export type Location = { id:string; name:string; location_type:string; parent_id:string|null; timezone:string; work_schedule_json:string; channel_id:string|null; archived:boolean; equipment:string[] };
export type Team = { id: string; name: string; description: string | null; parent_id: string | null; archived: boolean };
export type TeamMembership = {
  id: string; profile_id: string; team_id: string; role_id: string | null; lead: boolean;
  manager_id: string | null; since_date: string | null; till_date: string | null; requires_approval: boolean; archived: boolean;
};
export type MembershipEditRequest = { id:string; membership_id:string; requested_by:string; patch_json:string; status:"PENDING"|"APPROVED"|"REJECTED"; approver_id:string|null; created_at:number; decided_at:number|null };
export type ProjectRoleKind = "ADMIN" | "MEMBER" | "CUSTOM" | "EXTERNAL";
export type ProjectRoleTemplate = { id:string; code:string; name:string; description:string|null; role_kind:ProjectRoleKind; archived:boolean };
export type ProjectRole = { id:string; project_id:string; template_id:string|null; name:string; role_kind:ProjectRoleKind; archived:boolean };
export type ProjectTeamRole = { project_id:string; team_id:string; project_role_id:string };
export type Role = { id: string; name: string; description: string | null; parent_id: string | null; role_type: string; archived: boolean };
export type Right = {
  id: string; code: string; title: string; description: string | null; right_type: string; right_group: string | null;
  flags: number; implied_rights: string[]; feature_gate: string | null; propagation: string; descriptor: unknown;
};
export type RightGroup = { code: string; title: string; priority: number };
export type ScopeType = "global" | "project" | "team" | "profile" | "channel" | "document" | "documentFolder";
export type RoleAssignment = { id: string; role_id: string; profile_id: string | null; team_id: string | null; scope_type: ScopeType; scope_id: string | null };
export type Project = { id: string; name: string; key: string; description: string | null; created_by: string | null; archived: boolean; deadline: string | null }; 
export type CfType = "text" | "text_list" | "int" | "int_list" | "enum" | "enum_list" | "open_enum" | "open_enum_list" | "bool" | "date" | "datetime" | "percentage" | "fraction" | "profile" | "profile_list" | "team" | "location" | "project" | "url" | "contact" | "contact_list" | "autonumber" | "issue" | "issue_list";
export type CfDefinition = {
  id: string; entity_type: string; cf_type: CfType; name: string;
  constraints_json: string | null; default_json: string | null; ordering: number; archived: boolean;
};
export type CfValueEntry = CfDefinition & { value_json: string | null };

const call = <T>(command: string, args: Record<string, unknown> = {}) => invoke<T>(command, args);

// A new project carries no owner: the server mints `created_by` from the
// session identity, so the client can never name someone else as owner.
export type NewProject = Omit<Project, "created_by">;
const submitProject = (operation: "create" | "update", value: Project | NewProject) =>
  call<void>(`${operation}_project`, { project: value });

export const platformApi = {
  // Organization
  organization: () => call<Organization>("get_organization"),
  updateOrganization: (value: Organization) => call<Organization>("update_organization", { value }),
  orgSettings: () => call<OrgSettings>("get_org_settings"),
  updateOrgSettings: (value: OrgSettings) => call<OrgSettings>("update_org_settings", { value }),
  // Profiles
  profiles: () => call<Profile[]>("list_profiles"),
  createProfile: (profile: Profile) => call<void>("create_profile", { profile }),
  updateProfile: (profile: Profile) => call<void>("update_profile", { profile }),
getProfileEmailStatus: (profile_id: string) => call<ProfileEmailStatus>("get_profile_email_status", { profileId: profile_id }),
setProfileEmailStatus: (value: ProfileEmailStatus) => call<void>("set_profile_email_status", { value }),
messengerContacts: (profile_id: string) => call<MessengerContact[]>("list_messenger_contacts", { profileId: profile_id }),
saveMessengerContact: (value: MessengerContact) => call<MessengerContact>("save_messenger_contact", { value }),
principals: () => call<Principal[]>("list_principals"),

  deskAssignments: (profile_id?: string, location_id?: string) => call<DeskAssignment[]>("list_desk_assignments", { profileId: profile_id ?? null, locationId: location_id ?? null }),
saveDeskAssignment: (value: DeskAssignment) => call<DeskAssignment>("save_desk_assignment", { value }),
removeDeskAssignment: (id: string) => call<void>("remove_desk_assignment", { id }),
memberLocations: (profile_id?: string) => call<MemberLocation[]>("list_member_locations", { profileId: profile_id ?? null }),
addMemberLocation: (member_id: string, location: string, location_type: string) => call<MemberLocation>("add_member_location", { memberId: member_id, location, locationType: location_type }),
removeMemberLocation: (id: string) => call<void>("remove_member_location", { id }),
// Organization locations
locations: () => call<Location[]>("list_locations"),
saveLocation: (location: Location) => call<Location>("save_location", { location }),
locationChannel: (location_id: string) => call<string|null>("location_channel", { locationId: location_id }),
// Teams + memberships
  teams: () => call<Team[]>("list_teams"),
  createTeam: (input: { id?: string; name: string; description: string | null; parent_id: string | null }) =>
    call<Team>("create_team", { input }),
  updateTeam: (team: Team) => call<Team>("update_team", { team }),
  archiveTeam: (id: string, archived: boolean) => call<void>("archive_team", { id, archived }),
  memberships: (team_id?: string, profile_id?: string) =>
    call<TeamMembership[]>("list_team_memberships", { teamId: team_id ?? null, profileId: profile_id ?? null }),
  addMembership: (input: {
    id?: string; profile_id: string; team_id: string; role_id?: string | null; lead?: boolean;
    manager_id?: string | null; since_date?: string | null; till_date?: string | null; requires_approval?: boolean;
  }) => call<TeamMembership>("add_team_membership", { input }),
  updateMembership: (membership: TeamMembership) => call<void>("update_team_membership", { membership }),
  removeMembership: (id: string) => call<void>("remove_team_membership", { id }),
membershipEditRequests: (membership_id?: string) => call<MembershipEditRequest[]>("list_membership_edit_requests", { membershipId: membership_id ?? null }),
requestMembershipEdit: (membership: TeamMembership, requested_by: string) => call<MembershipEditRequest>("request_membership_edit", { membership, requestedBy: requested_by }),
decideMembershipEdit: (id: string, approver_id: string, approve: boolean) => call<MembershipEditRequest>("decide_membership_edit", { id, approverId: approver_id, approve }),

  // Project role templates + per-project roles + team bindings (V92)
  projectRoleTemplates: () => call<ProjectRoleTemplate[]>("list_project_role_templates"),
  createProjectRoleTemplate: (input: { id?: string; code: string; name: string; description?: string | null; role_kind: ProjectRoleKind }) =>
    call<ProjectRoleTemplate>("create_project_role_template", { input }),
  archiveProjectRoleTemplate: (id: string, archived: boolean) => call<void>("archive_project_role_template", { id, archived }),
  projectRoles: (project_id?: string) => call<ProjectRole[]>("list_project_roles", { projectId: project_id ?? null }),
  /** Name and kind may be omitted only with a template: the server inherits them from it. */
  createProjectRole: (input: { id?: string; project_id: string; template_id?: string | null; name?: string | null; role_kind?: ProjectRoleKind | null }) =>
    call<ProjectRole>("create_project_role", { input }),
  archiveProjectRole: (id: string, archived: boolean) => call<void>("archive_project_role", { id, archived }),
  projectTeamRoles: (project_id?: string) => call<ProjectTeamRole[]>("list_project_team_roles", { projectId: project_id ?? null }),
  assignProjectTeamRole: (project_id: string, team_id: string, project_role_id: string) =>
    call<ProjectTeamRole>("assign_project_team_role", { projectId: project_id, teamId: team_id, projectRoleId: project_role_id }),
  removeProjectTeamRole: (project_id: string, team_id: string, project_role_id: string) =>
    call<void>("remove_project_team_role", { projectId: project_id, teamId: team_id, projectRoleId: project_role_id }),

  // Roles + rights
  roles: () => call<Role[]>("list_roles"),
  createRole: (input: { id?: string; name: string; description: string | null; parent_id: string | null; role_type?: string }) =>
    call<Role>("create_role", { input }),
  updateRole: (role: Role) => call<Role>("update_role", { role }),
  archiveRole: (id: string, archived: boolean) => call<void>("archive_role", { id, archived }),
  rights: () => call<Right[]>("list_rights"),
  rightGroups: () => call<RightGroup[]>("list_right_groups"),
  seedRights: () => call<number>("seed_rights"),
  roleRights: (role_id: string) => call<string[]>("list_role_rights", { roleId: role_id }),
  setRoleRights: (role_id: string, right_codes: string[]) =>
    call<void>("set_role_rights", { roleId: role_id, rightCodes: right_codes }),

  // Role assignments + authz check
  assignments: (profile_id?: string, team_id?: string) =>
    call<RoleAssignment[]>("list_role_assignments", { profileId: profile_id ?? null, teamId: team_id ?? null }),
  createAssignment: (input: {
    id?: string; role_id: string; profile_id?: string | null; team_id?: string | null; scope_type: ScopeType; scope_id?: string | null;
  }) => call<RoleAssignment>("create_role_assignment", { input }),
  deleteAssignment: (id: string) => call<void>("delete_role_assignment", { id }),
  checkRight: (profile_id: string, right_code: string, scope_type: ScopeType, scope_id: string | null) =>
    call<boolean>("check_right", { profileId: profile_id, rightCode: right_code, scopeType: scope_type, scopeId: scope_id }),

  // Projects (read-mostly here; Projects.tsx owns its own view)
  projects: () => call<Project[]>("list_projects"),
  // `owner` is the desktop-only escape hatch: local sqlite has no session to
  // mint `created_by` from, so the shell binds its local identity here. Web
  // passes nothing and the server stamps the session profile (and would
  // overwrite anything sent anyway).
  createProject(project: NewProject, owner?: string | null) {
    return submitProject("create", owner ? { ...project, created_by: owner } : project);
  },
  updateProject(project: Project) {
    return submitProject("update", project);
  },
  /** Narrow deadline write: sends only the project id and the date, so a stale
   *  project object in a view can never overwrite unrelated fields (H6). */
  /** `actor` is desktop-only: with no HTTP session, the local profile is the
   *  identity the owner-or-admin gate runs against. Web sends none — the server
   *  gate authorized the session before dispatch and ignores client claims. */
  setProjectDeadline: (project_id: string, deadline: string | null, actor?: string | null) =>
    call<Project>("set_project_deadline", { projectId: project_id, deadline, actorProfileId: actor ?? null }),
  /** Narrow *edit* of a deadline that is already there. Compare-and-set: `expected` is the
   *  value the view was showing, so an edit made elsewhere in the meantime refuses this one
   *  instead of being overwritten. Clearing is `deadline: null`. */
  updateProjectDeadline: (project_id: string, expected: string | null, deadline: string | null, actor?: string | null) =>
    call<Project>("update_project_deadline", { projectId: project_id, expectedDeadline: expected, deadline, actorProfileId: actor ?? null }),

  // Custom Fields engine
  cfDefinitions: (entity_type?: string) => call<CfDefinition[]>("list_cf_definitions", { entityType: entity_type ?? null }),
  createCfDefinition: (input: {
    id?: string; entity_type: string; cf_type: CfType; name: string;
    constraints_json?: string | null; default_json?: string | null; ordering?: number;
  }) => call<CfDefinition>("create_cf_definition", { input }),
  updateCfDefinition: (definition: CfDefinition) => call<CfDefinition>("update_cf_definition", { definition }),
  archiveCfDefinition: (id: string, archived: boolean) => call<void>("archive_cf_definition", { id, archived }),
  cfSetValue: (definition_id: string, entity_id: string, value_json: string) =>
    call<void>("cf_set_value", { definitionId: definition_id, entityId: entity_id, valueJson: value_json }),
  cfGetValues: (entity_type: string, entity_id: string) =>
    call<CfValueEntry[]>("cf_get_values", { entityType: entity_type, entityId: entity_id }),
};
