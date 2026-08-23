import { createSignal, Show } from "solid-js";
import { humanError, login } from "../session";
import { authApi } from "../api/auth";
import "./Login.css";

/** Web-mode login gate — replaces the app shell until /api/auth/me succeeds. */
export default function Login() {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
// No register form is wired up yet, so nothing ever flips these: the register
// branch below is currently unreachable. Kept (read-only) so the call survives
// until the sign-up UI lands.
  const [displayName] = createSignal("");
  const [registering] = createSignal(false);
  const [totpCode, setTotpCode] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (registering()) { await authApi.register(username(), displayName(), password()); await login(username(), password()); }
else await login(username(), password(), totpCode().trim() || undefined);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login-screen">
      <form class="login-box" onSubmit={submit}>
        <h1>GAIA Space</h1>
        <Show when={error()}>
          <div class="error">{error()}</div>
        </Show>
        <label>
          Username
          <input value={username()} onInput={(e) => setUsername(e.currentTarget.value)} autofocus required />
        </label>
        <label>
          Password
          <input type="password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} required />
        </label>
        <label>
          Authenticator code <span class="login-optional">(if enabled)</span>
          <input inputMode="numeric" autocomplete="one-time-code" value={totpCode()} onInput={(e) => setTotpCode(e.currentTarget.value)} />
        </label>
        <button class="primary" type="submit" disabled={busy()}>{busy() ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
