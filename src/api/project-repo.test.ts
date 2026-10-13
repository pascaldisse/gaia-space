import { expect, test, describe, afterEach, mock } from "bun:test";
import { invoke } from "./invoke";
mock.module("@tauri-apps/api/core", () => ({ invoke }));
import { platformApi } from "./platform";

// The Repository tab never sends a filesystem path to a READ: reads are project-scoped
// (`project_repo_overview` / `project_repo_readme`), the server resolves the path from the
// project row. Only the bind write carries a path, and it is validated server-side.

const realFetch = globalThis.fetch;
let sent: { cmd: string; body: any }[] = [];
afterEach(() => { globalThis.fetch = realFetch; sent = []; });
const serve = (value: unknown) => {
  sent = [];
  globalThis.fetch = (async (url: any, init: any) => {
    sent.push({ cmd: String(url).split("api/cmd/")[1] ?? String(url), body: init?.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
};

describe("project ↔ repository commands", () => {
  test("reads are keyed by project id and carry no path", async () => {
    serve(null);
    await platformApi.projectRepoOverview("p1");
    await platformApi.projectRepoReadme("p1");
    expect(sent.map((call) => call.cmd)).toEqual(["project_repo_overview", "project_repo_readme"]);
    for (const call of sent) {
      expect(call.body.projectId ?? call.body.project_id).toBe("p1");
      expect(call.body.path).toBeUndefined();
    }
  });

  test("bind sends the project id and the path, nothing else", async () => {
    serve({ id: "p1", repo_path: "/x" });
    const row = await platformApi.setProjectRepo("p1", "~/projects/old-ones");
    expect(sent[0].cmd).toBe("set_project_repo");
    expect(sent[0].body.path).toBe("~/projects/old-ones");
    expect(sent[0].body.projectId ?? sent[0].body.project_id).toBe("p1");
    expect(row.repo_path).toBe("/x");
  });
});
