import { createSignal } from "solid-js";

/** Dashboard personalization: which widgets a user keeps on their overview.
 *  localStorage-backed like nav prefs (§ src/nav.ts) — per-device, no backend. */
export type DashboardWidget = {
  id: string;
  label: string;
};

export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: "today", label: "Today & next" },
  { id: "calendar", label: "Calendar" },
  { id: "issues", label: "Assigned issues" },
  { id: "inbox", label: "Inbox" },
  { id: "absences", label: "Absences" },
];

const HIDDEN_KEY = "space.dashboard.hidden";
const WIDGET_IDS = DASHBOARD_WIDGETS.map((w) => w.id);

const readHidden = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string" && WIDGET_IDS.includes(x))
      : [];
  } catch {
    return [];
  }
};

const [hiddenWidgets, setHiddenSignal] = createSignal<string[]>(readHidden());

export { hiddenWidgets };

export function setHiddenWidgets(next: string[]) {
  const clean = next.filter((id) => WIDGET_IDS.includes(id));
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(clean));
  setHiddenSignal(clean);
}

export function toggleWidget(id: string) {
  const hidden = hiddenWidgets();
  setHiddenWidgets(hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]);
}

/** True when the widget should render. Unknown ids are always visible. */
export function widgetVisible(id: string) {
  return !hiddenWidgets().includes(id);
}

/** Test/reset helper: forget stored prefs and re-read. */
export function resetDashboardPrefs() {
  localStorage.removeItem(HIDDEN_KEY);
  setHiddenSignal([]);
}
