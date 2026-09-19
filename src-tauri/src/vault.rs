//! Vaultwarden admin bridge: exchanges the shared `VAULTWARDEN_ADMIN_TOKEN` for an admin
//! session, then asks Vaultwarden's own admin API to invite an email into the vault.
//!
//! Verified against `raw.githubusercontent.com/dani-garcia/vaultwarden/main/src/api/admin.rs`:
//!   `const COOKIE_NAME: &str = "VW_ADMIN";`
//!   `#[post("/", format = "application/x-www-form-urlencoded", data = "<data>")]`
//!   `fn post_admin_login(data: Form<LoginForm>, cookies: &CookieJar<'_>, ...)` — `LoginForm { token, redirect }`,
//!     sets the `VW_ADMIN` cookie (JWT) on success, no JSON/Bearer response.
//!   `#[post("/invite", format = "application/json", data = "<data>")]`
//!   `async fn invite_user(data: Json<InviteData>, _token: AdminToken, ...)` — `InviteData { email }`.
//!   `AdminToken::from_request` reads the token *only* from the `VW_ADMIN` cookie — there is no
//!   Bearer/header admin auth upstream, so the cookie round-trip below is the only path.
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;

const DEFAULT_VAULTWARDEN_URL: &str = "http://127.0.0.1:8095";
/// Vaultwarden's `DOMAIN` config is itself `https://paloptic.com/space/vault` (box install,
/// see `deploy/vaultwarden/INSTALL.md`), and Rocket mounts every route group at
/// `[domain_path, "/admin"|"/identity"|...]` concatenated — so the app expects this prefix on
/// EVERY request, including loopback ones (`curl 127.0.0.1:8095/alive` -> 404,
/// `curl 127.0.0.1:8095/space/vault/alive` -> 200, both proven in that file). Not hardcoded:
/// overridable, defaults to the box's actual path.
const DEFAULT_VAULTWARDEN_PATH: &str = "/space/vault";
const ADMIN_COOKIE_NAME: &str = "VW_ADMIN";

#[derive(Debug, Deserialize)]
pub struct VaultInviteInput {
    pub email: String,
}

#[derive(Debug, Serialize)]
pub struct VaultInviteResult {
    pub email: String,
    pub invited: bool,
}

fn vaultwarden_url() -> String {
    std::env::var("VAULTWARDEN_URL").unwrap_or_else(|_| DEFAULT_VAULTWARDEN_URL.to_string())
}

fn vaultwarden_path() -> String {
    std::env::var("VAULTWARDEN_PATH").unwrap_or_else(|_| DEFAULT_VAULTWARDEN_PATH.to_string())
}

/// `{VAULTWARDEN_URL}{VAULTWARDEN_PATH}`, e.g. `http://127.0.0.1:8095/space/vault`.
fn vaultwarden_base() -> String {
    format!("{}{}", vaultwarden_url(), vaultwarden_path())
}

/// `POST {base}/admin` with the shared admin token; Vaultwarden answers with a `Set-Cookie:
/// VW_ADMIN=<jwt>; ...` header on success (see module doc). We only need the cookie *value*,
/// which we replay verbatim as the `Cookie:` header on the invite request below.
fn admin_session_cookie(client: &reqwest::blocking::Client, base: &str, token: &str) -> Result<String> {
    let response = client
        .post(format!("{base}/admin"))
        .form(&[("token", token)])
        .send()
        .map_err(|e| format!("could not reach the vault admin endpoint: {e}"))?;
    let status = response.status();
    let set_cookie = response
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let Some(set_cookie) = set_cookie else {
        return Err(format!(
            "the vault admin login did not return a session cookie (HTTP {status}); check VAULTWARDEN_ADMIN_TOKEN"
        ));
    };
    let value = set_cookie
        .split(';')
        .next()
        .unwrap_or("")
        .strip_prefix(&format!("{ADMIN_COOKIE_NAME}="))
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "the vault admin login cookie was missing VW_ADMIN".to_string())?;
    Ok(value.to_string())
}

fn invite_off_the_async_runtime(email: String) -> Result<VaultInviteResult> {
    let token = std::env::var("VAULTWARDEN_ADMIN_TOKEN").map_err(|_| "vault not configured".to_string())?;
    let base = vaultwarden_base();
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| format!("could not start the vault client: {e}"))?;
    let cookie = admin_session_cookie(&client, &base, &token)?;
    let response = client
        .post(format!("{base}/admin/invite"))
        .header(reqwest::header::COOKIE, format!("{ADMIN_COOKIE_NAME}={cookie}"))
        .json(&serde_json::json!({ "email": email }))
        .send()
        .map_err(|e| format!("could not reach the vault invite endpoint: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        return Err(format!("vault invite failed ({status}): {body}"));
    }
    Ok(VaultInviteResult { email, invited: true })
}

/// `vault_invite {input:{email}}`. Registered both as a Tauri command and in the
/// `/api/cmd/vault_invite` HTTP dispatch table (`space-server.rs`), gated there on
/// `CommandPolicy::Session` — the caller must hold a valid space session, same posture as every
/// other `Session`-gated command (see that table for the exact list).
#[cfg_attr(feature = "desktop", tauri::command)]
pub fn vault_invite(input: VaultInviteInput) -> Result<VaultInviteResult> {
    // reqwest's blocking client owns its own little Tokio runtime; building *and dropping* one
    // while already inside this binary's own async runtime panics on drop (every `/api/cmd/*`
    // handler is `async fn`) — same fix as `calendar_feeds::fetch_and_parse`: run the whole
    // client lifetime on a plain OS thread instead, which has no ambient runtime.
    let email = input.email;
    std::thread::spawn(move || invite_off_the_async_runtime(email))
        .join()
        .map_err(|_| "the vault invite thread panicked".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // `VAULTWARDEN_ADMIN_TOKEN` is process-global state; serialize the tests that touch it so a
    // parallel test run can't observe one test's env var change from another's assertion.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn requires_admin_token() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("VAULTWARDEN_ADMIN_TOKEN");
        match vault_invite(VaultInviteInput { email: "new@example.com".to_string() }) {
            Err(message) => assert_eq!(message, "vault not configured"),
            Ok(_) => panic!("expected 'vault not configured' without VAULTWARDEN_ADMIN_TOKEN set"),
        }
    }

    #[test]
    fn vaultwarden_url_defaults_to_localhost() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("VAULTWARDEN_URL");
        assert_eq!(vaultwarden_url(), DEFAULT_VAULTWARDEN_URL);
        std::env::set_var("VAULTWARDEN_URL", "http://example.invalid:1234");
        assert_eq!(vaultwarden_url(), "http://example.invalid:1234");
        std::env::remove_var("VAULTWARDEN_URL");
    }

    #[test]
    fn vaultwarden_base_defaults_to_the_boxs_domain_path() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("VAULTWARDEN_URL");
        std::env::remove_var("VAULTWARDEN_PATH");
        assert_eq!(vaultwarden_base(), "http://127.0.0.1:8095/space/vault");
        std::env::set_var("VAULTWARDEN_PATH", "/other");
        assert_eq!(vaultwarden_base(), "http://127.0.0.1:8095/other");
        std::env::remove_var("VAULTWARDEN_PATH");
    }
}
