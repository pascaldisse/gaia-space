import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import PageHeader from "../components/PageHeader";
import { Icon } from "../components/Icon";
import {
  decryptString,
  deriveMasterKey,
  deriveMasterPasswordHash,
  encryptString,
  makeRegistration,
  totp,
  type SymmetricKey,
} from "../vault/crypto";
import {
  assertPbkdf2Kdf,
  clearSession,
  createCipher,
  deleteCipher,
  inviteToVault,
  login,
  prelogin,
  register,
  sync,
  updateCipher,
  VaultError,
  type Cipher,
} from "../api/vault";
import "./Passwords.css";

/** ── PASSWORDS ──────────────────────────────────────────────────────────────
 *  A Bitwarden-protocol vault (server: Vaultwarden, `../api/vault.ts`), decrypted entirely
 *  client-side (`../vault/crypto.ts`). The server never sees a plaintext secret, a master
 *  password, or the account's `userKey` — only EncStrings and the PBKDF2 hash used as a login
 *  password. `userKey` itself lives in this component's own signal (memory only, like the
 *  access token in `api/vault.ts`): a reload always re-locks the vault, by design.
 *
 *  Card/Identity are READ-ONLY here (unsupported: see docs/specs/passwords-vault.md) — they
 *  list and open, but the drawer only edits Login and Secure Note.
 */

const DEFAULT_AUTOLOCK_MS = 5 * 60_000;
export const VAULT_AUTOLOCK_MS: number = Number(import.meta.env.VITE_VAULT_AUTOLOCK_MS) || DEFAULT_AUTOLOCK_MS;
const DEFAULT_KDF_ITERATIONS = 600_000;

type TypeFilter = "all" | "logins" | "cards" | "identities" | "notes";
const TYPE_CHIPS: { id: TypeFilter; label: string; cipherType?: Cipher["type"] }[] = [
  { id: "all", label: "All" },
  { id: "logins", label: "Logins", cipherType: 1 },
  { id: "cards", label: "Cards", cipherType: 3 },
  { id: "identities", label: "Identities", cipherType: 4 },
  { id: "notes", label: "Notes", cipherType: 2 },
];

/** A cipher with its EncStrings already opened. Undecryptable fields fall back to `""` rather
 *  than throwing — one bad row must not blank the whole vault. */
type VaultItem = {
  id: string;
  type: Cipher["type"];
  name: string;
  username: string;
  password: string;
  totpSecret: string;
  url: string;
  notes: string;
  favorite: boolean;
  raw: Cipher;
};

async function tryDecrypt(key: SymmetricKey, value: string | null | undefined): Promise<string> {
  if (!value) return "";
  try {
    return await decryptString(key, value);
  } catch {
    return "";
  }
}

