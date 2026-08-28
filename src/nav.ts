import { createSignal } from "solid-js";
import type { IconName } from "./components/Icon";

/** Navigation is user-configurable (JetBrains-Space style).
 *  `grouped` = the shipped default: 8 destinations, detail views nested as sub-tabs.
 *  `flat`    = every view as its own top-level entry (the pre-redesign behaviour).
 *  `chat-first` = the communication-first shell (rail + channel sidebar), default on this
 *                 branch. Nothing is removed by it: every registered view stays reachable
 *                 through the rail's "More" panel, and switching back is lossless. */
export type NavLayout = "grouped" | "flat" | "chat-first";
export type NavGroup = { id: string; label: string; icon: IconName; views: string[] };

export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Overview", icon: "home", views: ["Home", "Dashboard"] },
  // "Tasks", not "My tasks": this group holds the SHARED work surfaces (Team Tasks =
  // everybody's running project work, Project Tasks = one project's), so a possessive
  // label made people skip the only cross-team view there is.
  { id: "tasks", label: "Tasks", icon: "check", views: ["To-Do", "Team Tasks", "Project Tasks"] },
  // Projects is ONE destination: open a project → its boards → their issues.
  // Issues/Boards/Packages stay routable (deep links, Go to) but are not tabs.
  { id: "projects", label: "Projects", icon: "layers", views: ["Projects", "Development", "Repos", "Code Reviews", "Pipelines", "Dev Environments"] },
  { id: "calendar", label: "Calendar", icon: "calendar-nav", views: ["Calendar", "Meetings"] },
  { id: "knowledge", label: "Knowledge", icon: "book-nav", views: ["Documents", "Blogs"] },
  { id: "inbox", label: "Inbox", icon: "inbox", views: ["Inbox", "Chat"] },
  { id: "timeoff", label: "Time off", icon: "clock-nav", views: ["Absences"] },
  { id: "org", label: "Organization", icon: "org", views: ["Members", "Locations", "Users", "Admin", "Applications", "Settings"] },
];

const LAYOUT_KEY = "space.nav.layout";
const HIDDEN_KEY = "space.nav.hidden";
const DEFAULT_VIEW_KEY = "space.nav.defaultView";

const LAYOUTS: NavLayout[] = ["grouped", "flat", "chat-first"];
const readLayout = (): NavLayout => {
  const stored = localStorage.getItem(LAYOUT_KEY);
  return LAYOUTS.includes(stored as NavLayout) ? (stored as NavLayout) : "chat-first";
};
const readHidden = (): string[] => { try { const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };

const [navLayout, setLayoutSignal] = createSignal<NavLayout>(readLayout());
const [hiddenGroups, setHiddenSignal] = createSignal<string[]>(readHidden());
// Chat-first opens on Home (the calendar start view of the briefing); the older layouts
// keep their Dashboard landing. An explicit user choice always wins.
const [defaultView, setDefaultSignal] = createSignal<string>(
  localStorage.getItem(DEFAULT_VIEW_KEY) ?? (readLayout() === "chat-first" ? "Home" : "Dashboard"),
);

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

/** View names are ROUTING KEYS (router.ts, buildPath, deep links) and must not move.
 *  When the product's word differs from the key, it is mapped here — the nav shows the
 *  product's word, the URL keeps the app's own name. */
const VIEW_LABELS: Record<string, string> = { Issues: "Tickets" };
export const viewLabel = (view: string) => VIEW_LABELS[view] ?? view;

// ---------------------------------------------------------------------------
// Rail modes (chat-first shell).
//
// The rail selects a MODE and the sidebar shows that mode's objects. The mode is
// never stored: it is DERIVED from the current route, so a deep link into a
// channel / ticket / document always arrives with the sidebar its target belongs
// to. Storing it would let the two disagree, which is exactly the defect this
// mapping exists to prevent.
// ---------------------------------------------------------------------------
export type RailMode = "home" | "chats" | "activity" | "tasks" | "calendar" | "development" | "more";

/** Every view has EXACTLY ONE home mode. A view that is absent here belongs to
 *  "more", whose sidebar is built from the LIVE view registry — so a newly
 *  registered view can never become unreachable, it simply lands in More. */
const MODE_OF_VIEW: Record<string, RailMode> = {
  Home: "home",
  Dashboard: "home",
  Chat: "chats",
  Inbox: "activity",
  "To-Do": "tasks",
  "Team Tasks": "tasks",
  "Project Tasks": "tasks",
  Calendar: "calendar",
  Meetings: "calendar",
  Absences: "calendar",
  Locations: "calendar",
  Members: "calendar",
  Development: "development",
  Issues: "development",
  Boards: "development",
  Repos: "development",
  "Code Reviews": "development",
  Pipelines: "development",
  "Dev Environments": "development",
  Packages: "development",
};

export const railModeOfView = (view: string): RailMode => MODE_OF_VIEW[view] ?? "more";

/** Route -> mode. The entity type wins where a view is SHARED: a channel URL renders
 *  the Chat view, and a channel is always a conversation. Everything else is decided
 *  by the view name, which is the routing key itself. */
export const railModeOfRoute = (route: { view: string; entityType?: string }): RailMode =>
  route.entityType === "channel" ? "chats" : railModeOfView(route.view);

/** Views that own a rail mode's landing surface — used to keep the More sidebar
 *  free of duplicates without hand-maintaining a second list. */
export const viewsInMode = (mode: RailMode): string[] =>
  Object.keys(MODE_OF_VIEW).filter((view) => MODE_OF_VIEW[view] === mode);
