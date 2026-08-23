# Normal-room OIDC admission

Set a meeting's **Room access** to **Normal room** (`PUBLIC`), enable `ALLOW_UNREGISTERED_ROOMS=true`, then call `GET /api/rooms/{meeting-id}` with `Authorization: Bearer <OIDC JWT>`.

Required server configuration:

- `SPACE_NORMAL_ROOM_OIDC_ISSUER`
- `SPACE_NORMAL_ROOM_OIDC_AUDIENCE`
- `SPACE_NORMAL_ROOM_OIDC_HS256_SECRET`

The verifier checks HS256 signature, expiry, issuer, audience, and nonempty bounded `sub`; `name` is an optional bounded display name. The LiveKit identity is derived from `sub`, not request input.

## Partial implementation

No real external IdP/JWKS discovery is implemented. This supports a trusted issuer that signs HS256 tokens with the configured shared secret only. Do not configure it for RS256/ES256 IdPs or claim production OIDC federation until JWKS/key rotation is implemented.

Normal-room joins are fail-closed: a missing, malformed, expired, wrong-issuer, wrong-audience, or unverifiable bearer token returns no room. Legacy `username` query input is ignored. `ALLOW_UNREGISTERED_ROOMS=true` remains required because it enables externally reachable public meeting records, but it does not bypass OIDC.
