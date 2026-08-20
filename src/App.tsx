import { createEffect, createSignal, onCleanup, onMount, For, Match, Show, Switch, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import "./App.css";
import Dashboard from "./views/Dashboard";
import Todo from "./views/Todo";
import Absences from "./views/Absences";
import Projects from "./views/Projects";
import Repos from "./views/Repos";
import Reviews from "./views/Reviews";
import Issues from "./views/Issues";
import Boards from "./views/Boards";
import Chat from "./views/Chat";
import Inbox from "./views/Inbox";
import Documents from "./views/Documents";
import Calendar from "./views/Calendar";
import ProjectTasks from "./views/ProjectTasks";
import Packages from "./views/Packages";
import Pipelines from "./views/Pipelines";
import Members from "./views/Members";
import Admin from "./views/Admin";
import Users from "./views/Users";
import Settings from "./views/Settings";
import Goto from "./components/Goto";
import Login from "./components/Login";
import AccountFooter from "./components/AccountFooter";
import ServerConnect from "./components/ServerConnect";
import { Icon, type IconName } from "./components/Icon";
import { authChecked, checkAuth, currentUser, isWeb } from "./session";
import { isMobileSetup } from "./mobile";
import { activeView, createHashAdapter, createPathAdapter, initRouter, linkEntity, linkProps, registerViews, setAvailableViews, setRoutePending } from "./router";
import { defaultView, groupOfView, navLayout, visibleGroups, type NavGroup } from "./nav";

type View = { name:string; icon:IconName; component:Component };
const personalViews:View[]=[{name:"Dashboard",icon:"home",component:Dashboard},{name:"To-Do",icon:"check",component:Todo},{name:"Absences",icon:"clock-nav",component:Absences}];
const localOnlyViews:View[]=[{name:"Repos",icon:"repo",component:Repos},{name:"Code Reviews",icon:"review",component:Reviews},{name:"Pipelines",icon:"pipeline",component:Pipelines}];
const workspaceViews:View[]=[{name:"Projects",icon:"layers",component:Projects},...localOnlyViews,{name:"Issues",icon:"target",component:Issues},{name:"Boards",icon:"columns",component:Boards},{name:"Chat",icon:"chat",component:Chat},{name:"Inbox",icon:"inbox",component:Inbox},{name:"Documents",icon:"book-nav",component:Documents},{name:"Calendar",icon:"calendar-nav",component:Calendar},{name:"Packages",icon:"package",component:Packages},{name:"Members",icon:"org",component:Members},{name:"Admin",icon:"settings",component:Admin}];
const usersView:View={name:"Users",icon:"users",component:Users};
const settingsView:View={name:"Settings",icon:"settings",component:Settings};
const projectTasksView:View={name:"Project Tasks",icon:"check",component:ProjectTasks};

export default function App() {
  const active=()=>activeView()||defaultView();
  const [gotoOpen,setGotoOpen]=createSignal(false);
  const [accountOpen,setAccountOpen]=createSignal(false);
  const [menuOpen,setMenuOpen]=createSignal(false);
  const visibleWorkspaceViews=()=>{
    let list=workspaceViews;
    if(isWeb()) list=list.filter(v=>!localOnlyViews.includes(v));
    if(isWeb()&&currentUser()?.role==="admin") list=[...list,usersView];
    return list;
  };
  const views=()=>[...personalViews,...visibleWorkspaceViews(),projectTasksView,settingsView];
  const current=()=>views().find(view=>view.name===active())??personalViews[0];
  onMount(()=>{
    // "Meetings" is retained as an alias only: the destination is now Calendar,
    // where meetings are created and answered. Old links must keep resolving.
    registerViews([...personalViews,...workspaceViews,usersView,projectTasksView,settingsView].map(v=>v.name==="Calendar"?{name:v.name,aliases:["meetings"]}:{name:v.name}));
    setRoutePending(isWeb()&&!authChecked());
    initRouter(isWeb()?createPathAdapter(import.meta.env.BASE_URL):createHashAdapter());
    void checkAuth();
    const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setGotoOpen(open=>!open)}if(event.key==="Escape")setMenuOpen(false)};
    const closeAccount=(event:MouseEvent)=>{if(!(event.target as HTMLElement).closest(".topbar-right"))setAccountOpen(false)};
    window.addEventListener("keydown",shortcut); document.addEventListener("mousedown",closeAccount);
    onCleanup(()=>{window.removeEventListener("keydown",shortcut);document.removeEventListener("mousedown",closeAccount)});
  });
  createEffect(()=>{
    setRoutePending(isWeb()&&!authChecked());
    setAvailableViews([...personalViews,...visibleWorkspaceViews(),projectTasksView,settingsView].map(v=>v.name));
  });
  createEffect(()=>{ active(); setMenuOpen(false); });
  const nav=(view:View)=><a class="topnav-item" title={view.name} aria-label={view.name} classList={{active:active()===view.name}} {...linkProps({view:view.name})}><span class="nav-icon" aria-hidden="true"><Icon name={view.icon} size={18} /></span><span class="topnav-label">{view.name}</span></a>;
  const groups=()=>visibleGroups(views().map(view=>view.name));
  const activeGroup=()=>groupOfView(groups(),active());
  const groupNav=(group:NavGroup)=><a class="topnav-item" title={group.label} aria-label={group.label} classList={{active:activeGroup()?.id===group.id}} {...linkProps({view:group.views[0]})}><span class="nav-icon" aria-hidden="true"><Icon name={group.icon} size={18} /></span><span class="topnav-label">{group.label}</span></a>;
  const subNav=(name:string)=><a class="subnav-item" classList={{active:active()===name}} {...linkProps({view:name})}>{name}</a>;
  return <Switch>
    <Match when={isMobileSetup()}><ServerConnect/></Match>
    <Match when={isWeb()&&!authChecked()}><div class="space-shell-loading"/></Match>
    <Match when={isWeb()&&!currentUser()}><Login/></Match>
    <Match when={true}>
      <div class="space-shell">
        <header class="topbar">
          <button class="topbar-menu-btn" aria-label="Open navigation menu" aria-expanded={menuOpen()} onClick={()=>setMenuOpen(v=>!v)}><Icon name="menu" size={20} /></button>
          <div class="topbar-brand"><span class="space-mark" aria-hidden="true">S</span><em>GAIA Space</em></div>
          <nav class="topnav" aria-label="Workspace navigation"><Show when={navLayout()==="grouped"} fallback={<><For each={personalViews}>{nav}</For><For each={visibleWorkspaceViews()}>{nav}</For></>}><For each={groups()}>{groupNav}</For></Show></nav>
          <div class="topbar-right">
            <button class="topbar-search" aria-label="Open Go to search" title="Search (Ctrl/Cmd + K)" onClick={()=>setGotoOpen(true)}><span class="nav-icon" aria-hidden="true"><Icon name="search" size={16} /></span><span class="topbar-search-hint">Go to</span></button>
            <Show when={isWeb()}><button class="topbar-account account-trigger" aria-label="Open account menu" aria-expanded={accountOpen()} onClick={()=>setAccountOpen(v=>!v)}><span class="account-avatar" aria-hidden="true">{(currentUser()?.display_name??currentUser()?.username??"?").slice(0,1).toUpperCase()}</span></button><Show when={accountOpen()}><div class="account-dropdown"><AccountFooter/></div></Show></Show>
          </div>
        </header>
        <Show when={menuOpen()}>
          <div class="nav-drawer-backdrop" onClick={()=>setMenuOpen(false)}/>
          <nav class="nav-drawer" aria-label="Workspace navigation (mobile)">
            <div class="nav-drawer-head"><span>Navigation</span><button class="nav-drawer-close" aria-label="Close navigation menu" onClick={()=>setMenuOpen(false)}><Icon name="close" size={18} /></button></div>
            <div class="nav-drawer-list" onClick={()=>setMenuOpen(false)}><Show when={navLayout()==="grouped"} fallback={<><For each={personalViews}>{nav}</For><For each={visibleWorkspaceViews()}>{nav}</For></>}><For each={groups()}>{groupNav}</For></Show></div>
          </nav>
        </Show>
        <Show when={navLayout()==="grouped"&&(activeGroup()?.views.length??0)>1}>
          <nav class="subnav" aria-label="Section navigation"><For each={activeGroup()!.views}>{subNav}</For></nav>
        </Show>
        <main class="workspace"><Dynamic component={current().component}/></main>
        <Goto open={gotoOpen()} onClose={()=>setGotoOpen(false)} onNavigate={(kind,id)=>linkEntity(kind,id)}/>
      </div>
    </Match>
  </Switch>;
}
