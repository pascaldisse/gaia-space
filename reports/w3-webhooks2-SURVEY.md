# w3 webhook debt survey — Kali shadow

Scope: read-only survey at `master@9500038`; no production/parity change.  `PARITY.md` and `reports/parity/*` were read, not edited.  Estimates are implementation estimates, not measured changes.

## 1. `filters_json`: domain-event fan-out

### Measured current state

- `WebhookSubscription` persists `event_type` and optional `filters_json`: `src-tauri/src/applications.rs:108-120`; its only validation is JSON parsing at lines 277-293.  The V14 table has the same columns at `src-tauri/src/db.rs:623-625`.
- The only non-test `deliver_webhook` call-site is its exported manual command: `src-tauri/src/applications.rs:375-389`; repository search found no domain-module caller.  It inserts one delivery then immediately performs the HTTP POST (lines 385-388).
- `create_issue`, `update_issue`, and `archive_issue` finish their writes without dispatch at `src-tauri/src/issues.rs:366-403`.  They are an available first domain seam; other mutation seams exist in chat, documents, blogs, and review, but are not presently unified by an event bus.
- Existing delivery coverage is a real local HTTP POST → 500 → retry → 204 test at `src-tauri/src/applications.rs:993-1061`; concurrent queue ownership is covered at lines 1125-1193.  No test evaluates `filters_json` or invokes webhook delivery from a domain mutation.
- The closest existing filter precedent is personal subscription matching: scope/event selection at `src-tauri/src/personal.rs:613-634`.  It is per-profile notification policy, not webhook filter evaluation.

### Feasibility / proposed seam

**Feasible, but not as an unbounded “all domains” atom.**  Start with `IssueWebhookEvent`: after a successful issue write and after the returned issue is materialized (`issues.rs:366-394`; archive needs a payload read), call an `applications` fan-out helper.  The helper should:

1. define a typed internal event envelope (`event_type`, entity/target IDs, payload);
2. select enabled subscriptions by exact `event_type`;
3. parse and evaluate an explicitly specified JSON predicate against that envelope; malformed legacy filter must fail closed or be rejected on save (choice required);
4. create durable `webhook_deliveries` rows before any network attempt, reusing the existing V18 delivery table (`db.rs:588-591`), then use the existing delivery path/queue semantics.

Do not call synchronous HTTP while an issue write transaction is open.  The current `deliver_webhook` combines enqueue and synchronous send (`applications.rs:375-389`), so the seam needs an enqueue-only internal helper or equivalent refactor.

`filters_json` storage already exists; a first Issue-only fan-out and evaluator need **no DB migration / no V40**.  A new filter language must be specified before implementation; current JSON-validity is not semantics.

### Estimate

- Issue-only vertical slice: **~220–340 Rust LOC + ~80–140 test LOC**, touch `src-tauri/src/applications.rs`, `src-tauri/src/issues.rs`, and their in-file test modules; optional `src/api/applications.ts` / `src/views/Applications.tsx` only if filter editing replaces the current hard-coded `{}` (`Applications.tsx:26`).  **No migration.**
- Initial fan-out across issue/review/chat/document/blog mutation families: **~500–850 Rust LOC + ~250–400 test LOC**, plus the same applications layer.  **No migration** if the envelope/filter language remains application code and existing delivery rows suffice.

### PARITY status

- **Yes, related lines:** `PARITY.md:53-54` summarize application/webhook capability; `reports/parity/07-devenv-api.md:28,44,62,64,70-73` explicitly record filter/event-taxonomy and automatic domain delivery gaps/history.
- **No line explicitly tracks `filters_json` evaluation as a separately completed item.**  Frozen parity files require no edit in this survey.

## 2. Webhook secret rotation

### Measured current state

- A subscription exposes exactly one nullable plaintext `secret`: `src-tauri/src/applications.rs:115-120`; read/write SQL selects and overwrites that one value at lines 266-293.
- Delivery reads that one current value at send time (`applications.rs:328-343`) and sends `x-gaia-space-signature` from it (lines 349-357).  There is no key identifier, prior-key validity interval, rotation command, or webhook-secret UI.  The UI only displays signed/unsigned (`src/views/Applications.tsx:32`); `rotateSecret` there is OAuth client-secret rotation (lines 13-18), not webhook rotation.
- V39 added the existing `secret` and `max_attempts` columns (`src-tauri/src/db.rs:353-368`), with upgrade coverage at lines 1551-1576.  Current schema version is 39 (`db.rs:8`).

### Feasibility / required ledger and UX

**Feasible; durable overlap requires a migration, hence V40 (not reserved here).**  A safe design needs a key ring, rather than overwriting `webhook_subscriptions.secret`:

