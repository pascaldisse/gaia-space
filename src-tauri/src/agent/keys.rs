//! Provider keys for the agent, sealed with `secretbox` (`agent_provider_keys`, V150).
//!
//! The plaintext key enters through exactly one command and never leaves this
//! module: [`save_key_in`] seals it, [`open_split`] is the only way back, and the
//! listing surface hands the frontend a masked hint instead. `SPACE_SECRET_KEY`
//! absent means no storage at all — `secretbox::seal` refuses rather than falling
//! back to plaintext, so an unconfigured deployment cannot silently persist a key
//! in the clear.
//!
//! BYO keys with a base URL are what let one OpenAI-compatible client cover
//! OpenAI, a gateway, Ollama and vLLM (roadmap.md, "First provider").

use crate::{db, secretbox};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection};
use serde::Serialize;

type Result<T> = std::result::Result<T, String>;

/// A secretbox nonce is 12 bytes; the rest of the sealed blob is the body.
const NONCE_BYTES: usize = 12;

/// Everything the frontend may learn about a stored key. There is deliberately no
/// plaintext field — not even an optional one — so no code path can serialize one.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ProviderKey {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub base_url: Option<String>,
    /// Masked fingerprint, e.g. `sk-…9f3a`. Enough to tell two keys apart, not
    /// enough to reuse.
    pub hint: String,
    pub created_by: Option<String>,
    pub created_at: i64,
}

const KEY_COLS: &str = "id,provider,label,base_url,ciphertext,nonce,created_by,created_at";

/// One row as stored — ciphertext and nonce included. Never serialized: it exists
/// only so `to_public` can decrypt in-process to derive the hint.
struct StoredKey {
    id: String,
    provider: String,
    label: String,
    base_url: Option<String>,
    ciphertext: String,
    nonce: String,
    created_by: Option<String>,
    created_at: i64,
}

fn row_key(row: &rusqlite::Row) -> rusqlite::Result<StoredKey> {
    Ok(StoredKey {
        id: row.get(0)?,
        provider: row.get(1)?,
        label: row.get(2)?,
        base_url: row.get(3)?,
        ciphertext: row.get(4)?,
        nonce: row.get(5)?,
        created_by: row.get(6)?,
        created_at: row.get(7)?,
    })
}

impl StoredKey {
    fn to_public(&self) -> Result<ProviderKey> {
        Ok(ProviderKey {
            id: self.id.clone(),
            provider: self.provider.clone(),
            label: self.label.clone(),
            base_url: self.base_url.clone(),
            hint: mask(&open_split(&self.ciphertext, &self.nonce)?),
            created_by: self.created_by.clone(),
            created_at: self.created_at,
        })
    }
}

/// `secretbox::seal` returns one `base64(nonce ‖ body)` value; the V150 columns keep
/// the two halves in their own columns. This pair is the only place that layout is
/// known, so all cryptography stays inside `secretbox`.
fn seal_split(plaintext: &str) -> Result<(String, String)> {
    let sealed = secretbox::seal(plaintext)?;
    let raw = STANDARD
        .decode(sealed.trim())
        .map_err(|_| "sealed key is not valid base64".to_string())?;
    if raw.len() <= NONCE_BYTES {
        return Err("sealed key is truncated".into());
    }
    let (nonce, body) = raw.split_at(NONCE_BYTES);
    // (ciphertext, nonce) — the column order in the schema.
    Ok((STANDARD.encode(body), STANDARD.encode(nonce)))
}

fn open_split(ciphertext: &str, nonce: &str) -> Result<String> {
    let body = STANDARD
        .decode(ciphertext.trim())
        .map_err(|_| "stored ciphertext is not valid base64".to_string())?;
    let nonce = STANDARD
        .decode(nonce.trim())
        .map_err(|_| "stored nonce is not valid base64".to_string())?;
    if nonce.len() != NONCE_BYTES {
        return Err(format!(
            "stored nonce must be {NONCE_BYTES} bytes, got {}",
            nonce.len()
        ));
    }
    let mut joined = nonce;
    joined.extend(body);
    secretbox::open(&STANDARD.encode(joined))
}

/// A fingerprint a person can recognise without being able to reuse: leading 3 and
/// trailing 4 characters, the rest elided. Short values are masked whole — on an
/// 8-character secret, 3+4 would be most of it.
fn mask(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() <= 8 {
        return "\u{2022}".repeat(chars.len().max(1));
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}\u{2026}{tail}")
}

