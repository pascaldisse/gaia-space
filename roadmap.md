# GAIA Agent — native coding agent, vertical slice

## Steps

- [x] Stage 0 — Foundation: DB rung 150, `agent` module skeleton, encrypted provider keys
- [ ] Stage 1 — Provider: OpenAI-compatible client behind a mockable transport
- [ ] Stage 2 — Read-only loop: session, transcript, read/list/grep tools, step budget
- [ ] Stage 3 — Write + jail: containment tests written *before* the write tool exists
- [ ] Stage 4 — Execute: `run_command` with classification, approval, scrubbed env
- [ ] Stage 5 — Surface: `Agent.tsx`, approval UI, key entry in Settings, streaming
- [ ] Stage 6 — Hand-off: branch, commit under the agent identity, open a review
- [ ] Stage 7 — Parity: `PARITY.md` AI-agent domain, fence rows, proof artifact

## Problem

GAIA Space owns nearly all the plumbing a coding agent needs — repo access over libgit2
(`git.rs`), diff review (`review.rs`), CI (`pipelines.rs`), projects/tasks/chat, an
identity model (`principals`, `actor.rs`), rights (`rights.rs`), and encrypted secret
storage (`secretbox.rs`). What it has none of is the agent itself: no model client, no
run loop, no tool execution, no coding surface.

This plan adds the smallest thing that is genuinely useful: **one repo, one session,
end to end.** A task goes in, the agent reads and edits files in the local checkout,
you review the diff in the existing Reviews UI, and it commits. Everything else is a
follow-on.

The differentiator against OpenCode and OpenChamber is not the loop — it is that the
agent lives inside a server-of-record team platform: its sessions belong to projects,
its work is attributed, its merge requests flow through your existing review and CI
gates. That is why attribution and review hand-off are in the slice and MCP is not.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Runtime | New `src-tauri/src/agent/` in Rust | Works from the desktop shell and `space-server` unchanged |
| First milestone | Agent-in-repo vertical slice | Proves the whole chain on existing `git.rs` + `review.rs` |
| Execution | Local workspace, repo-scoped, approval-gated | No cloud dependency; matches the rights model |
| Provider keys | BYO, in `secretbox`, resolved server-side | Encrypted at rest, never sent to the frontend |
| First provider | OpenAI-compatible, base-URL override | One client covers OpenAI, gateways, Ollama, vLLM |
| Commit attribution | Distinct agent identity | A reviewer must never mistake agent output for human work |
| Streaming | After the slice (stage 5) | Keeps stages 0–4 deterministic under test |
| egui / eframe | Deferred | Adopting it deletes the web build; the Rust runtime keeps the frontend swappable |
| Web mode | Deferred | `/api/cmd` is request/response; live progress needs SSE or polling |

### Correction carried into the plan

`vault.rs` is **not** a secret store — it is a ~160-line admin *invite* bridge to
Vaultwarden's admin API. The in-app secret store is `secretbox.rs`
(ChaCha20Poly1305, key from `SPACE_SECRET_KEY`), already used by `calendar_feeds.rs`
and `auth_security.rs`. Provider keys go there.

## The load-bearing security rule

`project_repo.rs` already states the constraint this feature is most likely to violate:

> a web command that takes a caller-supplied filesystem path is an arbitrary-repo
> reader for every session

An agent's write and exec tools have exactly that failure mode, amplified. Therefore:

- Every agent command is **project-scoped, not path-taking.** The repo root resolves
  from `projects.repo_path` via `validate_repo_path`, never from an argument.
- The jail is built from that resolved root, and containment compares **canonical
  path components**, never string prefixes (`/repo-evil` must not pass a check for
  `/repo`).
- Writes into `.git/` are refused — the agent commits through `git.rs`, it does not
  hand-edit the repository's internals.

## Architecture

New module: `src-tauri/src/agent/`

| File | Owns |
|---|---|
| `mod.rs` | command surface, wiring, `pub mod agent;` from `lib.rs` |
| `provider.rs` | OpenAI-compatible client behind a mockable transport |
| `loop.rs` | session run loop: model call → tool calls → results → repeat |
| `tools/` | `read_file`, `write_file`, `edit_file`, `list_files`, `grep`, `run_command`, git inspection via `git.rs` |
| `jail.rs` | repo-root containment, command classification, approval gate |
| `keys.rs` | provider keys through `secretbox` |
| `store.rs` | sessions, messages, tool calls, approvals |

Reused unchanged: `project_repo.rs`, `git.rs`, `review.rs`, `pipelines.rs`,
`secretbox.rs`, `rights.rs`, `db.rs`, and `src/api/invoke.ts` (one command serves both
desktop IPC and the web `/api/cmd` bridge).

### Data model — `db.rs` rung 150

`SCHEMA_VERSION` goes 149 → 150, following the existing convention: a
`CREATE TABLE IF NOT EXISTS` rung that is a safe idempotent no-op on any other
database, FK on every reference, indexes on every hot path.

```
agent_provider_keys(id, provider, label, base_url, ciphertext, nonce,
                    created_by -> profiles(id), created_at, UNIQUE(provider, label))
agent_sessions(id, project_id -> projects(id), agent_principal_id -> principals(id),
               provider_key_id, model, title,
               status CHECK(idle|running|awaiting_approval|done|failed|cancelled),
               step_budget, created_by -> profiles(id), created_at, updated_at)
agent_messages(id, session_id -> agent_sessions(id) ON DELETE CASCADE, seq,
               role CHECK(system|user|assistant|tool), content, created_at)
agent_tool_calls(id, session_id, message_id -> agent_messages(id), tool, args_json,
                 result_json, status CHECK(proposed|approved|denied|ran|failed),
                 decided_by -> profiles(id), decided_at, created_at)
```

