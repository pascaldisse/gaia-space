import { For, Show, createResource, createSignal } from "solid-js";
import { editSavedServer } from "../components/ServerConnect";
import { Icon } from "../components/Icon";
import { isMobileServer, openServerSetup } from "../mobile";
import { NAV_GROUPS, defaultView, hiddenGroups, navLayout, setDefaultView, setNavLayout, toggleGroup } from "../nav";
import { calendarFeedsApi } from "../api/calendar-feeds";
import { humanError, profileId } from "../session";
import "./Settings.css";

const when = (seconds: number | null) => seconds ? new Date(seconds * 1000).toLocaleString() : "never";

/** Read-only external calendars (Settings → Connected calendars): a pasted
 *  secret iCal address, synced server-side, shown in Calendar as its own
 *  item kind. Nothing here is written back to the source — see the hint
 *  text below for why, and `calendar_feeds.rs` for the sync mechanics. */
function ConnectedCalendars() {
  const [feeds, { refetch: reloadFeeds }] = createResource(() => profileId(), profile => profile ? calendarFeedsApi.list(profile) : Promise.resolve([]));
  const [label, setLabel] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const connect = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");
    const owner = profileId();
    if (!owner) { setError("Select a profile before connecting a calendar."); return; }
    if (!label().trim() || !url().trim()) { setError("A label and a calendar address are both required."); return; }
    setBusy(true);
    try {
      // `profile_id` is shape-only: the server always rebinds it to the
      // session, the same as every other personal write.
      await calendarFeedsApi.save({ profile_id: owner, label: label().trim(), ics_url: url().trim() });
      setLabel(""); setUrl(""); reloadFeeds();
    } catch (reason) { setError(humanError(reason)); }
    finally { setBusy(false); }
  };
  const sync = async (id: string) => { setBusy(true); setError(""); try { await calendarFeedsApi.sync(id); reloadFeeds(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
  const remove = async (id: string) => { setBusy(true); setError(""); try { await calendarFeedsApi.remove(id); reloadFeeds(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
  return <div class="settings-card">
    <h2>Connected calendars</h2>
    <p class="settings-hint">Paste a calendar's secret address to show its events on your Calendar, read-only — nothing here is ever written back to the source. In Google Calendar: Settings → pick the calendar → “Integrate calendar” → “Secret address in iCal format”.</p>
    <Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show>
    <ul class="settings-groups feed-list">
      <For each={feeds() ?? []}>{feed =>
        <li class="settings-option feed-row">
          <span class="feed-info">
            <strong>{feed.label}</strong>
            <em class="settings-sub">
              {feed.event_count} event{feed.event_count === 1 ? "" : "s"} · last synced {when(feed.last_synced_at)}
              <Show when={feed.last_error}><span class="feed-error"> · {feed.last_error}</span></Show>
            </em>
          </span>
          <span class="feed-actions">
            <button type="button" disabled={busy()} onClick={() => sync(feed.id)}>Sync now</button>
            <button type="button" class="danger" disabled={busy()} onClick={() => remove(feed.id)}>Remove</button>
          </span>
        </li>
      }</For>
      <Show when={!feeds.loading && (feeds() ?? []).length === 0}><li class="settings-sub">No calendars connected yet.</li></Show>
    </ul>
    <form class="feed-connect" onSubmit={connect}>
      <input placeholder="Label, e.g. My Gmail" aria-label="Calendar label" value={label()} onInput={e => setLabel(e.currentTarget.value)} />
      <input placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" aria-label="Calendar address" value={url()} onInput={e => setUrl(e.currentTarget.value)} />
      <button type="submit" class="primary" disabled={busy()}>Connect</button>
    </form>
  </div>;
}

/** User settings — navigation layout is per-user, stored locally, default = the shipped grouped view. */
export default function Settings() {
  const allViews = () => NAV_GROUPS.flatMap(group => group.views);
  return <section class="personal-view settings-view">
    <header>
      <div><h1>Settings</h1><p>Navigation and layout preferences for your account.</p></div>
    </header>

    <div class="settings-card">
      <h2>Navigation layout</h2>
      <label class="settings-option">
        <input type="radio" name="nav-layout" checked={navLayout() === "grouped"} onChange={() => setNavLayout("grouped")} />
        <span><strong>Grouped</strong> — eight destinations, detail views as sub-tabs (default)</span>
      </label>
      <label class="settings-option">
        <input type="radio" name="nav-layout" checked={navLayout() === "flat"} onChange={() => setNavLayout("flat")} />
        <span><strong>Flat</strong> — every view as its own top-level entry</span>
      </label>
    </div>

    <div class="settings-card">
      <h2>Visible destinations</h2>
      <p class="settings-hint">Hidden destinations stay reachable by URL and from Go to (Ctrl/Cmd + K).</p>
      <div class="settings-groups">
        <For each={NAV_GROUPS}>{group =>
          <label class="settings-option">
            <input type="checkbox" checked={!hiddenGroups().includes(group.id)} onChange={() => toggleGroup(group.id)} />
            <span class="nav-icon" aria-hidden="true"><Icon name={group.icon} size={16} /></span>
            <span>{group.label}<em class="settings-sub">{group.views.join(" · ")}</em></span>
          </label>
        }</For>
      </div>
    </div>

    <ConnectedCalendars />

    <Show when={isMobileServer()}><div class="settings-card">
      <h2>Server</h2>
      <p class="settings-hint">This phone is connected to the server in the address bar. Switching server returns you to the connection screen.</p>
      <button type="button" onClick={() => { editSavedServer(); void openServerSetup(); }}>Change server</button>
    </div></Show>

    <div class="settings-card">
      <h2>Start view</h2>
      <select value={defaultView()} onChange={event => setDefaultView(event.currentTarget.value)}>
        <For each={allViews()}>{view => <option value={view}>{view}</option>}</For>
      </select>
    </div>
  </section>;
}
