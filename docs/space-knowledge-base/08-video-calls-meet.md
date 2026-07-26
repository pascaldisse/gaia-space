# Video Calls — La Suite Meet / LiveKit

## Overview

- Upstream: `https://github.com/suitenumerique/meet`; cloned commit `4c63aa8`; MIT code / Etalab-2.0 `docs/` ([meet/LICENSE.md](../../../../meet/LICENSE.md); [meet/README.md](../../../../meet/README.md) §§Open-source, License).
- Product: browser conference application; registered-room CRUD/lobby/roles/recording around LiveKit SFU; not a LiveKit-only library.
- Source inventory: [meet/README.md](../../../../meet/README.md); [meet/docs/developping_locally.md](../../../../meet/docs/developping_locally.md); [meet/compose.yml](../../../../meet/compose.yml); [meet/docs/openapi.yaml](../../../../meet/docs/openapi.yaml).

## Architecture

### Frontend

- React `18.3.1` + TypeScript + Vite `8.0.14`; React Aria, TanStack Query, Valtio, Wouter, Panda CSS: [meet/src/frontend/package.json](../../../../meet/src/frontend/package.json).
- LiveKit browser stack: `livekit-client 2.20.0`; `@livekit/components-react 2.9.21`; `@livekit/components-styles 1.2.0`; track processors `0.7.2`: [meet/src/frontend/package.json](../../../../meet/src/frontend/package.json) lines 22–24, 39.
- Backend returns `{url, room, token}`; `Conference.tsx` mounts `LiveKitRoom` with URL/token + auto-connect; `fetchRoom.ts` calls `/rooms/{id}?username=`: [meet/src/frontend/src/features/rooms/components/Conference.tsx](../../../../meet/src/frontend/src/features/rooms/components/Conference.tsx); [meet/src/frontend/src/features/rooms/api/fetchRoom.ts](../../../../meet/src/frontend/src/features/rooms/api/fetchRoom.ts); [meet/src/frontend/src/features/rooms/api/ApiRoom.ts](../../../../meet/src/frontend/src/features/rooms/api/ApiRoom.ts).
- Registered-room create: `POST /api/v1.0/rooms/`, JSON `{name, callback_id}`: [meet/src/frontend/src/features/rooms/api/createRoom.ts](../../../../meet/src/frontend/src/features/rooms/api/createRoom.ts).

### Backend / room API

- Python `>=3.13`; Django `5.2.14`; DRF `3.17.1`; `django-lasuite`; PostgreSQL/Redis/Celery/S3; LiveKit Python server SDK `livekit-api 1.1.1`: [meet/src/backend/pyproject.toml](../../../../meet/src/backend/pyproject.toml).
- Router: `/api/v1.0/rooms/`, `/recordings/`, `/users/`; external router when enabled: [meet/src/backend/core/urls.py](../../../../meet/src/backend/core/urls.py).
- `RoomViewSet`: retrieve/list/create/update/destroy; create makes caller owner; room retrieve emits LiveKit config; lobby, participant moderation, recording actions, LiveKit webhooks in same viewset: [meet/src/backend/core/api/viewsets.py](../../../../meet/src/backend/core/api/viewsets.py) §§`RoomViewSet`, `start_room_recording`.
- Token mint: backend signs scoped LiveKit JWT — identity/name, room, join/admin/publish/subscribe grants; returns `{url, room, token}`: [meet/src/backend/core/utils.py](../../../../meet/src/backend/core/utils.py) lines 63–176.
- External integration API: client-credentials application JWT → scoped `rooms:list|retrieve|create`; list/create/retrieve routes; update/delete marked coming soon: [meet/docs/openapi.yaml](../../../../meet/docs/openapi.yaml) §§Authentication Flow, Scopes, `/application/token/`, `/rooms/`.

### LiveKit / runtime dependencies