/// Store (or rotate) the key for `(provider, label)`. Returns the public shape only;
/// the plaintext argument is dropped on the floor once it is sealed.
pub fn save_key_in(
    c: &Connection,
    provider: &str,
    label: &str,
    base_url: Option<&str>,
    plaintext: &str,
    actor: Option<&str>,
) -> Result<ProviderKey> {
    let provider = provider.trim();
    let label = label.trim();
    if provider.is_empty() {
        return Err("provider is required".into());
    }
    if label.is_empty() {
        return Err("label is required".into());
    }
    if plaintext.trim().is_empty() {
        return Err("key is required".into());
    }
    let base_url = match base_url.map(str::trim).filter(|u| !u.is_empty()) {
        None => None,
        Some(url) => {
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err("base_url must be an http(s) URL".into());
            }
            Some(url.trim_end_matches('/').to_string())
        }
    };
    let (ciphertext, nonce) = seal_split(plaintext.trim())?;
    c.execute(
        "INSERT INTO agent_provider_keys(id,provider,label,base_url,ciphertext,nonce,created_by) \
         VALUES(?1,?2,?3,?4,?5,?6,?7) \
         ON CONFLICT(provider,label) DO UPDATE SET \
             base_url=excluded.base_url, ciphertext=excluded.ciphertext, nonce=excluded.nonce",
        params![
            crate::agent::new_id("key"),
            provider,
            label,
            base_url,
            ciphertext,
            nonce,
            actor
        ],
    )
    .map_err(|e| e.to_string())?;
    // The conflict path keeps the original id, created_by and created_at, so read
    // the row back by its natural key rather than trusting the id we proposed.
    let stored = c
        .query_row(
            &format!("SELECT {KEY_COLS} FROM agent_provider_keys WHERE provider=?1 AND label=?2"),
            params![provider, label],
            row_key,
        )
        .map_err(|e| e.to_string())?;
    stored.to_public()
}

pub fn list_keys_in(c: &Connection) -> Result<Vec<ProviderKey>> {
    let mut st = c
        .prepare(&format!(
            "SELECT {KEY_COLS} FROM agent_provider_keys \
             ORDER BY provider COLLATE NOCASE, label COLLATE NOCASE"
        ))
        .map_err(|e| e.to_string())?;
    let rows = st.query_map([], row_key).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?.to_public()?);
    }
    Ok(out)
}

pub fn delete_key_in(c: &Connection, id: &str) -> Result<()> {
    let removed = c
        .execute("DELETE FROM agent_provider_keys WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    if removed == 0 {
        return Err("provider key not found".into());
    }
    Ok(())
}

