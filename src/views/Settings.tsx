import { For, Show, createResource, createSignal } from "solid-js";
import { editSavedServer } from "../components/ServerConnect";
import { Icon } from "../components/Icon";
import { isMobileServer, openServerSetup } from "../mobile";
import { NAV_GROUPS, defaultView, hiddenGroups, navLayout, setDefaultView, setNavLayout, toggleGroup } from "../nav";
import { calendarFeedsApi, calendarsApi } from "../api/calendar-feeds";
import { permanentTokensApi, twoFactorApi } from "../api/auth";
import { platformApi, type Organization, type OrgSettings } from "../api/platform";
import { humanError, profileId } from "../session";
import "./Settings.css";

const when = (seconds: number | null) => seconds ? new Date(seconds * 1000).toLocaleString() : "never";

/** Read-only external calendars (Settings → Connected calendars): a pasted
 *  secret iCal address, synced server-side, shown in Calendar as its own
 *  item kind. Nothing here is written back to the source — see the hint
 *  text below for why, and `calendar_feeds.rs` for the sync mechanics. */
function ConnectedCalendars() {
  const [feeds, { refetch: reloadFeeds }] = createResource(() => profileId(), profile => profile ? calendarFeedsApi.list(profile) : Promise.resolve([]));
const [calendars] = createResource(() => profileId(), profile => profile ? calendarsApi.list(profile) : Promise.resolve([]));
  const [label, setLabel] = createSignal("");
  const [url, setUrl] = createSignal("");
const [calendarId, setCalendarId] = createSignal("");
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
      await calendarFeedsApi.save({ profile_id: owner, label: label().trim(), ics_url: url().trim(), calendar_id: calendarId() || null });
      setLabel(""); setUrl(""); setCalendarId(""); reloadFeeds();
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
      <select aria-label="Calendar destination" value={calendarId()} onChange={e => setCalendarId(e.currentTarget.value)}><option value="">Unassigned</option><For each={calendars() ?? []}>{calendar => <option value={calendar.id}>{calendar.name}</option>}</For></select>
      <button type="submit" class="primary" disabled={busy()}>Connect</button>
    </form>
  </div>;
}

