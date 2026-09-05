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
  // The Task Ledger is an EXTRA reading surface (generated, read-only), not a
  // replacement for the task area: it joins the group AFTER the three working
  // surfaces so nobody meets it first and mistakes it for "Tasks".
  { id: "tasks", label: "Tasks", icon: "check", views: ["To-Do", "Team Tasks", "Project Tasks", "Task Ledger"] },
  // Projects is ONE destination: open a project → its boards → their issues.
  // Issues/Boards/Packages stay routable (deep links, Go to) but are not tabs.
  { id: "projects", label: "Projects", icon: "layers", views: ["Projects", "Development", "Repos", "Code Reviews", "Pipelines", "Dev Environments"] },
  { id: "calendar", label: "Calendar", icon: "calendar-nav", views: ["Calendar", "Meetings"] },
  { id: "knowledge", label: "Knowledge", icon: "book-nav", views: ["Documents", "Blogs"] },
  { id: "inbox", label: "Inbox", icon: "inbox", views: ["Inbox", "Chat"] },
  { id: "timeoff", label: "Time off", icon: "clock-nav", views: ["Absences"] },
  // Leads (landing-page contact submissions, administrator-only) is an ORGANISATION
  // surface, not a second Inbox: it is administered, not worked in a conversation. It
  // therefore joins the org group instead of the standalone group master gave it, and in
  // the chat-first rail it falls through `railModeOfView` to "More" — the shell's home
  // for organisation-level views.
  { id: "org", label: "Organization", icon: "org", views: ["Members", "Locations", "Users", "Admin", "Applications", "Leads", "Finance", "Settings"] },
];

// ---------------------------------------------------------------------------
// FINANCE VISIBILITY — the ONE place the nav entry's condition lives.
//
// It is NOT the security boundary: `finance.rs` gates every command against the
// `finance_access` table and refuses whoever is not in it, so a user who guesses the
// URL sees a refusal, not numbers. This flag only decides whether the destination is
// OFFERED, and it believes the server's own answer (`finance_access_check`).
//
// TO SHOW FINANCE TO EVERYONE: set `FINANCE_FOR_EVERYONE = true`. One line, here.
// (The server gate stays in force — opening it for everyone means adding the people
//  to `finance_access`, which the view itself can do.)
// ---------------------------------------------------------------------------
export const FINANCE_FOR_EVERYONE = false;
const [financeAllowed, setFinanceAllowedSignal] = createSignal(false);
/** Set from the server's answer; never from a role guess in the page. */
export function setFinanceAllowed(next: boolean) { setFinanceAllowedSignal(next); }
export const financeVisible = () => FINANCE_FOR_EVERYONE || financeAllowed();

