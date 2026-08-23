//! Canonical authorization vocabulary. String codes are only storage/API values; callers use `Right`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Right {
    CreateIssue,
    EditIssue,
    CreateDocument,
    EditDocument,
    PostMessage,
    ManageChannel,
    Superadmin,
    EditRoles,
    CreateDevEnvironment,
    ManageDevEnvironmentsInProject,
    JoinHotPoolDevEnvironments,
}
impl Right {
    pub const fn code(self) -> &'static str {
        match self {
            Self::CreateIssue => "Project.CreateIssues",
            Self::EditIssue => "Project.EditIssues",
            Self::CreateDocument => "Document.CreateDocuments",
            Self::EditDocument => "Document.EditDocuments",
            Self::PostMessage => "Channel.PostMessages",
            Self::ManageChannel => "Channel.ManageChannel",
            Self::Superadmin => "Global.Superadmin",
            Self::EditRoles => "Global.EditRoles",
            Self::CreateDevEnvironment => "Project.CreateDevEnvironments",
            Self::ManageDevEnvironmentsInProject => "Project.ManageDevEnvironmentsInProject",
            Self::JoinHotPoolDevEnvironments => "Project.JoinHotPoolDevEnvironments",
        }
    }
}

pub const CATALOG: &[(&str, &str, &str, &str, &str)] = &[
    (
        "Project.CreateDevEnvironments",
        "Create dev environments",
        "Rd.Workspaces.Create — create dev environments in the project.",
        "Project",
        "DevEnvironments",
    ),
    (
        "Project.ManageDevEnvironmentsInProject",
        "Manage dev environments of all project members",
        "Rd.Workspaces.Manage — hibernate, resume or delete environments owned by others.",
        "Project",
        "DevEnvironments",
    ),
    (
        "Project.ViewDevEnvironmentsInProject",
        "View dev environments the user does not own",
        "Rd.Workspaces.View.",
        "Project",
        "DevEnvironments",
    ),
    (
        "Project.JoinHotPoolDevEnvironments",
        "Join standby dev environments",
        "Rd.Workspaces.Unattended.Join — claim a pre-warmed environment and become its owner.",
        "Project",
        "DevEnvironments",
    ),
    (
        "Project.ConnectDevEnvironments",
        "Connect to a dev environment",
        "Rd.Workspaces.Connect — open an IDE session against a running environment.",
        "Project",
        "DevEnvironments",
    ),
    (
        "Project.WarmupDevEnvironments",
        "Manage warm-up snapshots",
        "Rd.Workspaces.Warmup — configure and trigger warm-up builds.",
        "Project",
        "DevEnvironments",
    ),
    (
        "Global.ViewDevEnvironmentSettings",
        "View dev environment settings",
        "Rd.Settings.View — organization dev-environment settings such as the default IDE version.",
        "Global",
        "DevEnvironments",
    ),
    (
        "Global.EditDevEnvironmentSettings",
        "Edit dev environment settings",
        "Rd.Settings.Edit.",
        "Global",
        "DevEnvironments",
    ),
    (
        "Global.EditDevEnvironmentPolicy",
        "Edit dev environment cloud policy",
        "Rd.Policy.Edit — instance types and cloud policy available to the organization.",
        "Global",
        "DevEnvironments",
    ),
    (
        "Global.ViewDevEnvironmentDebugData",
        "View dev environment debug data",
        "Rd.DebugData.View — troubleshooting reports and environment logs.",
        "Global",
        "DevEnvironments",
    ),
    (
        "Global.Superadmin",
        "Superadmin",
        "Full organization administration.",
        "Global",
        "Permissions",
    ),
    (
        "Global.CreateProjects",
        "Create projects",
        "Create new projects in the organization.",
        "Global",
        "Project",
    ),
    (
        "Global.AddNewProfile",
        "Add member profile",
        "Add a new member account.",
        "Global",
        "Members",
    ),
    (
        "Global.AddNewTeam",
        "Add team",
        "Create a new team in the org directory.",
        "Global",
        "Teams",
    ),
    (
        "Global.EditRoles",
        "Edit roles",
        "Create/edit custom roles and their rights.",
        "Global",
        "Permissions",
    ),
    (
        "Global.ViewRoles",
        "View roles",
        "View the roles catalog.",
        "Global",
        "Permissions",
    ),
    (
        "Global.ViewTeams",
        "View teams",
        "View the team directory.",
        "Global",
        "Teams",
    ),
    (
        "Global.EditOrganizationInfo",
        "Edit organization info",
        "Edit org name/logo/settings.",
        "Global",
        "Organization",
    ),
    (
        "Global.ViewOrganizationInfo",
        "View organization info",
        "View org name/logo/settings.",
        "Global",
        "Organization",
    ),
    (
        "Global.ManageAuthModule",
        "Manage auth modules",
        "Configure login modules.",
        "Global",
        "AuthenticationModules",
    ),
    (
        "Global.EditCustomFields",
        "Edit global custom fields",
        "Manage cross-entity custom field definitions.",
        "Global",
        "GlobalCustomFields",
    ),
    (
        "Global.OrgMember",
        "Organization member",
        "Baseline membership right held by every account.",
        "Global",
        "Members",
    ),
    (
        "Project.ViewProject",
        "View project",
        "View a project and its contents.",
        "Project",
        "Project",
    ),
    (
        "Project.AdminProject",
        "Administer project",
        "Manage project settings and membership.",
        "Project",
        "Project",
    ),
    (
        "Project.VcsRead",
        "Read repository",
        "Read a project's Git repositories.",
        "Project",
        "VcsRepositories",
    ),
    (
        "Project.VcsWrite",
        "Write repository",
        "Push to a project's Git repositories.",
        "Project",
        "VcsRepositories",
    ),
    (
        "Project.VcsAdmin",
        "Administer repository",
        "Manage repository settings/branch protection.",
        "Project",
        "VcsRepositories",
    ),
    (
        "Project.ViewCodeReview",
        "View code review",
        "View merge requests/code reviews.",
        "Project",
        "CodeReview",
    ),
    (
        "Project.CreateCodeReview",
        "Create code review",
        "Open merge requests/code reviews.",
        "Project",
        "CodeReview",
    ),
    (
        "Project.EditCodeReview",
        "Edit code review",
        "Edit/merge code reviews.",
        "Project",
        "CodeReview",
    ),
    (
        "Project.ViewSecretKeys",
        "View secrets",
        "View project secret names.",
        "Project",
        "ProjectSecrets",
    ),
    (
        "Project.CreateSecrets",
        "Create secrets",
        "Create project secrets.",
        "Project",
        "ProjectSecrets",
    ),
    (
        "Project.ViewParameters",
        "View parameters",
        "View automation parameters.",
        "Project",
        "ProjectParameters",
    ),
    (
        "Project.ModifyParameters",
        "Modify parameters",
        "Edit automation parameters.",
        "Project",
        "ProjectParameters",
    ),
    (
        "Team.ViewTeamMembers",
        "View team members",
        "View a team's member list.",
        "Team",
        "TeamMembers",
    ),
    (
        "Team.ManageTeamMembers",
        "Manage team members",
        "Add/remove team members.",
        "Team",
        "TeamMembers",
    ),
    (
        "Team.EditTeam",
        "Edit team",
        "Edit team name/description/parent.",
        "Team",
        "Teams",
    ),
    (
        "Team.DeleteTeam",
        "Delete team",
        "Archive/delete a team.",
        "Team",
        "Teams",
    ),
    (
        "Profile.ViewProfile",
        "View profile",
        "View a member's full profile.",
        "Profile",
        "Members",
    ),
    (
        "Profile.ViewProfileBasic",
        "View basic profile",
        "View a member's basic info.",
        "Profile",
        "Members",
    ),
    (
        "Profile.EditProfile",
        "Edit profile",
        "Edit a member's profile.",
        "Profile",
        "Members",
    ),
    (
        "Profile.DeleteProfile",
        "Delete profile",
        "Remove a member profile.",
        "Profile",
        "Members",
    ),
    (
        "Profile.ViewAbsences",
        "View absences",
        "View a member's absences.",
        "Profile",
        "MemberAbsences",
    ),
    (
        "Profile.EditAbsences",
        "Edit absences",
        "Edit a member's absences.",
        "Profile",
        "MemberAbsences",
    ),
    (
        "Profile.ApproveAbsences",
        "Approve absences",
        "Approve a member's absence requests.",
        "Profile",
        "MemberAbsences",
    ),
    (
        "Profile.CreatePermanentTokens",
        "Create permanent tokens",
        "Create personal permanent tokens.",
        "Profile",
        "MemberPermanentTokens",
    ),
    (
        "Profile.SetUpTwoFactorAuthentication",
        "Set up 2FA",
        "Enable two-factor authentication.",
        "Profile",
        "TwoFactorAuthentication",
    ),
    (
        "Channel.ViewChannel",
        "View channel",
        "View a chat channel and its messages.",
        "Channel",
        "Channels",
    ),
    (
        "Channel.PostMessages",
        "Post messages",
        "Send messages in a channel.",
        "Channel",
        "Chat",
    ),
    (
        "Channel.ManageChannel",
        "Manage channel",
        "Edit channel settings/membership.",
        "Channel",
        "Channels",
    ),
    (
        "Channel.DeleteChannel",
        "Delete channel",
        "Archive/delete a channel.",
        "Channel",
        "Channels",
    ),
    (
        "Document.ViewDocuments",
        "View documents",
        "View documents in a container.",
        "Document",
        "Documents",
    ),
    (
        "Document.CreateDocuments",
        "Create documents",
        "Create new documents.",
        "Document",
        "Documents",
    ),
    (
        "Document.EditDocuments",
        "Edit documents",
        "Edit document content.",
        "Document",
        "Documents",
    ),
    (
        "Document.DeleteDocumentsForever",
        "Delete documents forever",
        "Permanently delete documents.",
        "Document",
        "Documents",
    ),
    (
        "Document.ManageDocuments",
        "Manage documents",
        "Move/archive/share documents.",
        "Document",
        "Documents",
    ),
    (
        "DocumentFolder.ViewFoldersMetadata",
        "View folder metadata",
        "View folder names/hierarchy.",
        "DocumentFolder",
        "Documents",
    ),
    (
        "DocumentFolder.ManageDocumentFolders",
        "Manage folders",
        "Create/rename/move folders.",
        "DocumentFolder",
        "Documents",
    ),
    (
        "Project.CreateIssues",
        "Create issues",
        "Create issues in a project.",
        "Project",
        "Planning",
    ),
    (
        "Project.EditIssues",
        "Edit issues",
        "Modify issues in a project.",
        "Project",
        "Planning",
    ),
    (
        "Project.ManageProjectPins",
        "Manage project pins",
        "Pin and unpin items in the project.",
        "Project",
        "Project",
    ),
    (
        "Project.PushCodeIssues",
        "Push code issues",
        "Report code-quality issues into the project.",
        "Project",
        "Project",
    ),
    (
        "Project.ViewResponsibilities",
        "View responsibilities",
        "See project responsibility assignments.",
        "Project",
        "ProjectResponsibilities",
    ),
    (
        "Project.ManageResponsibilities",
        "Manage responsibilities",
        "Assign project responsibilities.",
        "Project",
        "ProjectResponsibilities",
    ),
    (
        "Project.ViewAutomationExecution",
        "View automation runs",
        "See automation job executions.",
        "Project",
        "Automation",
    ),
    (
        "Project.StartAutomationExecution",
        "Start automation runs",
        "Trigger automation jobs.",
        "Project",
        "Automation",
    ),
    (
        "Project.StopAutomationExecution",
        "Stop automation runs",
        "Cancel running automation jobs.",
        "Project",
        "Automation",
    ),
    (
        "Project.AdminAutomationExecution",
        "Administer automation",
        "Full control over automation jobs and settings.",
        "Project",
        "Automation",
    ),
    (
        "Project.EditSecrets",
        "Edit secrets",
        "Change existing project secrets.",
        "Project",
        "ProjectSecrets",
    ),
    (
        "Project.DeleteSecrets",
        "Delete secrets",
        "Remove project secrets.",
        "Project",
        "ProjectSecrets",
    ),
    (
        "Project.UseSecrets",
        "Use secrets",
        "Consume project secrets from automation.",
        "Project",
        "ProjectSecrets",
    ),
    (
        "Project.DeleteParameters",
        "Delete parameters",
        "Remove project parameters.",
        "Project",
        "ProjectParameters",
    ),
    (
        "Project.DeleteCodeReview",
        "Delete code reviews",
        "Delete code reviews in the project.",
        "Project",
        "CodeReview",
    ),
    (
        "Project.ViewCodeReviewComments",
        "View code review comments",
        "Read comments on code reviews.",
        "Project",
        "CodeReviewComments",
    ),
    (
        "Project.EditCodeReviewComments",
        "Edit code review comments",
        "Write and edit code review comments.",
        "Project",
        "CodeReviewComments",
    ),
    (
        "Project.ViewVaultConnection",
        "View vault connection",
        "See the project vault connection.",
        "Project",
        "VaultConnection",
    ),
    (
        "Project.ModifyVaultConnection",
        "Modify vault connection",
        "Change the project vault connection.",
        "Project",
        "VaultConnection",
    ),
    (
        "Project.DeleteVaultConnection",
        "Delete vault connection",
        "Remove the project vault connection.",
        "Project",
        "VaultConnection",
    ),
    (
        "Project.ReadRepository",
        "Read repository",
        "Read a repository of the project.",
        "Project",
        "VcsRepositories",
    ),
    (
        "Project.WriteRepository",
        "Write repository",
        "Push to a repository of the project.",
        "Project",
        "VcsRepositories",
    ),
    (
        "Project.AdminRepository",
        "Administer repository",
        "Manage repository settings and protected branches.",
        "Project",
        "VcsRepositories",
    ),
    (
        "Project.WritePackages",
        "Publish packages",
        "Publish packages to project package repositories.",
        "Project",
        "PackageRepositories",
    ),
    (
        "Project.DeletePackages",
        "Delete packages",
        "Delete packages from project package repositories.",
        "Project",
        "PackageRepositories",
    ),
    (
        "Project.ReadDeployments",
        "View deployments",
        "See deployments and deploy targets.",
        "Project",
        "GlobalDeploymentsRights",
    ),
    (
        "Project.WriteDeploymentEvents",
        "Write deployment events",
        "Report deployment events.",
        "Project",
        "GlobalDeploymentsRights",
    ),
    (
        "Project.WriteDeployTargets",
        "Manage deploy targets",
        "Create and change deploy targets.",
        "Project",
        "GlobalDeploymentsRights",
    ),
    (
        "Project.ManageHosting",
        "Manage hosting",
        "Administer project hosting resources.",
        "Project",
        "Hosting",
    ),
    (
        "Project.ViewProjectTopics",
        "View project topics",
        "See project topics.",
        "Project",
        "ProjectTopics",
    ),
    (
        "Project.ManageProjectTopics",
        "Manage project topics",
        "Create and remove project topics.",
        "Project",
        "ProjectTopics",
    ),
    (
        "Project.ViewIssues",
        "View issues",
        "Read issues of the project.",
        "Project",
        "Planning",
    ),
    (
        "Project.DeleteIssues",
        "Delete issues",
        "Delete issues of the project.",
        "Project",
        "Planning",
    ),
    (
        "Profile.EditProfile2",
        "Edit extended profile",
        "Edit extended member profile data.",
        "Profile",
        "MemberData",
    ),
    (
        "Profile.ViewAbsenceReason",
        "View absence reason",
        "See the reason attached to an absence.",
        "Profile",
        "MemberAbsences",
    ),
    (
        "Profile.ViewAbsenceApproval",
        "View absence approval",
        "See absence approval state.",
        "Profile",
        "MemberAbsences",
    ),
    (
        "Profile.EditPastAbsences",
        "Edit past absences",
        "Change absences that already ended.",
        "Profile",
        "MemberAbsences",
    ),
    (
        "Profile.ViewWorkingDays",
        "View working days",
        "See a member's working days.",
        "Profile",
        "MemberWorkingDays",
    ),
    (
        "Profile.EditWorkingDays",
        "Edit working days",
        "Change a member's working days.",
        "Profile",
        "MemberWorkingDays",
    ),
    (
        "Profile.ViewLanguages",
        "View languages",
        "See a member's languages.",
        "Profile",
        "MemberLanguages",
    ),
    (
        "Profile.EditLanguages",
        "Edit languages",
        "Change a member's languages.",
        "Profile",
        "MemberLanguages",
    ),
    (
        "Profile.ViewMemberLocations",
        "View member locations",
        "See a member's locations.",
        "Profile",
        "MemberLocations",
    ),
    (
        "Profile.EditMemberLocations",
        "Edit member locations",
        "Change a member's locations.",
        "Profile",
        "MemberLocations",
    ),
    (
        "Profile.ViewMemberLocationMapPoints",
        "View member locations on map",
        "See member location map points.",
        "Profile",
        "MemberLocationsOnMap",
    ),
    (
        "Profile.ViewMemberMemberships",
        "View memberships",
        "See a member's team memberships.",
        "Profile",
        "MemberTeams",
    ),
    (
        "Profile.ViewPrivateCustomColumns",
        "View private custom fields",
        "See private custom profile fields.",
        "Profile",
        "MemberCustomFields",
    ),
    (
        "Profile.ViewRestrictedCustomColumns",
        "View restricted custom fields",
        "See restricted custom profile fields.",
        "Profile",
        "MemberCustomFields",
    ),
    (
        "Profile.EditAuthenticationSessions",
        "Manage authentication sessions",
        "List and revoke a member's sessions.",
        "Profile",
        "MemberAuthSessions",
    ),
    (
        "Profile.EditOAuthConsents",
        "Manage OAuth consents",
        "Review and revoke a member's OAuth consents.",
        "Profile",
        "MemberConsents",
    ),
    (
        "Profile.EditPermanentTokens",
        "Manage permanent tokens",
        "List and revoke a member's permanent tokens.",
        "Profile",
        "MemberPermanentTokens",
    ),
    (
        "Profile.EditTwoFactorAuthentication",
        "Manage two-factor authentication",
        "Change or disable a member's 2FA.",
        "Profile",
        "TwoFactorAuthentication",
    ),
    (
        "Profile.EditCredentials",
        "Manage credentials",
        "Reset a member's password or credentials.",
        "Profile",
        "MemberCredentials",
    ),
    (
        "Profile.VerifyEmail",
        "Manage email verification",
        "Verify or re-send verification for a member email.",
        "Profile",
        "EmailVerification",
    ),
    (
        "Profile.EditNotificationSettings",
        "Manage notification settings",
        "Change a member's notification settings.",
        "Profile",
        "MemberNotificationSettings",
    ),
    (
        "Global.AddNewExternalUser",
        "Add external user",
        "Invite an external user to the organization.",
        "Global",
        "Members",
    ),
    (
        "Global.ViewAllExternalUsers",
        "View all external users",
        "List every external user.",
        "Global",
        "Members",
    ),
    (
        "Global.AddCustomEmoji",
        "Add custom emoji",
        "Upload custom emoji.",
        "Global",
        "Reactions",
    ),
    (
        "Global.ManageEmojis",
        "Manage emojis",
        "Administer the custom emoji set.",
        "Global",
        "Reactions",
    ),
    (
        "Global.ViewCustomEmojiList",
        "View custom emoji list",
        "See the custom emoji set.",
        "Global",
        "Reactions",
    ),
    (
        "Global.EditReactions",
        "Edit reactions",
        "Configure available reactions.",
        "Global",
        "Reactions",
    ),
    (
        "Global.ManageStickers",
        "Manage stickers",
        "Administer stickers.",
        "Global",
        "Reactions",
    ),
    (
        "Global.AdminMaintenanceData",
        "Administer maintenance data",
        "Change organization maintenance data.",
        "Global",
        "Internal",
    ),
    (
        "Global.ViewMaintenanceData",
        "View maintenance data",
        "See organization maintenance data.",
        "Global",
        "Internal",
    ),
    (
        "Global.ViewUsageData",
        "View usage data",
        "See organization usage statistics.",
        "Global",
        "Internal",
    ),
    (
        "Global.ViewBouncedEmailData",
        "View bounced email data",
        "Inspect bounced organization email.",
        "Global",
        "Internal",
    ),
    (
        "Global.ImportMessagesOld",
        "Import messages",
        "Import chat history from another system.",
        "Global",
        "Chat",
    ),
    (
        "Global.AuthorizeAppUnfurls",
        "Authorize application unfurls",
        "Allow an application to unfurl links.",
        "Global",
        "Application",
    ),
    (
        "Global.ProvideExternalInlineUnfurls",
        "Provide inline unfurls",
        "Serve inline link previews.",
        "Global",
        "Application",
    ),
    (
        "Global.ProvideExternalAttachmentUnfurls",
        "Provide attachment unfurls",
        "Serve attachment link previews.",
        "Global",
        "Application",
    ),
    (
        "Global.ManageUnfurlBlackList",
        "Manage unfurl blacklist",
        "Block domains from link previews.",
        "Global",
        "Application",
    ),
    (
        "Global.ManageExternalLinkPatterns",
        "Manage external link patterns",
        "Configure external issue link patterns.",
        "Global",
        "Application",
    ),
    (
        "Global.ViewExternalLinkPatterns",
        "View external link patterns",
        "See external issue link patterns.",
        "Global",
        "Application",
    ),
    (
        "Global.EditAbsenceTypes",
        "Edit absence types",
        "Configure organization absence types.",
        "Global",
        "AbsenceTypes",
    ),
    (
        "Global.ViewAbsenceTypes",
        "View absence types",
        "See organization absence types.",
        "Global",
        "AbsenceTypes",
    ),
    (
        "Global.EditLocations",
        "Edit locations",
        "Configure organization locations.",
        "Global",
        "Locations",
    ),
    (
        "Global.ViewLocations",
        "View locations",
        "See organization locations.",
        "Global",
        "Locations",
    ),
    (
        "Global.EditEquipmentTypes",
        "Edit equipment types",
        "Configure organization equipment types.",
        "Global",
        "EquipmentTypes",
    ),
    (
        "Global.EditBusinessEntities",
        "Edit business entities",
        "Configure organization business entities.",
        "Global",
        "BusinessEntities",
    ),
    (
        "Global.EditHints",
        "Edit onboarding hints",
        "Configure onboarding hints.",
        "Global",
        "OnboardingHints",
    ),
    (
        "Global.EditTodoTask",
        "Edit to-do tasks",
        "Change organization to-do tasks.",
        "Global",
        "Internal",
    ),
    (
        "Global.ViewTodoTask",
        "View to-do tasks",
        "See organization to-do tasks.",
        "Global",
        "Internal",
    ),
    (
        "Global.PublishArticles",
        "Publish articles",
        "Publish organization articles.",
        "Global",
        "Articles",
    ),
    (
        "Global.UnpublishArticles",
        "Unpublish articles",
        "Withdraw published articles.",
        "Global",
        "Articles",
    ),
    (
        "Global.ImportArticles",
        "Import articles",
        "Import articles from another system.",
        "Global",
        "Articles",
    ),
    (
        "Global.ViewArticles",
        "View articles",
        "Read organization articles.",
        "Global",
        "Articles",
    ),
    (
        "Global.EditArticlesComments",
        "Manage article comments",
        "Moderate comments on articles.",
        "Global",
        "ArticlesComments",
    ),
    (
        "Global.ListPrivateProjects",
        "List private projects",
        "See private projects without membership.",
        "Global",
        "PrivateProjects",
    ),
    (
        "Global.ManageThrottledLogins",
        "Manage throttled logins",
        "List and clear throttled login records.",
        "Global",
        "AuthenticationModules",
    ),
    (
        "Global.ViewGrantedPermissions",
        "View granted permissions",
        "Inspect who holds which rights.",
        "Global",
        "AccessControl",
    ),
    (
        "Global.EditFeatureFlags",
        "Edit feature flags",
        "Toggle organization feature flags.",
        "Global",
        "FeatureFlags",
    ),
    (
        "Global.EditLoggers",
        "Edit loggers",
        "Change server log levels.",
        "Global",
        "Loggers",
    ),
    (
        "Global.UpdateOverdrafts",
        "Update overdrafts",
        "Change absence overdraft balances.",
        "Global",
        "MemberVacationPeriods",
    ),
    (
        "Global.EditDeployTargetCustomFields",
        "Edit deploy target custom fields",
        "Configure custom fields on deploy targets.",
        "Global",
        "GlobalDeploymentsRights",
    ),
    (
        "Document.ArchiveDocuments",
        "Archive documents",
        "Move documents to the archive.",
        "Document",
        "Documents",
    ),
    (
        "Document.ManageDocuments2",
        "Manage document sharing",
        "Change document sharing and permissions.",
        "Document",
        "Documents",
    ),
    (
        "Document.CreateBooks",
        "Create books",
        "Create document books.",
        "Document",
        "Books",
    ),
    (
        "Document.ViewBook",
        "View book",
        "Read a document book.",
        "Document",
        "Books",
    ),
    (
        "Document.ImportBooks",
        "Import books",
        "Import document books.",
        "Document",
        "Books",
    ),
    (
        "Document.ViewBookItems",
        "View book items",
        "Read entries of a document book.",
        "Document",
        "Books",
    ),
    (
        "Document.EditBookItems",
        "Edit book items",
        "Change entries of a document book.",
        "Document",
        "Books",
    ),
    (
        "Document.AdministrateBook",
        "Administer book",
        "Full control over a document book.",
        "Document",
        "Books",
    ),
    (
        "DocumentFolder.DeleteDocumentFolders",
        "Delete folders",
        "Delete document folders.",
        "DocumentFolder",
        "Documents",
    ),
    (
        "Channel.ArchiveChannel",
        "Archive channel",
        "Archive a channel.",
        "Channel",
        "Channels",
    ),
    (
        "Channel.ManageChannelMembers",
        "Manage channel members",
        "Add and remove channel members.",
        "Channel",
        "Channels",
    ),
    (
        "Channel.ViewDirectMessages",
        "View direct messages",
        "Read direct message conversations.",
        "Channel",
        "DirectMessages",
    ),
    (
        "Team.ManageTeamPositions",
        "Manage positions",
        "Create and assign team positions.",
        "Team",
        "Positions",
    ),
];

