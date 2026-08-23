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
#[tauri::command]
pub fn issue_permanent_token(
    user_id: String,
    name: String,
    expires_at: Option<i64>,
) -> Result<(PermanentToken, String)> {
    create_permanent_token(&user_id, &name, expires_at)
}
#[tauri::command]
pub fn permanent_tokens_for_user(user_id: String) -> Result<Vec<PermanentToken>> {
    list_permanent_tokens(&user_id)
}
#[tauri::command]
pub fn revoke_permanent_token_for_user(user_id: String, token_id: String) -> Result<bool> {
    revoke_permanent_token(&user_id, &token_id)
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
#[tauri::command]
pub fn enroll_totp(user_id: String, username: String) -> Result<TotpEnrollment> {
    begin_totp(&user_id, &username)
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
/// Confirms an enrollment and returns the fresh scratch codes, shown once.
/// `None` means the code did not verify.
pub fn confirm_totp(user_id: &str, code: &str) -> Result<Option<Vec<String>>> {
    let Some((sealed, _)) = stored_totp(user_id)? else {
        return Ok(None);
    };
    let secret = secretbox::open(&sealed)?;
    if !verify_totp(&secret, code, chrono::Utc::now().timestamp()) {
        return Ok(None);
    };
    db::conn()?
        .execute("UPDATE user_totp SET enabled=1 WHERE user_id=?1", [user_id])
        .map_err(|e| e.to_string())?;
    Ok(Some(issue_scratch_codes(user_id)?))
}
/// KB §05 §3.3: enrollment hands out one-time scratch codes beside the secret. A
/// lost authenticator must not be an account loss, so every confirmation mints a
/// fresh set and invalidates the previous one.
pub const SCRATCH_CODE_COUNT: usize = 10;
fn issue_scratch_codes(user_id: &str) -> Result<Vec<String>> {
    let c = db::conn()?;
    c.execute("DELETE FROM totp_scratch_codes WHERE user_id=?1", [user_id])
        .map_err(|e| e.to_string())?;
    let mut codes = Vec::with_capacity(SCRATCH_CODE_COUNT);
    for _ in 0..SCRATCH_CODE_COUNT {
        let raw = opaque("")[..12].to_string();
        c.execute(
            "INSERT INTO totp_scratch_codes(id,user_id,code_hash) VALUES(?1,?2,?3)",
            params![id("scratch"), user_id, hash(&raw)?],
        )
        .map_err(|e| e.to_string())?;
        codes.push(raw);
    }
    Ok(codes)
}
#[tauri::command]
pub fn verify_totp_enrollment(user_id: String, code: String) -> Result<Option<Vec<String>>> {
    confirm_totp(&user_id, &code)
}
#[tauri::command]
pub fn totp_scratch_codes_remaining(user_id: String) -> Result<i64> {
    scratch_codes_remaining(&user_id)
}
pub fn scratch_codes_remaining(user_id: &str) -> Result<i64> {
    db::conn()?
        .query_row(
            "SELECT count(*) FROM totp_scratch_codes WHERE user_id=?1 AND used_at IS NULL",
            [user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())
}
/// Burns a scratch code. Each code answers exactly one login challenge.
pub fn consume_scratch_code(user_id: &str, code: &str) -> Result<bool> {
    let code = code.trim();
    if code.is_empty() {
        return Ok(false);
    }
    let c = db::conn()?;
    let mut q = c
        .prepare("SELECT id,code_hash FROM totp_scratch_codes WHERE user_id=?1 AND used_at IS NULL")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([user_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (row_id, stored) = row.map_err(|e| e.to_string())?;
        if matches(code, &stored) {
            return Ok(c
                .execute(
                    "UPDATE totp_scratch_codes SET used_at=unixepoch() WHERE id=?1 AND used_at IS NULL",
                    [row_id],
                )
                .map_err(|e| e.to_string())?
                > 0);
        }
    }
    Ok(false)
}
#[tauri::command]
pub fn use_totp_scratch_code(user_id: String, code: String) -> Result<bool> {
    consume_scratch_code(&user_id, &code)
}
#[derive(Serialize)]
pub struct ApplicationPassword {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}
/// KB §05 §3.3: clients that cannot answer a TOTP prompt (IMAP, git-over-http,
/// old mobile builds) authenticate with a named per-client password instead of
/// the account password, revocable one client at a time.
pub fn create_application_password(
    user_id: &str,
    name: &str,
) -> Result<(ApplicationPassword, String)> {
    let name = name.trim();
    if name.is_empty() {
        return Err("application password name is required".into());
    }
    let raw = opaque("spap_");
    let item = ApplicationPassword {
        id: id("apppass"),
        name: name.into(),
        created_at: chrono::Utc::now().timestamp(),
        last_used_at: None,
    };
    db::conn()?
        .execute(
            "INSERT INTO application_passwords(id,user_id,name,password_hash,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![item.id, user_id, item.name, hash(&raw)?, item.created_at],
        )
        .map_err(|e| e.to_string())?;
    Ok((item, raw))
}
pub fn list_application_passwords(user_id: &str) -> Result<Vec<ApplicationPassword>> {
    let c = db::conn()?;
    let mut q = c
        .prepare("SELECT id,name,created_at,last_used_at FROM application_passwords WHERE user_id=?1 AND revoked_at IS NULL ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([user_id], |r| {
            Ok(ApplicationPassword {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                last_used_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
pub fn revoke_application_password(user_id: &str, id: &str) -> Result<bool> {
    Ok(db::conn()?
        .execute(
            "UPDATE application_passwords SET revoked_at=unixepoch() WHERE id=?1 AND user_id=?2 AND revoked_at IS NULL",
            params![id, user_id],
        )
        .map_err(|e| e.to_string())?
        > 0)
}
#[tauri::command]
pub fn issue_application_password(
    user_id: String,
    name: String,
) -> Result<(ApplicationPassword, String)> {
    create_application_password(&user_id, &name)
}
#[tauri::command]
pub fn application_passwords_for_user(user_id: String) -> Result<Vec<ApplicationPassword>> {
    list_application_passwords(&user_id)
}
#[tauri::command]
pub fn revoke_application_password_for_user(user_id: String, password_id: String) -> Result<bool> {
    revoke_application_password(&user_id, &password_id)
}
/// True when `raw` is a live application password of this account. Such a login
/// is already a second factor by construction, so it skips the TOTP challenge.
pub fn verify_application_password(user_id: &str, raw: &str) -> Result<bool> {
    if !raw.starts_with("spap_") {
        return Ok(false);
    }
    let c = db::conn()?;
    let mut q = c
        .prepare("SELECT id,password_hash FROM application_passwords WHERE user_id=?1 AND revoked_at IS NULL")
        .map_err(|e| e.to_string())?;
    let rows = q
        .query_map([user_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (row_id, stored) = row.map_err(|e| e.to_string())?;
        if matches(raw, &stored) {
            c.execute(
                "UPDATE application_passwords SET last_used_at=unixepoch() WHERE id=?1",
                [row_id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
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
    let Some(v) = code else { return Ok(false) };
    if secretbox::open(&sealed)
        .ok()
        .is_some_and(|s| verify_totp(&s, v, chrono::Utc::now().timestamp()))
    {
        return Ok(true);
    }
    // A scratch code is the documented fallback for a lost authenticator.
    consume_scratch_code(user_id, v)
}
pub fn disable_totp(user_id: &str, code: &str) -> Result<bool> {
    if !verify_user_totp(user_id, Some(code))? {
        return Ok(false);
    };
    let c = db::conn()?;
    c.execute("DELETE FROM totp_scratch_codes WHERE user_id=?1", [user_id])
        .map_err(|e| e.to_string())?;
    Ok(
        c.execute("DELETE FROM user_totp WHERE user_id=?1", [user_id])
            .map_err(|e| e.to_string())?
            > 0,
    )
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
#[tauri::command]
pub fn issue_invitation(
    invited_by: String,
    email: Option<String>,
    role_id: String,
    project_id: String,
    expires_at: Option<i64>,
    max_uses: i64,
) -> Result<(Invitation, String)> {
    create_invitation(
        &invited_by,
        email,
        &role_id,
        &project_id,
        expires_at,
        max_uses,
    )
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
#[tauri::command]
pub fn redeem_invitation(
    token: String,
    username: String,
    display_name: String,
    password: String,
) -> Result<String> {
    accept_invitation(&token, &username, &display_name, &password)
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
    fn enrollment_confirms_and_burns_a_scratch_code_once() {
        let _serial = crate::db::test_serial();
        let temp = crate::db::TempDb::new("auth-security-totp");
        let conn = crate::db::migrate_path(&temp).expect("migration");
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('totp-profile','totp-user','TOTP User',unixepoch())", []).expect("profile");
        conn.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('totp-user','totp-user','hash','TOTP User','totp-profile','member',unixepoch())", []).expect("user");
        std::env::set_var("SPACE_DB", temp.path());
        std::env::set_var(crate::secretbox::KEY_ENV, "aa".repeat(32));

        let enrollment = begin_totp("totp-user", "totp-user").expect("enrollment");
        let code = totp_code(
            &enrollment.secret,
            (chrono::Utc::now().timestamp() / 30) as u64,
        )
        .expect("code");
        let scratch = confirm_totp("totp-user", &code)
            .expect("confirmation")
            .expect("accepted code");
        assert_eq!(scratch.len(), SCRATCH_CODE_COUNT);
        assert_eq!(
            scratch_codes_remaining("totp-user").expect("remaining"),
            SCRATCH_CODE_COUNT as i64
        );
        assert!(consume_scratch_code("totp-user", &scratch[0]).expect("consume"));
        assert!(!consume_scratch_code("totp-user", &scratch[0]).expect("reuse fails"));
        assert_eq!(
            scratch_codes_remaining("totp-user").expect("remaining"),
            (SCRATCH_CODE_COUNT - 1) as i64
        );
    }
    #[test]
    fn permanent_tokens_and_application_passwords_are_individually_revocable() {
        let _serial = crate::db::test_serial();
        let temp = crate::db::TempDb::new("auth-security-tokens");
        let conn = crate::db::migrate_path(&temp).expect("migration");
        conn.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('token-profile','token-user','Token User',unixepoch())", []).expect("profile");
        conn.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('token-user','token-user','hash','Token User','token-profile','member',unixepoch())", []).expect("user");
        std::env::set_var("SPACE_DB", temp.path());

        let (token, token_raw) = create_permanent_token("token-user", "CLI", None).expect("token");
        assert_eq!(
            permanent_token_user(&token_raw).expect("verify token"),
            Some("token-user".into())
        );
        assert!(revoke_permanent_token("token-user", &token.id).expect("revoke token"));
        assert_eq!(
            permanent_token_user(&token_raw).expect("revoked token"),
            None
        );

        let (password, password_raw) =
            create_application_password("token-user", "Mail").expect("password");
        assert!(verify_application_password("token-user", &password_raw).expect("verify password"));
        assert!(revoke_application_password("token-user", &password.id).expect("revoke password"));
        assert!(
            !verify_application_password("token-user", &password_raw).expect("revoked password")
        );
    }
    #[test]
    fn invitation_redeem_assigns_the_preselected_project_role() {
        let _serial = crate::db::test_serial();
        let temp = crate::db::TempDb::new("auth-security-invite");
        let c = crate::db::migrate_path(&temp).expect("migration");
        c.execute("INSERT INTO profiles(id,username,display_name,created_at) VALUES('inviter-profile','inviter','Inviter',unixepoch())", []).expect("profile");
        c.execute("INSERT INTO users(id,username,password_hash,display_name,profile_id,role,created_at) VALUES('inviter','inviter','hash','Inviter','inviter-profile','admin',unixepoch())", []).expect("inviter");
        c.execute(
            "INSERT INTO roles(id,name,role_type) VALUES('invite-role','Guest','CUSTOM')",
            [],
        )
        .expect("role");
        std::env::set_var("SPACE_DB", temp.path());

        let (invite, token) = create_invitation(
            "inviter",
            Some("new@example.test".into()),
            "invite-role",
            "demo-project",
            None,
            1,
        )
        .expect("invite");
        let user_id =
            accept_invitation(&token, "new-user", "New User", "password-123").expect("redeem");
        let profile_id: String = c
            .query_row(
                "SELECT profile_id FROM users WHERE id=?1",
                [&user_id],
                |row| row.get(0),
            )
            .expect("created user");
        let assigned: i64 = c.query_row("SELECT count(*) FROM role_assignments WHERE role_id=?1 AND profile_id=?2 AND scope_type='project' AND scope_id=?3", rusqlite::params![invite.role_id, profile_id, invite.project_id], |row| row.get(0)).expect("assignment");
        assert_eq!(assigned, 1);
        assert!(
            accept_invitation(&token, "second", "Second", "password-123").is_err(),
            "single-use invitation is exhausted"
        );
    }
    #[test]
    fn base32_round_trips() {
        let raw = [0, 1, 2, 127, 255];
        assert_eq!(unbase32(&base32(&raw)).unwrap(), raw);
    }
}