- LiveKit server = WebRTC SFU/signaling; clients connect WebSocket; deployment requires TCP/UDP ICE exposure: [meet/docs/features/signaling.md](../../../../meet/docs/features/signaling.md); [meet/docs/installation/compose.md](../../../../meet/docs/installation/compose.md) §§Livekit, firewall.
- Dev compose starts LiveKit `--dev`, TCP `7880/7881`, UDP `7882`; config maps `devkey:secret`, Redis, backend webhook: [meet/compose.yml](../../../../meet/compose.yml) lines 226–245; [meet/docker/livekit/config/livekit-server.yaml](../../../../meet/docker/livekit/config/livekit-server.yaml).
- Minimum full Meet runtime: frontend Nginx, Django, PostgreSQL, Redis, LiveKit, OIDC provider; MinIO/mail required by enabled recording/files; compose additionally runs Egress, Keycloak, Celery, metadata/transcription/summary workers: [meet/docs/installation/compose.md](../../../../meet/docs/installation/compose.md) §Requirements; [meet/compose.yml](../../../../meet/compose.yml).

### Auth model

- Normal registered-room operation: OIDC Authorization Code flow through `django-lasuite`; Django session cookie; OIDC provider endpoints/client secret mandatory configuration: [meet/docs/features/authentication.md](../../../../meet/docs/features/authentication.md).
- Production can use any conforming OIDC provider; ProConnect is branding/provider configuration, not an intrinsic hard dependency: [meet/docs/features/authentication.md](../../../../meet/docs/features/authentication.md); [meet/docs/installation/compose.md](../../../../meet/docs/installation/compose.md) §OIDC.
- No IdP-free normal mode found. `ALLOW_UNREGISTERED_ROOMS=True` can mint anonymous token for unknown public slug, but dev config sets it `False`; registered room creation still needs user auth: [meet/src/backend/core/api/viewsets.py](../../../../meet/src/backend/core/api/viewsets.py) lines 259–283; [meet/env.d/development/common.dist](../../../../meet/env.d/development/common.dist).
- Dev mode is self-contained: compose imports Keycloak realm/user `meet` / `meet`; dev docs name those credentials: [meet/compose.yml](../../../../meet/compose.yml) lines 198–224; [meet/docs/developping_locally.md](../../../../meet/docs/developping_locally.md) lines 65–76.

### Extras

- Recording beta: LiveKit Egress room-composite → MinIO/S3 → storage webhook/backend → owner email; requires Egress, S3-compatible storage with webhook support, email, LiveKit webhook: [meet/docs/features/recording.md](../../../../meet/docs/features/recording.md).
- Transcription beta: recording audio + Summary FastAPI/Celery/Redis + WhisperX + La Suite Docs `/create-for-owner`; experimental stack: [meet/docs/features/transcription.md](../../../../meet/docs/features/transcription.md); [meet/src/summary/pyproject.toml](../../../../meet/src/summary/pyproject.toml).
- Summarization/subtitles: WIP; LiveKit agents include Deepgram/Silero/Kyutai plugin dependencies: [meet/docs/features/summarization.md](../../../../meet/docs/features/summarization.md); [meet/docs/features/subtitles.md](../../../../meet/docs/features/subtitles.md); [meet/src/agents/pyproject.toml](../../../../meet/src/agents/pyproject.toml).
- Telephony beta: separate LiveKit SIP server + SIP trunk + backend webhooks/dispatch rules; absent from local compose: [meet/docs/features/telephony.md](../../../../meet/docs/features/telephony.md).

## Boot result

- Command: `cd /Users/pascaldisse/projects/meet && make bootstrap FLUSH_ARGS='--no-input'`; first attempt blocked pre-build by stopped Docker daemon; Docker Desktop started; second attempt migrated Django, seeded demo, then Keycloak image pull ended `unexpected EOF`; `make run` retry completed.
- Live composition: Django `8071`, frontend `3000`, LiveKit `7880/7881/tcp + 7882/udp`, Keycloak via Nginx `8083`; PostgreSQL, Redis, MinIO, Egress, Celery, Summary, agents all `Up` — proof captured 2026-07-26 via `docker compose ps`.
- HTTP proof: `GET http://localhost:3000/` → `200`, `<title>LaSuite Meet</title>`; `GET http://localhost:8071/__heartbeat__` → `200` JSON checks; `GET http://localhost:7880/` → `200 OK`; Keycloak discovery `http://localhost:8083/realms/meet/.well-known/openid-configuration` → `200`.
- Real OIDC flow proof: `/api/v1.0/authenticate/` → Keycloak; submitted dev user `meet` / `meet`; callback → frontend; `GET /api/v1.0/users/me/` → `200`, `meet@meet.world`.
- Real room provisioning proof: authenticated `POST /api/v1.0/rooms/` `{name:"terra-e2e-room",access_level:"public"}` → `201`; room `0128ac29-cf6c-4fe2-aa1e-f8f8216bb87c`; follow-up `GET /api/v1.0/rooms/<id>/` → `200`, `is_administrable:true`, LiveKit URL + JWT token.
- WebRTC browser media join: UNVERIFIED — supplied LiveKit CLI absent; no browser automation kit available. Server, frontend route, OIDC, authenticated room creation and token mint verified; do not treat that as camera/microphone call proof.

