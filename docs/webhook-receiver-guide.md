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

## Retry and idempotency

Each send attempt obtains a new current Unix-seconds timestamp. A retry can
therefore have a different signed tuple from the prior attempt, so the replay
cache cannot deduplicate delivery events. Receivers needing event-level
idempotency must use a stable delivery identifier. GAIA Space sends
`x-gaia-space-delivery-id`, whose value is the durable `WebhookDelivery.id`;
retain that value idempotently in addition to the replay tuple.
