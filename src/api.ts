import { invoke } from "@tauri-apps/api/core";

export type RepoRef = { path: string; name: string };
export type RepoInfo = {
  path: string;
  name: string;
  head: string | null;
  detached: boolean;
  bare: boolean;
};
export type Commit = {
  id: string;
  short_id: string;
  summary: string;
  author: string;
  email: string;
  time: number;
  parents: string[];
};
export type Branch = {
  name: string;
  is_head: boolean;
  remote: boolean;
  target: string | null;
};
export type StatusEntry = { path: string; status: string; staged: boolean };
export type Tag = { name: string; target: string };
export type RemoteInfo = { name: string; url: string };
export type StashEntry = { index: number; message: string };
export type TreeEntry = { name: string; path: string; is_dir: boolean; id: string };
export type CommitFile = { path: string; status: string };
export type WorktreeInfo = { name: string; path: string };
export type HostedRepository = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  default_branch: string;
  created_at: number;
  created_by: string | null;
};

export const api = {
  repoList: () => invoke<RepoRef[]>("repo_list"),
  repoAdd: (path: string) => invoke<RepoRef[]>("repo_add", { path }),
  repoRemove: (path: string) => invoke<RepoRef[]>("repo_remove", { path }),
  repoInfo: (path: string) => invoke<RepoInfo>("repo_info", { path }),
  repoLog: (path: string, limit = 200) =>
    invoke<Commit[]>("repo_log", { path, limit }),
  repoBranches: (path: string) => invoke<Branch[]>("repo_branches", { path }),
  repoStatus: (path: string) => invoke<StatusEntry[]>("repo_status", { path }),
  repoDiff: (path: string, id?: string) =>
    invoke<string>("repo_diff", { path, id: id ?? null }),
  repoStage: (path: string, files: string[]) =>
    invoke<void>("repo_stage", { path, files }),
  repoCommit: (path: string, message: string) =>
    invoke<string>("repo_commit", { path, message }),
  repoFetch: (path: string, remote?: string) =>
    invoke<void>("repo_fetch", { path, remote: remote ?? null }),
  repoPull: (path: string) => invoke<string>("repo_pull", { path }),
  repoPush: (path: string, remote?: string, branch?: string) =>
    invoke<void>("repo_push", { path, remote: remote ?? null, branch: branch ?? null }),
  repoCheckout: (path: string, branch: string) =>
    invoke<void>("repo_checkout", { path, branch }),
  repoBranchCreate: (path: string, name: string, from?: string) =>
    invoke<void>("repo_branch_create", { path, name, from: from ?? null }),
  repoTags: (path: string) => invoke<Tag[]>("repo_tags", { path }),
  repoRemotes: (path: string) => invoke<RemoteInfo[]>("repo_remotes", { path }),
  repoStashSave: (path: string, message?: string) =>
    invoke<string>("repo_stash_save", { path, message: message ?? null }),
  repoStashPop: (path: string, index?: number) =>
    invoke<void>("repo_stash_pop", { path, index: index ?? null }),
  repoStashList: (path: string) => invoke<StashEntry[]>("repo_stash_list", { path }),
  repoCommitFiles: (path: string, id: string) =>
    invoke<CommitFile[]>("repo_commit_files", { path, id }),
  repoTree: (path: string, id: string, dir?: string) =>
    invoke<TreeEntry[]>("repo_tree", { path, id, dir: dir ?? null }),
  repoUnstage: (path: string, files: string[]) =>
    invoke<void>("repo_unstage", { path, files }),
  repoWorktrees: (path: string) => invoke<WorktreeInfo[]>("repo_worktrees", { path }),
  listHostedRepos: (projectId: string) =>
    invoke<HostedRepository[]>("list_hosted_repos", { projectId }),
  createHostedRepo: (projectId: string, name: string, defaultBranch: string) =>
    invoke<HostedRepository>("create_hosted_repo", { projectId, name, description: null, defaultBranch }),
  hostedRepoCloneUrl: (baseUrl: string, project: string, name: string) =>
    invoke<string>("hosted_repo_clone_url", { baseUrl, project, name }),
  listProjects: () => invoke<Project[]>("list_projects"),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  listIssues: () => invoke<Issue[]>("list_issues"),
  listBoards: () => invoke<Board[]>("list_boards"),
  listChannels: () => invoke<Channel[]>("list_channels"),
  listDocuments: () => invoke<Document[]>("list_documents"),
  listMeetings: () => invoke<Meeting[]>("list_meetings"),
  listPackageRepositories: () => invoke<PackageRepository[]>("list_package_repositories"),
  listPipelineScripts: () => invoke<PipelineScript[]>("list_pipeline_scripts"),
  listRoles: () => invoke<Role[]>("list_roles"),
  listReviews: () => invoke<Review[]>("list_reviews"),
};

export type Profile = { id: string; username: string; display_name: string; email: string | null; avatar_url: string | null; archived: boolean };
export type Project = { id: string; name: string; key: string; description: string | null; created_by: string | null; archived: boolean };
export type Issue = { id: string; project_id: string; number: number; title: string; description: string | null; status_id: string | null; assignee_id: string | null; created_by: string | null; due_date: string | null; archived: boolean };
export type Board = { id: string; project_id: string; name: string; backlog_type: string; archived: boolean };
export type Channel = { id: string; content_type: string; name: string | null; description: string | null; project_id: string | null; archived: boolean };
export type Document = { id: string; container_type: string; container_id: string | null; folder_id: string | null; doc_type: string; title: string; body: string | null; version: number; archived: boolean; created_by: string | null };
export type Meeting = { id: string; title: string; description: string | null; starts_at: number; ends_at: number; rrule: string | null; location: string | null; organizer_id: string | null; channel_id: string | null; archived: boolean };
export type PackageRepository = { id: string; project_id: string | null; name: string; format: string; mode: string; description: string | null; archived: boolean };
export type PipelineScript = { id: string; project_id: string; repository: string | null; path: string; source: string; archived: boolean };
export type Role = { id: string; name: string; description: string | null; role_type: string; archived: boolean };
export type Review = { id: string; project_id: string; number: number; kind: string; state: string; source_branch: string | null; target_branch: string | null; title: string; turn_based: boolean; channel_id: string | null };
