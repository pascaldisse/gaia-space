# Production deployment

Workflow → `.github/workflows/deploy-space.yml`.

Trigger → merge to `master`; manual dispatch → Actions.

## Required GitHub Actions secrets

| Secret | Value |
|---|---|
| `SPACE_DEPLOY_HOST` | production hostname or IP |
| `SPACE_DEPLOY_USER` | SSH deployment user |
| `SPACE_DEPLOY_SSH_KEY` | private key; deploy-user public key → server `authorized_keys` |
| `SPACE_DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -H <host>` output; pin server host key |

Server prerequisites → deploy user: write access to `/tmp`; passwordless `sudo` only for `install`, `rsync`, `systemctl restart gaia-space`; `rsync` installed.

Release → frontend → `/var/www/gaia-space`; API → `/opt/gaia-space/bin/space-server`; service restart → `gaia-space`.

Missing secrets → workflow skipped; no partial deployment.