async function decryptCipher(key: SymmetricKey, cipher: Cipher): Promise<VaultItem> {
  const login = cipher.login;
  return {
    id: cipher.id ?? "",
    type: cipher.type,
    name: await tryDecrypt(key, cipher.name),
    username: await tryDecrypt(key, login?.username ?? null),
    password: await tryDecrypt(key, login?.password ?? null),
    totpSecret: await tryDecrypt(key, login?.totp ?? null),
    url: login?.uris?.[0]?.uri ? await tryDecrypt(key, login.uris[0].uri) : "",
    notes: await tryDecrypt(key, cipher.notes),
    favorite: !!cipher.favorite,
    raw: cipher,
  };
}

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}";
function generatePassword(length: number, symbols: boolean): string {
  const alphabet = symbols ? ALPHANUM + SYMBOLS : ALPHANUM;
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

type DraftKind = "login" | "note";
type Draft = {
  id?: string;
  kind: DraftKind;
  name: string;
  username: string;
  password: string;
  url: string;
  totpSecret: string;
  notes: string;
  favorite: boolean;
};
const emptyDraft = (kind: DraftKind): Draft => ({ kind, name: "", username: "", password: "", url: "", totpSecret: "", notes: "", favorite: false });

export default function Passwords() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [autoLockedNotice, setAutoLockedNotice] = createSignal(false);

  const [userKey, setUserKey] = createSignal<SymmetricKey | null>(null);
  const [items, setItems] = createSignal<VaultItem[]>([]);
  const unlocked = () => userKey() !== null;

  const [search, setSearch] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal<TypeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [revealPassword, setRevealPassword] = createSignal(false);

  const [drawer, setDrawer] = createSignal<Draft | null>(null);
  const [drawerError, setDrawerError] = createSignal("");
  const [genLength, setGenLength] = createSignal(20);
  const [genSymbols, setGenSymbols] = createSignal(true);

  const [toast, setToast] = createSignal("");
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(""), 2000);
  };

  const [nowTick, setNowTick] = createSignal(Date.now());
  const tickTimer = setInterval(() => setNowTick(Date.now()), 1000);

  let lastActivity = Date.now();
  const noteActivity = () => { lastActivity = Date.now(); };
  const idleCheck = setInterval(() => {
    if (unlocked() && Date.now() - lastActivity > VAULT_AUTOLOCK_MS) {
      lock(true);
    }
  }, 1000);
  onMount(() => {
    window.addEventListener("pointerdown", noteActivity);
    window.addEventListener("keydown", noteActivity);
  });
  onCleanup(() => {
    clearInterval(tickTimer);
    clearInterval(idleCheck);
    window.removeEventListener("pointerdown", noteActivity);
    window.removeEventListener("keydown", noteActivity);
  });

  function lock(auto = false) {
    clearSession();
    setUserKey(null);
    setItems([]);
    setSelectedId(null);
    setDrawer(null);
    setPassword("");
    setAutoLockedNotice(auto);
  }

  async function loadItems(key: SymmetricKey) {
    const { ciphers } = await sync();
    const decrypted = await Promise.all(ciphers.filter(c => !c.deletedDate).map(c => decryptCipher(key, c)));
    setItems(decrypted);
  }

  async function unlock(e: Event) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const mail = email().trim();
      const pre = await prelogin(mail);
      assertPbkdf2Kdf(pre.kdf);
      const masterKey = await deriveMasterKey(mail, password(), pre.kdfIterations);
      const hash = await deriveMasterPasswordHash(masterKey, password());
      const result = await login(mail, hash);
      assertPbkdf2Kdf(result.Kdf ?? pre.kdf);
      const { unlockWithLoginKey } = await import("../vault/crypto");
      const key = await unlockWithLoginKey(masterKey, result.Key);
      setUserKey(key);
      setAutoLockedNotice(false);
      noteActivity();
      await loadItems(key);
    } catch (reason) {
      setError(reason instanceof VaultError ? reason.message : reason instanceof Error ? reason.message : "Could not unlock the vault.");
    } finally {
      setBusy(false);
    }
  }

  async function createVault(e: Event) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const mail = email().trim();
      if (!mail || !password()) throw new Error("Enter an email and a master password first.");
      await inviteToVault(mail);
      const iterations = DEFAULT_KDF_ITERATIONS;
      const { masterPasswordHash, encUserKey, userKey: freshKey } = await makeRegistration(mail, password(), iterations);
      await register({ email: mail, name: mail, masterPasswordHash, key: encUserKey, kdf: 0, kdfIterations: iterations });
      await login(mail, masterPasswordHash);
      setUserKey(freshKey);
      setAutoLockedNotice(false);
      noteActivity();
      await loadItems(freshKey);
    } catch (reason) {
      setError(reason instanceof VaultError ? reason.message : reason instanceof Error ? reason.message : "Could not create the vault.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    const filter = typeFilter();
    const favOnly = favoritesOnly();
    const wanted = TYPE_CHIPS.find(c => c.id === filter)?.cipherType;
    return items().filter(item => {
      if (wanted !== undefined && item.type !== wanted) return false;
      if (favOnly && !item.favorite) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.username.toLowerCase().includes(q);
    });
  });

  const selected = createMemo(() => items().find(i => i.id === selectedId()) ?? null);
  const [totpCode, setTotpCode] = createSignal("");
  createEffect(() => {
    nowTick();
    const item = selected();
    if (item?.totpSecret) {
      totp(item.totpSecret, Date.now()).then(setTotpCode).catch(() => setTotpCode(""));
    } else {
      setTotpCode("");
    }
  });
  const totpSecondsLeft = () => 30 - (Math.floor(nowTick() / 1000) % 30);

  const typeLabel = (t: Cipher["type"]) => t === 1 ? "Login" : t === 2 ? "Note" : t === 3 ? "Card" : t === 4 ? "Identity" : "SSH key";
  const typeIcon = (t: Cipher["type"]): "key" | "doc" | "grid" | "user" => t === 1 ? "key" : t === 2 ? "doc" : t === 3 ? "grid" : "user";

  async function copy(label: string, value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    showToast(`Copied ${label}`);
  }

  function openAdd(kind: DraftKind) {
    setDrawerError("");
    setGenLength(20);
    setGenSymbols(true);
    setDrawer(emptyDraft(kind));
  }
  function openEdit(item: VaultItem) {
    if (item.type !== 1 && item.type !== 2) return; // Card/Identity are read-only
    setDrawerError("");
    setDrawer({
      id: item.id,
      kind: item.type === 1 ? "login" : "note",
      name: item.name,
      username: item.username,
      password: item.password,
      url: item.url,
      totpSecret: item.totpSecret,
      notes: item.notes,
      favorite: item.favorite,
    });
  }

  async function saveDrawer(e: Event) {
    e.preventDefault();
    const key = userKey();
    const draft = drawer();
    if (!key || !draft) return;
    setDrawerError("");
    setBusy(true);
    try {
      const cipherType: Cipher["type"] = draft.kind === "login" ? 1 : 2;
      const cipher: Cipher = {
        id: draft.id,
        type: cipherType,
        name: await encryptString(key, draft.name || "Untitled"),
        notes: draft.notes ? await encryptString(key, draft.notes) : null,
        favorite: draft.favorite,
      };
      if (cipherType === 1) {
        cipher.login = {
          username: draft.username ? await encryptString(key, draft.username) : null,
          password: draft.password ? await encryptString(key, draft.password) : null,
          totp: draft.totpSecret ? await encryptString(key, draft.totpSecret) : null,
          uris: draft.url ? [{ uri: await encryptString(key, draft.url) }] : [],
        };
      } else {
        cipher.secureNote = { type: 0 };
      }
      if (draft.id) {
        await updateCipher(draft.id, cipher);
      } else {
        await createCipher(cipher);
      }
      setDrawer(null);
      await loadItems(key);
    } catch (reason) {
      setDrawerError(reason instanceof VaultError ? reason.message : reason instanceof Error ? reason.message : "Could not save this item.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    const item = selected();
    const key = userKey();
    if (!item || !key) return;
    setBusy(true);
    try {
      await deleteCipher(item.id);
      setSelectedId(null);
      await loadItems(key);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not delete this item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="passwords-view">
      <PageHeader
        icon="key"
        title="Passwords"
        subline="A Bitwarden-compatible vault, decrypted only on this device."
        actions={
          <Show when={unlocked()}>
            <button type="button" class="ghost-pill" onClick={() => lock(false)}>Lock</button>
          </Show>
        }
      />
      <Show when={toast()}><div class="passwords-toast" role="status">{toast()}</div></Show>

      <Show when={!unlocked()}>
        <div class="passwords-unlock-card" aria-label="Vault unlock">
          <Show when={autoLockedNotice()}>
            <p class="passwords-locked-banner" role="status">Locked after {Math.round(VAULT_AUTOLOCK_MS / 60000)} minutes idle.</p>
          </Show>
          <form aria-label="Unlock vault" onSubmit={unlock}>
            <label>Email<input aria-label="Email" type="email" value={email()} onInput={e => setEmail(e.currentTarget.value)} required /></label>
            <label>Master password<input aria-label="Master password" type="password" value={password()} onInput={e => setPassword(e.currentTarget.value)} required /></label>
            <Show when={error()}><p class="passwords-error" role="alert">{error()}</p></Show>
            <div class="passwords-unlock-actions">
              <button type="submit" class="primary" disabled={busy()}>Unlock</button>
              <button type="button" disabled={busy()} onClick={createVault}>Create vault</button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={unlocked()}>
        <div class="passwords-toolbar">
          <div class="passwords-search">
            <Icon name="search" size={16} />
            <input aria-label="Search passwords" placeholder="Search" value={search()} onInput={e => setSearch(e.currentTarget.value)} />
          </div>
          <div class="passwords-chips" role="tablist" aria-label="Filter by type">
            <For each={TYPE_CHIPS}>{chip => (
              <button type="button" role="tab" aria-pressed={typeFilter() === chip.id} classList={{ active: typeFilter() === chip.id }} onClick={() => setTypeFilter(chip.id)}>{chip.label}</button>
            )}</For>
            <button type="button" aria-pressed={favoritesOnly()} classList={{ active: favoritesOnly() }} onClick={() => setFavoritesOnly(v => !v)}>Favorites</button>
          </div>
          <button type="button" class="ghost-pill" onClick={() => openAdd("login")}>+ Login</button>
          <button type="button" class="ghost-pill" onClick={() => openAdd("note")}>+ Note</button>
        </div>

        <div class="passwords-body">
          <ul class="passwords-list" aria-label="Passwords">
            <Show when={filtered().length === 0}><li class="passwords-empty">No items match.</li></Show>
            <For each={filtered()}>{item => (
              <li>
                <button type="button" class="passwords-row" classList={{ active: selectedId() === item.id }} onClick={() => { setSelectedId(item.id); setRevealPassword(false); }}>
                  <Icon name={typeIcon(item.type)} size={16} />
                  <span class="passwords-row-text">
                    <span class="passwords-row-title">{item.name || "(untitled)"}</span>
                    <span class="passwords-row-meta">{item.username || typeLabel(item.type)}</span>
                  </span>
                </button>
              </li>
            )}</For>
          </ul>

          <Show when={selected()}>
            {(item) => (
              <div class="passwords-detail" aria-label={`Details for ${item().name}`}>
                <header>
                  <h2>{item().name || "(untitled)"}</h2>
                  <div class="passwords-detail-actions">
                    <Show when={item().type === 1 || item().type === 2}>
                      <button type="button" onClick={() => openEdit(item())}>Edit</button>
                    </Show>
                    <button type="button" onClick={removeSelected}>Delete</button>
                  </div>
                </header>
                <Show when={item().username}>
                  <div class="passwords-field">
                    <span>Username</span><span>{item().username}</span>
                    <button type="button" aria-label="Copy username" onClick={() => copy("username", item().username)}><Icon name="copy" size={14} /></button>
                  </div>
                </Show>
                <Show when={item().password}>
                  <div class="passwords-field">
                    <span>Password</span>
                    <span>{revealPassword() ? item().password : "••••••••"}</span>
                    <button type="button" aria-label={revealPassword() ? "Hide password" : "Reveal password"} onClick={() => setRevealPassword(v => !v)}>{revealPassword() ? "Hide" : "Show"}</button>
                    <button type="button" aria-label="Copy password" onClick={() => copy("password", item().password)}><Icon name="copy" size={14} /></button>
                  </div>
                </Show>
                <Show when={item().totpSecret}>
                  <div class="passwords-field">
                    <span>TOTP</span><span aria-label="TOTP code">{totpCode()} <em>{totpSecondsLeft()}s</em></span>
                    <button type="button" aria-label="Copy TOTP code" onClick={() => copy("TOTP code", totpCode())}><Icon name="copy" size={14} /></button>
                  </div>
                </Show>
                <Show when={item().url}>
                  <div class="passwords-field">
                    <span>URL</span><a href={item().url} target="_blank" rel="noreferrer">{item().url}</a>
                  </div>
                </Show>
                <Show when={item().notes}>
                  <div class="passwords-field passwords-field-notes"><span>Notes</span><p>{item().notes}</p></div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show when={drawer()}>
        {(draft) => (
          <div class="passwords-drawer" role="dialog" aria-label={draft().id ? "Edit item" : "Add item"}>
            <form onSubmit={saveDrawer}>
              <h2>{draft().id ? "Edit" : "Add"} {draft().kind === "login" ? "login" : "secure note"}</h2>
              <label>Name<input aria-label="Name" value={draft().name} onInput={e => setDrawer({ ...draft(), name: e.currentTarget.value })} required /></label>
              <Show when={draft().kind === "login"}>
                <label>Username<input aria-label="Username" value={draft().username} onInput={e => setDrawer({ ...draft(), username: e.currentTarget.value })} /></label>
                <label>Password<input aria-label="Password" value={draft().password} onInput={e => setDrawer({ ...draft(), password: e.currentTarget.value })} /></label>
                <div class="passwords-generator">
                  <label>Length<input aria-label="Generator length" type="number" min={12} max={64} value={genLength()} onInput={e => setGenLength(Number(e.currentTarget.value) || 20)} /></label>
                  <label><input aria-label="Include symbols" type="checkbox" checked={genSymbols()} onChange={e => setGenSymbols(e.currentTarget.checked)} /> Symbols</label>
                  <button type="button" onClick={() => setDrawer({ ...draft(), password: generatePassword(Math.min(64, Math.max(12, genLength())), genSymbols()) })}>Generate</button>
                </div>
                <label>URL<input aria-label="URL" value={draft().url} onInput={e => setDrawer({ ...draft(), url: e.currentTarget.value })} /></label>
                <label>TOTP secret<input aria-label="TOTP secret" value={draft().totpSecret} onInput={e => setDrawer({ ...draft(), totpSecret: e.currentTarget.value })} /></label>
              </Show>
              <label>Notes<textarea aria-label="Notes" value={draft().notes} onInput={e => setDrawer({ ...draft(), notes: e.currentTarget.value })} /></label>
              <label><input aria-label="Favorite" type="checkbox" checked={draft().favorite} onChange={e => setDrawer({ ...draft(), favorite: e.currentTarget.checked })} /> Favorite</label>
              <Show when={drawerError()}><p class="passwords-error" role="alert">{drawerError()}</p></Show>
              <div class="passwords-drawer-actions">
                <button type="submit" class="primary" disabled={busy()}>Save</button>
                <button type="button" disabled={busy()} onClick={() => setDrawer(null)}>Cancel</button>
              </div>
            </form>
          </div>
        )}
      </Show>
    </section>
  );
}
