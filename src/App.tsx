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
// Same Calendar module, two IA destinations: a primary workspace-wide Calendar in
// the top nav vs. the project-filtered Planning calendar inside a project.
const GlobalCalendar: Component = () => <Calendar scope="global" />;
const ProjectCalendar: Component = () => <Calendar scope="project" />;
import Packages from "./views/Packages";
import Pipelines from "./views/Pipelines";
import Members from "./views/Members";
import Admin from "./views/Admin";
import Users from "./views/Users";
import Goto from "./components/Goto";
import Login from "./components/Login";
import AccountFooter from "./components/AccountFooter";
import { ProjectPicker } from "./components/Pickers";
import { Avatar } from "./components/Avatar";
import { Icon, type IconName } from "./components/Icon";
import { authChecked, checkAuth, currentUser, isWeb, projectId, projects } from "./session";
import { requestedView, requestView } from "./nav";

// ── destination registry: every module still exists; the IA just groups them ──
type Dest = { name: string; label: string; icon: IconName; component: Component; desktopOnly?: boolean };
const registry: Record<string, Dest> = {
  // primary / personal
  MyWork:       { name: "MyWork",       label: "Overview",       icon: "home", component: Dashboard },
  "To-Do":      { name: "To-Do",        label: "My tasks",       icon: "check", component: Todo },
  Absences:     { name: "Absences",     label: "Time off",       icon: "clock", component: Absences },
  Inbox:        { name: "Inbox",        label: "Inbox",          icon: "inbox", component: Inbox },
  Projects:     { name: "Projects",     label: "Projects",       icon: "layers", component: Portfolio },
  Calendar:     { name: "Calendar",     label: "Calendar",       icon: "calendar-nav", component: GlobalCalendar },
  Knowledge:    { name: "Knowledge",    label: "Knowledge",      icon: "book", component: GlobalKnowledge },
  Organization: { name: "Organization", label: "Organization",   icon: "org", component: Members },
  Admin:        { name: "Admin",        label: "Admin",          icon: "settings", component: Admin },
  Users:        { name: "Users",        label: "User accounts",  icon: "users", component: Users },
  // project-context destinations
  Steering:        { name: "Steering",        label: "Steering",         icon: "target", component: Steering },
  Issues:          { name: "Issues",          label: "Issues",           icon: "check", component: Issues },
  Boards:          { name: "Boards",          label: "Boards",           icon: "columns", component: Boards },
  ProjectTasks:    { name: "ProjectTasks",    label: "Tasks",            icon: "check", component: ProjectTasks },
  Docs:            { name: "Docs",            label: "Docs",             icon: "book", component: ProjectDocs },
  Chat:            { name: "Chat",            label: "Chat",             icon: "chat", component: Chat },
  ProjectCalendar: { name: "ProjectCalendar", label: "Calendar",         icon: "calendar-nav", component: ProjectCalendar },
  Meetings:        { name: "Meetings",        label: "Meetings",         icon: "clock", component: Meetings },
  Repos:           { name: "Repos",           label: "Repositories",     icon: "repo", component: Repos, desktopOnly: true },
  Reviews:         { name: "Reviews",         label: "Code reviews",     icon: "review", component: Reviews, desktopOnly: true },
  Pipelines:       { name: "Pipelines",       label: "Pipelines",        icon: "pipeline", component: Pipelines, desktopOnly: true },
  Packages:        { name: "Packages",        label: "Packages",         icon: "package", component: Packages },
  ProjectSettings: { name: "ProjectSettings", label: "Project settings", icon: "settings", component: ProjectSettings },
};

// primary top-navigation: the four destinations the workspace centers on.
// A subtle divider separates a visually secondary cluster (Time off, Organization)
// that stays accessible but never competes with the primary four. Admin lives in a menu.
const primaryNav = ["MyWork", "To-Do", "Projects", "Calendar", "Knowledge", "Inbox"];
const secondaryNav = ["Absences", "Organization"];
// nav buttons that highlight for a whole section rather than a single destination
const sectionNav = new Set(["Projects", "Organization"]);

// project context surface: tabs → the destination(s) each reveals
type Tab = { tab: string; icon: IconName; views: string[] };
const projectTabs: Tab[] = [
  { tab: "Steering",      icon: "target", views: ["Steering"] },
  { tab: "Work",          icon: "columns", views: ["Issues", "Boards", "ProjectTasks"] },
  { tab: "Planning",      icon: "calendar", views: ["ProjectCalendar", "Meetings"] },
  { tab: "Knowledge",     icon: "book", views: ["Docs"] },
  { tab: "Communication", icon: "chat", views: ["Chat"] },
  { tab: "Delivery",      icon: "repo", views: ["Repos", "Reviews", "Pipelines", "Packages"] },
  { tab: "Settings",      icon: "settings", views: ["ProjectSettings"] },
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
      <span class="nav-icon"><Icon name={d.icon} size={17} /></span><span class="topnav-label">{d.label}</span>
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
            <button class="topbar-search" title="Search (⌘K)" onClick={() => setGotoOpen(true)}><span class="nav-icon"><Icon name="search" size={16} /></span><span class="topbar-search-hint">Search</span></button>

            {/* secondary / admin controls: compact menu, not primary nav */}
            <div class="topbar-menu">
              <button class="topbar-icon" classList={{ active: menu() === "manage" || inManageMenu() }} title="Manage" onClick={() => toggleMenu("manage")}><Icon name="settings" size={17} label="Manage" /></button>
              <Show when={menu() === "manage"}>
                <div class="topbar-dropdown">
                  <p class="dropdown-label">Manage</p>
                  <button classList={{ active: active() === "Admin" }} onClick={() => go("Admin")}><span class="nav-icon"><Icon name="settings" size={16} /></span>Admin</button>
                  <Show when={isWeb() && currentUser()?.role === "admin"}>
                    <button classList={{ active: active() === "Users" }} onClick={() => go("Users")}><span class="nav-icon"><Icon name="users" size={16} /></span>User accounts</button>
                  </Show>
                </div>
              </Show>
            </div>

            <Show when={isWeb()}>
              <div class="topbar-menu">
                <button class="topbar-account" classList={{ active: menu() === "account" }} title="Account" onClick={() => toggleMenu("account")}>
                  <Avatar class="account-avatar" variant="person" size={26} name={currentUser()?.display_name ?? currentUser()?.username ?? "?"} />
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
                  <button classList={{ active: activeTab().tab === t.tab }} onClick={() => openTab(t)}><span class="pc-tab-icon"><Icon name={t.icon} size={16} /></span>{t.tab}</button>)}
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
