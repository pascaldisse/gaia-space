import { describe, expect, test } from "bun:test";
import { parseArgs, parseManifest, sync, uniqueKey, type Options } from "./space-sync";

const PAT = "spat_SECRETSECRETSECRET";
const BASE = "https://space.test/space";

const MANIFEST = parseManifest(`
projects:
  - name: Orbital Lab
    group: labs
    description: sample
    repo: {name: orbital-core, branch: main}
    docs: [docs/intro.md]
    tasks:
      - {title: Ship v1, notes: "- a\\n- b", category: dev, links: [{url: "https://example.org/x", title: x}]}
      - {title: Write docs}
`);
const FILES: Record<string, string> = { "/m/docs/intro.md": "# Intro Doc\n\nhello\n" };

/** Stateful fake of the bits of space-server we touch. Records every request. */
function fakeServer(seed: { projects?: any[]; docs?: any[]; todos?: any[]; repos?: any[] } = {}) {
  const st = { projects: [...(seed.projects ?? [])], docs: [...(seed.docs ?? [])], todos: [...(seed.todos ?? [])], repos: [...(seed.repos ?? [])] };
  const calls: { url: string; auth: string | null; body: any }[] = [];
  const f = (async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    const auth = init.headers?.Authorization ?? null;
    calls.push({ url, auth, body });
    const ok = (value: unknown) => new Response(JSON.stringify({ ok: true, value }));
    if (auth !== `Bearer ${PAT}`) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    if (url.endsWith("/api/auth/me")) return new Response(JSON.stringify({ user: { username: "bot", profile_id: "profile-bot" } }));
    const cmd = url.split("/api/cmd/")[1];
    switch (cmd) {
      case "list_projects": return ok(st.projects);
      case "create_project": st.projects.push({ ...body.project, created_by: "profile-bot" }); return ok(null);
      case "list_documents": return ok(st.docs);
      case "create_document": st.docs.push(body.document); return ok(null);
      case "save_document": { const d = st.docs.find((x) => x.id === body.id)!; d.body = body.body; return ok(d); }
      case "list_hosted_repos": return ok(st.repos.filter((r) => r.project_id === body.project_id));
      case "create_hosted_repo": st.repos.push({ project_id: body.project_id, name: body.name }); return ok({ id: "git-1" });
      case "list_project_todos": return ok(st.todos.filter((t) => t.project_id === body.project_id));
      case "create_todo": { const t = { id: `todo-${st.todos.length + 1}`, ...body.input, content: body.input.content }; st.todos.push(t); return ok(t); }
      case "add_todo_link": return ok({ id: "l1" });
      default: return new Response(JSON.stringify({ ok: false, error: "unknown command" }), { status: 404 });
    }
  }) as unknown as typeof fetch;
  return { f, st, calls, cmds: () => calls.map((c) => c.url.split("/api/")[1]) };
}

const opts = (over: Partial<Options> = {}): Options & { lines: string[] } => {
  const lines: string[] = [];
  return { apply: false, baseUrl: BASE, pat: PAT, updateDocs: false, baseDir: "/m", log: (l) => lines.push(l), readFile: (p) => FILES[p] ?? (() => { throw new Error(`no ${p}`); })(), lines, ...over };
};

const WRITES = ["create_project", "create_hosted_repo", "create_document", "create_todo", "save_document", "add_todo_link"];
const writes = (cmds: string[]) => cmds.filter((c) => WRITES.some((w) => c.endsWith(w)));

