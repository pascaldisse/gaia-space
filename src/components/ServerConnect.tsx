import { createSignal, onMount, Show } from "solid-js";
import { connectServer } from "../mobile";
import "./Login.css";

const SERVER_KEY = "space.server-url";
const EDITING_KEY = "space.server-url-editing";

/** Native mobile first-run screen. The chosen server is retained only on this device. */
export default function ServerConnect() {
  const [url, setUrl] = createSignal("");
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const connect = async (value: string) => {
    setError("");
    setBusy(true);
    try {
      const normalized = new URL(value.trim()).toString();
      await connectServer(normalized);
      localStorage.setItem(SERVER_KEY, normalized);
    } catch (reason) {
      setError(String((reason as { message?: string }).message ?? reason));
    } finally {
      setBusy(false);
    }
  };
  onMount(() => {
    const editing = localStorage.getItem(EDITING_KEY) === "true";
    localStorage.removeItem(EDITING_KEY);
    const saved = localStorage.getItem(SERVER_KEY) ?? "";
    setUrl(saved);
    if (saved && !editing) void connect(saved);
  });
  const submit = (event: SubmitEvent) => { event.preventDefault(); void connect(url()); };
  return <div class="login-screen"><form class="login-box" onSubmit={submit}>
    <h1>GAIA Space</h1>
    <p class="login-intro">Connect to a GAIA Space server.</p>
    <Show when={error()}><div class="error">{error()}</div></Show>
    <label>Server URL<input type="url" inputMode="url" placeholder="https://space.example.com/space/" value={url()} onInput={event => setUrl(event.currentTarget.value)} autofocus required /></label>
    <button class="primary" type="submit" disabled={busy()}>{busy() ? "Connecting…" : "Continue"}</button>
  </form></div>;
}

export function editSavedServer() {
  localStorage.setItem(EDITING_KEY, "true");
}
