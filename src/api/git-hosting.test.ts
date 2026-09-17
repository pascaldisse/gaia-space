import { afterEach, expect, test } from "bun:test";
import { api } from "../api";

const seen: { command: string; args: Record<string, unknown> }[] = [];
afterEach(() => { seen.length = 0; delete (window as any).__TAURI_INTERNALS__; });

test("hosted repository API keeps the Rust command names and argument keys", async () => {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown>) => { seen.push({ command, args }); return command === "hosted_repo_clone_url" ? "http://space.test/git/project/repo.git" : []; },
  };
  await api.listHostedRepos("project");
  await api.createHostedRepo("project", "repo", "main");
  await api.hostedRepoCloneUrl("http://space.test", "project", "repo");
  expect(seen).toEqual([
    { command: "list_hosted_repos", args: { projectId: "project" } },
    { command: "create_hosted_repo", args: { projectId: "project", name: "repo", description: null, defaultBranch: "main" } },
    { command: "hosted_repo_clone_url", args: { baseUrl: "http://space.test", project: "project", name: "repo" } },
  ]);
});
