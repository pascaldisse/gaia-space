import { createEffect, createSignal, onCleanup, onMount, Match, Show, Switch, type Component } from "solid-js";
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
import Chat from "./views/Chat";
import Documents from "./views/Documents";
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
import { Resizer, paneWidth } from "./components/Resizer";
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
  Organization: { name: "Organization", label: "Organization",   icon: "♟", component: Members },
  Admin:        { name: "Admin",        label: "Admin",          icon: "⚙", component: Admin },
  Users:        { name: "Users",        label: "User accounts",  icon: "⚉", component: Users },
  // project-context destinations
  Steering:        { name: "Steering",        label: "Steering",         icon: "◎", component: Steering },
  Issues:          { name: "Issues",          label: "Issues",           icon: "✓", component: Issues },
  Boards:          { name: "Boards",          label: "Boards",           icon: "▦", component: Boards },
  Docs:            { name: "Docs",            label: "Docs",             icon: "▤", component: Documents },
  Chat:            { name: "Chat",            label: "Chat",             icon: "◌", component: Chat },
  Calendar:        { name: "Calendar",        label: "Calendar",         icon: "▦", component: Calendar },
  Meetings:        { name: "Meetings",        label: "Meetings",         icon: "◷", component: Meetings },
  Repos:           { name: "Repos",           label: "Repositories",     icon: "⌘", component: Repos, desktopOnly: true },
  Reviews:         { name: "Reviews",         label: "Code reviews",     icon: "⇄", component: Reviews, desktopOnly: true },
  Pipelines:       { name: "Pipelines",       label: "Pipelines",        icon: "▷", component: Pipelines, desktopOnly: true },
  Packages:        { name: "Packages",        label: "Packages",         icon: "◇", component: Packages },
  ProjectSettings: { name: "ProjectSettings", label: "Project settings", icon: "⚙", component: ProjectSettings },
};

// primary sidebar groups
const myWorkNav = ["MyWork", "To-Do", "Absences"];
const workspaceNav = ["Inbox", "Projects", "Organization"];
// nav buttons that highlight for a whole section rather than a single destination
const sectionNav = new Set(["Projects", "Organization"]);

// project context surface: tabs → the destination(s) each reveals
type Tab = { tab: string; icon: string; views: string[] };
const projectTabs: Tab[] = [
  { tab: "Steering",      icon: "◎", views: ["Steering"] },
  { tab: "Work",          icon: "▦", views: ["Issues", "Boards"] },
  { tab: "Planning",      icon: "▦", views: ["Calendar", "Meetings"] },
  { tab: "Knowledge",     icon: "▤", views: ["Docs"] },
  { tab: "Communication", icon: "◌", views: ["Chat"] },
  { tab: "Delivery",      icon: "⌘", views: ["Repos", "Reviews", "Pipelines", "Packages"] },
  { tab: "Settings",      icon: "⚙", views: ["ProjectSettings"] },
];
const projectDestinations = new Set(projectTabs.flatMap((t) => t.views));

// Goto search results map onto the new destination keys.
const gotoView: Record<string, string> = { profile: "Organization", project: "Projects", issue: "Issues", channel: "Chat", document: "Docs", review: "Reviews", meeting: "Calendar" };

export default function App() {
  const [active, setActive] = createSignal("MyWork");
  const [gotoOpen, setGotoOpen] = createSignal(false);
  const allowed = (name: string) => !(isWeb() && registry[name].desktopOnly);
  const current = () => registry[active()] ?? registry.MyWork;

  const [navWidth, setNavWidth] = paneWidth("space.nav.width", 208);
  const [pinnedCollapsed, setPinnedCollapsed] = createSignal(localStorage.getItem("space.nav.collapsed") === "1");
  const [narrow, setNarrow] = createSignal(false);
  const collapsed = () => pinnedCollapsed() || narrow();
  const toggle = () => { const next = !pinnedCollapsed(); setPinnedCollapsed(next); localStorage.setItem("space.nav.collapsed", next ? "1" : "0"); };

  // primary highlight: which top-level section owns the current destination
  const inProject = () => projectDestinations.has(active());
  const section = () => (inProject() || active() === "Projects") ? "Projects" : (active() === "Organization" || active() === "Users") ? "Organization" : active();

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
    const mq = window.matchMedia("(max-width: 900px)"); const sync = () => setNarrow(mq.matches); sync(); mq.addEventListener("change", sync);
    onCleanup(() => { window.removeEventListener("keydown", shortcut); mq.removeEventListener("change", sync); });
  });

  // cross-view navigation requests (Project Home quick links, etc.)
  createEffect(() => { const v = requestedView(); if (v && registry[v] && allowed(v)) { setActive(v); requestView(undefined); } });

  const navButton = (name: string) => {
    const d = registry[name];
    const isActive = () => (sectionNav.has(name) ? section() === name : active() === name);
    return <button title={d.label} classList={{ active: isActive() }} onClick={() => setActive(name)}><span class="nav-icon">{d.icon}</span><em>{d.label}</em></button>;
  };

  return <Switch>
    <Match when={isWeb() && !authChecked()}><div class="space-shell-loading"/></Match>
    <Match when={isWeb() && !currentUser()}><Login/></Match>
    <Match when={true}>
      <div class="space-shell" classList={{ collapsed: collapsed() }} style={{ "--nav-w": (collapsed() ? 52 : navWidth()) + "px" }}>
        <aside class="nav">
          <header><div class="space-mark">S</div><em>GAIA Space</em><button class="nav-toggle" title={collapsed() ? "Expand sidebar" : "Collapse sidebar"} onClick={toggle}>{collapsed() ? "»" : "«"}</button></header>
          <nav>
            <p class="nav-section">My Work</p>{myWorkNav.map(navButton)}
            <p class="nav-section">Workspace</p>{workspaceNav.map(navButton)}
            <p class="nav-section">Manage</p>{navButton("Admin")}
            <Show when={isWeb() && currentUser()?.role === "admin"}>{navButton("Users")}</Show>
          </nav>
          <Show when={isWeb()}><AccountFooter/></Show>
        </aside>
        <Resizer width={navWidth} setWidth={setNavWidth} min={160} max={420}/>
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