/// KB §05 §2.1 `RightGroup`: the UI grouping categories a Right belongs to, as
/// `(code, title, priority)`. The Admin permission matrix orders by `priority`,
/// so a new group takes a slot without renumbering its neighbours.
pub const RIGHT_GROUPS: &[(&str, &str, i32)] = &[
    ("Members", "Members", 10),
    ("MemberData", "Member data", 20),
    ("MemberLanguages", "Member languages", 30),
    ("MemberLocations", "Member locations", 40),
    ("MemberLocationsOnMap", "Member locations on map", 50),
    ("MemberAbsences", "Member absences", 60),
    ("MemberTeams", "Member teams", 70),
    ("MemberAuthSessions", "Member authentication sessions", 80),
    ("MemberWorkingDays", "Member working days", 90),
    ("MemberConsents", "Member consents", 100),
    ("MemberPermanentTokens", "Member permanent tokens", 110),
    (
        "MemberNotificationSettings",
        "Member notification settings",
        120,
    ),
    ("TwoFactorAuthentication", "Two-factor authentication", 130),
    ("EmailVerification", "Email verification", 140),
    ("MemberCustomFields", "Member custom fields", 150),
    ("MemberCredentials", "Member credentials", 160),
    ("MemberGoogleAccount", "Member Google account", 170),
    ("MemberBusinessEntities", "Member business entities", 180),
    ("MemberVacationPeriods", "Member vacation periods", 190),
    ("MemberWiFiCredentials", "Member Wi-Fi credentials", 200),
    ("Teams", "Teams", 210),
    ("TeamMembers", "Team members", 220),
    ("Positions", "Positions", 230),
    ("Articles", "Articles", 240),
    ("ArticlesComments", "Article comments", 250),
    ("Chat", "Chat", 260),
    ("Channels", "Channels", 270),
    ("DirectMessages", "Direct messages", 280),
    ("Application", "Applications", 290),
    ("Organization", "Organization", 300),
    ("BusinessEntities", "Business entities", 310),
    ("Locations", "Locations", 320),
    ("EquipmentTypes", "Equipment types", 330),
    ("AbsenceTypes", "Absence types", 340),
    ("GlobalCustomFields", "Global custom fields", 350),
    ("GlobalDeploymentsRights", "Deployments", 360),
    ("FeatureFlags", "Feature flags", 370),
    ("OnboardingHints", "Onboarding hints", 380),
    ("Loggers", "Loggers", 390),
    ("Reactions", "Reactions", 400),
    ("AuthenticationModules", "Authentication modules", 410),
    ("Permissions", "Permissions", 420),
    ("AccessControl", "Access control", 430),
    ("Project", "Project", 440),
    ("CodeReviewComments", "Code review comments", 450),
    ("ProjectResponsibilities", "Project responsibilities", 460),
    ("PrivateProjects", "Private projects", 470),
    ("VcsRepositories", "Repositories", 480),
    ("PackageRepositories", "Package repositories", 490),
    ("Books", "Books", 500),
    ("Documents", "Documents", 510),
    ("Automation", "Automation", 520),
    ("ProjectParameters", "Project parameters", 530),
    ("ProjectSecrets", "Project secrets", 540),
    ("DevEnvironments", "Dev environments", 550),
    ("Hosting", "Hosting", 560),
    ("ProjectTopics", "Project topics", 570),
    ("CodeReview", "Code review", 580),
    ("VaultConnection", "Vault connection", 590),
    ("Internal", "Internal", 600),
    ("Planning", "Planning", 610),
];
/// KB §2.1 `RightType`: the seven contexts a right can belong to. Every catalog code is
/// namespaced by its type, so this list is also the code prefix vocabulary.
pub const RIGHT_TYPES: &[&str] = &[
    "Global",
    "Project",
    "Profile",
    "Team",
    "Channel",
    "Document",
    "DocumentFolder",
];
pub fn is_right_group(code: &str) -> bool {
    RIGHT_GROUPS.iter().any(|(group, ..)| *group == code)
}

