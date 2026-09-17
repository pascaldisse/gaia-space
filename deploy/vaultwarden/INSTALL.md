# Vaultwarden sidecar — install notes (box: root@151.115.73.182)

## Build
Tag: 1.37.3 · commit eb212e23fad88e6136723f43e5b73543fa7026d3
```
cd /opt && git clone --depth 1 --branch 1.37.3 https://github.com/dani-garcia/vaultwarden.git vaultwarden-src
cd vaultwarden-src && cargo build --release --features sqlite   # ~15min on 4-core box, nohup+log if long
cp target/release/vaultwarden /usr/local/bin/vaultwarden
```

## Admin auth method (source-verified: src/api/admin.rs, src/auth.rs)
NO Bearer-header admin auth. `AdminToken` FromRequest guard requires cookie
`VW_ADMIN` (JWT, path=`{domain_path}/admin`, HttpOnly, SameSite=Strict) —
Bearer header (`src/auth.rs:640`) is only used by the regular user `Headers`
guard (`/api`, `/identity` etc.), never by `AdminToken`.
Server-to-server flow:
1. `POST {domain_path}/admin` form-urlencoded `token=<ADMIN_TOKEN>` (+ optional
   `redirect`) → validated by `validate_token()` (admin.rs:230; ct_eq on plain
   token, or argon2 verify if `ADMIN_TOKEN` starts with `$argon2`) → sets
   `Set-Cookie: VW_ADMIN=<jwt>`.
2. Reuse that cookie on every subsequent `/admin/*` call (`_token: AdminToken`
   param on each route, e.g. admin.rs:308 `invite_user`).
Invite: `POST /admin/invite` JSON `{"email":...}`.
Delete: `POST /admin/users/<id>/delete` (NOT `DELETE /admin/users/<id>` — that
404s; only `GET /admin/users/<id>` and `POST .../delete` exist, admin.rs:409,419).

## System user / paths
- user: `vaultwarden` (system, nologin)
- data: `/var/lib/vaultwarden` (owner vaultwarden:vaultwarden, 750)
- env: `/etc/vaultwarden/vaultwarden.env` (root:vaultwarden, 640) — see
  `vaultwarden.env.example` in this dir. Plain `ADMIN_TOKEN` also mirrored to
  `/root/.vaultwarden-admin-token` (600, root-only) for server-to-server calls
  (this vaultwarden version accepts a plain token directly — no forced hashing).
- unit: `/etc/systemd/system/vaultwarden.service` — see `vaultwarden.service`
  in this dir. `systemctl enable --now vaultwarden`.

## Caddy — handle vs handle_path
DECISION: `handle` (full path forwarded), **not** `handle_path` — no prefix
stripping.
REASON (source-verified, src/main.rs `launch_rocket`): rocket mounts every
route group at `[CONFIG.domain_path(), "/api"|"/admin"|"/identity"|...]`
concat — `domain_path` is auto-derived from `DOMAIN`'s URL path
(`extract_url_path`, config.rs:1339) = `/space/vault` here. So the app itself
expects the incoming request path to still carry the `/space/vault` prefix;
stripping it before the reverse_proxy would 404 everything (proven: bare
`curl 127.0.0.1:8095/alive` → 404, `curl 127.0.0.1:8095/space/vault/alive` →
200).
Block added to `/etc/caddy/Caddyfile.space` before the `handle_path /space/*`
SPA catch-all — see `../Caddyfile.space` in this worktree for the exact
mirrored file. Box backup: `/etc/caddy/Caddyfile.space.bak-vault-20260917154416`.

## Proofs (all live, box: root@151.115.73.182)
```
$ curl 127.0.0.1:8095/alive          -> 404 (no prefix, as expected)
$ curl 127.0.0.1:8095/space/vault/alive -> 200 "2026-09-17T15:58:16Z"
$ curl https://paloptic.com/space/vault/alive
"2026-09-17T15:58:26.678074Z"                                   HTTP:200

$ curl -X POST https://paloptic.com/space/vault/identity/accounts/prelogin \
    -d '{"email":"nobody@example.com"}'
{"kdf":0,"kdfIterations":600000,...}                            HTTP:200

# admin login -> cookie
$ curl -c cj -X POST https://paloptic.com/space/vault/admin \
    --data-urlencode "token=$ADMIN_TOKEN"                       HTTP:200
  (Set-Cookie: VW_ADMIN=<jwt>, path=/space/vault/admin)

# invite
$ curl -b cj -X POST https://paloptic.com/space/vault/admin/invite \
    -d '{"email":"vault-proof@paloptic.com"}'
{"id":"b9ebdf74-adb1-45e4-875a-ab51b3bb7484",...}                HTTP:200

# register (throwaway kdf 0 / 600000 iter key+hash)
$ curl -X POST https://paloptic.com/space/vault/identity/accounts/register -d '{...}'
{"captchaBypassToken":"","object":"register"}                   HTTP:200

# token
$ curl -X POST https://paloptic.com/space/vault/identity/connect/token \
    -d grant_type=password -d username=vault-proof@paloptic.com \
    -d password=<hash> -d scope='api offline_access' -d client_id=web \
    -d deviceType=9 -d deviceIdentifier=<uuid> -d deviceName=proof
{"access_token":"eyJ...","expires_in":7200,"token_type":"Bearer",...} HTTP:200

# delete cleanup
$ curl -b cj -X POST https://paloptic.com/space/vault/admin/users/<id>/delete HTTP:200
$ curl -b cj https://paloptic.com/space/vault/admin/users/<id>
{"message":"User doesn't exist",...}                             HTTP:404
```

## gaia-space wiring
`EnvironmentFile=/etc/gaia-space.env` (from `systemctl cat gaia-space`) — appended
(not replaced), NOT restarted:
```
VAULTWARDEN_URL=http://127.0.0.1:8095
VAULTWARDEN_ADMIN_TOKEN=<plain, from /root/.vaultwarden-admin-token>
```
Backup: `/etc/gaia-space.env.bak-vault-<ts>`. `systemctl daemon-reload` run
(harmless no-op until gaia-space's own CI deploy restarts it).

## UNVERIFIED
- gaia-space server code does not yet consume `VAULTWARDEN_URL`/`VAULTWARDEN_ADMIN_TOKEN`
  (env vars only — no app-side integration; out of scope per task, infra only).
- ADMIN_TOKEN stored in **plain text** (not argon2-hashed) per task's own env
  spec — vaultwarden logs a startup NOTICE recommending argon2 PHC via
  `vaultwarden hash`; plain works fine for API use, hashing not applied.
