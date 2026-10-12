#!/usr/bin/env bun
// tools/space-sync.ts — bun only. Idempotent manifest → gaia-space upsert (projects, hosted repos, tasks, library docs).
// Never deletes. Default is --dry-run (prints exact requests); --apply needs env SPACE_PAT.
//
// Usage:
//   bun run tools/space-sync.ts manifest.yaml [--base-url https://gaia-systems.org/space] [--dry-run | --apply] [--update-docs] [--allow-host H]
//   (host guard: base URL host must be gaia-systems.org unless --allow-host H)
//   SPACE_PAT=spat_… bun run tools/space-sync.ts manifest.yaml --apply
//
// Manifest (YAML or JSON):
//   projects:
//     - name: Orbital                 # match key (case-insensitive) → create_project if missing
//       description: text             # optional
//       key: ORBIT                    # optional explicit project key (alnum, upper-cased); taken → warned + derived instead
//       group: whatever               # NO server concept (projects have no parent) → warned + ignored
//       repo: orbital-core            # or {name, description, branch}; → create_hosted_repo (default branch main)
//       docs: [docs/a.md, {path: b.md, title: B}]   # relative to the manifest; title = first '# ' line | filename
//       tasks:
//         - {title: Do X, notes: md, category: dev, due_date: 2026-12-01, links: [{url: https://…, title: t}]}
//
// Wire facts (src-tauri/src/bin/space-server.rs): POST {base}/api/cmd/<name>, JSON object whose keys are the
// Rust parameter names (nested struct params wrapped: {project:{…}}, {input:{…}}, {document:{…}}); reply
// {ok:true,value}|{ok:false,error}. Auth: Authorization: Bearer spat_… (PAT) or space_session cookie.
// Server never mints project/document ids from '' (client mints); todo id is minted server-side when omitted.

import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

export const DEFAULT_BASE_URL = "https://gaia-systems.org/space";
export const DEFAULT_HOST = "gaia-systems.org";
export const TODO_CATEGORIES = ["create", "improve", "review", "decide", "admin", "dev"] as const;
const NAME_RE = /^[A-Za-z0-9._-]+$/;

export type TaskSpec = { title: string; notes?: string; category?: string; due_date?: string; links?: { url: string; title?: string }[] };
export type DocSpec = { path: string; title?: string };
export type RepoSpec = { name: string; description?: string; branch?: string };
export type ProjectSpec = { name: string; key?: string; group?: string; description?: string; repo?: RepoSpec; docs: DocSpec[]; tasks: TaskSpec[] };
export type Manifest = { projects: ProjectSpec[] };

export type Options = {
  apply: boolean;
  baseUrl: string;
  pat?: string;
  updateDocs: boolean;
  baseDir: string;
  log: (line: string) => void;
  readFile?: (path: string) => string;
};

export type Summary = { created: string[]; skipped: string[]; drift: string[]; warnings: string[] };

// ───────────────────────── manifest ─────────────────────────

export function parseManifest(text: string, filename = "manifest.yaml"): Manifest {
  let raw: any;
  if (filename.endsWith(".json")) raw = JSON.parse(text);
  else {
    const yaml = (globalThis as any).Bun?.YAML;
    if (!yaml) throw new Error("Bun.YAML unavailable — use a .json manifest or bun >= 1.2.21");
    raw = yaml.parse(text);
  }
  if (!raw || !Array.isArray(raw.projects)) throw new Error("manifest needs a top-level `projects:` list");
  const seen = new Set<string>();
  const projects = raw.projects.map((p: any, i: number): ProjectSpec => {
    const at = `projects[${i}]`;
    if (!p || typeof p.name !== "string" || !p.name.trim()) throw new Error(`${at}.name is required`);
    const name = p.name.trim();
    if (seen.has(name.toLowerCase())) throw new Error(`${at}: duplicate project name ${JSON.stringify(name)}`);
    seen.add(name.toLowerCase());
    let repo: RepoSpec | undefined;
    if (p.repo != null) {
      repo = typeof p.repo === "string" ? { name: p.repo } : { name: p.repo.name, description: p.repo.description, branch: p.repo.branch };
      if (typeof repo.name !== "string" || !NAME_RE.test(repo.name)) throw new Error(`${at}.repo name must match [A-Za-z0-9._-]+`);
      if (repo.branch !== undefined && !NAME_RE.test(repo.branch)) throw new Error(`${at}.repo.branch must match [A-Za-z0-9._-]+`);
    }
    const docs = (p.docs ?? []).map((d: any, j: number): DocSpec => {
      const spec = typeof d === "string" ? { path: d } : { path: d?.path, title: d?.title };
      if (typeof spec.path !== "string" || !spec.path) throw new Error(`${at}.docs[${j}] needs a path`);
      return spec;
    });
    const tasks = (p.tasks ?? []).map((t: any, j: number): TaskSpec => {
      if (!t || typeof t.title !== "string" || !t.title.trim()) throw new Error(`${at}.tasks[${j}].title is required`);
      const category = t.category ?? "dev";
      if (!(TODO_CATEGORIES as readonly string[]).includes(category)) throw new Error(`${at}.tasks[${j}].category must be one of ${TODO_CATEGORIES.join("|")}`);
      const links = (t.links ?? []).map((l: any) => {
        if (!l || typeof l.url !== "string") throw new Error(`${at}.tasks[${j}].links[] needs a url`);
        return { url: l.url, title: l.title };
      });
      return { title: t.title.trim(), notes: t.notes == null ? undefined : String(t.notes), category, due_date: t.due_date == null ? undefined : String(t.due_date), links };
    });
    if (p.key != null && !/^[A-Za-z0-9]{1,8}$/.test(String(p.key))) throw new Error(`${at}.key must be 1-8 alphanumerics`);
    return { name, key: p.key == null ? undefined : String(p.key).toUpperCase(), group: p.group, description: p.description, repo, docs, tasks };
  });
  return { projects };
}

