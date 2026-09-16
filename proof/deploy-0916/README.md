# deploy 0916 — master 1f2659c live on production

deploy run <https://github.com/pascaldisse/gaia-space/actions/runs/35091037066> · conclusion **success** · headSha `1f2659ce00e1283c91ad27b1efdedf110104decb`

cause of the block → Scaleway regenerated `/root/.ssh/authorized_keys` (Sep 9) → CI key unauthorized → run 34842334799 died at *Upload release* with `Permission denied (publickey)`.
fix → new ed25519 deploy key appended to `authorized_keys` **and** `/root/.ssh/instance_keys` (survives the next Scaleway regen) · repo secret `SPACE_DEPLOY_SSH_KEY` rotated. Private key never left `~/.gaia/secrets/`.

bundle `index-CQiY5rqR.js` (393e6cb4) → **`index-C3OD-FLw.js`** (1f2659c)

## measured live, logged in through the real gate (admin) · Brave headful rig

| PR | page | viewport | result | console errors |
| --- | --- | --- | --- | --- |
| #28 library back-nav | `/space/documents` → doc → `history.back()` | 1440×1000 | back returns to `/space/documents` (not the resolved doc URL) | 1 (pre-existing¹) |
| #28 | same | 390×844 | same | 1 (pre-existing¹) |
| #29 calendar dot | `/space/home` month grid | 1440×1000 | shipped rule `top: calc(50% + 0.67em)` + `translateY(-50%)`; measured Δ vs expected = **0.00 px**, dot below numeral centre, inside cell | 0 |
| #29 | same | 390×844 | identical numbers | 0 |
| #30 knowledge file card | `/space/documents/<file doc>` | 1440×1000 | one `.doc-file-card`: name · `Word document · 13 KB · Added 08/09/2026 · by Jannes` · Download; no object/iframe/embed viewer | 0 |
| #30 | same | 390×844 | card reflows to 354 px, same facts | 0 |
| #30 server | `POST /space/api/cmd/get_document_file` | — | HTTP 200 `ok:true`, filename returned, **no bytes in the response** | — |

¹ `403 /space/api/cmd/list_book_owners` on the Library page. Introduced by `4a52c2a`, an ancestor of the previously deployed `393e6cb` → present before this deploy, not caused by it. Unfixed, reported.

## not verified
- dot alignment against a REAL event: the admin account's visible calendar has no event in any month scanned (14 months back) → `report-dot-live-search.json` `withEvent: 0`. The dot was measured by toggling `has-event` on a real day cell, so the CSS measured is production's, but the data path (event → class) was not exercised live.
- `report-live.json` is the first pass, kept for the raw library/knowledge numbers.