/// Persisted `rights.propagation` values. `GLOBAL_TO_DESCENDANTS` is the default: a
/// grant made at the organization level reaches every project/team/channel below it.
/// `NONE` means the grant only counts at the exact scope it was made on — a global
/// role does *not* silently confer it. This is the only propagation vocabulary; the
/// resolver in `platform::check_right_on` reads the persisted column, never this list.
pub const PROPAGATION_NONE: &str = "NONE";
pub const PROPAGATION_GLOBAL_TO_DESCENDANTS: &str = "GLOBAL_TO_DESCENDANTS";

/// Rights that must be granted where they are used. Everything not listed here
/// propagates from a global grant. These are the reads/writes that touch one
/// member's private data or one channel's private traffic: holding an
/// organization-wide role is not, by itself, consent to look at them.
pub const NON_PROPAGATING_RIGHTS: &[&str] = &[
    "Profile.ViewPrivateCustomColumns",
    "Profile.ViewRestrictedCustomColumns",
    "Profile.ViewAbsenceReason",
    "Profile.EditCredentials",
    "Profile.EditAuthenticationSessions",
    "Profile.EditOAuthConsents",
    "Profile.EditPermanentTokens",
    "Profile.EditTwoFactorAuthentication",
    "Channel.ViewDirectMessages",
];
pub fn default_propagation(code: &str) -> &'static str {
    if NON_PROPAGATING_RIGHTS.contains(&code) {
        PROPAGATION_NONE
    } else {
        PROPAGATION_GLOBAL_TO_DESCENDANTS
    }
}

