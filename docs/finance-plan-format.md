# Finance plan file

The finance plan is **data, not source code**. This repository contains no amounts;
the plan is imported at runtime through the command `import_finance_plan`, or in the
view through **Plan importieren** next to *Import Splitwise CSV*.

## Format

JSON. Amounts are **whole cents, integers** — negative for cost, positive for
revenue. `kind` is stated by the file and never read off the sign.

```json
{
  "version": 1,
  "currency": "EUR",
  "overwrite": false,
  "positions": [
    {
      "category": "Beispielblock",
      "position": "Beispielposten",
      "kind": "cost",
      "optional": false,
      "estimated": true,
      "assumption": "Monat nicht im Dokument; hier angenommen.",
      "source": "beispiel.html",
      "source_block": "Beispielblock",
      "source_detail": "Beispielzeile",
      "months": { "2026-08": -1234, "2026-09": -1234 }
    },
    {
      "category": "Beispielumsatz",
      "position": "Beispielerlös",
      "kind": "revenue",
      "optional": false,
      "estimated": false,
      "assumption": null,
      "source": null,
      "months": { "2026-09": 7000 }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `version` | `1`. Any other version is refused as a whole. |
| `currency` | Informational; the database stores `EUR`. |
| `overwrite` | `true` rewrites amounts that already differ. Default `false`. |
| `category` | The block the position belongs to. Required. |
| `position` | The named position inside the block. Empty = a block-level row. |
| `kind` | `"cost"` or `"revenue"`. Default `"cost"`. Anything else is an error. |
| `optional` | The position is only paid once income carries it. |
| `estimated` | The amount is an estimate, not a quoted figure. |
| `assumption` | Why this month, in words. Shown in the view. `null` if none. |
| `source` · `source_block` · `source_detail` | Where the number comes from. Optional. |
| `months` | `"YYYY-MM" -> cents`. A month in another shape is reported as an error, the rest of the file still lands. |

## What the import does

Keyed by `(category, position, month)`:

- cell missing → **inserted**
- cell identical → **skipped**
- cell differs, `overwrite: false` → **skipped** and reported. A hand correction in
  the view is the owner's and is never silently rewritten.
- cell differs, `overwrite: true` → **updated**

Flags, `assumption` and provenance are the document speaking: they are brought into
step on every import, without touching a single amount.

The result is `{ inserted, updated, skipped, categories, positions, errors[] }` —
plus `replaced_summary_rows` for block-level rows a named position replaced (those
are kept in `finance_plan_legacy`).

Importing the same file twice changes nothing.
