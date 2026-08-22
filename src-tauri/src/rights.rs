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
        }
    }
}

pub const CATALOG: &[(&str, &str, &str, &str, &str)] = &[
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
        "Issues",
    ),
    (
        "Project.EditIssues",
        "Edit issues",
        "Modify issues in a project.",
        "Project",
        "Issues",
    ),
];

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

/// True if `granted` transitively contains `requested`. This remains code-based so
/// catalog rows and descriptors added by a server stay forward-compatible.
pub fn implies(granted: &str, requested: &str) -> bool {
    if granted == requested || granted == "Global.Superadmin" {
        return true;
    }
    let mut pending = vec![granted];
    let mut seen = std::collections::BTreeSet::new();
    while let Some(code) = pending.pop() {
        if !seen.insert(code) {
            continue;
        }
        for (parent, child) in IMPLIED_RIGHTS {
            if code == *parent {
                if *child == requested {
                    return true;
                }
                pending.push(child);
            }
        }
    }
    false
}

/// Direct edges only; [`implies`] computes the transitive closure.
pub const IMPLIED_RIGHTS: &[(&str, &str)] = &[
    ("Project.AdminProject", "Project.ViewProject"),
    ("Project.VcsAdmin", "Project.VcsWrite"),
    ("Project.VcsWrite", "Project.VcsRead"),
    ("Project.EditCodeReview", "Project.CreateCodeReview"),
    ("Project.CreateCodeReview", "Project.ViewCodeReview"),
    ("Channel.ManageChannel", "Channel.PostMessages"),
    ("Document.EditDocuments", "Document.CreateDocuments"),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn implied_rights_are_transitive_and_directional() {
        assert!(implies("Project.VcsAdmin", "Project.VcsRead"));
        assert!(implies("Channel.ManageChannel", "Channel.PostMessages"));
        assert!(!implies("Project.VcsRead", "Project.VcsAdmin"));
    }
}
