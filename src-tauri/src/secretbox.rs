//! Authenticated encryption for secrets we must keep usable (OAuth refresh
//! tokens), not just verify. Passwords stay hashed with Argon2 — this is for
//! the strictly different case where the plaintext has to come back.
//!
//! Key: `SPACE_SECRET_KEY`, 64 hex chars (32 bytes). Absent → refuse to store.
//! A missing key is a configuration error, never a silent plaintext fallback.

use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::aead::Aead;
use chacha20poly1305::{ChaCha20Poly1305, Key, KeyInit, Nonce};
use rand::RngCore;

pub const KEY_ENV: &str = "SPACE_SECRET_KEY";

fn cipher() -> Result<ChaCha20Poly1305, String> {
    let raw = std::env::var(KEY_ENV).map_err(|_| format!("{KEY_ENV} is not set: refusing to store a secret in plaintext"))?;
    let bytes = hex::decode(raw.trim()).map_err(|_| format!("{KEY_ENV} must be 64 hex characters"))?;
    if bytes.len() != 32 { return Err(format!("{KEY_ENV} must decode to 32 bytes, got {}", bytes.len())); }
    Ok(ChaCha20Poly1305::new(Key::from_slice(&bytes)))
}

/// True when the deployment is configured to hold retrievable secrets at all.
pub fn configured() -> bool { cipher().is_ok() }

/// `base64(nonce ‖ ciphertext‖tag)` — one self-contained column value.
pub fn seal(plaintext: &str) -> Result<String, String> {
    let cipher = cipher()?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut sealed = nonce_bytes.to_vec();
    sealed.extend(cipher.encrypt(nonce, plaintext.as_bytes()).map_err(|_| "encryption failed".to_string())?);
    Ok(STANDARD.encode(sealed))
}

pub fn open(sealed: &str) -> Result<String, String> {
    let cipher = cipher()?;
    let raw = STANDARD.decode(sealed.trim()).map_err(|_| "stored secret is not valid base64".to_string())?;
    if raw.len() < 13 { return Err("stored secret is truncated".into()); }
    let (nonce, body) = raw.split_at(12);
    let plain = cipher.decrypt(Nonce::from_slice(nonce), body).map_err(|_| "stored secret failed authentication (wrong key or tampering)".to_string())?;
    String::from_utf8(plain).map_err(|_| "stored secret is not valid UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The env key is process-global, so these run under one lock.
    fn with_key<T>(key: Option<&str>, body: impl FnOnce() -> T) -> T {
        use std::sync::{Mutex, OnceLock};
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let _guard = LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let previous = std::env::var(KEY_ENV).ok();
        match key { Some(value) => std::env::set_var(KEY_ENV, value), None => std::env::remove_var(KEY_ENV) }
        let out = body();
        match previous { Some(value) => std::env::set_var(KEY_ENV, value), None => std::env::remove_var(KEY_ENV) }
        out
    }

    #[test]
    fn round_trip_recovers_the_secret() {
        with_key(Some(&"11".repeat(32)), || {
            let sealed = seal("refresh-token-value").expect("seal");
            assert_ne!(sealed, "refresh-token-value", "the stored value must not be the plaintext");
            assert_eq!(open(&sealed).expect("open"), "refresh-token-value");
        });
    }

    #[test]
    fn same_plaintext_seals_differently_each_time() {
        with_key(Some(&"22".repeat(32)), || {
            assert_ne!(seal("same").unwrap(), seal("same").unwrap(), "a fresh nonce per seal");
        });
    }

    #[test]
    fn tampering_is_detected() {
        with_key(Some(&"33".repeat(32)), || {
            let sealed = seal("refresh-token-value").unwrap();
            let mut raw = STANDARD.decode(&sealed).unwrap();
            let last = raw.len() - 1;
            raw[last] ^= 0x01;
            assert!(open(&STANDARD.encode(raw)).is_err(), "a flipped bit must not decrypt");
        });
    }

    #[test]
    fn a_different_key_cannot_open_it() {
        let sealed = with_key(Some(&"44".repeat(32)), || seal("refresh-token-value").unwrap());
        with_key(Some(&"55".repeat(32)), || assert!(open(&sealed).is_err()));
    }

    #[test]
    fn without_a_key_we_refuse_rather_than_store_plaintext() {
        with_key(None, || {
            assert!(!configured());
            assert!(seal("refresh-token-value").is_err(), "no key must mean no storage, not plaintext");
        });
    }
}
