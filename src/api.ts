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
};
