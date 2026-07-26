# Platform / Auth / Permissions & Org Structure — Knowledge Base

Domain: Workspaces, Organizations, Teams, Roles, Rights/Permissions, Authentication (login, 2FA, tokens, OAuth apps).
Sources: decompiled Android client (`~/Downloads/space-clients/android/jadx-out/sources/circlet/...`, Kotlin→Java via jadx, obfuscated field names but `@Metadata` `d1`/`d2` arrays preserve original Kotlin signatures/field names — used as primary evidence), live docs at jetbrains.com/help/space/*, jetbrains.com/help/space-on-premises/*.

---

## 1. Feature Overview

Space's permission system is **not project-only** — it is a 4-tier right system (Global / Project / Team / Profile / Channel / Document / DocumentFolder "RightType"s) applied through **Roles** (named bundles of Rights) which are assigned to members or teams **in a context** (org-wide = global, or scoped to one project/team/channel). This is materially more granular than typical SaaS RBAC (single global role per user) — Space supports per-project and per-team role overrides plus a request/approve workflow for both human members and third-party OAuth applications.

Key pillars found in source:
1. **Rights** (`circlet.common.permissions.Right`) — atomic permission unit, e.g. `ViewProject`, `EditRoles`, `CreateProjects`. ~150+ concrete Right classes found.
2. **Roles** (`circlet.client.api.RoleDTO` / `DTO_Role` / `TD_Role`) — named, ordered sets of Rights; predefined (System Admin, Member, Guest, Team Admin, Team Lead, Manager) or custom.
3. **Scopes/Contexts** (`circlet.permissions.scopes.*`, `PermissionContextApi`) — where a Role/Right applies: Global (org), a specific Project, a specific Team, a specific Chat Channel.
4. **Org / Workspace** (`circlet.workspaces.*`, `circlet.client.api.OrganizationRecord`) — the tenant/org container; on mobile client called a "Workspace" (one server URL + one logged-in org account = one Workspace).
5. **Teams** (`circlet.client.api.TD_Team`, `circlet.teams.*`) — the actual org-chart directory (hierarchical, parent/child), distinct from "Project Teams" (`ProjectTeam*`) which are project-scoped groups.
6. **Auth** (`circlet.client.api.auth.*`) — password/OAuth2/federated (SAML/LDAP) login modules, 2FA (TOTP + scratch codes + app passwords), permanent tokens (personal & application), OAuth2 flows, invitations, app-authorization/consent (appAuth), throttled-login brute-force protection.

---

## 2. Real Data Model (from decompile)

All field names below are the **original Kotlin names**, recovered from the `@Metadata(d2 = [...])` string table jadx preserves even when it obfuscates the actual JVM field/method names (e.g. `f27007a`). Package paths are given so gaia-space can mirror the structure.

### 2.1 Rights (`circlet.common.permissions`)

- **`Right`** (interface, extends `PlatformRight` from `circlet.platform.api.permissions`) — `Right.java`. Fields: `rightType: RightType`, `group: RightGroup`, `flags: Set<RightFlags>`, `targetActionIsActive: Boolean`, `grantedRights: List<Right>`, `rightTypeCode: String`, `code: RightCode` (typealias String), `featureFlag: FeatureFlag?`, `nameForExceptions`, `projectFeature: ProjectFeature?`, `defaultsPropagation: RightPropagation`, `optionalFeature: OptionalFeature?`.
- **`PlatformRight`** (`circlet.platform.api.permissions.PlatformRight`) — base: `title`, `description`, `uniqueCode: UniqueRightCode` (inline value class wrapping String, e.g. `"Global.Superadmin"`-style codes used in live-doc examples like `Project.Issues.Create`).
- **`RightType`** (`circlet.common.permissions.RightType.java`) — sealed class, concrete subtypes with `(moniker, targetName)`: **`Global`**("Global","Global"), **`Project`**("Project","Project"), **`Profile`**("Profile","Member profile"), **`Team`**("Team","Team"), **`Channel`**("M2","Channel"), **`Document`**("Document","Document"), **`DocumentFolder`**("DocumentFolder","Document Folder"). This is the scope taxonomy: every Right belongs to exactly one of these 7 contexts.
- **`RightGroup`** (`RightGroup.java`) — 56 named UI-grouping categories (each a singleton subclass with `title`+`priority`), matching Space's Admin UI permission-category headers, e.g.: `Members`, `MemberData`, `MemberLanguages`, `MemberLocations`, `MemberLocationsOnMap`, `MemberAbsences`, `MemberTeams`, `MemberAuthSessions`, `MemberWorkingDays`, `MemberConsents`, `MemberPermanentTokens`, `MemberNotificationSettings`, `TwoFactorAuthentication`, `EmailVerification`, `MemberCustomFields`, `MemberCredentials`, `MemberGoogleAccount`, `MemberBusinessEntities`, `MemberVacationPeriods`, `MemberWiFiCredentials`, `Teams`, `TeamMembers`, `Positions`, `Articles`, `ArticlesComments`, `Chat`, `Channels`, `DirectMessages`, `Application`, `Organization`, `BusinessEntities`, `Locations`, `EquipmentTypes`, `AbsenceTypes`, `GlobalCustomFields`, `GlobalDeploymentsRights`, `FeatureFlags`, `OnboardingHints`, `Loggers`, `Reactions`, `AuthenticationModules`, `Permissions`, `AccessControl`, `Project`, `CodeReviewComments`, `ProjectResponsibilities`, `PrivateProjects`, `VcsRepositories`, `PackageRepositories`, `Books`(deprecated→Documents), `Documents`, `Automation`, `ProjectParameters`, `ProjectSecrets`, `DevEnvironments`, `Hosting`, `ProjectTopics`, `CodeReview`, `VaultConnection`, `Internal`.
- **`RightFlags`, `RightPropagation`** — additional metadata enums (propagation = whether a right on a parent team/project auto-grants on children).
- **`PermissionRoleType`** (enum) — `PREDEFINED`, `CUSTOM`, `AUTHORIZABLE`, `ANONYMOUS`. Classifies a Role's origin/editability.
- **Concrete Right catalog** (`RightsKt.java`, static init blocks — this *is* the master right list, ~29 project rights + ~27 profile rights + 3 deployment rights + 2 admin rights + 47 global rights + document/repository rights). Representative real class names (each maps 1:1 to a live-doc permission label):
  - *Project-scope:* `ViewProject`, `AdminProject`, `ManageProjectPins`, `VcsRead`, `VcsWrite`, `VcsAdmin`, `PushCodeIssues`, `ViewResponsibilities`, `ManageResponsibilities`, `ViewAutomationExecution`, `AdminAutomationExecution`, `StartAutomationExecution`, `StopAutomationExecution`, `ViewSecretKeys`, `CreateSecrets`, `DeleteSecrets`, `EditSecrets`, `UseSecrets`, `ViewParameters`, `ModifyParameters`, `DeleteParameters`, `ViewCodeReview`, `CreateCodeReview`, `EditCodeReview`, `DeleteCodeReview`, `ViewVaultConnection`, `ModifyVaultConnection`, `DeleteVaultConnection`.
  - *Repository-scope:* `ReadRepository`, `WriteRepository`, `AdminRepository`, `WritePackages`, `DeletePackages`.
  - *Deployment:* `ReadDeployments`, `WriteDeploymentEvents`, `WriteDeployTargets`, `EditDeployTargetCustomFields` (global).
  - *Profile-scope (member self/HR data):* `ViewAbsences`, `ViewAbsenceReason`, `ViewAbsenceApproval`, `ApproveAbsences`, `EditAbsences`, `EditPastAbsences`, `ViewProfile`, `ViewProfileBasic`, `EditProfile`, `EditProfile2`, `DeleteProfile`, `ViewWorkingDays`, `EditWorkingDays`, `ViewLanguages`, `EditLanguages`, `ViewMemberLocations`, `EditMemberLocations`, `ViewMemberLocationMapPoints`, `ViewMemberMemberships`, `ViewPrivateCustomColumns`, `ViewRestrictedCustomColumns`, `EditAuthenticationSessions`, `EditOAuthConsents`, `CreatePermanentTokens`, `EditPermanentTokens`, `SetUpTwoFactorAuthentication`, `EditTwoFactorAuthentication`.
  - *Global-scope (org admin):* `AddCustomEmoji`, `AddNewExternalUser`, `AddNewProfile`, `AddNewTeam`, `AdminMaintenanceData`, `AuthorizeAppUnfurls`, `CreateProjects`, `EditAbsenceTypes`, `EditCustomFields`, `EditHints`, `EditLocations`, `EditOrganizationInfo`, `EditReactions`, `EditRoles`, `EditTodoTask`, `ImportArticles`, `ImportMessagesOld`, `ListPrivateProjects`, `ManageAuthModule`, `ManageEmojis`, `ManageExternalLinkPatterns`, `ManageStickers`, `ManageThrottledLogins`, `ManageUnfurlBlackList`, `OrgMember`, `ProvideExternalAttachmentUnfurls`, `ProvideExternalInlineUnfurls`, `PublishArticles`, **`Superadmin`**, `UnpublishArticles`, `UpdateOverdrafts`, `ViewAbsenceTypes`, `ViewAllExternalUsers`, `ViewArticles`, `ViewOrganizationInfo`, `ViewBouncedEmailData`, `ViewCustomEmojiList`, `ViewExternalLinkPatterns`, `ViewGrantedPermissions`, `ViewLocations`, `ViewMaintenanceData`, `ViewRoles`, `ViewTeams`, `ViewTodoTask`, `ViewUsageData`, `EditFeatureFlags`, `EditLoggers`.
  - *Documents:* `ViewFoldersMetadata`, `ViewDocuments`, `EditDocuments`, `ManageDocuments`, `ManageDocuments2`, `ArchiveDocuments`, `DeleteDocumentsForever`, `CreateDocuments`, `CreateBooks`, `ViewBook`, `ImportBooks`, `ViewBookItems`, `EditBookItems`, `AdministrateBook`.
  - Chat/planning/application rights exist in sibling `ChatRightsKt`, `PlanningRightsKt`, `ApplicationRightsKt` (not fully enumerated here; same pattern of one class per right).
- **Permission-check surface** (`circlet.permissions.PermissionsVm.java`) — the actual runtime API the UI calls: `hasPermission(profile, ProfileRight)`, `hasPermissionGlobally(Right)`, `hasAnyPermissionGlobally(Right...)`, `hasPermissionUnsafe(team, rightCode:String)`, per-team `TeamRight` check taking `Ref<TD_Team>`, per-project `hasPermission(PR_ProjectComplete, ProjectRight): Boolean` (`J0` in obfuscated form), `hasPermissionForAtLeastOneMember/Team(memberships: List<TD_Membership>)`, `isExistingPermission(rightUniqueCode)`. Confirms 4 distinct right subtypes actually checked at runtime: `Right` (global), `ProjectRight`, `TeamRight`, `ProfileRight`.

### 2.2 Roles (`circlet.client.api`, `circlet.permissions.roles`)

- **`TD_Role`** (`TD_Role.java`, `ARecord`) — the raw DB record: `id: TID`, `name: String`, `parent: Ref<TD_Role>?` (roles can be hierarchical/derived), `archived: Boolean`, `arenaId`.
- **`RoleDTO`** (`RoleDTO.java`) — API-facing shape: `roleId: TID`, `type: PermissionRoleType`, `code: String?`, `name: String`, `description: String?`, `membersEditable: Boolean`, `rightsEditable: Boolean?`.
- **`DTO_Role`** (`DTO_Role.java`) — richer/admin-UI shape: `roleId`, `title`, `fullTitle`, `code: String?`, `category: String?`, `editable: Boolean`, `resetToDefaultsAvailable: Boolean`, `featureFlag: FeatureFlagInfo?`, `rights: List<DTO_Right>`.
- **`GlobalRole`** (`GlobalRole.java`, sealed) — the 4 built-in **global** org roles a member account can hold: **`GlobalAdmin`**, **`GlobalMember`**, **`Guest`**, **`LightGuest`** (feature-flagged). This is the enum actually stored per-membership; distinct from the richer named "System Admin / Member / Guest" labels shown in the Admin UI (UI maps `GlobalAdmin→System Admin`, `GlobalMember→Member`, `Guest→External User/Collaborator`, `LightGuest→Light Guest`).
- **`RoleArena`** — arena/event-source for role CRUD (arena pattern = Space's reactive-record sync mechanism, every mutable entity type has an `*Arena`).
- **Team-specific role wiring:** `TeamRights` / `DTO_TeamRights` / `TeamWithRights{team: TID, rights: List<String>}` / `TeamPermissionContext` / `TeamPermissionContextIdentifier` / `TeamPermissionTarget` — a team can itself be *granted* rights (e.g., a team gets Project rights on a project), separate from *members-of-team-get-a-role* semantics.
- **Project-specific roles:** `ProjectRoleIn`, `ProjectMemberRoleIn`, `ProjectAdministratorRoleIn`, `ProjectCustomRoleIn`, `ProjectExternalRoleIn`, `ProjectRoleApi`/`ProjectAdminRoleApi`/`ProjectMemberRoleApi`/`ProjectCustomRoleApi`/`ProjectExternalRoleApi`, `ProjectTeamRole` — confirms per-project role templates exist independently of the 6 org-level predefined roles (matches live doc "Project Templates" role editor).
- **Live-doc cross-check** (`roles-comparison.html`): the 6 predefined roles are **System Admin, Team Admin, Team Lead, Manager, Member, External User (Collaborator or Guest)**. Sample matrix rows confirm granular per-right-per-role assignment exactly matching the decompiled Right catalog, e.g. "View member profile basic info" / "View member profiles" / "Add members (new account)" / "Update member profiles" / "Delete member profiles" / "Edit locations" / "View absence reasons" (blue=own only, orange=team-scoped) / "Approve absences" / "Manage authentication sessions" / "Create/Manage permanent tokens" / "Set up/Manage two-factor authentication" — each row is one `Right` subclass above.
- (`configure-roles.html`): System Admin & External User roles are **not editable**; Member, Team Admin, Manager are editable; **Project Role Templates** exist separately and only affect projects created after the template edit (matches `ProjectRoleIn`/`ProjectCustomRoleIn` template classes).

### 2.3 Permission Contexts / Scopes (`circlet.permissions.scopes`, `circlet.permissions.appAuth`, `circlet.client.api`)

- **`ScopeInContext`** — `context: PermissionContextApi`, `permissions: List<RightDescriptorDTO>`, `expanded: MutableProperty<Boolean>` (UI expand state).
- **`PermissionContextData`** — UI display shape for a context row: `icon`, `location` (deep link), `title`/`titleCaps`, `kind`/`kindCaps`, `kindName`/`kindNameCaps` (i.e. "Project", "Team", "Channel" labels).
- **`XScopeVm`, `ScopeInContext`, `PermissionContextApiExKt`** — reactive VM for browsing "what am I authorized for, in which contexts" (used both for the member's own permission inspector and for app-authorization review screens).
- **App/OAuth authorization model** (`circlet.permissions.appAuth`): `AppAuthContextsVm` (per-app, list of authorized contexts), `AppAuthInContextVm` (rights within one context: approve/deny individual rights, `approveAll`, `updateRightStatus`), `RightOrGroup` (sealed: `Right(RightWithDependencies)` | `Group(name)` — UI can request/display either one right or a named bundle), `RightWithDependencies` (a right plus the other rights it implies), `AuthorizationAction`, `RequiredRightsCountVm`, `AppPermissionsAllowedOpsVm`. This directly implements the live-doc **"Request Permissions"** workflow (global vs per-project vs per-channel app authorization, approve/deny by an admin).
- Live-doc confirms exact wire format: **scope string = `<context>:<permission>`**, e.g. OAuth scope param `project:key:MY-APP:Project.View project:key:MY-APP:VcsRepository.Read`; REST `request-rights` payload `{"contextIdentifier":"project:key:MY-APP","rightCodes":["Automation.Execution.View","Project.CodeReview.View"]}` or `{"contextIdentifier":"global","rightCodes":["Project.Issues.Create"]}`. Only a **System Admin** can grant global rights; only a **Project Admin** can grant rights within their project; only a channel admin can grant channel rights.

### 2.4 Organization / Workspace (`circlet.workspaces`, `circlet.client.api`)

- **`OrganizationRecord`** (`ARecord`) — `id`, `orgId`, `name`, `slogan: String?`, `logoId: String?`, `onboardingRequired: Boolean?`, `allowDomainsEdit: Boolean?`, `arenaId`, `createdAt: Long?`, `createdWithNavigationV2: Boolean?`, `timezone: ATimeZone?`, `orgSize: OrgSizeDTO?`, `orgIndustry: OrgIndustryDTO?`, `sendAnonymousDataAgreementAccepted: Boolean?`, `marketplaceEnabled: Boolean?`.
- **`OrgSettings`** — `availableRightsCodes: List<String>`, `isSpaceCode: Boolean?`, `isSpaceCodeOnly: Boolean?` (feature-flag-driven right availability per org plan/tier).
- **`OrgVm` / `OrgVmImpl` / `OrgSettingsVm` / `OrgSettingsVmImpl`** — reactive VMs wrapping the above for the client UI; `OrgVmImpl` also exposes `licenseId`, `activationUrl` (on-prem license activation flow).
- **`OrgDomainStatus` / `OrgDomainDTO`** — verified-domain-based auto-join/signup config (matches `modules/SignUpWithEmailDomain.java`, `ES_AuthModuleSettings` `registerNewUsers`).
- **Workspace = one client-side "logged in session against one org"**: `Workspace` (interface, huge aggregate root of ~40 sub-VMs: `orgVm`, `orgSettingsVm`, `permissions: PermissionsVm`, `featureFlags: FeatureFlagsVm`, `profileSettings`, `chatVm`, etc.) and `WorkspaceState` (persisted/restorable slice: `profile: TD_MemberProfile`, `token: TokenInfo`, `profilePic`, `preferredLanguage`, `englishLanguage`, `navBarMenuItems`, `navBarProjects`, `typographySettings`, `firstDayOfWeek`, `darkTheme`, `themeName`, `todoFilters`). `WorkspaceManager` manages the (potentially multiple) `Workspace`s the client is logged into, each keyed by server URL (`WorkspaceConfiguration`) — i.e. multi-org support is a first-class client concept (switch between orgs = switch Workspace), not just a single tenant assumption.
- **`ApiVersionsVm` / `ApiFlagsFetcher` / `ApiFlagsVmKt`** — server capability negotiation (on-prem servers may run older API versions; client checks `ifApiFlagGranted`/`isFeatureEnabled` before using newer endpoints) — important for gaia-space if it ever needs to support "older server" compatibility shims.

### 2.5 Teams & Members (`circlet.client.api`, `circlet.teams`)

- **`TD_Team`** (`ARecord`) — `id`, `name`, `description`, `parent: Ref<TD_Team>?` (hierarchical sub-teams), `emails: Array<String>?`, `channelId: String?` (every team has an associated chat channel), `archived: Boolean`, `disbanded: Boolean?`, `disbandedAt`, `externalId: String?`, `defaultManager: Ref<TD_MemberProfile>?`, `arenaId`.
- **`TD_Membership`** (`ARecord`) — the join entity member↔team↔role: `id`, `member: Ref<TD_MemberProfile>`, `team: Ref<TD_Team>`, `role: Ref<TD_Role>`, `lead: Boolean` (is this membership the team's lead), `manager: Ref<TD_MemberProfile>?`, `since/till: KotlinXDate?`, `activeSince/activeTill: KotlinXDateTime?`, `requiresApproval: Boolean`, `archived: Boolean`, `editFor/pendingEdit/approver: Ref?` (pending-edit-approval workflow for HR-sensitive membership changes), `arenaId`. **This single record is the answer to "how are Team+Role+Member related"**: a membership always carries a `TD_Role` reference — i.e. a member's Role is assigned *per team-membership*, not purely globally (global role is the separate `GlobalRole` on the profile).
- **`TD_MemberProfile`** (`ARecord`, data class) — `id`, `username`, `name: TD_ProfileName`, `speaksEnglish: Boolean`, `smallAvatar/avatar/profilePicture: String?`, `languages: List<TD_ProfileLanguage>`, `archived: Boolean`, `notAMember: Boolean` (true for non-org contacts, e.g. external unfurl authors), `suspended: Boolean?`, `suspendedAt: KotlinXDateTime?`, `joined: KotlinXDate?`, `leftAt: KotlinXDateTime?`, `external: Boolean?` (guest/collaborator flag), `externalLight: Boolean?` (light-guest flag), `arenaId` (defaults to `"People"` arena).
- **Team location/map features** (`circlet.teams.LocationMapVM`, `MapItem`/`MarkedMapItem`/`NumberedMarkedMapItem`/`UnmarkedMapItem`) — org chart can be visualized as a physical office floor-plan map with member pins (`circlet.features.Locations`-flagged feature); out of scope for typical SaaS clone but notable JetBrains-Space-specific feature.
- **Project Teams are a separate concept** (`ProjectTeam`, `ProjectTeamRecord`, `ProjectTeamMemberRecord`, `ProjectTeamRole`, `ProjectTeamType`, `ParticipantTeamOnProject`) — a project can attach one or more "Teams" (from the org directory) as participants with a per-project role, distinct from the global Team directory hierarchy.

---

## 3. Auth Flows (decompile + live docs)

### 3.1 Access-token methods (`authentication-and-authorization.html`)
Space supports exactly these token-acquisition methods (table on the live doc, on behalf-of column noted):
1. **Permanent token** (user or application) — never expires, "not recommended", used mainly for dev/testing.
2. **OAuth 2.0 Authorization Code flow** (+ refresh token) — user, server-side web apps.
3. **OAuth 2.0 Client Credentials flow** — application acting for itself (e.g. chatbots).
4. **OAuth 2.0 Implicit flow** — user, **deprecated**.
5. **OAuth 2.0 Resource Owner Password Credentials flow** — user, "not recommended", enabled by default for all registered apps.

### 3.2 Password / Federated / OAuth2 login modules (`circlet.client.api.auth.modules`)
- **`AuthModules`** Api — `createAuthModule(key, name, enabled, iconDataURI, settings)`, `authModules(withDisabled)`, `updateAuthModule(...)`, `deleteAuthModule`, `reorderAuthModules`, `usages(): List<AuthModuleUsage>`, `getConfig()/setConfig(dontRememberMeTtl, adminRememberMeTtl, userRememberMeTtl)`, `resetConfig()`. Admin can configure **multiple simultaneous login modules**, reorder them (login-page button order), and set differentiated "remember me" TTLs for admins vs regular users.
- **`ES_AuthModuleSettings`** (base interface): `getUrl()`, `registerNewUrls`/`registerNewUsers: Boolean?`.
- **`ES_PasswordAuthModuleSettings`** (base for password-style modules) → **`ES_ExternalPasswordAuthModuleSettings`** (LDAP/AD-style): `serverUrl`, `changePasswordUrl`, `connectionTimeout: Int`, `readTimeout: Int`, `sslKeystore: SSLKeystore?`, `teamMappings: List<ES_TeamMapping>` (auto-assign external users to teams based on directory group).
- **`ES_FederatedAuthModuleSettings`** → **`ES_OAuth2AuthModuleSettings`**: `clientId`, `clientSecret`, `registerNewUsers: Boolean?` — generic OAuth2/OIDC identity-provider module (Google/GitHub/GitLab/JetBrains Account style SSO all implemented as instances of this).
- **`ES_HiddenAuthModuleSettings`** — module not shown on public login page (e.g. internal-only SSO).
- **`ProfileLoginsRecord` / `ES_ProfileLogin` / `ES_ProfileLoginDetails` / `ES_DefaultProfileLoginDetails`** — per-member linked-login records (a member can have multiple logins across modules, detachable via `detachProfileLogin`).
- **`AuthConfig`** — global auth config object (remember-me TTLs etc., set via `AuthModules.setConfig`).
- **`AuthModules.Flags.RegisterNewUserRules`** — on-prem-version-gated feature flag for fine-grained "who can self-register" rules.

### 3.3 Two-Factor Authentication (`circlet.client.api.auth.twoFA`)
- **`TwoFactorAuthenticationStatus`** (enum): `NOT_SETUP`, `INACTIVE`, `ACTIVE`.
- **`TwoFactorAuthenticationRequirement`** (sealed): `NotRequired` | `Required` — org-level policy of whether 2FA is mandatory.
- **`TwoFactorAuthenticationSecret`** — `secretKey: String`, `qrCode: QRCode`, `scratchCodes: List<String>` (standard TOTP enrollment: secret + QR + one-time backup/scratch codes).
- **`TwoFactorAuthentications`** (Api surface, name inferred from package), **`Profile2FAStatusRecord`/`Profile2FAStatusArena`**, **`Profile2FARequirement`** — per-member 2FA status tracking separate from org policy.
- **`ES_ApplicationPassword` / `ApplicationPasswords`** — app-specific passwords issued when 2FA is enabled (for legacy Git/Basic-auth clients that can't do interactive 2FA) — mirrors the live-doc roles-comparison row "Set up two-factor authentication. **Create application passwords.**"

### 3.4 Permanent Tokens (`circlet.client.api.auth.permanentTokens`, `circlet.permissions.permTokens`)
- **`ES_PermanentToken`** (base) → **`ES_PersonalToken`**: `profile: Ref<TD_MemberProfile>`, `scope: String`, `apiScope: XScopeApi`, `created/expires: KotlinXDateTime?`, `lastAccess: AccessRecord?`. → **`ES_ApplicationPermanentToken`**: same shape but `application: Ref<ES_App>` instead of `profile`. Confirms **both personal (user) and application** permanent tokens share one base type differing only in the "owner" reference — matches live-doc "permanent token: On behalf of = User or application".
- **`PersonalPermanentTokens` / `ApplicationPermanentTokens`** — Api surfaces (create/list/revoke) per owner type.
- **`PermanentTokenListVM`** (base) → **`PersonalPermanentTokenListVM`**, **`ApplicationPermanentTokenListVM`** — list/create/revoke/update VM, `NewPermanentTokenVM`, `ExistingPermanentTokenVM`.
- Scope format matches OAuth scope format (`<context>:<permission>`), confirmed by shared `XScopeApi`/`apiScope` field on the token record.

### 3.5 OAuth Apps / Mobile Auth (`circlet.client.api.auth.mobileTokens`, `appAuth`)
- **`AuthorizationQRCodes`** Api — `createAuthorizationQRCode(lifetime, clientId)`, `buildAuthorizationQRCode(code, scope, baseUrl)`, `buildDownloadQRCode(url)` — QR-code-based mobile app pairing/login flow (scan QR on desktop-authenticated session to auth the mobile app, or scan to download the app).
- App authorization/consent model detailed in §2.3 above (`appAuth` package) — this is what backs the live-doc "Request Permissions" (global vs per-context app authorization, admin approve/deny).

### 3.6 Invitations (`circlet.client.api.auth.invite`)
- **`Invitation`** (`ARecord`) — single-use, targeted at one email: `id`, `expiresAt`, `inviteeEmail`, `inviteeEmailBlocked: Boolean` + `inviteeEmailBlockedReason: String?` (bounce/complaint suppression), `inviteeFirstName/LastName`, `invitee: Ref<TD_MemberProfile>?` (once accepted), `inviter: CPrincipal`, `team: Ref<TD_Team>?`, `role: Ref<TD_Role>?`, `project: Ref<PR_Project>?`, `projectRole: ProjectTeamRole?`, `globalRole: GlobalRole?`, `revoked: Boolean?`. I.e. **an invitation can pre-assign team + role + project + project-role + global-role all at once**.
- **`InvitationLink`** — reusable multi-use invite: `name`, `createdBy: CPrincipal`, `createdAt/expiresAt`, `inviteeLimit: Int`, `inviteeUsage: Int` (usage cap/counter), same team/position/project/globalRole/projectRole targeting fields as `Invitation`, `link: String?`, `deleted: Boolean`.
- **`AcceptedInvitationLink` / `AcceptedInvitationLinkCounter` / `AcceptedInvitationLinkArena`** — audit trail of who joined via which link.

### 3.7 Login Throttling (`circlet.client.api.auth.login`)
- **`ThrottledLogin`** — `login: String`, `throttledUntil: KotlinXDateTime` (brute-force lockout record, keyed by login/username, not IP).
- **`OrgThrottlingStatus` / `ThrottledLogins`** — org-wide list/status Api for admins to view/clear throttled accounts.

### 3.8 OAuth Token Model (`circlet.platform.api.oauth`)
- **`TokenInfo`** (implements `TokenSource`) — `accessToken: String`, `expires: KDateTime?`, `refreshToken: String?`, `logoutUrl: String` — the concrete client-side session token shape, including refresh-token support and a server-provided `logoutUrl` (single-logout-URL pattern, relevant if gaia-space ever federates logout across an on-prem SSO IdP).

---

## 4. Overall Architecture (on-prem service breakdown)

From the still-live Docker Compose install guide (`space-on-premises/docker-compose-installation.html`, confirmed reachable):

- **Deployment unit**: single `docker-compose.yml` fetched from `https://assets.on-premises.service.jetbrains.space/<version>/docker-compose.yml`, brought up with `docker-compose -p space-on-premises up -d`.
- **Exposed service endpoints** (default local ports):
  - `http://127.0.0.1:8084` — **Space application** (main web frontend / "Space app" service, config file `space.on-premises.conf`, has `frontend{url, internalUrl, altUrls}` config block; internal container path `/home/space/circlet-server-onprem/`).
  - `http://127.0.0.1:8080` — **VCS API** (Git hosting HTTP API; config `vcs.on-premises.properties`, `base.url`/`circlet.url.ext`; container path `/home/space/git/vcs-hosting/`).
  - `ssh://127.0.0.1:2222` — **VCS SSH** (git-over-ssh, same VCS service).
  - `http://127.0.0.1:8390` — **Packages API** (package registry service; config `packages.on-premises.conf`, has its own `space{url, internalUrl}` block; container path `/home/space/packages-server/`).
  - **Lang-service** — code-intelligence/language server backend, config `langservice.on-premises.conf`, container path `/home/space/langservice-server/` (no public port listed in the quick-start; internal-only service consumed by the Space app for code review syntax/semantic features).
- **`init-configs`** — a one-shot init container/service (`docker-compose -p space-on-premises up init-configs`) that materializes the four `.conf`/`.properties` files above into a shared `config` volume before the real services start.
- **Default admin bootstrap**: default URL `http://127.0.0.1:8084`, default credentials `admin`/`admin` on first run.
- **Backing stores** — the guide explicitly recommends running **Postgres, Elasticsearch, and a MinIO-compatible object store as external/managed services** for any non-POC deployment (implying the bundled compose file runs them as regular containers by default for the proof-of-concept case). **Redis** and exact container/service names for Postgres/Elasticsearch/MinIO were **not enumerated in the fetched page text** (the doc references them only descriptively, not by compose service name) — do not treat as confirmed; would need the actual `docker-compose.yml` contents (which require a version-specific download from `assets.on-premises.service.jetbrains.space`, not fetched here) to get exact service names/images.
- **Mail**: no bundled mail server by default; guide shows adding a `mailhog` service + `mail{outgoing{...}}` block in `space.on-premises.conf` to enable transactional email (invitations, notifications).
- **Networking**: all services share a Docker network (`frontend` network referenced when adding mailhog); base URLs for multi-host deployment must be changed in 3 places (`space.on-premises.conf` frontend block, `packages.on-premises.conf` space block, `vcs.on-premises.properties` base.url/circlet.url.ext) — i.e. **no single reverse-proxy/gateway config**; each service tracks its own external URL.
- **License activation** — confirmed in decompile: `OrgVmImpl` exposes `licenseId` and `activationUrl`, matching the live doc's post-install "Activate your Space On-Premises instance" step.
- Mapping to decompiled client concepts: "Space application" ⇒ everything under `circlet.client.api.*` (GraphQL/HTTP RPC surface consumed by this client) + the Workspace/Org/Permissions/Team/Auth models documented above; "VCS" ⇒ `VcsRead/VcsWrite/VcsAdmin` rights + `PR_ProjectComplete` repo settings; "Packages" ⇒ `WritePackages/ReadRepository/DeletePackages/AdminRepository` rights + `PackageRepositories` right-group; "Lang-service" ⇒ backs `CodeReview`/`CodeReviewComments` right-groups' underlying diff/syntax features (no direct client API surface found under the auth/permissions domain).

---

## 5. gaia-space Gap Analysis

Checked: `lib/ui/screens/auth/{login_screen.dart,register_screen.dart}`, `lib/core/services/auth_service.dart` (356 lines), `lib/core/models/{user.dart,workspace.dart}`, `lib/ui/screens/home/workspace_screen.dart` (1454 lines, greped for role/team/member/permission).

### HAVE (partial UI shell only, no real backend semantics)
- **Basic login/register screens** (`login_screen.dart`, `register_screen.dart`) — username/password form UI only.
- **`AuthService`** — entirely mock: `_useMockAuth = true` hardcoded; `login()`/`register()` fabricate a local `User` + a **fake unsigned JWT** (`header.payload.mock_signature` — no real signature, no server call); token stored via `flutter_secure_storage` (skipped entirely on web); `JwtDecoder.isExpired` used only to check the mock token's own fabricated `exp`. Real-API path is a stubbed `throw UnimplementedError`.
- **`User` model** — `id, username, email, displayName, avatarUrl, createdAt, lastLogin, roles: List<String>` with `hasRole()`/`isAdmin` helpers — a flat string-list role model, no scoping, no per-team/per-project role, no rights/permissions granularity at all.
- **`Workspace` model** — `id, name, description, createdBy, createdAt, membersCount, channelsCount, avatarUrl` — a shallow "team/org" stand-in; no org settings, no billing/tier, no domain/SSO config, no multi-role membership list (`membersCount` is just an int, not a members collection).
- **`workspace_screen.dart`** member list — **hardcoded demo data**: `_buildMemberTile(context, 'John Doe', 'Admin', ...)`, `'Jane Smith', 'Member'`, `'Alex Johnson', 'Member'`; role is a **free-text string** passed straight to a widget (`role == 'Admin' ? ... `), not backed by any Role/Right model. "Manage Members" / "Add Member" buttons exist but are UI-only stubs (`tooltip` only, no handler wired to a permission check).

### MISSING (no equivalent found anywhere in lib/)
- **Any Right/Permission model** — no enum/class for individual permissions, no RightGroup/RightType taxonomy, no per-context (global/project/team/channel) scoping.
- **Any Role model beyond a raw string** — no predefined-roles set (System Admin/Team Admin/Team Lead/Manager/Member/External User), no custom-role CRUD, no role-to-rights mapping, no role editability rules (some roles non-editable).
- **Team directory / org-chart** — no hierarchical Team entity (parent/child teams), no `TD_Membership`-equivalent join model connecting member+team+role+lead/manager+since/till+approval workflow. Current "workspace" conflates Slack-style workspace with Space's Team directory; Space's actual Teams (org chart) and Workspaces (org/tenant) are different concepts gaia-space has not separated.
- **Membership approval workflow** — no pending-edit/approver concept (`editFor`/`pendingEdit`/`approver` in `TD_Membership`).
- **Org/Workspace settings model** — no `OrganizationRecord`-equivalent (slogan, logo, org size/industry, domain policy, onboarding flags, license/activation, timezone).
- **Multi-org / multi-workspace client session** — no `WorkspaceManager`-equivalent; app assumes a single logged-in identity, no concept of switching between multiple orgs/servers.
- **Real authentication backend integration** — no HTTP calls at all; no password hashing/verification server-side reference, no session/token issuance beyond a fabricated unsigned string.
- **2FA** — completely absent (no TOTP secret/QR/scratch-codes, no status enum, no org-level required/not-required policy, no application passwords for legacy clients).
- **Permanent tokens (personal or application)** — absent (no token list/create/revoke UI or model, no scope string format).
- **OAuth2 flows** — absent (no Authorization Code / Client Credentials / Implicit / ROPC flow implementations, no OAuth app registration, no consent screen, no scope string parsing `<context>:<permission>`).
- **Federated/external auth modules** — absent (no SSO/OAuth2-IdP module config, no LDAP/AD external-password module, no multi-module login page with reordering, no per-role remember-me TTL).
- **Invitations** — absent (no single-use email invite or reusable invite-link model; no pre-assignment of team/role/project/project-role/global-role at invite time; no invite acceptance/expiry/usage-cap tracking).
- **App/OAuth authorization & consent management** (appAuth) — absent (no per-app authorized-context list, no approve/deny individual right, no request-rights workflow, no "requested" pending state).
- **Login throttling / brute-force protection** — absent (no throttled-login record, no admin view to clear lockouts).
- **Permission-check API surface** — absent (`AuthService`/`User` have no `hasPermission(context, right)`-style call anywhere; UI role checks are ad-hoc string comparisons, e.g. `role == 'Admin'` in `workspace_screen.dart`).
- **API/feature-flag version negotiation** — absent (no `ApiVersionsVm`/`ApiFlagsFetcher`-equivalent for graceful degradation against older/on-prem servers, relevant if gaia-space ever targets self-hosted deployments).

### Priority notes for parity work (not asked for, but evident from the gap size)
The single biggest structural gap is that gaia-space has **no Right/Role/Scope model at all** — everything permission-related is either absent or a free-text string (`User.roles: List<String>`, member-tile `role` string). Given Space's model is fundamentally "Right × Context (Global/Project/Team/Channel) × Role(bundle of Rights) × Membership(member+team+role)", any parity work should introduce that 4-part model before attempting to replicate individual screens (Roles admin page, Team directory, App authorization page, etc.), since every one of those screens is a view over this same underlying data model.
