# ADVERSARY review — feat/github-push-bridge @ 6cec7e7

reviewer: ghoul-sonnet · worktree: gaia-space-wt-ghpush-adv (removed on exit)

## 1. HMAC — PASS
verify.ts:1-22. sha256= prefix required (L20). timing-safe compare, equal-length guard, XOR accumulate (L14-18) — not crypto.timingSafeEqual/Bun.CryptoHasher, but correct manual pattern; digest is fixed-length hex so the length-guard leaks nothing exploitable. index.ts:59-60: raw = await request.text() then verifyGitHubSignature BEFORE JSON.parse (L61) — malformed/missing header → 401 without touching body parsing. HMAC is computed over the UTF-8 re-encoding of the decoded text, not the literal wire bytes — sound for GitHub JSON webhooks (always UTF-8) but not literally raw-byte. No secret ever passed to console.* (grep clean across index.ts/space.ts/config.ts/state.ts/verify.ts).

## 2. Dedupe — WEAK
Persisted, bounded 500 (state.ts:9,15,18). Missing X-GitHub-Delivery → dedupe skipped but event still posted once (index.ts:59-64) — correct.
WEAK — state.ts:14: `Bun.write(path, ...)` writes directly to the target path, not temp+rename. A crash mid-write can truncate/corrupt state.json, losing delivery history (next redelivery would double-post, not double-execute anything unsafe, but violates "atomic-ish").
Fix (state.ts:13-15):
```ts
export async function saveState(path: string, state: DeliveryState): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await Bun.write(tmp, `${JSON.stringify({ deliveryIds: state.deliveryIds.slice(-500) }, null, 2)}\n`);
  await Bun.file(tmp).exists() && (await import("node:fs/promises")).then(fs => fs.rename(tmp, path));
}
```
(or use `node:fs/promises` rename directly — write-temp-then-rename is the standard atomic-ish pattern on POSIX.)

## 3. /notify — WEAK
Bearer timing-safe (index.ts:39). NOTIFY_TOKEN required at boot, empty/missing → ConfigError, process refuses to start — not default-open (config.ts:47-49, `required()`). PASS on both.
WEAK — index.ts:16-22 `notificationInput`: no upper bound on `text`/`url` length. A single caller with the bearer token can push an arbitrarily large body into Space.
Fix (index.ts:16-22), add a cap, e.g.:
```ts
if (input.text.length > 4000 || (input.url !== undefined && input.url.length > 2000)) return null;
```

## 4. Space posting — PASS (documented tradeoff)
Token-or-cookie (space.ts:16-32). Retry once, 5xx only, not 4xx (space.ts:36-40). Webhook handler always returns 200 after recording the delivery ID, even if the Space post ultimately fails — post() swallows the error into `metrics.failed` + console.error (index.ts:27-33); chosen behavior is stated in README ("failure → logged/counted, process continues"). Sane: avoids GitHub retry storms since the delivery ID is already persisted before the post is attempted, so a GH-side redelivery would just hit `duplicate:true` and never re-post either. Tradeoff: a sustained Space outage silently drops messages beyond the one built-in retry, with no re-delivery path — acceptable for a best-effort notifier, not for anything requiring guaranteed delivery.
Minor gap: `/health` (index.ts:38) exposes `posted`/`lastDeliveryAt` but not `failed` — add `failed: metrics.failed` to the health payload for ops visibility.
REPO_CHANNEL_MAP → SPACE_CHANNEL_ID fallback: PASS (index.ts:14, `channelFor`). MAX_COMMITS respected + "+N more": PASS (format.ts:24-26), verified live below.

## 5. Formatting — PASS (no crashes), two cosmetic WEAKs
`bun test` must run from `bridge/github-push/` (root bunfig.toml:1-5 preloads `test/solid-dom-preload.ts` for the whole monorepo, which needs `@happy-dom/global-registrator` not installed in this worktree — running `bun test bridge/github-push/` from repo root fails on that preload, not on the bridge code). README already says `cd bridge/github-push && bun test` (README.md:57) — correct instruction.
```
bun test v1.3.14
 11 pass, 0 fail, 21 expect() calls — 4 files (format/index/space/verify)
```
Hand-crafted payloads (proof/ghpush-adv/manual-format-check.ts), actual output:
```
=== deleted branch ===
null (ignored)

=== force-push ===
⬆ acme/repo → main · 1 commits by bob
• bbbbbbb rewrite history — Bob
https://github.com/acme/repo/compare/aaaaaaa...bbbbbbb

=== zero commits ===
⬆ acme/repo → main · 0 commits by carol
https://github.com/acme/repo/compare/ccccccc...ddddddd

=== tag push ===
⬆ acme/repo → refs/tags/v1.2.3 · 1 commits by dave
• eeeeeee release commit — Dave
https://github.com/acme/repo/compare/eeeeeee...fffffff

=== PR closed merged:false ===
🔀 acme/repo PR #42 closed: Abandon this approach (by erin)
main ← erin/scrapped
https://github.com/acme/repo/pull/42

=== release published ===
🏷 acme/repo release: v1.2.3
https://github.com/acme/repo/releases/tag/v1.2.3
```
No crash on any case. Two cosmetic WEAKs:
- format.ts:19 only strips `refs/heads/` — tag pushes render `→ refs/tags/v1.2.3` instead of `→ v1.2.3`. Fix: `text(event.ref, "unknown").replace(/^refs\/(heads|tags)\//, "")`.
- `forced:true` is silently ignored — a force-push looks identical to a normal push. Fix (format.ts:22-27), prefix the header line when `event.forced === true`, e.g. `⚡ force-pushed` marker.