// ───────────────────────── naming (mirrors src/views/Projects.tsx) ─────────────────────────

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
export const deriveKey = (name: string, length = 5) => name.replace(/[^a-zA-Z0-9]/g, "").slice(0, length).toUpperCase();
export const uniqueKey = (name: string, taken: Iterable<string>) => {
  const used = new Set(Array.from(taken, (v) => v.toUpperCase()));
  const base = deriveKey(name) || "PROJ";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}${n}`)) return `${base}${n}`;
};
const uniqueId = (base: string, taken: Set<string>) => {
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
};
const docTitle = (spec: DocSpec, body: string) =>
  (spec.title ?? body.match(/^#\s+(.+?)\s*$/m)?.[1] ?? spec.path.split("/").pop()!.replace(/\.[^.]+$/, "")).trim();

// ───────────────────────── host guard ─────────────────────────
/** Refuse any base URL whose host is not gaia-systems.org unless explicitly allowed (--allow-host). */
export function assertHost(baseUrl: string, allow: string[] = []) {
let host: string;
try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { throw new Error(`bad base URL ${JSON.stringify(baseUrl)}`); }
if (host !== DEFAULT_HOST && !allow.some((h) => h.toLowerCase() === host)) throw new Error(`refusing host ${JSON.stringify(host)} (only ${DEFAULT_HOST} unless --allow-host ${host})`);
}
// ───────────────────────── transport ─────────────────────────

type Kind = "read" | "write";

class Client {
  constructor(private o: Options, private f: typeof fetch) {}
  private url(path: string) { return `${this.o.baseUrl.replace(/\/+$/, "")}${path}`; }
  private show(method: string, path: string, kind: Kind, body?: unknown, note = "") {
    this.o.log(`${kind === "read" ? "READ " : "WRITE"} ${method} ${this.url(path)}${note}`);
    this.o.log(`      Authorization: Bearer ${this.o.pat ? "spat_***" : "<SPACE_PAT>"}`);
    if (body !== undefined) this.o.log(`      ${JSON.stringify(body)}`);
  }
  private headers() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.o.pat}` };
  }
  /** Dry-run without a PAT performs no network at all (reads return undefined → caller assumes empty remote). */
  get offline() { return !this.o.apply && !this.o.pat; }

  async me(): Promise<{ username: string; profile_id: string } | undefined> {
    this.show("GET", "/api/auth/me", "read", undefined, this.offline ? "   (skipped: offline dry-run)" : "");
    if (this.offline) return undefined;
    const res = await this.f(this.url("/api/auth/me"), { headers: this.headers() });
    if (!res.ok) throw new Error(`auth/me → HTTP ${res.status} (bad or expired SPACE_PAT?)`);
    return ((await res.json()) as any).user;
  }

  async cmd<T = unknown>(name: string, args: Record<string, unknown>, kind: Kind, placeholder?: T): Promise<T | undefined> {
    const path = `/api/cmd/${name}`;
    if (kind === "write" && !this.o.apply) {
      this.show("POST", path, kind, args, "   (dry-run: not sent)");
      return placeholder;
    }
    if (this.offline) {
      this.show("POST", path, kind, args, "   (skipped: offline dry-run, remote assumed empty)");
      return undefined;
    }
    this.show("POST", path, kind, args);
    const res = await this.f(this.url(path), { method: "POST", headers: this.headers(), body: JSON.stringify(args) });
    let body: any;
    try { body = await res.json(); } catch { throw new Error(`${name}: bad response (HTTP ${res.status})`); }
    if (!res.ok || body?.ok === false) throw new Error(`${name}: ${body?.error ?? `HTTP ${res.status}`}`);
    return body.value as T;
  }
}

