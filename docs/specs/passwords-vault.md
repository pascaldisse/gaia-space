# Passwords vault (Bitwarden protocol over Vaultwarden) — spec 2026-09-17

Lane B. Backend = Vaultwarden 1.37.3 (`deploy/vaultwarden/INSTALL.md`, box 151.115.73.182), same-origin at
`/space/vault` (Caddy `handle`, no prefix stripping — Vaultwarden's own `DOMAIN` includes the path, so every
call, even loopback, must carry it: `curl 127.0.0.1:8095/alive`→404, `.../space/vault/alive`→200).

## Protocol (client-side crypto only — server never sees plaintext or the account key)
- `masterKey = PBKDF2-SHA256(password, salt=email.trim().toLowerCase(), iterations, 32B)`.
- `masterPasswordHash = base64(PBKDF2-SHA256(masterKey, salt=password, 1 round, 32B))` — this, not the
  password, is what `/identity/connect/token` and `/identity/accounts/register` receive.
- stretched master key = `HKDF-expand(SHA256, prk=masterKey, info='enc') 32B ‖ HKDF-expand(info='mac') 32B`
  (expand only — `masterKey` is used directly as the PRK, no extract step; RFC 5869 `T(1)=HMAC(prk,info‖0x01)`
  covers every length this protocol needs since SHA-256's block is 32B).
- `userKey` = 64 random bytes (`enc=bytes[0..32)`, `mac=bytes[32..64)`) — the account's own symmetric key,
  generated once at registration, wrapped (EncString) under the stretched master key, and stored server-side
  as the register/login `key`/`Key` field. Any 64-byte key (stretched master key, userKey) is used the same
  way; the app calls that shape `SymmetricKey`.
- EncString type 2: `2.<b64 iv>|<b64 ct>|<b64 mac>` = AES-256-CBC(PKCS7, 16B random iv) ‖
  HMAC-SHA256(macKey, iv‖ct). Decrypt verifies the MAC (constant-time) *before* attempting to decrypt.
- TOTP: RFC 6238 over HMAC-SHA1, base32 secret, default period 30s / 6 digits.
- kdf ≠ 0 (Argon2id) → refused as a typed `VaultError('ArgonUnsupported', …)`, shown inline in the UI. Only
  PBKDF2 (kdf 0) is implemented.

## Files
- `src/vault/crypto.ts` (+ `crypto.test.ts`) — pure WebCrypto, no deps: PBKDF2/HKDF-expand/EncString/TOTP,
  `makeRegistration`, `unlockWithLoginKey`.
- `src/api/vault.ts` (+ `vault.test.ts`) — Vaultwarden fetch client: `prelogin/register/login/refresh/sync/
  createCipher/updateCipher/deleteCipher`, plus `inviteToVault` (goes through the *space* `invoke`/`api/cmd`
  bridge, not Vaultwarden directly — it needs `VAULTWARDEN_ADMIN_TOKEN`, which the browser never holds).
  Base path: `VAULT_BASE` = `/space/vault`, override `VITE_VAULT_BASE`; desktop Tauri (not the mobile shell,
  whose webview has already navigated to the real server origin) resolves against `https://paloptic.com`
  because its own window origin (`tauri://localhost`) is not the deployed domain. Access/refresh tokens live
  in an in-memory Solid signal only — never localStorage; a reload always re-locks the vault.
- `src-tauri/src/vault.rs` — `vault_invite {input:{email}}` (`CommandPolicy::Session`, wired in both
  `tauri::generate_handler!` and the `/api/cmd/*` dispatch table in `space-server.rs`, same pattern as
  `budget_add_expense`). Env `VAULTWARDEN_URL` (default `http://127.0.0.1:8095`) + `VAULTWARDEN_PATH`
  (default `/space/vault`, see box-install note above) + `VAULTWARDEN_ADMIN_TOKEN` (missing →
  `"vault not configured"`). Admin session = cookie only (`POST {base}/admin` form `token=…` → `Set-Cookie:
  VW_ADMIN=<jwt>`), replayed as `Cookie:` on `POST {base}/admin/invite` — Vaultwarden's `AdminToken` guard
  has no Bearer/header path.
- `src/views/Passwords.tsx` (+ `Passwords.css`, `src/vault/passwords.view.test.tsx`) — rail entry "Passwords"
  (key icon) in the Knowledge/library group (`nav.ts`), route `/passwords`. Setup/unlock card → locked banner
  + idle auto-lock (`VAULT_AUTOLOCK_MS`, default 5 min, override `VITE_VAULT_AUTOLOCK_MS`) → search + type
  chips (All/Logins/Cards/Identities/Notes) + favorites → detail pane (copy username/password/TOTP-live/URL,
  reveal toggle, Edit/Delete=trash) → add/edit drawer (Login + Secure Note only; password generator 12–64
  chars, symbols toggle, `crypto.getRandomValues`). Card/Identity list and open but do not edit here.

## Endpoints used (all under `VAULT_BASE`)
`POST /identity/accounts/prelogin` · `POST /identity/accounts/register` (old `RegisterData` compat shape:
`email,name,masterPasswordHash,key,kdf,kdfIterations`, no asymmetric `keys`) · `POST /identity/connect/token`
(form, `grant_type=password|refresh_token`) · `GET /api/sync` · `POST /api/ciphers` ·
`PUT /api/ciphers/{id}` · `PUT /api/ciphers/{id}/delete` (soft delete = trash; there is no hard delete here).

## Unsupported (by design, this lane)
Argon2id KDF · organizations/collections/sharing · attachments · asymmetric (RSA) account keys · SSH-key
ciphers · Card/Identity editing (read-only) · hard delete (trash only) · key rotation.