## 6. Deploy files — WEAK (2 items), rest PASS
Caddy (deploy/caddy-github-push.snippet:1-4 `handle /space/hooks/*`): live `/etc/caddy/Caddyfile` (checked read-only) currently has, in order inside the `route` block: `handle /space/api/*` then `handle_path /space/*` (the SPA catch-all/file_server). `handle`/`handle_path` are matched in written order, first match wins — the hooks block MUST be placed before `handle_path /space/*` or the SPA fallback swallows it. README.md:36 already instructs "Add ... before the /space SPA fallback" — correct guidance. `uri strip_prefix /space` on `/space/hooks/github` → `/hooks/github`, matches the server's route check (bridge/github-push/index.ts:57 `pathname !== "/hooks/github"`) — PASS.
systemd (deploy/gaia-space-github-push.service:7-9): `WorkingDirectory=/opt/gaia-space-repo`, `ExecStart=/usr/local/bin/bun run bridge/github-push/index.ts` — verified live on the box (read-only ssh): `/opt/gaia-space-repo` exists, is a real git clone of `origin/gaia-space` (currently at master `564424d`), and `/usr/local/bin/bun` exists. Paths are CORRECT.
WEAK — the checkout at `/opt/gaia-space-repo` is on `master`, not `feat/github-push-bridge`; `bun run bridge/github-push/index.ts` runs source directly from that checkout, and README's Deploy section (README.md:33-38) has no step to advance it (e.g. `git fetch && git checkout <ref>`) before `systemctl enable --now`. Add a line before README.md:35: `cd /opt/gaia-space-repo && git fetch && git checkout <merge-commit-or-branch>`.
WEAK — EnvironmentFile ownership: README.md:22 recommends `install -o gaia-space -g gaia-space -m 0600 ... github-push.env`. systemd's `EnvironmentFile=` is read by systemd (PID 1, root) BEFORE it drops privileges to `User=gaia-space` to exec the process — the service user never needs direct filesystem read access to that file. The existing sibling unit's convention on this exact box is `root:root 0600` (`ls -la /etc/gaia-space.env` → `-rw-------. 1 root root`). Recommendation: match that convention — `root:root` (or `root:gaia-space`) `0600` — so a compromised gaia-space-owned process can't read/tamper the raw secrets file on disk (it still gets the resolved env vars at exec, which is unavoidable, but not read access to the file itself for exfil via other means). Fix (README.md:21-22):
```sh
install -d -o root -g root -m 0750 /etc/gaia-space
install -o root -g root -m 0600 /dev/null /etc/gaia-space/github-push.env
```

## 7. Law scan — PASS
No hardcoded secrets/tokens; all required config has no default (config.ts:47-49 GITHUB_WEBHOOK_SECRET/NOTIFY_TOKEN, config.ts:54-55 SPACE_TOKEN-or-creds) — only non-secret operational values (port, URL, channel, state path, max commits) have defaults. No `/tmp` reference anywhere in bridge/github-push/* or deploy/*. No secret values passed to console.log/console.error (grep clean). No junk files (fixtures/*.json are legitimate test fixtures; no .orig/.bak/.DS_Store).

## Summary
BLOCK: none.
WEAK (5): dedupe state write not atomic (state.ts:14) · /notify text/url unbounded size (index.ts:16-22) · tag-push label not stripped (format.ts:19) · force-push not flagged in output (format.ts:22-27) · deploy checkout-sync step missing + EnvironmentFile ownership should be root:root not gaia-space:gaia-space (README.md:21-22,33-38).
PASS: HMAC verification/timing-safety/ordering, secret non-logging, Space posting retry/fallback/channel-routing/MAX_COMMITS, Caddy ordering guidance, systemd paths (verified live against the box), law scan.
