# Webhook receiver verification

Use this procedure for every inbound GAIA Space webhook request. It describes the
current sender contract: JSON body plus `x-gaia-space-webhook`,
`x-gaia-space-timestamp`, and `x-gaia-space-signature` headers.

1. Read and retain the raw, unmodified request body. Read all three headers.
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

## Retry and idempotency

Each send attempt obtains a new current Unix-seconds timestamp. A retry can
therefore have a different signed tuple from the prior attempt, so the replay
cache cannot deduplicate delivery events. Receivers needing event-level
idempotency must use a stable delivery identifier. GAIA Space will send
`x-gaia-space-delivery-id`, whose value is the durable `WebhookDelivery.id`;
retain that value idempotently in addition to the replay tuple.
