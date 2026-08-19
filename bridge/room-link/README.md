# Space ↔ GAIA room link

Polls configured Space channels, sends new non-bridge messages through GAIA's normal room HTTP ingress, waits for the first new agent event, and posts it to Space using the authenticated bridge account. The bridge never calls a model provider directly.

## Configure + run

```sh
cp config.example.json config.json
# set mappings, Space credentials/sessionCookie, and GAIA workspaceId
bun run bridge/room-link/src.ts bridge/room-link/config.json
```

`mappings` is the complete routing table: `[{spaceChannelId, roomId}]`. URLs, timeouts, and polling intervals are parameters with defaults; no channel, room, workspace, or identity is baked into the code. Set either `space.sessionCookie` or `space.username` + `space.password`. Space derives the bridge identity from `/api/auth/me`; replies authored by that profile are never re-forwarded.

## Test

```sh
bun test bridge/room-link/
```