// ───────────────────────── sync ─────────────────────────

type RProject = { id: string; name: string; key: string; archived: boolean };
type RTodo = { id: string; content: string };
type RDoc = { id: string; container_type: string; container_id: string | null; title: string; body: string | null; archived: boolean };
type RRepo = { name: string };

export async function sync(manifest: Manifest, o: Options, f: typeof fetch = fetch): Promise<Summary> {
  assertHost(o.baseUrl, o.allowHosts);
  const c = new Client(o, f);
  const out: Summary = { created: [], skipped: [], drift: [], warnings: [] };
  const read = o.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const mode = o.apply ? "APPLY" : "DRY-RUN";
  o.log(`# space-sync ${mode} → ${o.baseUrl}`);

  const who = await c.me();
  if (who) o.log(`# acting as ${who.username} (profile ${who.profile_id})`);

  const projects = (await c.cmd<RProject[]>("list_projects", {}, "read")) ?? [];
  const docsAll = manifest.projects.some((p) => p.docs.length) ? ((await c.cmd<RDoc[]>("list_documents", {}, "read")) ?? []) : [];
  const takenKeys = new Set(projects.map((p) => p.key));
  const takenIds = new Set(projects.map((p) => p.id));
  const takenDocIds = new Set(docsAll.map((d) => d.id));

  for (const spec of manifest.projects) {
    o.log(`\n## project ${JSON.stringify(spec.name)}`);
    if (spec.group) out.warnings.push(`${spec.name}: \`group: ${spec.group}\` ignored — projects have no parent/group on the server`);

    // project
    let found = projects.find((p) => p.name.trim().toLowerCase() === spec.name.toLowerCase() && !p.archived)
      ?? projects.find((p) => p.name.trim().toLowerCase() === spec.name.toLowerCase());
    let pid: string;
    if (found) {
      pid = found.id;
      out.skipped.push(`project ${spec.name} (${pid}${found.archived ? ", archived" : ""})`);
      if (found.archived) out.warnings.push(`${spec.name}: matched an ARCHIVED project, not recreating`);
    } else {
      pid = uniqueId(`proj-${slug(spec.name) || "x"}`, takenIds);
      takenIds.add(pid);
      let key = spec.key ?? uniqueKey(spec.name, takenKeys);
      if (spec.key && takenKeys.has(spec.key)) { const alt = uniqueKey(spec.name, takenKeys); out.warnings.push(`${spec.name}: key ${spec.key} already taken → using ${alt}`); key = alt; }
      takenKeys.add(key);
      await c.cmd("create_project", {
        project: { id: pid, name: spec.name, key, description: spec.description ?? null, deadline: null, archived: false, status: "open", lead_id: null },
      }, "write");
      out.created.push(`project ${spec.name} (${pid}, key ${key})`);
    }
    const isNew = !found;

    // hosted repo
    if (spec.repo) {
      const repos = isNew ? [] : ((await c.cmd<RRepo[]>("list_hosted_repos", { project_id: pid }, "read")) ?? []);
      if (repos.some((r) => r.name === spec.repo!.name)) out.skipped.push(`repo ${spec.repo.name}`);
      else {
        if (isNew) o.log("      (project is new → repo list skipped, nothing can exist yet)");
        await c.cmd("create_hosted_repo", { project_id: pid, name: spec.repo.name, description: spec.repo.description ?? null, default_branch: spec.repo.branch ?? "main" }, "write");
        out.created.push(`repo ${pid}/${spec.repo.name}`);
      }
    }

    // docs (project library: container_type 'project'; server creates the 'Documents' root folder when folder_id is null)
    for (const d of spec.docs) {
      const body = read(resolve(o.baseDir, d.path));
      const title = docTitle(d, body);
      const existing = docsAll.find((x) => x.container_type === "project" && x.container_id === pid && x.title.trim() === title && !x.archived);
      if (existing) {
        if ((existing.body ?? "") === body) out.skipped.push(`doc ${title}`);
        else if (o.updateDocs) {
          await c.cmd("save_document", { id: existing.id, title, body, actor: null }, "write");
          out.created.push(`doc ${title} (updated body, new version)`);
        } else {
          out.drift.push(`doc ${title} (${existing.id}) body differs from ${d.path} — pass --update-docs to push`);
          o.log(`      drift: doc ${JSON.stringify(title)} differs; not touching (no --update-docs)`);
        }
        continue;
      }
      const id = uniqueId(`doc-${pid}-${slug(title) || "doc"}`.slice(0, 120), takenDocIds);
      takenDocIds.add(id);
      await c.cmd("create_document", {
        document: { id, container_type: "project", container_id: pid, folder_id: null, doc_type: "text", body_format: "text", kind: "markdown", title, body, version: 1, archived: false, created_by: null },
      }, "write");
      out.created.push(`doc ${title} (${id})`);
    }

    // tasks (tickets ≡ tasks since V143; list_project_todos is the shared surface, create_todo with project_id)
    if (spec.tasks.length) {
      const todos = isNew ? [] : ((await c.cmd<RTodo[]>("list_project_todos", { project_id: pid, profile_id: "", include_done: true, admin: false }, "read")) ?? []);
      const have = new Set(todos.map((t) => t.content.trim().toLowerCase()));
      for (const t of spec.tasks) {
        const k = t.title.toLowerCase();
        if (have.has(k)) { out.skipped.push(`task ${t.title}`); continue; }
        have.add(k);
        const created = await c.cmd<{ id: string }>("create_todo", {
          input: {
            profile_id: "", content: t.title, due_date: t.due_date ?? null, project_id: pid, done: false,
            source_entity_type: null, source_entity_id: null, notes: t.notes ?? null, assignee_ids: [],
            content_kind: "markdown", category: t.category ?? "dev", links: [],
          },
        }, "write", { id: "<new-todo-id>" });
        out.created.push(`task ${t.title}`);
        for (const l of t.links ?? []) {
          await c.cmd("add_todo_link", { input: { todo_id: created!.id, kind: "EXTERNAL", url: l.url, target_id: null, title: l.title ?? null } }, "write");
        }
      }
    }
  }

  o.log(`\n# ${mode} summary: ${out.created.length} to create/update, ${out.skipped.length} already present, ${out.drift.length} drift, ${out.warnings.length} warnings`);
  for (const w of out.warnings) o.log(`# warn: ${w}`);
  for (const d of out.drift) o.log(`# drift: ${d}`);
  return out;
}