## Integration options

### 1. Full Meet stack + Gaia opens Meet room URL

- Reuse: all Meet React conference UX, Django room/lobby/roles/recording/telephony integration, OIDC; Gaia stores external Meet room ID/URL against `meetings`.
- Rewrite: Gaia meeting create/join bridge; common OIDC/identity mapping; deep-link/webview window lifecycle; participant/RSVP synchronization; desktop permissions/UI shell.
- Runtime: full Meet deployment — frontend, Django, PostgreSQL, Redis, LiveKit/TURN; OIDC; MinIO/Egress/mail if recordings; additional workers/WhisperX/Docs only for AI features.
- Effort: smallest Gaia code delta; largest operations footprint. Webview/embed compatibility and cross-origin auth must be proven; a Tauri external/child webview is not equivalent to native conference controls.

### 2. LiveKit only + native Gaia Solid UI + Rust token mint

- Reuse: LiveKit server/SFU/TURN; JWT claim model from `core/utils.py`; selected Meet UX patterns only. Do not reuse Meet React components directly.
- Rewrite: Solid conference UI; `livekit-client` dependency/integration; device permissions; join/lobby/moderation/chat/screenshare; room lifecycle mapped to `meetings` / `meeting_participants`; Rust Tauri token command; credentials/key rotation; optional recording/transcription separately.
- Rust seam: Gaia currently has Tauri 2/Rust/SQLite (`rusqlite`) + Solid, but no LiveKit client/server SDK or JWT dependency: [package.json](../../package.json); [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml). Hand-sign LiveKit HS256 JWT or add a maintained Rust JWT path; never expose API secret to Solid webview.
- Runtime: LiveKit + TURN/UDP; Gaia backend/token authority. No Django/React/Postgres/Keycloak required if Gaia supplies real user auth; recording adds Egress/object storage/webhooks.
- Effort: medium/high product implementation; smallest durable runtime and only option yielding native Solid UX.

### 3. Vendor / transplant Meet React frontend

- Reuse: substantial React room UI only; still requires Meet API contract/Django token/lobby endpoints or an extensive compatibility layer.
- Rewrite: React↔Solid host boundary, routing/state/design-system integration, every backend call/auth hook; upstream merge/rebrand maintenance.
- Runtime: effectively option 1 unless Gaia reimplements Django API; then combines option 2 rewrite cost with React vendoring cost.
- Effort: highest; technically mismatched frontend frameworks; no operational advantage.

## Ranking

1. **LiveKit-only + Solid/Rust (option 2)** — best Gaia-space integration target; native UX, bounded runtime; requires deliberate feature scope/MVP.
2. **Full Meet URL/webview (option 1)** — fastest validated delivery route; retain only if full Meet operations + separate UX are acceptable.
3. **Vendor React frontend (option 3)** — reject; duplicate framework/runtime integration cost without preserving a clean ownership boundary.

## Gaia seam

- Existing meeting persistence: `meetings(id,title,description,starts_at,ends_at,rrule,location,organizer_id,channel_id,archived)` + `meeting_participants(meeting_id,profile_id,status)`: [src-tauri/src/db.rs](../../src-tauri/src/db.rs) `SCHEMA_V1`; current commands only list/get/create/update `Meeting`: [src-tauri/src/meetings.rs](../../src-tauri/src/meetings.rs).
- Needed data additions whichever route: `video_provider`, `video_room_id`, `join_url` or provider endpoint, lifecycle/status, host identity, created-at; retain participant rows as attendance/authorization source rather than copy LiveKit ephemeral participant state.
