#!/usr/bin/env bun
// tools/purge-proof-accounts.ts — bun only.
// List/delete gaia-space proof+test fixture accounts via the admin HTTP API.
// Any lane that creates ephemeral accounts should run this in --verify mode
// at lane end (see HANDOFF.md).
//
// Usage:
//   bun run tools/purge-proof-accounts.ts --base-url http://127.0.0.1:8090 --token spat_xxx [--dry-run] [--verify]
//
// Auth: --token is sent as `Authorization: Bearer <token>` (spat_ PAT) unless
// --cookie is given instead (raw `Cookie:` header value, e.g. from a session login).
// Params are never hardcoded secrets — token/cookie/base-url are CLI args or env
// fallbacks (PURGE_BASE_URL, PURGE_TOKEN, PURGE_COOKIE), all optional with safe
// localhost defaults.

type Options = {
  baseUrl: string;
  token?: string;
  cookie?: string;
  pattern: string;
  minAgeMinutes: number;
  dryRun: boolean;
  verify: boolean;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8090";
// Username prefixes OR display-name substrings that mark a proof/test fixture.
// Mirrors the PURGE LANE spec: /^(calls-proof|cw-calls|cw-slim|cw-video|cw-inspect|proof-|zz-proof-)/
// OR display_name matching /proof|inspect|CW CSS|CW Video Live|CW Slim/i.
const DEFAULT_PATTERN =
  String.raw`^(calls-proof|cw-calls|cw-slim|cw-video|cw-inspect|proof-|zz-proof-)|proof|inspect|CW CSS|CW Video Live|CW Slim`;
const DEFAULT_MIN_AGE_MINUTES = 20;

function usage(): never {
  throw new Error(
    "Usage: bun run tools/purge-proof-accounts.ts [--base-url <url>] [--token <spat_...>] [--cookie <raw-cookie-header>] " +
      "[--pattern <regex>] [--min-age-minutes <n>] [--dry-run <true|false>] [--verify]\n" +
      "Env fallbacks: PURGE_BASE_URL, PURGE_TOKEN, PURGE_COOKIE.",
  );
}

function boolOption(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  usage();
}

function parseArgs(args: string[]): Options {
  let baseUrl = process.env.PURGE_BASE_URL ?? DEFAULT_BASE_URL;
  let token = process.env.PURGE_TOKEN;
  let cookie = process.env.PURGE_COOKIE;
  let pattern = DEFAULT_PATTERN;
  let minAgeMinutes = DEFAULT_MIN_AGE_MINUTES;
  let dryRun = true;
  let verify = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => args[++index] ?? usage();
    switch (arg) {
      case "--base-url": baseUrl = value(); break;
      case "--token": token = value(); break;
      case "--cookie": cookie = value(); break;
      case "--pattern": pattern = value(); break;
      case "--min-age-minutes": {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed < 0) throw new Error("--min-age-minutes must be a non-negative number");
        minAgeMinutes = parsed;
        break;
      }
      case "--dry-run": dryRun = boolOption(value(), true); break;
      case "--verify": verify = true; break;
      case "--help": usage();
      default: usage();
    }
  }
  return { baseUrl, token, cookie, pattern, minAgeMinutes, dryRun, verify };
}

type ApiUser = {
  id: string;
  username: string;
  display_name: string;
  profile_id: string;
  role: string;
  active: boolean;
  // Not guaranteed by every deployed server build — used opportunistically
  // for age filtering when present. Absent => treated as "age unknown".
  created_at?: number;
};

function authHeaders(o: Options): Record<string, string> {
  const h: Record<string, string> = {};
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  if (o.cookie) h.Cookie = o.cookie;
  return h;
}