/// KB §2.1 `Right.featureFlag`: a right whose capability only exists when the named
/// feature is switched on. Stored on the descriptor so a client can explain *why* a
/// right is inert. UNVERIFIED as an enforcement mechanism: nothing consults it at
/// check time yet, because there is no feature-flag store to consult.
pub const FEATURE_GATES: &[(&str, &str)] = &[
    ("DevEnvironments", "dev-environments"),
    ("Books", "documents-books"),
    ("GlobalDeploymentsRights", "deployments"),
    ("Hosting", "hosting"),
    ("VaultConnection", "vault-connection"),
];
/// Feature gate of a right, derived from its group.
pub fn feature_gate_for_group(group: &str) -> Option<&'static str> {
    FEATURE_GATES
        .iter()
        .find_map(|(gated, flag)| (*gated == group).then_some(*flag))
}

/// Catalog flag defaults. `Books` rights are KB-deprecated in favour of `Documents`,
/// and `Internal` rights are not offered in the ordinary permission matrix.
pub fn default_flags(group: &str) -> u32 {
    match group {
        "Books" => flags::DEPRECATED,
        "Internal" => flags::HIDDEN,
        _ => 0,
    }
}
/// Scope names accepted by role grants. Keep this beside Right metadata so UI,
/// command validation, and SQLite's V37 constraint share one vocabulary.
pub const SCOPE_TYPES: &[&str] = &[
    "global",
    "project",
    "team",
    "profile",
    "channel",
    "document",
    "documentFolder",
];
pub fn is_scope_type(scope_type: &str) -> bool {
    SCOPE_TYPES.contains(&scope_type)
}