// ───────────────────────── cli ─────────────────────────

export function parseArgs(argv: string[]) {
  const a = { file: "", apply: false, dry: false, updateDocs: false, allowHosts: [] as string[], baseUrl: process.env.SPACE_BASE_URL ?? DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--apply") a.apply = true;
    else if (v === "--dry-run") a.dry = true;
    else if (v === "--update-docs") a.updateDocs = true;
    else if (v === "--base-url") a.baseUrl = argv[++i] ?? "";
    else if (v === "--allow-host") a.allowHosts.push(argv[++i] ?? "");
    else if (v.startsWith("--")) throw new Error(`unknown flag ${v}`);
    else if (!a.file) a.file = v;
    else throw new Error(`unexpected argument ${v}`);
  }
  if (!a.file) throw new Error("usage: space-sync.ts <manifest.yaml|json> [--dry-run|--apply] [--update-docs] [--base-url URL] [--allow-host H]");
  if (a.apply && a.dry) throw new Error("--apply and --dry-run are mutually exclusive");
  return a;
}

if (import.meta.main) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const pat = process.env.SPACE_PAT?.trim() || undefined;
    if (a.apply && !pat) throw new Error("--apply requires env SPACE_PAT (spat_…)");
    const file = resolve(a.file);
    const manifest = parseManifest(readFileSync(file, "utf8"), file);
    const s = await sync(manifest, { apply: a.apply, baseUrl: a.baseUrl, pat, updateDocs: a.updateDocs, allowHosts: a.allowHosts, baseDir: dirname(file), log: (l) => console.log(l) });
    process.exit(s.drift.length && a.apply ? 3 : 0);
  } catch (e) {
    console.error(`space-sync: ${(e as Error).message}`);
    process.exit(2);
  }
}
