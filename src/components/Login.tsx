import { createSignal, Show } from "solid-js";
import { humanError, login } from "../session";
import "./Login.css";

/** Web-mode login gate — replaces the app shell until /api/auth/me succeeds. */
export default function Login() {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username(), password());
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
        <button class="primary" type="submit" disabled={busy()}>{busy() ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