/// Storage flags for a Right descriptor. Flags are intentionally extensible: unknown
/// bits round-trip, allowing newer servers to describe rights to older clients.
pub mod flags {
    pub const DEPRECATED: u32 = 1 << 0;
    pub const HIDDEN: u32 = 1 << 1;
    pub const EXPERIMENTAL: u32 = 1 << 2;
}

/// Whether a grant crosses scope boundaries. `GlobalToDescendants` is the normal
/// global grant behavior; `None` requires exact scope matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Propagation {
    None,
    GlobalToDescendants,
}

/// Direct edges only, and only as the *seed* of `rights.implied_rights_json`.
///
/// There is exactly one implication resolver in the system and it is
/// `platform::check_right_on`, which walks the persisted descriptors. A second,
/// code-based closure used to live here; it was deleted because an administrator who
/// edits `implied_rights_json` must not be silently overruled by a compiled-in graph,
/// and two closures over the same edges are two answers waiting to disagree.
/// Direct edges only; the persisted closure in `platform::check_right_on` is transitive.
pub const IMPLIED_RIGHTS: &[(&str, &str)] = &[
    // Dev Environments group (KB 07 §2.1): Space names these `Rd.Workspaces.*`;
    // the codes here keep our `<RightType>.<Name>` namespacing and carry the Space
    // code in the description so an operator can map them one to one.
    (
        "Project.JoinHotPoolDevEnvironments",
        "Project.CreateDevEnvironments",
    ),
    (
        "Project.CreateDevEnvironments",
        "Global.ViewDevEnvironmentSettings",
    ),
    (
        "Project.ManageDevEnvironmentsInProject",
        "Project.ViewDevEnvironmentsInProject",
    ),
    (
        "Global.EditDevEnvironmentSettings",
        "Global.ViewDevEnvironmentSettings",
    ),
    ("Project.AdminProject", "Project.ViewProject"),
    ("Project.VcsAdmin", "Project.VcsWrite"),
    ("Project.VcsWrite", "Project.VcsRead"),
    ("Project.EditCodeReview", "Project.CreateCodeReview"),
    ("Project.CreateCodeReview", "Project.ViewCodeReview"),
    ("Channel.ManageChannel", "Channel.PostMessages"),
    ("Document.EditDocuments", "Document.CreateDocuments"),
];