Indexes: `agent_messages(session_id, seq)`, `agent_tool_calls(session_id)`.

### Agent identity

`principals` is already `kind IN ('profile','application','external')` with
`profile_id` and `label`, so a machine identity is an **application principal** with a
profile row and attribution flows through the same path as every other actor — no
parallel mechanism. Note: adding a literal `'agent'` to that `CHECK` is a SQLite table
rebuild, not an `ALTER`. Either reuse `application`, or budget a dedicated rung that
rebuilds `principals` deliberately.

## Stage detail

### Stage 0 — Foundation
Migration 150, module skeleton, key storage. `keys.rs` accepts a key, encrypts via
`secretbox`, stores the ciphertext, and returns only provider / label / base_url /
a masked hint — the plaintext never travels back to the frontend.

**Gate:** `cd src-tauri && cargo test` · `migrate` run twice is a no-op.

### Stage 1 — Provider
`provider.rs` defines the request/response types and takes a transport the way
`payload_dispatch.rs` takes `Transport`, so tests inject scripted replies and never
touch the network. OpenAI chat-completions wire format with a per-key base-URL
override. Key decrypted at call time only; never logged. Non-streaming.

**Gate:** offline unit test asserting request shape (headers, body, tool schemas) and
response parsing · one manual live call to confirm the wire format.

### Stage 2 — Read-only loop
`loop.rs` builds the prompt from the transcript, calls the provider, dispatches tool
calls, appends results, and repeats until a final answer, the step budget, or
cancellation. Tools: `read_file`, `list_files`, `grep` — all paths resolved against
the repo root and rejected if they canonicalize outside it.

**Gate:** scripted session test — the model asks to read a file, receives it, answers ·
transcript persisted and replayable · step budget enforced · cancellation stops the loop.

### Stage 3 — Write + jail
**Write the containment test suite first, before the tools exist.** Cases: `..`
traversal · absolute paths · a symlink pointing outside the root · writes into `.git/`
· a prefix-sibling path such as `/repo-evil` against root `/repo` · normalization
edges. Then implement `write_file` and `edit_file` (exact-match replace, match must be
unique — the same discipline this repo's own tooling uses). Every write produces an
`agent_tool_calls` row in `proposed`, and is applied only after an `approved` decision.

**Gate:** containment suite green · no write can occur without an approval row.

### Stage 4 — Execute
`run_command` via `tokio::process` (the `process` feature is already enabled in
`Cargo.toml`). Classification: read-only (allowed), mutating (approval), destructive
(`rm -rf`, `git push --force`, `chmod`/`chown`, `curl | sh`, anything touching
`~/.ssh`) — refused or approval-with-explicit-confirm. `cwd` is the repo root, output
is capped, and the child environment is **scrubbed of `SPACE_SECRET_KEY`, provider
keys, and session credentials**.

**Gate:** classification tests · a test proving `SPACE_SECRET_KEY` is not visible to
the child process.

### Stage 5 — Surface
`reqwest` gains the `stream` feature here, not before; an SSE reader feeds tokens into
the view. New `src/views/Agent.tsx` + `Agent.css`, registered in `App.tsx`
(`workspaceViews`) and `router.ts` (view slug). Follows the standing house rules:
`PageHeader`, `ContentHead`, `EmptyState`, `GhostPill`/`controls`, `paper.css`, design
tokens only, light palette scoped under `.theme-space-light` with structure never
scoped, one action in one place, one page one measure, a silent metric carries no
colour. Session list, transcript, tool-call cards with an inline diff, approve/deny,
stop. Provider key entry (add / list / remove, never echoing the key) in `Settings.tsx`.

**Gate:** `bunx tsc --noEmit` · `bun test` · `bunx vite build` · a headless proof
artifact under `proof/` and `reports/`, as the git-ui proof harness does.

### Stage 6 — Hand-off
Branch and commit via `git.rs`, authored by the agent principal, with the session id in
the message. Open a review through `review.rs` from the session — the step that makes
this a teammate rather than an editor plugin.

**Gate:** `cargo test` covering commit author and identity · review hand-off test.

### Stage 7 — Parity
New AI-agent domain section in `PARITY.md`, including the explicit fence rows for what
this slice does not do.

## Non-goals for the slice

MCP client · skills · subagents / parallel agents · LSP or codebase indexing ·
worktrees · the agent as a chat participant · cloud or remote runners · per-user
quotas and billing · an embedded editor component · web-mode live progress · egui.

## Risks

| Risk | Mitigation |
|---|---|
| Jail correctness (prefix compare, symlinks, `.git`) | Tests written before the tools; canonical-component comparison |
| Secrets leaking into child processes or logs | Scrubbed env; a test asserts `SPACE_SECRET_KEY` is absent; keys never returned to the frontend |
| Provider wire-format drift | Scripted transport in tests plus one live smoke call |
| Cost / step runaway | Per-session step budget, cancellable run |
| Two agents editing one worktree | One run per session, a lane like the git-graph lanes |
| `principals` CHECK needs `'agent'` | Reuse `application`, or rebuild the table in a dedicated rung |

## Standing repo conventions this must obey

- All four gates before every commit: `bunx tsc --noEmit -p tsconfig.json` · `bun test`
  · `bunx vite build` · `cd src-tauri && cargo test`.
- Commits with **explicit paths**, never `git add -A`.
- No weakened tests.
- UI in English; internal identifiers unchanged.