function NamedCalendars() {
const [calendars, { refetch }] = createResource(() => profileId(), owner => owner ? calendarsApi.list(owner) : Promise.resolve([]));
const [name, setName] = createSignal(""); const [color, setColor] = createSignal("#2563eb"); const [error, setError] = createSignal("");
const save = async (event: SubmitEvent) => { event.preventDefault(); const owner=profileId(); if (!owner || !name().trim()) { setError("Select a profile and enter a calendar name."); return; } try { await calendarsApi.save({profile_id:owner,name:name().trim(),color:color(),visible:true}); setName(""); refetch(); } catch(reason) { setError(humanError(reason)); } };
return <div class="settings-card"><h2>My calendars</h2><p class="settings-hint">Create named calendars for organizing connected and future writable calendars.</p><Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show><ul class="settings-groups feed-list"><For each={calendars() ?? []}>{calendar => <li class="settings-option feed-row"><span><strong><span aria-hidden="true" style={{color:calendar.color}}>●</span> {calendar.name}</strong><em class="settings-sub">{calendar.visible ? "Visible" : "Hidden"} · CalDAV: <code>{`${window.location.origin}/caldav/${encodeURIComponent(calendar.id)}/calendar.ics`}</code> (HTTP Basic username/password)</em></span><button type="button" class="danger" onClick={() => void calendarsApi.remove(calendar.id).then(() => refetch()).catch(reason => setError(humanError(reason)))}>Remove</button></li>}</For><Show when={!calendars.loading && !(calendars() ?? []).length}><li class="settings-sub">No named calendars yet.</li></Show></ul><form class="feed-connect" onSubmit={save}><input aria-label="Calendar name" placeholder="Calendar name" value={name()} onInput={e=>setName(e.currentTarget.value)} /><input aria-label="Calendar color" type="color" value={color()} onInput={e=>setColor(e.currentTarget.value)} /><button class="primary" type="submit">Add calendar</button></form></div>;
}
function SecuritySettings() {
const [tokens, { refetch }] = createResource(() => permanentTokensApi.list());
const [name, setName] = createSignal(""); const [oneTime, setOneTime] = createSignal(""); const [error, setError] = createSignal(""); const [busy, setBusy] = createSignal(false);
const [twoFactor, { refetch: reloadTwoFactor }] = createResource(() => twoFactorApi.status());
const createToken = async (event: SubmitEvent) => { event.preventDefault(); if (!name().trim()) return; setBusy(true); setError(""); try { const created = await permanentTokensApi.create(name().trim()); setOneTime(created.token); setName(""); refetch(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
const enableTwoFactor = async () => { setBusy(true); setError(""); try { const enrollment = await twoFactorApi.enroll(); const code = window.prompt(`Save this secret in your authenticator, then enter its code:\n${enrollment.secret}`); if (!code) return; await twoFactorApi.confirm(code); reloadTwoFactor(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
const disableTwoFactor = async () => { const code = window.prompt("Enter a current authenticator code to disable two-factor authentication."); if (!code) return; setBusy(true); setError(""); try { await twoFactorApi.disable(code); reloadTwoFactor(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
return <div class="settings-card"><h2>Security</h2><Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show><h3>Two-factor authentication</h3><p class="settings-hint">{twoFactor()?.enabled ? "An authenticator code is required when you sign in." : "Protect your password sign-in with an RFC 6238 authenticator."}</p><button type="button" disabled={busy()} onClick={() => void (twoFactor()?.enabled ? disableTwoFactor() : enableTwoFactor())}>{twoFactor()?.enabled ? "Disable two-factor authentication" : "Set up two-factor authentication"}</button><h3>Permanent tokens</h3><p class="settings-hint">Use a token for scripts. Its value is shown only once and is never stored in plaintext.</p><Show when={oneTime()}><p class="calendar-error" role="status">Copy now: <code>{oneTime()}</code></p></Show><form class="feed-connect" onSubmit={createToken}><input aria-label="Token name" placeholder="Token name" value={name()} onInput={e => setName(e.currentTarget.value)} /><button type="submit" class="primary" disabled={busy()}>Create token</button></form><ul class="settings-groups feed-list"><For each={tokens() ?? []}>{token => <li class="settings-option feed-row"><span><strong>{token.name}</strong><em class="settings-sub">Created {when(token.created_at)} · last used {when(token.last_used_at)}</em></span><button type="button" class="danger" disabled={busy()} onClick={() => void permanentTokensApi.revoke(token.id).then(() => refetch()).catch(reason => setError(humanError(reason)))}>Revoke</button></li>}</For><Show when={!tokens.loading && (tokens() ?? []).length === 0}><li class="settings-sub">No permanent tokens.</li></Show></ul></div>;
}
function OrganizationSettings() {
const [organization, { refetch: reloadOrganization }] = createResource(() => platformApi.organization());
const [settings, { refetch: reloadSettings }] = createResource(() => platformApi.orgSettings());
const [error, setError] = createSignal(""); const [busy, setBusy] = createSignal(false);
const saveOrganization = async (event: SubmitEvent) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const value = organization(); if (!value) return; setBusy(true); setError(""); try { await platformApi.updateOrganization({...value, name:String(form.get("org-name") ?? ""), slogan:String(form.get("org-slogan") ?? "") || null, timezone:String(form.get("org-timezone") ?? "UTC"), onboarding_required:form.get("org-onboarding") === "on", allow_domains_edit:form.get("org-domains") === "on"}); reloadOrganization(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
const saveSettings = async (event: SubmitEvent) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const value=settings(); if (!value) return; setBusy(true); setError(""); try { await platformApi.updateOrgSettings({...value, available_right_codes:String(form.get("right-codes") ?? "").split(",").map(x=>x.trim()).filter(Boolean), is_space_code:form.get("space-code") === "on", is_space_code_only:form.get("space-code-only") === "on"}); reloadSettings(); } catch (reason) { setError(humanError(reason)); } finally { setBusy(false); } };
return <Show when={organization() && settings()}><section class="settings-card"><h2>Organization</h2><Show when={error()}><p class="calendar-error" role="alert">{error()}</p></Show><form class="feed-connect" onSubmit={saveOrganization}><input name="org-name" aria-label="Organization name" value={organization()!.name}/><input name="org-slogan" aria-label="Organization slogan" value={organization()!.slogan ?? ""}/><input name="org-timezone" aria-label="Organization timezone" value={organization()!.timezone}/><label><input name="org-onboarding" type="checkbox" checked={organization()!.onboarding_required}/> Require onboarding</label><label><input name="org-domains" type="checkbox" checked={organization()!.allow_domains_edit}/> Allow domain editing</label><button class="primary" disabled={busy()}>Save organization</button></form><form class="feed-connect" onSubmit={saveSettings}><input name="right-codes" aria-label="Available rights" value={settings()!.available_right_codes.join(", ")} placeholder="Right codes, comma separated"/><label><input name="space-code" type="checkbox" checked={settings()!.is_space_code}/> Space Code</label><label><input name="space-code-only" type="checkbox" checked={settings()!.is_space_code_only}/> Space Code only</label><button disabled={busy()}>Save organization settings</button></form></section></Show>;
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

    <OrganizationSettings />
<NamedCalendars />
<ConnectedCalendars />
<SecuritySettings />

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