/// Initial catalog descriptor only. Runtime resolution reads the persisted
/// `implied_rights_json` column, so administrator changes take effect directly.
pub fn default_implied_rights(code: &str) -> Vec<&'static str> {
    if code == "Global.Superadmin" {
        return CATALOG
            .iter()
            .map(|(code, ..)| *code)
            .filter(|child| *child != code)
            .collect();
    }
    IMPLIED_RIGHTS
        .iter()
        .filter_map(|(parent, child)| (*parent == code).then_some(*child))
        .collect()
}

/// B4-3: the roles an empty organization starts with, as `(name, description,
/// granted right codes)`. These are `SYSTEM` roles — seeded once, editable afterwards
/// like any other role. Only the direct grants are listed: everything reachable through
/// `implied_rights_json` comes for free from the resolver, so `Admin` does not restate
/// the catalog and `Member` does not restate `ViewProject`.
pub const DEFAULT_ROLES: &[(&str, &str, &[&str])] = &[
    (
        "Admin",
        "Full administration of the organization.",
        &["Global.Superadmin"],
    ),
    (
        "Member",
        "Everyday contributor: participates in projects, documents and channels.",
        &[
            "Global.OrgMember",
            "Global.ViewOrganizationInfo",
            "Global.ViewTeams",
            "Global.CreateProjects",
            "Profile.ViewProfile",
            "Profile.EditProfile",
            "Profile.ViewAbsences",
            "Profile.EditAbsences",
            "Project.ViewProject",
            "Project.CreateIssues",
            "Project.EditIssues",
            "Project.VcsWrite",
            "Project.EditCodeReview",
            "Document.EditDocuments",
            "Channel.PostMessages",
            "Team.ViewTeamMembers",
        ],
    ),
    (
        "Guest",
        "Read-only visitor: sees what is shared, changes nothing.",
        &[
            "Profile.ViewProfileBasic",
            "Project.ViewProject",
            "Project.VcsRead",
            "Project.ViewCodeReview",
            "Document.ViewDocuments",
            "DocumentFolder.ViewFoldersMetadata",
            "Channel.ViewChannel",
        ],
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    /// Codes are the storage key of a right (`rights.code` is UNIQUE): a duplicate in
    /// the catalog silently drops a right at seed time via INSERT OR IGNORE.
    #[test]
    fn catalog_codes_are_unique_and_typed() {
        let mut seen = std::collections::BTreeSet::new();
        for (code, title, _, right_type, _) in CATALOG {
            assert!(seen.insert(*code), "duplicate right code {code}");
            assert!(!title.is_empty(), "{code} has no title");
            assert!(
                RIGHT_TYPES.contains(right_type),
                "{code} has unknown right type {right_type}"
            );
            assert!(
                code.starts_with(&format!("{right_type}.")),
                "{code} is not namespaced by its right type"
            );
        }
    }

    /// Propagation is a per-right fact, not a per-scope one: the private-data rights
    /// must not be reachable from an organization-wide grant.
    #[test]
    fn private_data_rights_do_not_propagate() {
        assert_eq!(
            default_propagation("Profile.EditCredentials"),
            PROPAGATION_NONE
        );
        assert_eq!(
            default_propagation("Project.ViewProject"),
            PROPAGATION_GLOBAL_TO_DESCENDANTS
        );
        for code in NON_PROPAGATING_RIGHTS {
            assert!(
                CATALOG.iter().any(|(catalog, ..)| catalog == code),
                "{code} is marked non-propagating but is not in the catalog"
            );
        }
    }

    /// A default role that names a right the catalog does not define would seed a role
    /// with a silently missing grant: the join in `set_role_rights` simply finds no row.
    #[test]
    fn every_default_role_grant_exists_in_the_catalog() {
        for (role, _, grants) in DEFAULT_ROLES {
            for code in *grants {
                assert!(
                    CATALOG
                        .iter()
                        .any(|(catalog_code, ..)| catalog_code == code),
                    "{role} grants unknown right {code}"
                );
            }
        }
    }

    /// Guest is the boundary case that matters: a read-only role must not carry a write
    /// grant, directly or through implication.
    #[test]
    fn the_guest_role_grants_nothing_that_writes() {
        let (_, _, guest) = DEFAULT_ROLES
            .iter()
            .find(|(name, ..)| *name == "Guest")
            .expect("Guest is a default role");
        for code in *guest {
            let mut pending = vec![*code];
            while let Some(current) = pending.pop() {
                assert!(
                    current.contains("View") || current.contains("Read"),
                    "Guest reaches {current} through {code}"
                );
                pending.extend(default_implied_rights(current));
            }
        }
    }

    /// The seed carries direct edges only. Transitivity is the resolver's job, and it
    /// is asserted against the database in `platform`, not here — asserting it twice in
    /// two implementations is what this module just stopped doing.
    #[test]
    fn the_seed_carries_direct_edges_and_no_closure() {
        assert_eq!(
            default_implied_rights("Project.VcsAdmin"),
            vec!["Project.VcsWrite"],
            "VcsRead is reached through VcsWrite, not seeded directly"
        );
        assert!(default_implied_rights("Project.VcsRead").is_empty());
        assert!(
            default_implied_rights("Global.Superadmin").len() > IMPLIED_RIGHTS.len(),
            "superadmin seeds the whole catalog"
        );
    }
}
