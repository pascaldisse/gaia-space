# Webhook receiver verification

Use this procedure for every inbound GAIA Space webhook request. It describes the
sender contract: JSON body plus `x-gaia-space-webhook`,
`x-gaia-space-delivery-id`, `x-gaia-space-timestamp`, and
`x-gaia-space-signature` headers, plus `x-gaia-space-signature-retiring` while a
secret rotation overlap is in progress (see *Secret rotation* below).

1. Read and retain the raw, unmodified request body. Read all four headers.
2. Use `x-gaia-space-webhook` to look up that subscription's configured secret.
   Reject an unknown webhook ID; reject an absent signature or secret according to
   your receiver's unsigned-webhook policy.
3. Parse `x-gaia-space-timestamp` as Unix seconds and reject it outside your
   allowed clock-skew window. A **five-minute** window is a recommended receiver
   policy value, **not a value derived from GAIA Space code**.
4. Recompute `sha256=<HMAC-SHA256(secret, timestamp + "." + rawBody)>` and compare
   it with `x-gaia-space-signature` using a constant-time comparison. Reject a
   mismatch.
5. Atomically retain `(webhook_id, timestamp, signature)` until at least the
   accepted freshness window expires; reject an already-retained tuple.

The timestamp is covered by the HMAC, so an intercepted body cannot be paired
with a freshly invented timestamp without the secret. That does not stop an
identical captured request replayed while its timestamp is accepted; step 5 does.

## Secret rotation (parallel signatures)

A rotation mints a new signing secret and keeps the superseded one valid for an
overlap window, so a receiver can switch over without a delivery gap. During that
window every request carries **two** headers:

* `x-gaia-space-signature` — the signature under the current (ACTIVE) secret;
* `x-gaia-space-signature-retiring` — a comma-separated list of signatures under
  each still-valid superseded (RETIRING) secret. Absent or empty when there is
  none.

Verification while you hold more than one secret:

1. Split `x-gaia-space-signature-retiring` on `,` and build the candidate set as
   `[x-gaia-space-signature] + those values` (skip empty entries).
2. For each secret you currently accept, recompute the signature per step 4 above
   and accept the request if it constant-time-equals **any** candidate.
3. Once your configuration holds only the new secret, the retiring header stops
   mattering; it disappears by itself when the overlap elapses.

The overlap length is chosen by the sender at rotation time (default
`GAIA_SPACE_WEBHOOK_SECRET_OVERLAP_SECONDS`, 86400s). Deploy the new secret to
your receiver inside that window; after it expires, only the ACTIVE secret signs.

## Typed application payloads (app endpoint)

An application's own `endpoint_uri` receives the typed payload family
(`dispatch_application_payload`), signed with the application's **Ed25519** key —
not the HMAC webhook secret. Five headers travel with the JSON body:

* `x-gaia-space-application` — application ID;
* `x-gaia-space-payload-class` — the `className` tag of the payload;
* `x-gaia-space-key-id` — which signing key was used;
* `x-gaia-space-timestamp` — Unix seconds, part of the signed message;
* `x-gaia-space-signature` — `ed25519=<base64 signature>`.

Verification procedure:

1. Read and retain the raw body. Read all five headers.
2. Fetch the application's public key (`app_signing_key`). Match
   `x-gaia-space-key-id` against `key_id`, or against `previous_key_id` while a
   rotation is in flight — `rotate_app_signing_key` keeps the retired public key
   readable exactly so an in-flight payload still verifies.
3. Parse `x-gaia-space-timestamp` and reject it outside the freshness window.
   The sender's window is `GAIA_APP_PAYLOAD_MAX_AGE_SECS` (default **300s**);
   `payload_dispatch::verify_fresh_app_payload` performs steps 3 and 4 together
   and is the exact check to mirror.
4. Verify the base64 signature (after stripping the `ed25519=` prefix) over the
   byte string `timestamp + "." + rawBody` with the public key. Reject a mismatch.
5. Retain `(application_id, timestamp, signature)` for at least the window and
   reject an already-seen tuple: the timestamp is inside the signed message, so a
   captured request cannot be re-dated, and the window bounds how long it could be
   replayed verbatim.

Sender-side egress policy, re-validated at dispatch time (the endpoint row may
have been written by somebody else, long before):

* the endpoint must be `https://`. A plaintext `http://` endpoint is refused
  unless `GAIA_APP_DISPATCH_ALLOW_PLAINTEXT=1`, and a payload carrying a
  credential-shaped field (`secret`, `token`, `password`, `private_key`,
  `credential`, at any depth) is refused over plaintext **regardless** of that
  switch;
* loopback, private, link-local, CGNAT and unique-local destinations are refused,
  literal or resolved from the hostname, unless
  `GAIA_APP_DISPATCH_ALLOW_PRIVATE_ENDPOINTS=1` (on-prem receivers, tests);
* non-HTTP schemes never dispatch; redirects are not followed.

## Retry and idempotency

Each send attempt obtains a new current Unix-seconds timestamp. A retry can
therefore have a different signed tuple from the prior attempt, so the replay
cache cannot deduplicate delivery events. Receivers needing event-level
idempotency must use a stable delivery identifier. GAIA Space sends
`x-gaia-space-delivery-id`, whose value is the durable `WebhookDelivery.id`;
retain that value idempotently in addition to the replay tuple.