// ---- command surface (/api/cmd/<name>; desktop IPC with the same names) ----
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn agent_save_provider_key(
    provider: String,
    label: String,
    base_url: Option<String>,
    key: String,
    actor: Option<String>,
) -> Result<ProviderKey> {
    save_key_in(
        &db::conn()?,
        &provider,
        &label,
        base_url.as_deref(),
        &key,
        actor.as_deref(),
    )
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn agent_list_provider_keys() -> Result<Vec<ProviderKey>> {
    list_keys_in(&db::conn()?)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn agent_delete_provider_key(id: String) -> Result<()> {
    delete_key_in(&db::conn()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `SPACE_SECRET_KEY` is process-global, so every test that sets or removes it
    /// holds the shared guard and restores the previous value on the way out.
    fn with_secret_key<T>(key: Option<&str>, body: impl FnOnce() -> T) -> T {
        let _serial = crate::db::test_serial();
        let previous = std::env::var(secretbox::KEY_ENV).ok();
        match key {
            Some(value) => std::env::set_var(secretbox::KEY_ENV, value),
            None => std::env::remove_var(secretbox::KEY_ENV),
        }
        let out = body();
        match previous {
            Some(value) => std::env::set_var(secretbox::KEY_ENV, value),
            None => std::env::remove_var(secretbox::KEY_ENV),
        }
        out
    }

    const TEST_KEY: &str = "77";

    fn conn_with_key<T>(body: impl FnOnce(&Connection) -> T) -> T {
        with_secret_key(Some(&TEST_KEY.repeat(32)), || {
            let c = db::open_in_memory().expect("db");
            db::migrate(&c).expect("migrate");
            body(&c)
        })
    }

    fn stored_secret(c: &Connection, id: &str) -> String {
        let (ciphertext, nonce): (String, String) = c
            .query_row(
                "SELECT ciphertext,nonce FROM agent_provider_keys WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("stored row");
        open_split(&ciphertext, &nonce).expect("open the stored key")
    }

    #[test]
    fn the_plaintext_never_lands_in_a_column_and_never_reaches_the_frontend() {
        let plaintext = "sk-live-0123456789abcdefghijklmnop";
        conn_with_key(|c| {
            // `created_by` is a real FK to `profiles`: an actor that does not exist
            // is refused, which is the point of the column.
            c.execute(
                "INSERT INTO profiles(id,username,display_name,created_at) \
                 VALUES('pascal','pascal','Pascal',unixepoch())",
                [],
            )
            .expect("profile");
            let saved = save_key_in(
                c,
                "openai",
                "Work",
                Some("https://api.openai.com/v1/"),
                plaintext,
                Some("pascal"),
            )
            .expect("save");
            // The trailing slash is normalized away; nothing else is invented.
            assert_eq!(saved.base_url.as_deref(), Some("https://api.openai.com/v1"));
            assert_eq!(saved.created_by.as_deref(), Some("pascal"));
            assert_eq!(saved.hint, "sk-\u{2026}mnop");
            assert_ne!(saved.hint, plaintext);

            let (ciphertext, nonce): (String, String) = c
                .query_row(
                    "SELECT ciphertext,nonce FROM agent_provider_keys WHERE id=?1",
                    [&saved.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .expect("stored row");
            assert_ne!(ciphertext, plaintext, "the column must not hold plaintext");
            assert!(!nonce.is_empty());
            assert_eq!(stored_secret(c, &saved.id), plaintext);

            let listed = serde_json::to_string(&list_keys_in(c).unwrap()).unwrap();
            assert!(
                !listed.contains(plaintext),
                "the listing must never carry the plaintext: {listed}"
            );
            assert!(listed.contains("sk-\u{2026}mnop"));
        });
    }

    /// The store is only readable with the deployment key that wrote it.
    #[test]
    fn a_different_space_secret_key_cannot_open_the_store() {
        let c = db::open_in_memory().expect("db");
        db::migrate(&c).expect("migrate");
        with_secret_key(Some(&TEST_KEY.repeat(32)), || {
            save_key_in(&c, "openai", "L", None, "sk-live-secret", None).expect("save");
        });
        with_secret_key(Some(&"99".repeat(32)), || {
            assert!(list_keys_in(&c).is_err(), "a different key must not open it");
        });
    }

    #[test]
    fn save_validates_and_refuses_junk() {
        conn_with_key(|c| {
            assert!(save_key_in(c, "", "L", None, "sk-x", None).is_err());
            assert!(save_key_in(c, "openai", "   ", None, "sk-x", None).is_err());
            assert!(save_key_in(c, "openai", "L", None, "   ", None).is_err());
            assert!(save_key_in(c, "openai", "L", Some("ftp://x"), "sk-x", None).is_err());
            assert!(
                list_keys_in(c).unwrap().is_empty(),
                "a rejected save must store nothing"
            );
        });
    }

    #[test]
    fn provider_and_label_are_the_natural_key_so_a_rotate_replaces_the_secret() {
        conn_with_key(|c| {
            let first = save_key_in(
                c,
                "ollama",
                "Local",
                Some("http://127.0.0.1:11434/v1"),
                "first-secret-value",
                None,
            )
            .expect("save");
            let second = save_key_in(c, "ollama", "Local", None, "second-secret-value", None)
                .expect("rotate");
            assert_eq!(first.id, second.id, "same provider+label is the same row");
            assert_eq!(second.base_url, None, "a rotation replaces the whole config");
            assert_eq!(first.created_at, second.created_at, "the row is not recreated");
            assert_eq!(list_keys_in(c).unwrap().len(), 1);
            assert_eq!(stored_secret(c, &second.id), "second-secret-value");
        });
    }

    #[test]
    fn short_secrets_are_masked_whole() {
        assert_eq!(mask("sk-a"), "\u{2022}\u{2022}\u{2022}\u{2022}");
        assert_eq!(mask("12345678"), "\u{2022}".repeat(8));
        assert_eq!(mask("123456789"), "123\u{2026}6789");
    }

    #[test]
    fn delete_removes_one_key_and_reports_a_missing_one() {
        conn_with_key(|c| {
            let k = save_key_in(c, "vllm", "Cluster", None, "sk-cluster-secret", None).unwrap();
            delete_key_in(c, &k.id).expect("delete");
            assert!(list_keys_in(c).unwrap().is_empty());
            assert!(
                delete_key_in(c, &k.id).is_err(),
                "deleting it twice is an error, not a silent success"
            );
        });
    }

    #[test]
    fn without_space_secret_key_we_store_nothing_rather_than_plaintext() {
        with_secret_key(None, || {
            let c = db::open_in_memory().expect("db");
            db::migrate(&c).expect("migrate");
            let error = save_key_in(&c, "openai", "L", None, "sk-live-secret", None).unwrap_err();
            assert!(error.contains(secretbox::KEY_ENV), "{error}");
            assert!(list_keys_in(&c).unwrap().is_empty());
        });
    }

    #[test]
    fn a_tampered_nonce_is_detected_rather_than_returned_as_a_hint() {
        conn_with_key(|c| {
            let k = save_key_in(c, "openai", "L", None, "sk-live-secret", None).unwrap();
            c.execute(
                "UPDATE agent_provider_keys SET nonce=?2 WHERE id=?1",
                params![&k.id, STANDARD.encode([0u8; NONCE_BYTES])],
            )
            .unwrap();
            assert!(list_keys_in(c).is_err(), "a swapped nonce must not decrypt");
            // A nonce that is not even 12 bytes is a corrupt row, not a panic.
            c.execute(
                "UPDATE agent_provider_keys SET nonce='AAAA' WHERE id=?1",
                [&k.id],
            )
            .unwrap();
            assert!(list_keys_in(c).is_err());
        });
    }
}
