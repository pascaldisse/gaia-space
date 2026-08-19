# INTENT — PR #3 native rebuild

## Provenance
- PR#3 → paloptic workspace · project operations · calendar · access hardening
- Recon only → foreign code never copied

## Checklist
- [x] DB → V5 idempotent drift repair · V6 todos.project_id nullable FK/index · V7 projects.deadline · FK every connection · migration equivalence/tests
- [x] Server → session-bound authz map registrations · project owner/admin mutation · calendar visible-only aggregation · atomic writes
- [x] Router → canonical /space paths · semantic anchors/hrefFor · route tests · Goto allowed/desktop gates
- [x] Product → workspace/project compositions · project archive/deadline · scoped calendar · project todos
- [x] Frontend → loud calendar error · theme tokens only
- [ ] Gates → cargo lib/bin · tsc · bun test · build
- [ ] Landing → merge master · repeat gates · push origin master · sweep