const LAYOUT_KEY = "space.nav.layout";
const HIDDEN_KEY = "space.nav.hidden";
const DEFAULT_VIEW_KEY = "space.nav.defaultView";
const PLACEMENT_KEY = "space.nav.placement";
const MOBILE_PLACEMENT_KEY = "space.nav.mobilePlacement";
const DEVELOPMENT_KEY = "space.nav.showDevelopment";
const LAYOUTS: NavLayout[] = ["grouped", "flat", "chat-first"];
const PLACEMENTS: NavPlacement[] = ["left", "right", "top", "bottom"];
const MOBILE_PLACEMENTS: MobileNavPlacement[] = ["top", "bottom"];
const readChoice = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
  const stored = localStorage.getItem(key);
  return choices.includes(stored as T) ? stored as T : fallback;
};
const readBoolean = (key: string, fallback: boolean): boolean => {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
};
const readLayout = (): NavLayout => readChoice(LAYOUT_KEY, LAYOUTS, "chat-first");
const readHidden = (): string[] => { try { const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
const [navLayout, setLayoutSignal] = createSignal<NavLayout>(readLayout());
const [hiddenGroups, setHiddenSignal] = createSignal<string[]>(readHidden());
const [navPlacement, setPlacementSignal] = createSignal<NavPlacement>(readChoice(PLACEMENT_KEY, PLACEMENTS, "left"));
const [mobileNavPlacement, setMobilePlacementSignal] = createSignal<MobileNavPlacement>(readChoice(MOBILE_PLACEMENT_KEY, MOBILE_PLACEMENTS, "bottom"));
const [showDevelopment, setShowDevelopmentSignal] = createSignal(readBoolean(DEVELOPMENT_KEY, true));
const [defaultView, setDefaultSignal] = createSignal<string>(localStorage.getItem(DEFAULT_VIEW_KEY) ?? (readLayout() === "chat-first" ? "Home" : "Dashboard"));
export { navLayout, hiddenGroups, defaultView, navPlacement, mobileNavPlacement, showDevelopment };
export function setNavLayout(next: NavLayout) { localStorage.setItem(LAYOUT_KEY, next); setLayoutSignal(next); }
export function setNavPlacement(next: NavPlacement) { localStorage.setItem(PLACEMENT_KEY, next); setPlacementSignal(next); }
export function setMobileNavPlacement(next: MobileNavPlacement) { localStorage.setItem(MOBILE_PLACEMENT_KEY, next); setMobilePlacementSignal(next); }
export function setShowDevelopment(next: boolean) { localStorage.setItem(DEVELOPMENT_KEY, String(next)); setShowDevelopmentSignal(next); }
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
const VIEW_LABELS: Record<string, string> = { Issues: "Tickets", Documents: "Knowledge" };
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
export type RailMode = "home" | "chats" | "tasks" | "projects" | "library" | "development" | "more";
export type NavPlacement = "left" | "right" | "top" | "bottom";
export type MobileNavPlacement = "top" | "bottom";
export const MOBILE_RAIL_MODES: readonly RailMode[] = ["home", "chats", "tasks", "projects", "more"];

/** Every view has EXACTLY ONE home mode. A view that is absent here belongs to
 *  "more", whose sidebar is built from the LIVE view registry — so a newly
 *  registered view can never become unreachable, it simply lands in More. */
const MODE_OF_VIEW: Record<string, RailMode> = {
  Home: "home",
  Dashboard: "home",
  Chat: "chats",
  Inbox: "home",
  /* TASKS IS A MODE OF ITS OWN. These three used to be mapped to "home", whose
     sidebar is deliberately empty, and `moreViews()` lists only what is mapped to
     "more" — so the task area was reachable by URL and by nothing else. A working
     surface that no menu names has been deleted in every way that matters. */
  "To-Do": "tasks",
  "Team Tasks": "tasks",
  "Task Ledger": "tasks",
  // Every project-scoped surface belongs to the PROJECTS mode, not to Tasks and not
  // to More. They were unmapped, so all four fell into More and piled up there as
  // "Projects, Project Overview, Project Steering, Project Settings" — four entries
  // for one thing, in the drawer meant for what has no home.
  Projects: "projects",
  // THE workspace: one project, one frame, one tab row. The four surfaces below it
  // are still registered views (they are what its tabs mount, and what old links
  // resolve to), so they keep their single home in this mode too.
  "Project Workspace": "projects",
  "Project Overview": "projects",
  "Project Steering": "projects",
  "Project Settings": "projects",
  "Project Tasks": "projects",
  Calendar: "home",
  Meetings: "home",
  Absences: "home",
  Locations: "home",
  Documents: "library",
  Blogs: "library",
  Members: "home",
  Development: "development",
  Issues: "development",
  Boards: "development",
  Repos: "development",
  "Code Reviews": "development",
  Pipelines: "development",
  "Dev Environments": "development",
  Packages: "development",
};

export const railModeOfView = (view: string): RailMode => {
  const mode = MODE_OF_VIEW[view] ?? "more";
  return mode === "development" && !showDevelopment() ? "more" : mode;
};

/** Route -> mode. The entity type wins where a view is SHARED: a channel URL renders
 *  the Chat view, and a channel is always a conversation. Everything else is decided
 *  by the view name, which is the routing key itself. */
export const railModeOfRoute = (route: { view: string; entityType?: string; projectId?: string }): RailMode => {
  // A PROJECT ROUTE IS ALWAYS THE PROJECTS MODE. This wins over the entity type and
  // over the view name, because both lie about a project-scoped address: a channel
  // opened inside the workspace (`/projects/<id>/chats/<cid>`) renders the Chat view
  // and carries `entityType: "channel"`, yet you are standing in the project — and a
  // ticket at `/projects/<id>/issues/<iid>` renders Issues, whose own home is
  // Development. Deriving the mode from the view alone put both in the wrong sidebar.
  if (route.projectId) return "projects";
  return route.entityType === "channel" ? "chats" : railModeOfView(route.view);
};

/** Views that own a rail mode's landing surface — used to keep the More sidebar
 *  free of duplicates without hand-maintaining a second list. */
export const viewsInMode = (mode: RailMode): string[] =>
  Object.keys(MODE_OF_VIEW).filter((view) => railModeOfView(view) === mode);
