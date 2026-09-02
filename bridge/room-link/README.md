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
| create a ticket (project issue) | `POST /api/cmd/create_issue {input}` | verified in `space-server.rs`: policy `ProjectMemberWrite` **plus** `Right::CreateIssue` on the project; `input` is `issues::IssueInput` (`project_id` required) |
| create a task (to-do) | `POST /api/cmd/create_todo {input}` | verified in `space-server.rs`: policy `TodoCreate` (project only checked when a `project_id` is present); `input` is `personal::TodoInput` (`profile_id` rebound to the session) |
| ticket permalink | `…/projects/<projectId>/issues/<issueId>` | verified against the router grammar in `src/router.ts` (`entityRoutes.issue`) |
| task permalink | *(none)* | to-dos have **no** entity route in `src/router.ts`; a project task is linked via `…/projects/<projectId>/tasks`, a personal task is reported by id only |

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

### Own-account mode (running under your own Space credential)

By default the bridge assumes a **dedicated account** and suppresses by author: everything written by its own profile is ignored. Point that same default at your *personal* credential and it also swallows every message you type in Space by hand — same author, no way to tell the two apart.

`space.ownAccountMode: true` switches the loop guard from author to **origin**:

| message | default mode | own-account mode |
| --- | --- | --- |
| written by hand by the credential owner | dropped | **forwarded** |
| written by anyone else | forwarded | forwarded |
| posted by GAIA through this bridge | dropped | dropped |
| thread reply / archived / blank | dropped | dropped |

Origin lives in the **message id**, never in a marker inside the text:

1. the id is chosen by the client, and `create_message` stores it verbatim and returns the whole message view (server-side only `author_id` is rebound, by `bind_session_identity`) — so a posted id is a fact both sides agree on;
2. every outbound id is written to a durable ledger (`space.outboundLedgerPath`) **before** the post goes out, so a crash between record and post can only over-suppress, never loop;
3. the ledger is a bounded FIFO ring (`space.outboundLedgerLimit`, default 5000) — it cannot grow without end, and the id prefix (`space.outboundIdPrefix`, default `bridge-`) is the stateless second guard that still holds for an evicted id or a lost state file.

The honest caveat: a message you write by hand whose id happens to start with `bridge-` would be treated as GAIA's own. Space clients mint UUID-shaped ids, so this cannot happen by accident; pick a more distinctive prefix if you want the point moot.

```jsonc
"space": {
  "ownAccountMode": true,                                            // default false — behaviour above is unchanged when off
  "outboundIdPrefix": "bridge-",                                     // default; must be non-empty [A-Za-z0-9._-]
  "outboundLedgerPath": "bridge/room-link/state/outbound-ids.json",  // default; gitignored, atomic writes
  "outboundLedgerLimit": 5000                                        // default; FIFO ring size
}
```

## Creating Space work items from a GAIA room (`actions`) — opt-in

A person standing in a linked GAIA room can file a Space **task** (to-do) or **ticket** (project issue). This is the only path in the bridge that *writes work* into Space, so it is off unless `actions.enabled` is `true`, and every step is explicit.

### The grammar

| typed in the GAIA room | effect |
| --- | --- |
| `!space task <title>` | **preview only** — resolves context, answers with a one-time token |
| `!space ticket <title>` | **preview only** — same, requires the channel's project |
| `!space confirm <TOKEN>` | creates the previewed item — the *only* command that writes |
| `!space cancel <TOKEN>` | discards the preview |
| `!space help` (or bare `!space`) | prints the grammar |

A second line and everything after it becomes the item's description (issue `description`, to-do `notes`).

Example:

```
you:    !space ticket Login redirect loops after SSO
        Repro: staging, Safari, second login attempt.

bridge: Preview — nothing created yet.
        kind:    ticket (project issue)
        title:   Login redirect loops after SSO
        details: Repro: staging, Safari, second login attempt.
        channel: chan-7f21
        project: proj-core

        Create it: !space confirm K7QM4T   (expires in 5 min)
        Discard it: !space cancel K7QM4T

you:    !space confirm K7QM4T

bridge: Created ticket: Login redirect loops after SSO
        id: issue-8931 (#412)
        link: https://space.example/projects/proj-core/issues/issue-8931
```

The same line is posted into the linked Space channel (`announceInChannel`, on by default), so the people in the channel see the item appear with its link — under the bridge's own outbound id, so own-account mode does not forward it back.

### Why this cannot fire by accident

| gate | rule |
| --- | --- |
| off by default | `actions.enabled: false`; `actions.allowedRoomIds` narrows further to named rooms |
| prefix at the START | only a message beginning with the prefix is parsed. `"as I said, !space ticket X"` and `"!spacex ticket X"` do nothing |
| human turns only | only events authored by `user` act. An **agent** that emits `!space ticket …` is ignored, so nothing a model is told to say can create work |
| chat cannot reach it | forwarded Space messages arrive as `Space message from <id>: …`, so Space chat never begins with the prefix either |
| two steps | naming an item creates nothing. Only `confirm <token>` writes; the token is 6 chars from a 32-symbol alphabet, single-use, room-bound, and expires (`confirmTtlMs`, default 5 min) |
| context, never guesswork | project = the linked channel's project. A channel with no project **refuses** a ticket (and says to use `task` instead); a room linked to two channels refuses as ambiguous |
| no duplicates | room + kind + normalized title inside `duplicateWindowMs` (default 24 h) answers with the existing item's link instead of creating a second |
| no replay | handled event ids, spent tokens and completed items are durable (`statePath`, atomic writes), and a room's transcript is **primed** on first sight — a restart never re-executes an old `confirm` |
| write-then-create order | the token is spent *before* the create call: a crash can lose an item (retypeable), never create two (not undoable) |

### Permission is Space's, not the bridge's

The create calls ride the **same authenticated transport** as everything else — with `space.personalAccessToken` set, that is the token owner. The server rebinds `created_by`/`profile_id` to that session (`bind_session_identity`) and enforces `ProjectMemberWrite` + `Right::CreateIssue` (tickets) or `TodoCreate` (tasks). The bridge holds no capability of its own and grants none: a refusal comes back as the server's own message, e.g.

```
Space refused to create the ticket: POST /api/cmd/create_issue: HTTP 403 project access denied
```

Consequence worth stating plainly: **whoever can type in the linked GAIA room acts as the token owner.** Give the bridge a token from an account whose rights you are willing to lend to that room, and use `allowedRoomIds` when only some rooms should be able to file work.

### Config keys (actions)

```jsonc
"actions": {
  "enabled": false,                 // default — the whole feature is opt-in
  "commandPrefix": "!space",        // default; no whitespace allowed
  "kinds": { "task": true, "ticket": true },
  "confirmTtlMs": 300000,           // preview lifetime
  "maxTitleLength": 200,
  "duplicateWindowMs": 86400000,    // same title in the same room = the same item
  "statePath": "bridge/room-link/state/actions.json",  // gitignored, atomic writes
  "stateLimit": 500,                // bounded history of tokens/events/items
  "webBaseUrl": "",                 // e.g. "https://space.example"; empty = report ids, never guess a link
  "webBasePath": "",                // path the SPA is mounted under, e.g. "/space"
  "announceInChannel": true,        // post the created item into the Space channel too
  "allowedRoomIds": []              // empty = every linked room; otherwise only these
}
```

Caveat, honestly: the bridge answers by posting a normal room message, so the room's own agent takes a turn on the preview and on the result. That is the only ingress the GAIA daemon exposes.

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