async function listUsers(o: Options): Promise<ApiUser[]> {
  const res = await fetch(`${o.baseUrl}/api/users`, { headers: authHeaders(o) });
  if (!res.ok) throw new Error(`GET /api/users failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ApiUser[];
}

async function deleteUser(o: Options, id: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${o.baseUrl}/api/users/${id}`, { method: "DELETE", headers: authHeaders(o) });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// Best-effort age extraction: proof-lane usernames embed a creation timestamp
// (epoch ms, epoch s, or YYYYMMDDtHHMMSSz). If `created_at` is present on the
// API row, that always wins. Otherwise try to parse one out of the username;
// if nothing parses, age is unknown and the account is treated as eligible
// (not deferred) — the pattern match itself is the safety gate, --dry-run is
// the default, and a human reviews output before a real run.
function ageMinutes(u: ApiUser, nowMs: number): number | null {
  if (typeof u.created_at === "number" && u.created_at > 0) {
    const createdMs = u.created_at > 1e12 ? u.created_at : u.created_at * 1000; // s vs ms
    return (nowMs - createdMs) / 60000;
  }
  const msMatch = u.username.match(/(\d{13})/);
  if (msMatch) return (nowMs - Number(msMatch[1])) / 60000;
  const sMatch = u.username.match(/(?<!\d)(\d{10})(?!\d)/);
  if (sMatch) return (nowMs - Number(sMatch[1]) * 1000) / 60000;
  const isoMatch = u.username.match(/(\d{8})t(\d{6})z/i);
  if (isoMatch) {
    const [, ymd, hms] = isoMatch;
    const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return (nowMs - parsed) / 60000;
  }
  return null;
}

function matches(u: ApiUser, re: RegExp): boolean {
  return re.test(u.username) || re.test(u.display_name);
}

async function main() {
  const o = parseArgs(Bun.argv.slice(2));
  const re = new RegExp(o.pattern, "i");
  const users = await listUsers(o);
  const now = Date.now();

  const matched = users.filter((u) => matches(u, re));
  const deferred: ApiUser[] = [];
  const eligible: ApiUser[] = [];
  for (const u of matched) {
    const age = ageMinutes(u, now);
    if (age !== null && age < o.minAgeMinutes) deferred.push(u);
    else eligible.push(u);
  }

  console.log(`base_url=${o.baseUrl} pattern=${JSON.stringify(o.pattern)} min_age_minutes=${o.minAgeMinutes} dry_run=${o.dryRun} verify=${o.verify}`);
  console.log(`total_users=${users.length} matched=${matched.length} eligible=${eligible.length} deferred=${deferred.length}`);
  for (const u of eligible) console.log(`ELIGIBLE  ${u.username}\t${u.display_name}\t${u.id}`);
  for (const u of deferred) console.log(`DEFERRED  ${u.username}\t${u.display_name}\t${u.id}\t(age<${o.minAgeMinutes}min)`);

  if (o.verify) {
    if (matched.length > 0) {
      console.error(`VERIFY FAILED: ${matched.length} proof-pattern account(s) still present.`);
      process.exit(1);
    }
    console.log("VERIFY OK: no proof-pattern accounts remain.");
    process.exit(0);
  }

  if (eligible.length === 0) {
    console.log("nothing to delete.");
    return;
  }

  if (o.dryRun) {
    console.log(`DRY RUN: would delete ${eligible.length} account(s). Re-run with --dry-run false to apply.`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const u of eligible) {
    const result = await deleteUser(o, u.id);
    if (result.ok) {
      ok += 1;
      console.log(`DELETED  ${u.username}\t${u.id}`);
    } else {
      fail += 1;
      console.error(`DELETE FAILED  ${u.username}\t${u.id}\tstatus=${result.status}\t${result.body}`);
    }
  }
  console.log(`deleted_ok=${ok} deleted_fail=${fail}`);
  // Note: DELETE /api/users/{id} removes the users+sessions rows only — it
  // does not cascade profiles/channels/messages/meetings (see space-server.rs
  // delete_user). Fixture channels/meetings left behind by deleted accounts
  // need a follow-up orphan sweep (direct SQL, inside one transaction, after
  // a fresh `cp space.db space.db.bak-<date>`) — this script only owns the
  // account layer, which is what a proof lane creates and must clean up.
  if (fail > 0) process.exit(1);
}

await main();
