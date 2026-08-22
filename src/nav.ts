import { createSignal } from "solid-js";
import type { IconName } from "./components/Icon";

/** Navigation is user-configurable (JetBrains-Space style).
 *  `grouped` = the shipped default: 8 destinations, detail views nested as sub-tabs.
 *  `flat`    = every view as its own top-level entry (the pre-redesign behaviour). */
export type NavLayout = "grouped" | "flat";
export type NavGroup = { id: string; label: string; icon: IconName; views: string[] };

export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Overview", icon: "home", views: ["Dashboard"] },
  { id: "tasks", label: "My tasks", icon: "check", views: ["To-Do", "Project Tasks"] },
  // Projects is ONE destination: open a project → its boards → their issues.
  // Issues/Boards/Packages stay routable (deep links, Go to) but are not tabs.
  { id: "projects", label: "Projects", icon: "layers", views: ["Projects", "Repos", "Code Reviews", "Pipelines"] },
  { id: "calendar", label: "Calendar", icon: "calendar-nav", views: ["Calendar", "Meetings"] },
  { id: "knowledge", label: "Knowledge", icon: "book-nav", views: ["Documents"] },
  { id: "inbox", label: "Inbox", icon: "inbox", views: ["Inbox", "Chat"] },
  { id: "timeoff", label: "Time off", icon: "clock-nav", views: ["Absences"] },
  { id: "org", label: "Organization", icon: "org", views: ["Members", "Users", "Admin", "Settings"] },
];

const LAYOUT_KEY = "space.nav.layout";
const HIDDEN_KEY = "space.nav.hidden";
const DEFAULT_VIEW_KEY = "space.nav.defaultView";

const readLayout = (): NavLayout => (localStorage.getItem(LAYOUT_KEY) === "flat" ? "flat" : "grouped");
const readHidden = (): string[] => { try { const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

const [navLayout, setLayoutSignal] = createSignal<NavLayout>(readLayout());
const [hiddenGroups, setHiddenSignal] = createSignal<string[]>(readHidden());
const [defaultView, setDefaultSignal] = createSignal<string>(localStorage.getItem(DEFAULT_VIEW_KEY) ?? "Dashboard");

export { navLayout, hiddenGroups, defaultView };
export function setNavLayout(next: NavLayout) { localStorage.setItem(LAYOUT_KEY, next); setLayoutSignal(next); }
export function setHiddenGroups(next: string[]) { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); setHiddenSignal(next); }
export function setDefaultView(next: string) { localStorage.setItem(DEFAULT_VIEW_KEY, next); setDefaultSignal(next); }
export function toggleGroup(id: string) { const hidden = hiddenGroups(); setHiddenGroups(hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id]); }

/** Groups restricted to the views this user actually has, minus user-hidden groups. */
export function visibleGroups(available: string[]): NavGroup[] {
  const hidden = hiddenGroups();
  return NAV_GROUPS
    .filter(group => !hidden.includes(group.id))
    .map(group => ({ ...group, views: group.views.filter(view => available.includes(view)) }))
    .filter(group => group.views.length > 0);
}

export const groupOfView = (groups: NavGroup[], view: string) => groups.find(group => group.views.includes(view));
