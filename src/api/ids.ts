/** ── MINTING A CLIENT-SIDE ID ────────────────────────────────────────────────
 *
 *  `crypto.randomUUID` is a SECURE-CONTEXT API. The desktop webview and an HTTPS
 *  deployment have it; a web build served at plain `http://<host>/space/` does not,
 *  and the property is simply `undefined` there. Calling it then throws a TypeError
 *  in the FIRST line of a composer's submit handler — before any command is sent —
 *  so the surface reports a failure while the network shows no request at all.
 *
 *  `Applications.tsx` already carried that guard inline, for one surface. This is the
 *  same rule stated once, for every surface that mints an id: the real UUID where it
 *  exists, and a collision-resistant fallback where it does not. The fallback is only
 *  ever a local row id — nothing authenticates on it.
 */
export const newId = (): string =>
  crypto.randomUUID?.() ??
  [
    Date.now().toString(16),
    Math.random().toString(16).slice(2, 10),
    Math.random().toString(16).slice(2, 10),
  ].join("-");

/** The same id, prefixed by the kind of thing it names (`document-…`, `review-…`). */
export const prefixedId = (prefix: string): string => `${prefix}-${newId()}`;
