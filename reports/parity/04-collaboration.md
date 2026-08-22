# §04 — Collaboration parity evidence

## Chat attachments + mentions — partial
- Attachment store → `message_attachments`; SQLite durable data-URL payload; 10 MiB cap; `src-tauri/src/chat.rs`
- Preview → image/video/audio/download; `src/views/Chat.tsx`
- Mention autocomplete → composer + thread composer; selected recipient IDs → `message_mentions`; notification hook → `notifications(event_type='chat.mention')`
- Gates → cargo check ✓ · tsc ✓ · bun test 110/0 ✓ · vite ✓

## Document sharing + per-document ACL — UNVERIFIED / not implemented
- Existing document-scoped role/rights engine identified: `role_assignments.scope_type='document'`; `Document.ViewDocuments`/`Document.EditDocuments`.
- No ACL UI/API landed in this commit set.
