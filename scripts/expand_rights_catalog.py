#!/usr/bin/env python3
"""Generator for the KB §05 §2.1 right catalog rows in `src-tauri/src/rights.rs`.

Idempotent: rows already present are never duplicated, so re-running after a manual
edit is safe. Lives in-repo (not /tmp) so the derivation stays auditable.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RIGHTS = ROOT / "src-tauri/src/rights.rs"

P, G, PR, D, DF, C, T = "Project", "Global", "Profile", "Document", "DocumentFolder", "Channel", "Team"

# (code, title, description, right_type, right_group)
NEW = [
("Project.ManageProjectPins", "Manage project pins", "Pin and unpin items in the project.", P, "Project"),
("Project.PushCodeIssues", "Push code issues", "Report code-quality issues into the project.", P, "Project"),
("Project.ViewResponsibilities", "View responsibilities", "See project responsibility assignments.", P, "ProjectResponsibilities"),
("Project.ManageResponsibilities", "Manage responsibilities", "Assign project responsibilities.", P, "ProjectResponsibilities"),
("Project.ViewAutomationExecution", "View automation runs", "See automation job executions.", P, "Automation"),
("Project.StartAutomationExecution", "Start automation runs", "Trigger automation jobs.", P, "Automation"),
("Project.StopAutomationExecution", "Stop automation runs", "Cancel running automation jobs.", P, "Automation"),
("Project.AdminAutomationExecution", "Administer automation", "Full control over automation jobs and settings.", P, "Automation"),
("Project.EditSecrets", "Edit secrets", "Change existing project secrets.", P, "ProjectSecrets"),
("Project.DeleteSecrets", "Delete secrets", "Remove project secrets.", P, "ProjectSecrets"),
("Project.UseSecrets", "Use secrets", "Consume project secrets from automation.", P, "ProjectSecrets"),
("Project.DeleteParameters", "Delete parameters", "Remove project parameters.", P, "ProjectParameters"),
("Project.DeleteCodeReview", "Delete code reviews", "Delete code reviews in the project.", P, "CodeReview"),
("Project.ViewCodeReviewComments", "View code review comments", "Read comments on code reviews.", P, "CodeReviewComments"),
("Project.EditCodeReviewComments", "Edit code review comments", "Write and edit code review comments.", P, "CodeReviewComments"),
("Project.ViewVaultConnection", "View vault connection", "See the project vault connection.", P, "VaultConnection"),
("Project.ModifyVaultConnection", "Modify vault connection", "Change the project vault connection.", P, "VaultConnection"),
("Project.DeleteVaultConnection", "Delete vault connection", "Remove the project vault connection.", P, "VaultConnection"),
("Project.ReadRepository", "Read repository", "Read a repository of the project.", P, "VcsRepositories"),
("Project.WriteRepository", "Write repository", "Push to a repository of the project.", P, "VcsRepositories"),
("Project.AdminRepository", "Administer repository", "Manage repository settings and protected branches.", P, "VcsRepositories"),
("Project.WritePackages", "Publish packages", "Publish packages to project package repositories.", P, "PackageRepositories"),
("Project.DeletePackages", "Delete packages", "Delete packages from project package repositories.", P, "PackageRepositories"),
("Project.ReadDeployments", "View deployments", "See deployments and deploy targets.", P, "GlobalDeploymentsRights"),
("Project.WriteDeploymentEvents", "Write deployment events", "Report deployment events.", P, "GlobalDeploymentsRights"),
("Project.WriteDeployTargets", "Manage deploy targets", "Create and change deploy targets.", P, "GlobalDeploymentsRights"),
("Project.ManageHosting", "Manage hosting", "Administer project hosting resources.", P, "Hosting"),
("Project.ViewProjectTopics", "View project topics", "See project topics.", P, "ProjectTopics"),
("Project.ManageProjectTopics", "Manage project topics", "Create and remove project topics.", P, "ProjectTopics"),
("Project.ViewIssues", "View issues", "Read issues of the project.", P, "Planning"),
("Project.DeleteIssues", "Delete issues", "Delete issues of the project.", P, "Planning"),
("Profile.EditProfile2", "Edit extended profile", "Edit extended member profile data.", PR, "MemberData"),
("Profile.ViewAbsenceReason", "View absence reason", "See the reason attached to an absence.", PR, "MemberAbsences"),
("Profile.ViewAbsenceApproval", "View absence approval", "See absence approval state.", PR, "MemberAbsences"),
("Profile.EditPastAbsences", "Edit past absences", "Change absences that already ended.", PR, "MemberAbsences"),
("Profile.ViewWorkingDays", "View working days", "See a member's working days.", PR, "MemberWorkingDays"),
("Profile.EditWorkingDays", "Edit working days", "Change a member's working days.", PR, "MemberWorkingDays"),
("Profile.ViewLanguages", "View languages", "See a member's languages.", PR, "MemberLanguages"),
("Profile.EditLanguages", "Edit languages", "Change a member's languages.", PR, "MemberLanguages"),
("Profile.ViewMemberLocations", "View member locations", "See a member's locations.", PR, "MemberLocations"),
("Profile.EditMemberLocations", "Edit member locations", "Change a member's locations.", PR, "MemberLocations"),
("Profile.ViewMemberLocationMapPoints", "View member locations on map", "See member location map points.", PR, "MemberLocationsOnMap"),
("Profile.ViewMemberMemberships", "View memberships", "See a member's team memberships.", PR, "MemberTeams"),
("Profile.ViewPrivateCustomColumns", "View private custom fields", "See private custom profile fields.", PR, "MemberCustomFields"),
("Profile.ViewRestrictedCustomColumns", "View restricted custom fields", "See restricted custom profile fields.", PR, "MemberCustomFields"),
("Profile.EditAuthenticationSessions", "Manage authentication sessions", "List and revoke a member's sessions.", PR, "MemberAuthSessions"),
("Profile.EditOAuthConsents", "Manage OAuth consents", "Review and revoke a member's OAuth consents.", PR, "MemberConsents"),
("Profile.EditPermanentTokens", "Manage permanent tokens", "List and revoke a member's permanent tokens.", PR, "MemberPermanentTokens"),
("Profile.EditTwoFactorAuthentication", "Manage two-factor authentication", "Change or disable a member's 2FA.", PR, "TwoFactorAuthentication"),
("Profile.EditCredentials", "Manage credentials", "Reset a member's password or credentials.", PR, "MemberCredentials"),
("Profile.VerifyEmail", "Manage email verification", "Verify or re-send verification for a member email.", PR, "EmailVerification"),
("Profile.EditNotificationSettings", "Manage notification settings", "Change a member's notification settings.", PR, "MemberNotificationSettings"),
("Global.AddNewExternalUser", "Add external user", "Invite an external user to the organization.", G, "Members"),
("Global.ViewAllExternalUsers", "View all external users", "List every external user.", G, "Members"),
("Global.AddCustomEmoji", "Add custom emoji", "Upload custom emoji.", G, "Reactions"),
("Global.ManageEmojis", "Manage emojis", "Administer the custom emoji set.", G, "Reactions"),
("Global.ViewCustomEmojiList", "View custom emoji list", "See the custom emoji set.", G, "Reactions"),
("Global.EditReactions", "Edit reactions", "Configure available reactions.", G, "Reactions"),
("Global.ManageStickers", "Manage stickers", "Administer stickers.", G, "Reactions"),
("Global.AdminMaintenanceData", "Administer maintenance data", "Change organization maintenance data.", G, "Internal"),
("Global.ViewMaintenanceData", "View maintenance data", "See organization maintenance data.", G, "Internal"),
("Global.ViewUsageData", "View usage data", "See organization usage statistics.", G, "Internal"),
("Global.ViewBouncedEmailData", "View bounced email data", "Inspect bounced organization email.", G, "Internal"),
("Global.ImportMessagesOld", "Import messages", "Import chat history from another system.", G, "Chat"),
("Global.AuthorizeAppUnfurls", "Authorize application unfurls", "Allow an application to unfurl links.", G, "Application"),
("Global.ProvideExternalInlineUnfurls", "Provide inline unfurls", "Serve inline link previews.", G, "Application"),
("Global.ProvideExternalAttachmentUnfurls", "Provide attachment unfurls", "Serve attachment link previews.", G, "Application"),
("Global.ManageUnfurlBlackList", "Manage unfurl blacklist", "Block domains from link previews.", G, "Application"),
("Global.ManageExternalLinkPatterns", "Manage external link patterns", "Configure external issue link patterns.", G, "Application"),
("Global.ViewExternalLinkPatterns", "View external link patterns", "See external issue link patterns.", G, "Application"),
("Global.EditAbsenceTypes", "Edit absence types", "Configure organization absence types.", G, "AbsenceTypes"),
("Global.ViewAbsenceTypes", "View absence types", "See organization absence types.", G, "AbsenceTypes"),
("Global.EditLocations", "Edit locations", "Configure organization locations.", G, "Locations"),
("Global.ViewLocations", "View locations", "See organization locations.", G, "Locations"),
("Global.EditEquipmentTypes", "Edit equipment types", "Configure organization equipment types.", G, "EquipmentTypes"),
("Global.EditBusinessEntities", "Edit business entities", "Configure organization business entities.", G, "BusinessEntities"),
("Global.EditHints", "Edit onboarding hints", "Configure onboarding hints.", G, "OnboardingHints"),
("Global.EditTodoTask", "Edit to-do tasks", "Change organization to-do tasks.", G, "Internal"),
("Global.ViewTodoTask", "View to-do tasks", "See organization to-do tasks.", G, "Internal"),
("Global.PublishArticles", "Publish articles", "Publish organization articles.", G, "Articles"),
("Global.UnpublishArticles", "Unpublish articles", "Withdraw published articles.", G, "Articles"),
("Global.ImportArticles", "Import articles", "Import articles from another system.", G, "Articles"),
("Global.ViewArticles", "View articles", "Read organization articles.", G, "Articles"),
("Global.EditArticlesComments", "Manage article comments", "Moderate comments on articles.", G, "ArticlesComments"),
("Global.ListPrivateProjects", "List private projects", "See private projects without membership.", G, "PrivateProjects"),
("Global.ManageThrottledLogins", "Manage throttled logins", "List and clear throttled login records.", G, "AuthenticationModules"),
("Global.ViewGrantedPermissions", "View granted permissions", "Inspect who holds which rights.", G, "AccessControl"),
("Global.EditFeatureFlags", "Edit feature flags", "Toggle organization feature flags.", G, "FeatureFlags"),
("Global.EditLoggers", "Edit loggers", "Change server log levels.", G, "Loggers"),
("Global.UpdateOverdrafts", "Update overdrafts", "Change absence overdraft balances.", G, "MemberVacationPeriods"),
("Global.EditDeployTargetCustomFields", "Edit deploy target custom fields", "Configure custom fields on deploy targets.", G, "GlobalDeploymentsRights"),
("Document.ArchiveDocuments", "Archive documents", "Move documents to the archive.", D, "Documents"),
("Document.ManageDocuments2", "Manage document sharing", "Change document sharing and permissions.", D, "Documents"),
("Document.CreateBooks", "Create books", "Create document books.", D, "Books"),
("Document.ViewBook", "View book", "Read a document book.", D, "Books"),
("Document.ImportBooks", "Import books", "Import document books.", D, "Books"),
("Document.ViewBookItems", "View book items", "Read entries of a document book.", D, "Books"),
("Document.EditBookItems", "Edit book items", "Change entries of a document book.", D, "Books"),
("Document.AdministrateBook", "Administer book", "Full control over a document book.", D, "Books"),
("DocumentFolder.DeleteDocumentFolders", "Delete folders", "Delete document folders.", DF, "Documents"),
("Channel.ArchiveChannel", "Archive channel", "Archive a channel.", C, "Channels"),
("Channel.ManageChannelMembers", "Manage channel members", "Add and remove channel members.", C, "Channels"),
("Channel.ViewDirectMessages", "View direct messages", "Read direct message conversations.", C, "DirectMessages"),
("Team.ManageTeamPositions", "Manage positions", "Create and assign team positions.", T, "Positions"),
]

# (code, title, priority) — KB §05 §2.1 `RightGroup`, the 56 UI grouping categories.
# `Planning` is deliberately extra: KB keeps planning rights in the sibling
# `PlanningRightsKt` without naming their group, so they get their own registered
# group instead of being silently folded into `Project`.
GROUPS = [
("Members", "Members", 10), ("MemberData", "Member data", 20), ("MemberLanguages", "Member languages", 30),
("MemberLocations", "Member locations", 40), ("MemberLocationsOnMap", "Member locations on map", 50),
("MemberAbsences", "Member absences", 60), ("MemberTeams", "Member teams", 70),
("MemberAuthSessions", "Member authentication sessions", 80), ("MemberWorkingDays", "Member working days", 90),
("MemberConsents", "Member consents", 100), ("MemberPermanentTokens", "Member permanent tokens", 110),
("MemberNotificationSettings", "Member notification settings", 120),
("TwoFactorAuthentication", "Two-factor authentication", 130), ("EmailVerification", "Email verification", 140),
("MemberCustomFields", "Member custom fields", 150), ("MemberCredentials", "Member credentials", 160),
("MemberGoogleAccount", "Member Google account", 170), ("MemberBusinessEntities", "Member business entities", 180),
("MemberVacationPeriods", "Member vacation periods", 190), ("MemberWiFiCredentials", "Member Wi-Fi credentials", 200),
("Teams", "Teams", 210), ("TeamMembers", "Team members", 220), ("Positions", "Positions", 230),
("Articles", "Articles", 240), ("ArticlesComments", "Article comments", 250), ("Chat", "Chat", 260),
("Channels", "Channels", 270), ("DirectMessages", "Direct messages", 280), ("Application", "Applications", 290),
("Organization", "Organization", 300), ("BusinessEntities", "Business entities", 310), ("Locations", "Locations", 320),
("EquipmentTypes", "Equipment types", 330), ("AbsenceTypes", "Absence types", 340),
("GlobalCustomFields", "Global custom fields", 350), ("GlobalDeploymentsRights", "Deployments", 360),
("FeatureFlags", "Feature flags", 370), ("OnboardingHints", "Onboarding hints", 380), ("Loggers", "Loggers", 390),
("Reactions", "Reactions", 400), ("AuthenticationModules", "Authentication modules", 410),
("Permissions", "Permissions", 420), ("AccessControl", "Access control", 430), ("Project", "Project", 440),
("CodeReviewComments", "Code review comments", 450), ("ProjectResponsibilities", "Project responsibilities", 460),
("PrivateProjects", "Private projects", 470), ("VcsRepositories", "Repositories", 480),
("PackageRepositories", "Package repositories", 490), ("Books", "Books", 500),
("Documents", "Documents", 510), ("Automation", "Automation", 520), ("ProjectParameters", "Project parameters", 530),
("ProjectSecrets", "Project secrets", 540), ("DevEnvironments", "Dev environments", 550), ("Hosting", "Hosting", 560),
("ProjectTopics", "Project topics", 570), ("CodeReview", "Code review", 580), ("VaultConnection", "Vault connection", 590),
("Internal", "Internal", 600), ("Planning", "Planning", 610),
]


def rust_tuple(t):
    code, title, desc, rtype, group = t
    return f'    (\n        "{code}",\n        "{title}",\n        "{desc}",\n        "{rtype}",\n        "{group}",\n    ),\n'


def main() -> int:
    src = RIGHTS.read_text()
    head, rest = src.split("pub const CATALOG", 1)
    body, tail = rest.split("\n];", 1)
    present = set(re.findall(r'^\s{8}"([A-Za-z]+\.[A-Za-z0-9_]+)",', body, re.M))
    additions = "".join(rust_tuple(t) for t in NEW if t[0] not in present)
    body = body.replace('"Dev Environments",', '"DevEnvironments",').replace('"Issues",', '"Planning",')
    groups_rs = (
        "\n/// KB §05 §2.1 `RightGroup`: the UI grouping categories a Right belongs to, as\n"
        "/// `(code, title, priority)`. The Admin permission matrix orders by `priority`,\n"
        "/// so a new group takes a slot without renumbering its neighbours.\n"
        "pub const RIGHT_GROUPS: &[(&str, &str, i32)] = &[\n"
        + "".join(f'    ("{c}", "{t}", {p}),\n' for c, t, p in GROUPS)
        + "];\n"
        "pub fn is_right_group(code: &str) -> bool {\n"
        "    RIGHT_GROUPS.iter().any(|(group, ..)| *group == code)\n"
        "}\n"
    )
    RIGHTS.write_text(head + "pub const CATALOG" + body + additions + "\n];\n" + groups_rs + tail.lstrip("\n"))
    print(f"catalog rows: {len(present)} -> {len(present | {t[0] for t in NEW})}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
