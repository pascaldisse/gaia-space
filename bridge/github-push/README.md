# GitHub push bridge

GitHub webhook → one Space channel message. Local `/notify` → deployment/non-GitHub notices. Delivery IDs → persisted, latest 500; duplicate delivery → no second post.

## Configuration

`GITHUB_WEBHOOK_SECRET` required → GitHub webhook secret.  
`NOTIFY_TOKEN` required → bearer credential for `POST /notify`.  
`SPACE_TOKEN` preferred → permanent `spat_…` bearer token.  
`SPACE_USERNAME` + `SPACE_PASSWORD` → required fallback when `SPACE_TOKEN` absent; bridge logs in and uses its session cookie.  
`SPACE_SERVER_URL` → `http://127.0.0.1:8090`.  
`SPACE_CHANNEL_ID` → `target`.  
`REPO_CHANNEL_MAP` → optional JSON, e.g. `{"owner/repo":"channel-id"}`; matching repo overrides `SPACE_CHANNEL_ID`.  
`PORT` → `8093`.  
`STATE_PATH` → `bridge/github-push/state.json`.  
`MAX_COMMITS` → `5`.

Secrets → `/etc/gaia-space/github-push.env`, mode `0600`; never commit it.

```sh
install -d -o gaia-space -g gaia-space /etc/gaia-space
install -o gaia-space -g gaia-space -m 0600 /dev/null /etc/gaia-space/github-push.env
# /etc/gaia-space/github-push.env
# GITHUB_WEBHOOK_SECRET=...
# NOTIFY_TOKEN=...
# SPACE_TOKEN=spat_...                 # preferred
# SPACE_CHANNEL_ID=<Space channel id>
```

Create a dedicated Space service account; grant it access to the target channel. Create its permanent token in Space at `POST /api/auth/tokens`; set that value as `SPACE_TOKEN`. Cookie login remains available with `SPACE_USERNAME` + `SPACE_PASSWORD` when a token is unavailable.

## Deploy

```sh
# Advance /opt/gaia-space-repo to a ref containing bridge/github-push.
cd /opt/gaia-space-repo && git fetch origin && git checkout <merge-commit-or-branch>
install -o root -g root -m 0644 deploy/gaia-space-github-push.service /etc/systemd/system/
# Add deploy/caddy-github-push.snippet before the /space SPA fallback; it mirrors /space/api/* strip-prefix routing.
systemctl daemon-reload
systemctl enable --now gaia-space-github-push
```

Caddy receives `https://paloptic.com/space/hooks/github`; strip-prefix forwards `/hooks/github` to the bridge.

## Register GitHub webhook

```sh
gh api repos/O/R/hooks -f name=web -F active=true -f 'events[]=push' -f 'events[]=pull_request' -f 'events[]=release' -f config[url]=https://paloptic.com/space/hooks/github -f config[content_type]=json -f config[secret]=…
```

`push` → branch, pusher, bounded commit subjects, compare URL; deleted refs → skipped.  
`pull_request` → opened/reopened/closed/merged/ready-for-review.  
`release` → published only.  
`ping` and unknown events → `200`, no post.  
Space post `5xx` → one retry; failure → logged/counted, process continues.

## Local notification

```sh
curl -X POST http://127.0.0.1:8093/notify \
  -H "Authorization: Bearer $NOTIFY_TOKEN" -H 'content-type: application/json' \
  --data '{"repo":"paloptic/deploy","ref":"main","text":"Deploy complete","url":"https://paloptic.com"}'
```

`GET /health` → `{"ok":true,"posted":0,"failed":0,"lastDeliveryAt":null}` shape.

## Test

```sh
cd bridge/github-push && bun test
cd ../.. && bunx tsc --noEmit
```
