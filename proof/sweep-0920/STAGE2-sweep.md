# STAGE 2 — SWEEP worktrees (NOTHING-DIES law)

## Per-worktree table

| path | branch | uncommitted? | merged into origin? | action | local branch | remote branch |
|---|---|---|---|---|---|---|
| paloptic-wt/mode-lock | fix/charles-mode-lock | clean | yes (`origin/main..HEAD` empty) | worktree removed | deleted (`git branch -d`) | deleted (no PR, merged into origin/main) |
| paloptic-wt/visual-drift | fix/charles-visual-drift | clean | yes (`origin/main..HEAD` empty) | worktree removed | deleted (`git branch -d`) | deleted (no PR, merged into origin/main) |
| paloptic-wt/flows | fix/charles-flows | clean | yes (`origin/main..HEAD` empty) | worktree removed | deleted (`git branch -d`) | deleted (no PR, merged into origin/main) |
| paloptic-wt/trunk-0920 | trunk-0920 | clean | yes vs `origin/main` (tip `1aea9acb` **is** current `origin/main` HEAD) | worktree removed | **refused** — see below | n/a, branch was never pushed (`git ls-remote --heads origin trunk-0920` empty) |
| gaia-space-wt/crm-merge | (detached HEAD @ `9af3579`) | clean | yes (`origin/master..HEAD` empty) | worktree removed | n/a (no local branch attached, was a bare detached checkout) | n/a |
| paloptic-wt/perf-loops | perf/loops-fanout | — | — | **SKIPPED per instruction** (parallel lane in use) | — | — |

### trunk-0920 local-branch refusal detail
```
$ git branch -d trunk-0920
error: the branch 'trunk-0920' is not fully merged
```
Cause: refusal is against the **local** `main` ref, not `origin/main`. Local `paloptic` checkout's `main` is stale (`706f131a`), 17 commits behind `origin/main` (`1aea9acb`), and `1aea9acb` IS `trunk-0920`'s own tip — i.e. `trunk-0920` **is** the current origin/main HEAD, fully merged there, just not yet visible to the local main pointer. Per style law (never touch the main tree) and NOTHING-DIES (no `-D` force), the local branch `trunk-0920` was **left in place, not force-deleted**. Worktree itself was still removed (task allows this independent of local-branch-delete outcome). No remote branch existed to delete (never pushed).

## charles-latest / charles-ref-2fe765b0
- `lsof -nP -iTCP:58206 -sTCP:LISTEN` → PID 14482 (`bun`, user `pascaldisse`)
- `lsof -p 14482 | grep cwd` → `cwd DIR ... /Users/pascaldisse/projects/charles-ref-2fe765b0`
- **`charles-ref-2fe765b0` = UNTOUCHABLE** (serves the live :58206 reference). Left in place, unmodified.
- `charles-latest`: `git status --porcelain` → empty (no untracked/modified files) → **removed** (`rm -rf`).

## git worktree prune
```
$ cd paloptic && git worktree prune -v      # no stale entries, no output
$ cd gaia-space && git worktree prune -v    # no stale entries, no output
```

## Final `git worktree list`
```
# paloptic
/Users/pascaldisse/projects/paloptic                706f131a [main]
/Users/pascaldisse/projects/paloptic-wt/perf-loops  1aea9acb [perf/loops-fanout]

# gaia-space
/Users/pascaldisse/projects/gaia-space  bdfcaf1 [master]
```

## Disk usage after sweep
```
3.3G	/Users/pascaldisse/projects/paloptic-wt   (only perf-loops remains, skipped per instruction)
  0B	/Users/pascaldisse/projects/gaia-space-wt (empty, crm-merge removed)
```

## Branches deleted
- **Local**: `fix/charles-mode-lock`, `fix/charles-visual-drift`, `fix/charles-flows`
- **Remote**: `origin/fix/charles-mode-lock`, `origin/fix/charles-visual-drift`, `origin/fix/charles-flows`
- **Not deleted (UNVERIFIED-clean but refused per law)**: local `trunk-0920` — refused by git (stale local main), left intact; no remote counterpart existed.

## refs/archive/branch/*
None created — every branch processed had `origin/main..HEAD` (or `origin/master..HEAD` for crm-merge) already empty, so no archive-before-remove step was triggered.
