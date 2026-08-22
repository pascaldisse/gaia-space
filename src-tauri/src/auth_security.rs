//! Durable credential records: opaque permanent tokens, sealed RFC6238 TOTP,
//! and single/reusable invitations. Plaintext credentials leave only at creation.
use crate::{db, secretbox};
use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use sha1::{Digest, Sha1};

type Result<T> = std::result::Result<T, String>;
pub(crate) fn opaque(prefix: &str) -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{prefix}{}", hex::encode(bytes))
}
fn id(prefix: &str) -> String {
    format!("{prefix}-{}", &opaque("")[..24])
}
pub(crate) fn hash(value: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(value.as_bytes(), &salt)
        .map(|v| v.to_string())
        .map_err(|e| e.to_string())
}
pub(crate) fn matches(value: &str, stored: &str) -> bool {
    PasswordHash::new(stored)
        .ok()
        .and_then(|p| Argon2::default().verify_password(value.as_bytes(), &p).ok())
        .is_some()
}

#[derive(Serialize)]
pub struct PermanentToken {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub last_used_at: Option<i64>,
}
pub fn create_permanent_token(
    user_id: &str,
    name: &str,
    expires_at: Option<i64>,
) -> Result<(PermanentToken, String)> {
    let name = name.trim();
    if name.is_empty() {
        return Err("token name is required".into());
    }
    if expires_at.is_some_and(|v| v <= chrono::Utc::now().timestamp()) {
        return Err("token expiry must be in the future".into());
    }
    let raw = opaque("spat_");
    let value = PermanentToken {
        id: id("pt"),
        name: name.into(),
        created_at: chrono::Utc::now().timestamp(),
        expires_at,
        last_used_at: None,
    };
    db::conn()?.execute("INSERT INTO permanent_tokens(id,user_id,name,token_hash,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6)",params![value.id,user_id,value.name,hash(&raw)?,value.created_at,value.expires_at]).map_err(|e|e.to_string())?;
    Ok((value, raw))
}
pub fn list_permanent_tokens(user_id: &str) -> Result<Vec<PermanentToken>> {
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,name,created_at,expires_at,last_used_at FROM permanent_tokens WHERE user_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([user_id], |r| {
            Ok(PermanentToken {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                expires_at: r.get(3)?,
                last_used_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
pub fn revoke_permanent_token(user_id: &str, token_id: &str) -> Result<bool> {
    Ok(db::conn()?.execute("UPDATE permanent_tokens SET revoked_at=unixepoch() WHERE id=?1 AND user_id=?2 AND revoked_at IS NULL",params![token_id,user_id]).map_err(|e|e.to_string())?>0)
}
pub fn permanent_token_user(raw: &str) -> Result<Option<String>> {
    if !raw.starts_with("spat_") {
        return Ok(None);
    }
    let c = db::conn()?;
    let mut q=c.prepare("SELECT t.id,t.user_id,t.token_hash FROM permanent_tokens t JOIN users u ON u.id=t.user_id WHERE t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>unixepoch()) AND u.active=1").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (token_id, user_id, stored) = row.map_err(|e| e.to_string())?;
        if matches(raw, &stored) {
            c.execute(
                "UPDATE permanent_tokens SET last_used_at=unixepoch() WHERE id=?1",
                [token_id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(Some(user_id));
        }
    }
    Ok(None)
}

fn base32(bytes: &[u8]) -> String {
    const A: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::new();
    let (mut acc, mut bits) = (0u32, 0u8);
    for &b in bytes {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(A[((acc >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(A[((acc << (5 - bits)) & 31) as usize] as char)
    }
    out
}
fn unbase32(text: &str) -> Result<Vec<u8>> {
    let (mut acc, mut bits, mut out) = (0u32, 0u8, Vec::new());
    for b in text.bytes().filter(|b| *b != b' ' && *b != b'-') {
        let val = match b.to_ascii_uppercase() {
            b'A'..=b'Z' => b - b'A',
            b'2'..=b'7' => b - b'2' + 26,
            _ => return Err("invalid TOTP secret".into()),
        };
        acc = (acc << 5) | val as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    if out.is_empty() {
        Err("invalid TOTP secret".into())
    } else {
        Ok(out)
    }
}
fn hmac_sha1(key: &[u8], msg: &[u8]) -> [u8; 20] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..20].copy_from_slice(&Sha1::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha1::new();
    inner.update(k.map(|v| v ^ 0x36));
    inner.update(msg);
    let inner = inner.finalize();
    let mut outer = Sha1::new();
    outer.update(k.map(|v| v ^ 0x5c));
    outer.update(inner);
    outer.finalize().into()
}
pub fn totp_code(secret: &str, counter: u64) -> Result<String> {
    let hash = hmac_sha1(&unbase32(secret)?, &counter.to_be_bytes());
    let off = (hash[19] & 15) as usize;
    let n = ((u32::from(hash[off]) & 127) << 24)
        | (u32::from(hash[off + 1]) << 16)
        | (u32::from(hash[off + 2]) << 8)
        | u32::from(hash[off + 3]);
    Ok(format!("{:06}", n % 1_000_000))
}
pub fn verify_totp(secret: &str, code: &str, now: i64) -> bool {
    let code = code.trim();
    code.len() == 6
        && (-1i64..=1).any(|offset| {
            totp_code(secret, ((now / 30) + offset) as u64)
                .ok()
                .as_deref()
                == Some(code)
        })
}
#[derive(Serialize)]
pub struct TotpEnrollment {
    pub secret: String,
    pub otpauth_uri: String,
}
pub fn begin_totp(user_id: &str, username: &str) -> Result<TotpEnrollment> {
    let mut raw = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut raw);
    let secret = base32(&raw);
    let sealed = secretbox::seal(&secret)?;
    db::conn()?.execute("INSERT INTO user_totp(user_id,secret_sealed,enabled,enrolled_at) VALUES(?1,?2,0,unixepoch()) ON CONFLICT(user_id) DO UPDATE SET secret_sealed=excluded.secret_sealed,enabled=0,enrolled_at=excluded.enrolled_at",params![user_id,sealed]).map_err(|e|e.to_string())?;
    Ok(TotpEnrollment{otpauth_uri:format!("otpauth://totp/GAIA%20Space:{}?secret={}&issuer=GAIA%20Space&algorithm=SHA1&digits=6&period=30",username,secret),secret})
}
fn stored_totp(user_id: &str) -> Result<Option<(String, bool)>> {
    db::conn()?
        .query_row(
            "SELECT secret_sealed,enabled FROM user_totp WHERE user_id=?1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())
}
pub fn confirm_totp(user_id: &str, code: &str) -> Result<bool> {
    let Some((sealed, _)) = stored_totp(user_id)? else {
        return Ok(false);
    };
    let secret = secretbox::open(&sealed)?;
    if !verify_totp(&secret, code, chrono::Utc::now().timestamp()) {
        return Ok(false);
    };
    db::conn()?
        .execute("UPDATE user_totp SET enabled=1 WHERE user_id=?1", [user_id])
        .map_err(|e| e.to_string())?;
    Ok(true)
}
pub fn totp_required(user_id: &str) -> Result<bool> {
    Ok(stored_totp(user_id)?.is_some_and(|(_, enabled)| enabled))
}
pub fn verify_user_totp(user_id: &str, code: Option<&str>) -> Result<bool> {
    let Some((sealed, enabled)) = stored_totp(user_id)? else {
        return Ok(true);
    };
    if !enabled {
        return Ok(true);
    };
    Ok(code.is_some_and(|v| {
        secretbox::open(&sealed)
            .ok()
            .is_some_and(|s| verify_totp(&s, v, chrono::Utc::now().timestamp()))
    }))
}
pub fn disable_totp(user_id: &str, code: &str) -> Result<bool> {
    if !verify_user_totp(user_id, Some(code))? {
        return Ok(false);
    };
    Ok(db::conn()?
        .execute("DELETE FROM user_totp WHERE user_id=?1", [user_id])
        .map_err(|e| e.to_string())?
        > 0)
}

#[derive(Serialize)]
pub struct Invitation {
    pub id: String,
    pub email: Option<String>,
    pub role_id: String,
    pub project_id: String,
    pub expires_at: Option<i64>,
    pub max_uses: i64,
    pub uses: i64,
}
pub fn create_invitation(
    invited_by: &str,
    email: Option<String>,
    role_id: &str,
    project_id: &str,
    expires_at: Option<i64>,
    max_uses: i64,
) -> Result<(Invitation, String)> {
    if max_uses < 1 {
        return Err("max_uses must be positive".into());
    }
    if expires_at.is_some_and(|v| v <= chrono::Utc::now().timestamp()) {
        return Err("invitation expiry must be in the future".into());
    }
    let c = db::conn()?;
    let valid:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM roles WHERE id=?1) AND EXISTS(SELECT 1 FROM projects WHERE id=?2)",params![role_id,project_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !valid {
        return Err("role and project must exist".into());
    }
    let raw = opaque("spin_");
    let item = Invitation {
        id: id("invite"),
        email: email
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
        role_id: role_id.into(),
        project_id: project_id.into(),
        expires_at,
        max_uses,
        uses: 0,
    };
    c.execute("INSERT INTO invitations(id,token_hash,email,role_id,project_id,invited_by,created_at,expires_at,max_uses) VALUES(?1,?2,?3,?4,?5,?6,unixepoch(),?7,?8)",params![item.id,hash(&raw)?,item.email,item.role_id,item.project_id,invited_by,item.expires_at,item.max_uses]).map_err(|e|e.to_string())?;
    Ok((item, raw))
}
pub fn accept_invitation(
    raw: &str,
    username: &str,
    display_name: &str,
    password: &str,
) -> Result<String> {
    if username.trim().is_empty() || display_name.trim().is_empty() || password.len() < 8 {
        return Err("username, display name, and an 8-character password are required".into());
    }
    let c = db::conn()?;
    let mut q=c.prepare("SELECT id,token_hash,role_id,project_id,uses,max_uses FROM invitations WHERE (expires_at IS NULL OR expires_at>unixepoch()) AND uses<max_uses").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut found = None;
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        if matches(raw, &row.1) {
            found = Some(row);
            break;
        }
    }
    let Some((invite_id, _, role_id, project_id, uses, max_uses)) = found else {
        return Err("invitation is invalid or expired".into());
    };
    let user_id = id("user");
    let profile_id = id("profile");
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO profiles(id,username,display_name,created_at) VALUES(?1,?2,?3,unixepoch())",
        params![profile_id, username.trim(), display_name.trim()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES(?1,?2,?3,?4,?5,'member',unixepoch())",params![user_id,username.trim(),hash(password)?,display_name.trim(),profile_id]).map_err(|e|e.to_string())?;
    tx.execute(
        "INSERT INTO project_members(project_id,profile_id) VALUES(?1,?2)",
        params![project_id, profile_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO role_assignments(id,role_id,profile_id,scope_type,scope_id) VALUES(?1,?2,?3,'project',?4)",params![id("assignment"),role_id,profile_id,project_id]).map_err(|e|e.to_string())?;
    if tx
        .execute(
            "UPDATE invitations SET uses=uses+1 WHERE id=?1 AND uses=?2 AND max_uses=?3",
            params![invite_id, uses, max_uses],
        )
        .map_err(|e| e.to_string())?
        != 1
    {
        return Err("invitation was already accepted".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(user_id)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rfc6238_sha1_vector() {
        assert_eq!(
            totp_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1).unwrap(),
            "287082"
        );
    }
    #[test]
    fn base32_round_trips() {
        let raw = [0, 1, 2, 127, 255];
        assert_eq!(unbase32(&base32(&raw)).unwrap(), raw);
    }
}
