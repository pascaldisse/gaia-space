import { createSignal } from "solid-js";
import { personalApi } from "./api/personal";
/** Dashboard personalization is server-backed; this key exists only for one-time migration. */
export type DashboardWidget = { id: string; label: string };
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: "today", label: "Today & next" }, { id: "calendar", label: "Calendar" },
  { id: "inbox", label: "Inbox" }, { id: "absences", label: "Absences" },
];
const HIDDEN_KEY = "space.dashboard.hidden";
const WIDGET_IDS = DASHBOARD_WIDGETS.map((widget) => widget.id);
const readLegacy = (): string[] => {
  try { const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && WIDGET_IDS.includes(id)) : []; } catch { return []; }
};
const [hiddenWidgets, setHiddenSignal] = createSignal<string[]>([]);
let activeProfile = "";
export { hiddenWidgets };
/** Load server truth; an absent server row is initialized once from the old per-device value. */
export async function loadDashboardPrefs(profileId: string) {
  activeProfile = profileId;
  if (!profileId) { setHiddenSignal([]); return; }
  const saved = await personalApi.dashboardPreferences(profileId);
  if (activeProfile !== profileId) return;
  const serverHidden = Array.isArray(saved?.hidden_widgets) ? saved.hidden_widgets : [];
  if (saved?.initialized) { setHiddenSignal(serverHidden); return; }
  const migrated = await personalApi.saveDashboardPreferences({ profile_id: profileId, hidden_widgets: readLegacy(), initialized: false });
  if (activeProfile === profileId) setHiddenSignal(Array.isArray(migrated?.hidden_widgets) ? migrated.hidden_widgets : []);
}
export function setHiddenWidgets(next: string[]) {
  const clean = [...new Set(next.filter((id) => WIDGET_IDS.includes(id)))];
  const previous = hiddenWidgets();
  setHiddenSignal(clean);
  if (activeProfile) void personalApi.saveDashboardPreferences({ profile_id: activeProfile, hidden_widgets: clean, initialized: true }).catch(() => setHiddenSignal(previous));
}
export function toggleWidget(id: string) { const hidden = hiddenWidgets(); setHiddenWidgets(hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id]); }
export function widgetVisible(id: string) { return !hiddenWidgets().includes(id); }
/** Test-only reset; production never mutates the legacy key after migration. */
export function resetDashboardPrefs() { activeProfile = ""; setHiddenSignal([]); localStorage.removeItem(HIDDEN_KEY); }
