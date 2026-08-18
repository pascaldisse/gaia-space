import { createEffect, createSignal, onCleanup, onMount, Match, Show, Switch, For, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import "./App.css";
import Dashboard from "./views/Dashboard";
import Todo from "./views/Todo";
import Absences from "./views/Absences";
import Portfolio from "./views/Portfolio";
import Steering from "./views/Steering";
import ProjectSettings from "./views/ProjectSettings";
import Inbox from "./views/Inbox";
import Repos from "./views/Repos";
import Reviews from "./views/Reviews";
import Issues from "./views/Issues";
import Boards from "./views/Boards";
import ProjectTasks from "./views/ProjectTasks";
import Chat from "./views/Chat";
import Documents from "./views/Documents";
// Same Documents module, two IA destinations: project-independent knowledge in the
// top nav vs. project-specific docs inside the project context.
const GlobalKnowledge: Component = () => <Documents scope="global" />;
const ProjectDocs: Component = () => <Documents scope="project" />;
import Meetings from "./views/Meetings";
import Calendar from "./views/Calendar";
import Packages from "./views/Packages";
import Pipelines from "./views/Pipelines";
import Members from "./views/Members";
import Admin from "./views/Admin";
import Users from "./views/Users";
import Goto from "./components/Goto";
import Login from "./components/Login";
import AccountFooter from "./components/AccountFooter";
import { ProjectPicker } from "./components/Pickers";
import { authChecked, checkAuth, currentUser, isWeb, projectId, projects } from "./session";
import { requestedView, requestView } from "./nav";

// ── destination registry: every module still exists; the IA just groups them ──
type Dest = { name: string; label: string; icon: string; component: Component; desktopOnly?: boolean };
const registry: Record<string, Dest> = {
  // primary / personal
  MyWork:       { name: "MyWork",       label: "Overview",       icon: "⌂", component: Dashboard },
  "To-Do":      { name: "To-Do",        label: "My tasks",       icon: "✓", component: Todo },
  Absences:     { name: "Absences",     label: "Time off",       icon: "◷", component: Absences },
  Inbox:        { name: "Inbox",        label: "Inbox",          icon: "✉", component: Inbox },
  Projects:     { name: "Projects",     label: "Projects",       icon: "◈", component: Portfolio },
  Knowledge:    { name: "Knowledge",    label: "Knowledge",      icon: "▤", component: GlobalKnowledge },
  Organization: { name: "Organization", label: "Organization",   icon: "♟", component: Members },
  Admin:        { name: "Admin",        label: "Admin",          icon: "⚙", component: Admin },
  Users:        { name: "Users",        label: "User accounts",  icon: "⚉", component: Users },
  // project-context destinations
  Steering:        { name: "Steering",        label: "Steering",         icon: "◎", component: Steering },
  Issues:          { name: "Issues",          label: "Issues",           icon: "✓", component: Issues },
  Boards:          { name: "Boards",          label: "Boards",           icon: "▦", component: Boards },
  ProjectTasks:    { name: "ProjectTasks",    label: "Tasks",            icon: "✓", component: ProjectTasks },
  Docs:            { name: "Docs",            label: "Docs",             icon: "▤", component: ProjectDocs },
  Chat:            { name: "Chat",            label: "Chat",             icon: "◌", component: Chat },
  Calendar:        { name: "Calendar",        label: "Calendar",         icon: "▦", component: Calendar },
  Meetings:        { name: "Meetings",        label: "Meetings",         icon: "◷", component: Meetings },
  Repos:           { name: "Repos",           label: "Repositories",     icon: "⌘", component: Repos, desktopOnly: true },
  Reviews:         { name: "Reviews",         label: "Code reviews",     icon: "⇄", component: Reviews, desktopOnly: true },
  Pipelines:       { name: "Pipelines",       label: "Pipelines",        icon: "▷", component: Pipelines, desktopOnly: true },
  Packages:        { name: "Packages",        label: "Packages",         icon: "◇", component: Packages },
  ProjectSettings: { name: "ProjectSettings", label: "Project settings", icon: "⚙", component: ProjectSettings },
};

// primary top-navigation: the four destinations the workspace centers on.
// A subtle divider separates a visually secondary cluster (Time off, Organization)
// that stays accessible but never competes with the primary four. Admin lives in a menu.
const primaryNav = ["MyWork", "To-Do", "Projects", "Knowledge", "Inbox"];
const secondaryNav = ["Absences", "Organization"];
// nav buttons that highlight for a whole section rather than a single destination
const sectionNav = new Set(["Projects", "Organization"]);

// project context surface: tabs → the destination(s) each reveals
type Tab = { tab: string; icon: string; views: string[] };
const projectTabs: Tab[] = [
  { tab: "Steering",      icon: "◎", views: ["Steering"] },
  { tab: "Work",          icon: "▦", views: ["Issues", "Boards", "ProjectTasks"] },
  { tab: "Planning",      icon: "▦", views: ["Calendar", "Meetings"] },
  { tab: "Knowledge",     icon: "▤", views: ["Docs"] },
  { tab: "Communication", icon: "◌", views: ["Chat"] },
  { tab: "Delivery",      icon: "⌘", views: ["Repos", "Reviews", "Pipelines", "Packages"] },
  { tab: "Settings",      icon: "⚙", views: ["ProjectSettings"] },
];
const projectDestinations = new Set(projectTabs.flatMap((t) => t.views));

// Goto search results map onto the new destination keys.
const gotoView: Record<string, string> = { profile: "Organization", project: "Projects", issue: "Issues", channel: "Chat", document: "Knowledge", review: "Reviews", meeting: "Calendar" };

export default function App() {
  const [active, setActive] = createSignal("MyWork");
  const [gotoOpen, setGotoOpen] = createSignal(false);
  // only one top-right menu open at a time ("manage" | "account" | null)
  const [menu, setMenu] = createSignal<"manage" | "account" | null>(null);
  const toggleMenu = (which: "manage" | "account") => setMenu((m) => (m === which ? null : which));
  const allowed = (name: string) => !(isWeb() && registry[name].desktopOnly);
  const current = () => registry[active()] ?? registry.MyWork;
  const go = (name: string) => { setMenu(null); setActive(name); };

  // primary highlight: which top-level section owns the current destination
  const inProject = () => projectDestinations.has(active());
  const section = () => (inProject() || active() === "Projects") ? "Projects" : (active() === "Organization" || active() === "Users") ? "Organization" : active();
  const inManageMenu = () => active() === "Admin" || active() === "Users";

  // active project tab + its sibling destinations (for the secondary segmented control)
  const activeTab = () => projectTabs.find((t) => t.views.includes(active())) ?? projectTabs[0];
  const tabViews = (t: Tab) => t.views.filter(allowed);
  const openTab = (t: Tab) => { const v = tabViews(t)[0]; if (v) setActive(v); };

  const activeProjectName = () => projects()?.find((p) => p.id === projectId())?.name;
  const backToPortfolio = () => setActive("Projects");

  onMount(() => {
    void checkAuth();
    const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setGotoOpen((open) => !open); } };
    window.addEventListener("keydown", shortcut);
    // close top-right menus when clicking outside the header
    const away = (event: MouseEvent) => { if (!(event.target as HTMLElement)?.closest(".topbar-menu")) setMenu(null); };
    window.addEventListener("mousedown", away);
    onCleanup(() => { window.removeEventListener("keydown", shortcut); window.removeEventListener("mousedown", away); });
  });

  // cross-view navigation requests (Project Home quick links, etc.)
  createEffect(() => { const v = requestedView(); if (v && registry[v] && allowed(v)) { setActive(v); requestView(undefined); } });

  const navButton = (name: string, secondary = false) => {
    const d = registry[name];
    const isActive = () => (sectionNav.has(name) ? section() === name : active() === name);
    return <button class="topnav-item" title={d.label} classList={{ active: isActive(), secondary }} onClick={() => go(name)}>
      <span class="nav-icon">{d.icon}</span><span class="topnav-label">{d.label}</span>
    </button>;
  };

  return <Switch>
    <Match when={isWeb() && !authChecked()}><div class="space-shell-loading"/></Match>
    <Match when={isWeb() && !currentUser()}><Login/></Match>
    <Match when={true}>
      <div class="space-shell">
        <header class="topbar">
          <div class="topbar-brand"><div class="space-mark">S</div><em>GAIA Space</em></div>
          <nav class="topnav">
            <For each={primaryNav}>{(name) => navButton(name)}</For>
            <span class="topnav-divider" aria-hidden="true" />
            <For each={secondaryNav}>{(name) => navButton(name, true)}</For>
          </nav>
          <div class="topbar-right">
            <button class="topbar-search" title="Search (⌘K)" onClick={() => setGotoOpen(true)}><span class="nav-icon">⌕</span><span class="topbar-search-hint">Search</span></button>

            {/* secondary / admin controls: compact menu, not primary nav */}
            <div class="topbar-menu">
              <button class="topbar-icon" classList={{ active: menu() === "manage" || inManageMenu() }} title="Manage" onClick={() => toggleMenu("manage")}>⚙</button>
              <Show when={menu() === "manage"}>
                <div class="topbar-dropdown">
                  <p class="dropdown-label">Manage</p>
                  <button classList={{ active: active() === "Admin" }} onClick={() => go("Admin")}><span class="nav-icon">⚙</span>Admin</button>
                  <Show when={isWeb() && currentUser()?.role === "admin"}>
                    <button classList={{ active: active() === "Users" }} onClick={() => go("Users")}><span class="nav-icon">⚉</span>User accounts</button>
                  </Show>
                </div>
              </Show>
            </div>

            <Show when={isWeb()}>
              <div class="topbar-menu">
                <button class="topbar-account" classList={{ active: menu() === "account" }} title="Account" onClick={() => toggleMenu("account")}>
                  <span class="account-avatar">{(currentUser()?.display_name ?? currentUser()?.username ?? "?").slice(0, 1).toUpperCase()}</span>
                </button>
                <Show when={menu() === "account"}>
                  <div class="topbar-dropdown account-dropdown"><AccountFooter/></div>
                </Show>
              </div>
            </Show>
          </div>
        </header>

        <main class="workspace">
          <Show when={inProject()}>
            <div class="project-context">
              <div class="pc-head">
                <div class="pc-crumb"><button class="pc-back" title="All projects" onClick={backToPortfolio}>Projects</button><span class="pc-sep">/</span><strong>{activeProjectName() ?? "Select a project"}</strong></div>
                <ProjectPicker label=""/>
              </div>
              <nav class="pc-tabs">
                {projectTabs.filter((t) => tabViews(t).length).map((t) =>
                  <button classList={{ active: activeTab().tab === t.tab }} onClick={() => openTab(t)}><span class="pc-tab-icon">{t.icon}</span>{t.tab}</button>)}
              </nav>
              <Show when={tabViews(activeTab()).length > 1}>
                <div class="pc-sub">
                  {tabViews(activeTab()).map((v) =>
                    <button classList={{ active: active() === v }} onClick={() => setActive(v)}>{registry[v].label}</button>)}
                </div>
              </Show>
            </div>
          </Show>
          <div class="workspace-body"><Dynamic component={current().component}/></div>
        </main>
        <Goto open={gotoOpen()} onClose={() => setGotoOpen(false)} onNavigate={(kind) => setActive(gotoView[kind] ?? "MyWork")}/>
      </div>
    </Match>
  </Switch>;
}