- proposed `webhook_subscription_secrets` rows: immutable key ID, subscription ID/FK, secret material, created/activated/retire-at/revoked-at timestamps; exactly one active sender key;
- send `x-gaia-space-key-id`, select the active key for new attempts, and define whether old queued retries retain their signing key (store key ID on delivery) or intentionally re-sign with the new key;
- rotation command generates a new secret, returns it once, keeps the old key valid until an operator-selected grace expiry, and supports revoke-now/list metadata without returning old material;
- UI: “rotate webhook secret”, one-time copy warning, active/retiring state + expiry, explicit revoke; do not conflate it with OAuth rotation.

The exact at-rest protection policy is **UNVERIFIED**: current webhook secrets are plaintext DB values; `secretbox` exists elsewhere but this survey did not establish a project-wide policy for this column.

### Estimate

**~300–460 Rust LOC + ~100–180 TypeScript/UI LOC + ~180–280 test LOC**; touch `src-tauri/src/db.rs`, `src-tauri/src/applications.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/bin/space-server.rs`, `src/api/applications.ts`, `src/views/Applications.tsx`, and tests in db/applications.  **Migration required: V40**, including fresh/upgraded/partial-DB tests patterned after `db.rs:1551-1576`.  V40 is deliberately not reserved or edited by this survey.

### PARITY status

- **Yes, related lines:** `PARITY.md:17` records V39 signed delivery; `PARITY.md:53-54` and `reports/parity/07-devenv-api.md:25,36,44` record broader credential/signing/key gaps.
- **No explicit webhook-secret rotation row.**

## 3. Receiver replay defence

### Measured current state

- Sender makes a Unix-seconds timestamp (`src-tauri/src/applications.rs:337-340`) and signs literal `"{timestamp}.{payload}"` with HMAC-SHA256 (`245-264`, `341-343`).  It transmits webhook ID, timestamp, and signature headers at lines 349-357.
- **No nonce exists** in subscription, delivery, payload construction, or outbound headers.  `WebhookDelivery` does have a durable delivery ID (`applications.rs:126-136`), but it is not sent as a header or guaranteed in arbitrary caller-provided payload JSON (`375-386`).
- The existing test checks that the signature matches the observed timestamp/body (`applications.rs:1053-1060`).  It does not test freshness, constant-time comparison, replay cache, nonce, or receiver behavior.
- The source comment at lines 245-246 says a captured body cannot be replayed with a fresh header.  This is narrow: it prevents changing a timestamp without the secret, not re-sending an identical captured signed request within a receiver acceptance window.

### Feasibility / receiver contract

**Documentable now, but not a complete sender-enforced replay defence.**  A receiver guide can accurately require:

1. read raw, unmodified body and the three existing headers;
2. look up the subscription secret by webhook ID; reject unsigned/unknown keys according to receiver policy;
3. parse timestamp; reject outside a stated clock-skew window (recommended policy value must be chosen, not inferred from code);
4. recompute `sha256=<HMAC-SHA256(secret, timestamp + "." + rawBody)>` and compare in constant time;
5. atomically cache `(webhook_id, timestamp, signature)` until at least the accepted freshness window expires; reject duplicates.

That cache stops identical captured requests.  It does **not** deduplicate legitimate retry attempts because every send creates a new timestamp (`applications.rs:337-343`).  For event-level exactly-once receiver handling, add a stable `x-gaia-space-delivery-id` from existing `WebhookDelivery.id` and require receivers to retain it idempotently.  A random nonce is not currently available; adding one is unnecessary if the durable delivery ID is defined and sent, but this is a proposal, not current behavior.

### Estimate

- Receiver verification document only: **~70–110 Markdown LOC**, **no migration / no V40**; testability in this repository is limited to a local receiver fixture, because the receiver is external.
- Sender completion (delivery-ID header + documentation + localhost tests): **~45–85 Rust LOC + ~50–90 test/doc LOC**, touch `src-tauri/src/applications.rs` and docs/report location chosen by owner.  **No migration** because delivery IDs already persist.

### PARITY status

- **Yes, related lines:** `PARITY.md:17,53-54`; `reports/parity/07-devenv-api.md:71,73` cover signed manual delivery and its HTTP test; `:25,36,44` cover signing/key/payload gaps.
- **No explicit timestamp freshness, nonce, receiver replay-cache, or delivery-id row.**

## Audit limits

- No code, migration, `PARITY.md`, or `reports/parity/*` content changed.
- “All-domain” event taxonomy/filter semantics, grace duration, at-rest encryption policy, and receiver clock window are **UNVERIFIED / product decisions**, not facts established by source inspection.