describe("space-sync", () => {
  test("dry-run with PAT reads but never writes", async () => {
    const s = fakeServer();
    const o = opts();
    const r = await sync(MANIFEST, o, s.f);
    expect(writes(s.cmds())).toEqual([]);
    expect(s.cmds()).toContain("cmd/list_projects");
    expect(r.created.length).toBe(5); // project, repo, doc, 2 tasks
    expect(o.lines.join("\n")).toContain("WRITE POST https://space.test/space/api/cmd/create_project");
    expect(r.warnings.join()).toContain("group");
  });

  test("offline dry-run (no PAT) does zero network", async () => {
    const s = fakeServer();
    const o = opts({ pat: undefined });
    await sync(MANIFEST, o, s.f);
    expect(s.calls.length).toBe(0);
    expect(o.lines.join("\n")).toContain("<SPACE_PAT>");
  });

  test("apply creates with the exact envelopes, in order", async () => {
    const s = fakeServer();
    const o = opts({ apply: true });
    await sync(MANIFEST, o, s.f);
    expect(writes(s.cmds())).toEqual(["cmd/create_project", "cmd/create_hosted_repo", "cmd/create_document", "cmd/create_todo", "cmd/add_todo_link", "cmd/create_todo"]);
    const byCmd = (n: string) => s.calls.filter((c) => c.url.endsWith(`/api/cmd/${n}`));
    const proj = byCmd("create_project")[0].body.project;
    expect(proj).toMatchObject({ id: "proj-orbital-lab", name: "Orbital Lab", key: "ORBIT", archived: false, status: "open" });
    expect(byCmd("create_hosted_repo")[0].body).toEqual({ project_id: "proj-orbital-lab", name: "orbital-core", description: null, default_branch: "main" });
    const doc = byCmd("create_document")[0].body.document;
    expect(doc).toMatchObject({ container_type: "project", container_id: "proj-orbital-lab", folder_id: null, title: "Intro Doc", kind: "markdown", version: 1 });
    const todo = byCmd("create_todo")[0].body.input;
    expect(todo).toMatchObject({ content: "Ship v1", project_id: "proj-orbital-lab", category: "dev", done: false, assignee_ids: [] });
    expect(byCmd("add_todo_link")[0].body.input).toMatchObject({ todo_id: "todo-1", kind: "EXTERNAL", url: "https://example.org/x" });
    expect(s.calls.every((c) => c.auth === `Bearer ${PAT}`)).toBe(true);
  });

  test("second apply is a no-op (idempotent), never deletes", async () => {
    const s = fakeServer();
    await sync(MANIFEST, opts({ apply: true }), s.f);
    s.calls.length = 0;
    const r = await sync(MANIFEST, opts({ apply: true }), s.f);
    expect(writes(s.cmds())).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.skipped.length).toBe(5);
    expect(s.cmds().some((c) => c.includes("delete"))).toBe(false);
  });

  test("existing project (case-insensitive) is reused; missing task/doc still created", async () => {
    const s = fakeServer({ projects: [{ id: "p-existing", name: "orbital lab", key: "ORBIT", archived: false }], todos: [{ id: "t0", project_id: "p-existing", content: "ship V1" }] });
    const r = await sync(MANIFEST, opts({ apply: true }), s.f);
    expect(s.cmds()).not.toContain("cmd/create_project");
    expect(s.calls.filter((c) => c.url.endsWith("create_todo")).map((c) => c.body.input.content)).toEqual(["Write docs"]);
    expect(s.calls.find((c) => c.url.endsWith("create_document"))!.body.document.container_id).toBe("p-existing");
    expect(r.skipped.some((x) => x.startsWith("task Ship v1"))).toBe(true);
  });

  test("doc drift is reported, only pushed with --update-docs", async () => {
    const seed = { projects: [{ id: "p1", name: "Orbital Lab", key: "ORBIT", archived: false }], docs: [{ id: "d1", container_type: "project", container_id: "p1", title: "Intro Doc", body: "old", archived: false }] };
    const a = fakeServer(seed);
    const ra = await sync(MANIFEST, opts({ apply: true }), a.f);
    expect(ra.drift.length).toBe(1);
    expect(a.cmds()).not.toContain("cmd/save_document");
    const b = fakeServer(seed);
    await sync(MANIFEST, opts({ apply: true, updateDocs: true }), b.f);
    expect(b.calls.find((c) => c.url.endsWith("save_document"))!.body).toEqual({ id: "d1", title: "Intro Doc", body: FILES["/m/docs/intro.md"], actor: null });
  });

  test("the PAT never appears in output", async () => {
    const s = fakeServer();
    const o = opts({ apply: true });
    await sync(MANIFEST, o, s.f);
    expect(o.lines.join("\n")).not.toContain("SECRET");
  });

  test("server error aborts with the command name", async () => {
    const s = fakeServer();
    await expect(sync(MANIFEST, opts({ apply: true, pat: "spat_wrong" }), s.f)).rejects.toThrow(/auth\/me|unauthorized/);
  });

  test("uniqueKey counts up like the UI; manifest validation", () => {
    expect(uniqueKey("Orbital", ["ORBIT"])).toBe("ORBIT2");
    expect(() => parseManifest("projects: [{name: A, tasks: [{title: t, category: nope}]}]")).toThrow(/category/);
    expect(() => parseManifest("projects: [{name: A, repo: 'bad name'}]")).toThrow(/repo name/);
    expect(() => parseManifest("projects: [{name: A},{name: a}]")).toThrow(/duplicate/);
  });

  test("CLI: --apply without SPACE_PAT is refused (exit 2); --apply+--dry-run rejected", async () => {
    expect(() => parseArgs(["m.yaml", "--apply", "--dry-run"])).toThrow(/mutually/);
    const p = Bun.spawn(["bun", "run", `${import.meta.dir}/space-sync.ts`, "nope.yaml", "--apply"], { env: { ...process.env, SPACE_PAT: "" }, stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(2);
    expect(await new Response(p.stderr).text()).toContain("requires env SPACE_PAT");
  });
});
