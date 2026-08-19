import { For, Show } from "solid-js";
import { editSavedServer } from "../components/ServerConnect";
import { Icon } from "../components/Icon";
import { isMobileServer, openServerSetup } from "../mobile";
import { NAV_GROUPS, defaultView, hiddenGroups, navLayout, setDefaultView, setNavLayout, toggleGroup } from "../nav";
import "./Settings.css";

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
