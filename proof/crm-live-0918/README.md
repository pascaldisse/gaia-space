# PR #31 (CRM sales workspace) — audit + live check, 2026-09-18

## Merge facts (gh, live)

| field | value |
|---|---|
| state | MERGED |
| merged by | **pascaldisse** |
| merged at | **2026-09-17T12:47:22Z** |
| merge commit | `4e6136b5185628bb49c7d7505b45a32f77311324` |
| size | 34 files, +7320 / -7 |
| in `origin/master`? | yes (`git merge-base --is-ancestor` true) |
| deploy run for the merge | 35223134286 — success |
| master HEAD now | `4c10700` (vault work landed after; live deploy run 35244759789 = `0eb592c`) |

## Is #31 deployed?

**Yes, the CODE is.** Live bundle `https://paloptic.com/space/assets/index-2ReD609F.js` contains
`crm` 301x, `Papierkorb` 18x, `Gewonnen` 31x, `Einblicke` 3x, `Leads` 10x (plus the later Vault work).

**But the FEATURE is not reachable on the web deployment.** Measured live, logged in as admin:

| probe | result |
|---|---|
| rail entry `CRM` present | yes, `a.rail-item` |
| its `href` | **`/space/dashboard`** — not a CRM address |
| clicking it | stays on `/space/dashboard`, `[class*=crm]` node count **0** |
| `GET /space/crm` and `/space/crm/insights` | resolve to `/space/dashboard` |
| `history.pushState('/space/crm/leads')` + popstate | rewritten to `/space/dashboard` |

Cause, read off master (agrees with the measurement, two independent paths):
`src/App.tsx:75` puts CRM in `localOnlyViews`; `:113` `if(web()) list=list.filter(v=>!localOnlyViews.includes(v))`,
and `:135` feeds exactly that list to `setAvailableViews(...)`. So on the web build the CRM view is not
available -> the router rejects every `/crm/*` address and `linkProps` falls back to `/dashboard`
(the fallback documented at `SpaceShell.tsx:146`). The Tauri desktop build is unaffected.
This matches the PR author's own caveat: the CRM is localStorage-only, with no backend and no ACL.

**Defect (not a security issue): the rail shows a CRM button on web that leads nowhere.**
`SpaceShell.tsx:41-51` builds RAIL unconditionally, so the button exists even when the view is filtered out.
Reported, not fixed — out of audit scope.

## Gate (worktree on `origin/master` @ `4c10700`, sequential)

| gate | result |
|---|---|
| `bun install --frozen-lockfile` | 151 packages |
| `bun run check` (`tsc --noEmit`) | **clean, exit 0** |
| `bun test` | **939 pass / 0 fail**, 3615 expects, 127 files, 63.2 s |

## Security grep over the #31 content (`8ee5afc..afcd2b5`, `src/` only, added lines)

| pattern | hits | what they are |
|---|---|---|
| `dangerouslySetInnerHTML` | 0 | — |
| `innerHTML` | 11 | all `document.body.innerHTML = ""` in test teardown |
| `eval(` / `new Function` | 0 | — |
| `fetch(` / `XMLHttpRequest` | 0 | **no network calls at all** |
| `invoke(` / `CommandPolicy` | 0 | **no new Tauri/web commands, no new routes, no auth surface** |
| `http://` | 2 | a CSV-injection test string and an inline SVG data URI |
| `password` / `token` / `secret` / `apiKey` / `Bearer` | 0 | no secrets |
| SQL (`SELECT `/`INSERT `) | 23 | every one is an HTML `<select>`; no SQL in this diff |
| `localStorage` | 49 | the CRM's entire persistence |

Positive finding: CSV export escapes formula injection (`csvCell("=HYPERLINK(...)")` -> `"'=HYPERLINK`).

## VERDICT: **SAFE-TO-DEPLOY** — and already deployed; nothing to deploy.

No server surface, no auth change, no secrets, no SQL, no remote fetch. Residual risk is confined to the
browser profile: CRM records live unencrypted in `localStorage`, with no ACL and no multi-user scoping.
On the web deployment that risk is currently moot, because the feature cannot be opened there at all.

## Console errors seen while probing (classified, pre-existing)

- pre-login: `401` on `get_organization`, `finance_access_check`, `auth/me` — the unauthenticated gate.
- authenticated, EVERY page (home, documents, dashboard): `403 /space/api/cmd/finance_access_check`
  — the server denying finance to this admin; not CRM-related, present on pages #31 never touched.
- no CRM-specific errors, because no CRM code runs on web.

## UNVERIFIED

- The CRM has never been exercised on the **Tauri desktop** build, where it IS available. Everything
  above about its behaviour is source- and test-level, not a live desktop run.
- Whether hiding CRM from web was intended to be permanent or is a pending wiring step — Pascal's call.

Harnesses: `live-crm-proof.mjs`, `live-crm-click.mjs`, `crm-nav-probe.mjs` (raw CDP, rig :9383, admin
password read from the box into the environment, never printed) · `report.json`, `report-click.json`,
`report-nav.json` · screenshots 01-09.
