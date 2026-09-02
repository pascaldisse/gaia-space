# Space ↔ GAIA room link

Polls Space channels, sends new non-bridge messages through GAIA's normal room HTTP ingress, waits for the first new agent event, and posts it back to Space using the authenticated bridge account. The bridge never calls a model provider directly.

Two modes:

| mode | routing table | when |
| --- | --- | --- |
| `mappings` | explicit `[{spaceChannelId, roomId}]` in config | a handful of hand-picked channels |
| `whole-space` | **derived** from Space channel discovery, persisted to disk | the whole Space, one GAIA room per channel + one hub room |

Nothing is hardcoded: no channel, room, workspace, token, or password lives in the code. Secrets stay in `config.json` (gitignored) or whatever your deployment injects into it. The recommended credential is a **personal access token** (`space.personalAccessToken`) — see [Space credentials](#space-credentials); the older cookie and username/password paths still work unchanged.

## whole-space mode

One channel → one GAIA room. Channels never share a room, so one channel's content can never enter another channel's context.

1. **Discover** — `list_channels_with_meta` returns the channels the bridge account may read.
2. **Filter** — threads (`thread:*`) and archived channels are out by default; include/exclude, project, and content-type lists narrow further.
3. **Derive** — room id = `<roomIdPrefix><slug(channel name)>-<8-hex digest of channel id>`, clamped to GAIA's rule (1–64 of `A-Za-z0-9._-`). Deterministic: the same channel always yields the same room id. Collisions get a `-2`, `-3` … suffix; a room id already present in the workspace is never taken over.
4. **Provision** — create the room (idempotent) and title it `#<channel name>`.
5. **Persist** — the derived table is written atomically to `mappingStatePath`. This file is the source of truth: renaming a channel re-titles the room but keeps the mapping, so no second room is ever created for the same channel.
6. **Forward** — per-channel polling; a channel that gets linked later primes its own backlog instead of replaying history into GAIA.

### Hub room

`hubRoomId` is an existing GAIA room used as the control surface. Both hub features are **off by default**:

- `hub.digestEnabled` — posts a periodic digest into the hub: headline counts and `channel → room` lines only, never message bodies (no cross-channel mixing).
- `hub.commandsEnabled` — reads hub-room events and answers `!bridge list|sync|status` by posting into the hub.

Caveat, honestly: writing into a hub room is a normal room message, so the hub's own agent will take a turn on it. Enable the hub features only in a room where that is wanted.

## Verified capabilities (checked against this machine's GAIA daemon and the Space server source, 2026-09-01)

| capability | route | status |
| --- | --- | --- |
| list GAIA rooms | `GET /api/workspaces/{ws}/snapshot` → `snapshot.rooms[].id` | verified live |
| create GAIA room | `POST /api/workspaces/{ws}/rooms {roomId}` | verified live (idempotent; **also selects** the room — the daemon has no create-only route) |
| title GAIA room | `POST /api/workspaces/{ws}/rooms/{room}/title {title}` | verified live |
| read GAIA room events | `GET /api/workspaces/{ws}/rooms/{room}/events?limit=` | verified live |
| post into GAIA room | `POST /api/workspaces/{ws}/rooms/{room}/messages {text}` | pre-existing bridge path |
| Space channel discovery | `POST /api/cmd/list_channels_with_meta {profile_id}` | verified in `space-server.rs` (policy `Session`) |
| Space channel discovery via `list_channels` | `POST /api/cmd/list_channels` | **unavailable** — `CommandPolicy::Unavailable` over HTTP; discovery must use `list_channels_with_meta` |
| Space personal access token | `Authorization: Bearer <token>` on `/api/auth/me` and `/api/cmd/*` | verified in `space-server.rs` (`user_by_token` resolves the bearer via `auth_security::permanent_token_user`) |

Two consequences worth knowing before deployment:

- The server rewrites `profile_id` to the caller's own session (`bind_session_identity`), so the bridge sees exactly the channels its account is a member of. **Channel coverage is an ACL question**: add the bridge account to a channel and it appears at the next discovery pass.
- Provisioning switches the workspace's *current* room as a side effect of each create. Run `--provision-only` when nobody is watching that workspace's UI, or accept the room switch.

Deleting a GAIA room out of band is safe: the next pass re-creates it under the same id.

## Configure + run

```sh
cp bridge/room-link/config.example.json bridge/room-link/config.json   # gitignored
# set space.personalAccessToken, gaia.workspaceId, wholeSpace.hubRoomId

# provision only: create/refresh rooms, print the mapping table, exit
bun run bridge/room-link/src.ts bridge/room-link/config.json --provision-only

# run the bridge (provisions, then forwards continuously)
bun run bridge/room-link/src.ts bridge/room-link/config.json
```

Space derives the bridge identity from `/api/auth/me`; replies authored by that profile are never re-forwarded.

### Space credentials

Three credentials are accepted, in this order of preference:

| key | how it is sent | notes |
| --- | --- | --- |
| `space.personalAccessToken` | `Authorization: Bearer <token>` | **recommended.** No password is ever sent, no login call is made, no session cookie is created or stored. |
| `space.sessionCookie` | `Cookie: space_session=…` | pre-existing path, unchanged; the cookie expires with the session |
| `space.username` + `space.password` | `POST /api/auth/login`, then the returned cookie | pre-existing path, unchanged; puts a password in the config file |

A token alone is a complete credential — configure it and leave `username`/`password`/`sessionCookie` out entirely. When a token is present it wins: the bridge skips login and never falls back to the cookie, so a leftover password in the config is not used.

Mint a token for the bridge's own account (a dedicated non-admin account is the point — the token carries exactly that account's identity and channel memberships, and `bind_session_identity` on the server rewrites `profile_id` to it):

```sh
# as the bridge account, against a live Space server
curl -sX POST http://127.0.0.1:8090/api/auth/tokens \
  -H 'content-type: application/json' -b "space_session=$SESSION" \
  -d '{"name":"gaia-bridge","expires_at":null}'
# → {"token":"<raw token — shown once>", "record":{"id":"…","name":"gaia-bridge",…}}
```

List with `GET /api/auth/tokens`, revoke with `DELETE /api/auth/tokens/{token_id}` (owner only).

The raw token is shown once; store it only in the gitignored `config.json` (or inject it at deploy time). Tokens are individually revocable and can be given an `expires_at`; revoking one does not touch the account's password or other tokens.

### Config keys (whole-space)

```jsonc
"mode": "whole-space",              // inferred when `wholeSpace` is present
"wholeSpace": {
  "hubRoomId": "chat-...",          // required, existing GAIA room
  "roomIdPrefix": "space-",         // default
  "roomTitlePrefix": "#",           // default
  "mappingStatePath": "bridge/room-link/state/whole-space-map.json",
  "discoveryIntervalMs": 60000,     // re-discovery cadence
  "filter": { "includeArchived": false, "includeChannelIds": [], "excludeChannelIds": [], "projectIds": [], "contentTypes": [] },
  "hub": { "digestEnabled": false, "digestIntervalMs": 900000, "commandsEnabled": false, "commandPrefix": "!bridge" }
}
```

## Test

```sh
bun test bridge/room-link/
```
