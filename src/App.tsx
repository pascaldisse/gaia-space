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
import Documents from "./views/Documents";
import Meetings from "./views/Meetings";
import Calendar from "./views/Calendar";
import ProjectTasks from "./views/ProjectTasks";
import Packages from "./views/Packages";
import Pipelines from "./views/Pipelines";
import Members from "./views/Members";
import Admin from "./views/Admin";
import Users from "./views/Users";
import Goto from "./components/Goto";
import Login from "./components/Login";
import AccountFooter from "./components/AccountFooter";
import { authChecked, checkAuth, currentUser, isWeb } from "./session";
import { activeView, createHashAdapter, createPathAdapter, initRouter, linkEntity, linkProps, registerViews, setAvailableViews, setRoutePending } from "./router";

type View = { name:string; icon:string; component:Component };
const personalViews:View[]=[{name:"Dashboard",icon:"⌂",component:Dashboard},{name:"To-Do",icon:"✓",component:Todo},{name:"Absences",icon:"◷",component:Absences}];
const localOnlyViews:View[]=[{name:"Repos",icon:"⌘",component:Repos},{name:"Code Reviews",icon:"⇄",component:Reviews},{name:"Pipelines",icon:"▷",component:Pipelines}];
const workspaceViews:View[]=[{name:"Projects",icon:"◇",component:Projects},...localOnlyViews,{name:"Issues",icon:"!",component:Issues},{name:"Boards",icon:"▦",component:Boards},{name:"Chat",icon:"◌",component:Chat},{name:"Documents",icon:"▤",component:Documents},{name:"Meetings",icon:"◷",component:Meetings},{name:"Calendar",icon:"□",component:Calendar},{name:"Packages",icon:"▣",component:Packages},{name:"Members",icon:"♙",component:Members},{name:"Admin",icon:"⚙",component:Admin}];
const usersView:View={name:"Users",icon:"♧",component:Users};
const projectTasksView:View={name:"Project Tasks",icon:"✓",component:ProjectTasks};

export default function App() {
  const active=()=>activeView()||"Dashboard";
  const [gotoOpen,setGotoOpen]=createSignal(false);
  const [accountOpen,setAccountOpen]=createSignal(false);
  const visibleWorkspaceViews=()=>{
    let list=workspaceViews;
    if(isWeb()) list=list.filter(v=>!localOnlyViews.includes(v));
    if(isWeb()&&currentUser()?.role==="admin") list=[...list,usersView];
    return list;
  };
  const views=()=>[...personalViews,...visibleWorkspaceViews(),projectTasksView];
  const current=()=>views().find(view=>view.name===active())??personalViews[0];
  onMount(()=>{
    registerViews([...personalViews,...workspaceViews,usersView,projectTasksView].map(v=>({name:v.name})));
    setRoutePending(isWeb()&&!authChecked());
    initRouter(isWeb()?createPathAdapter(import.meta.env.BASE_URL):createHashAdapter());
    void checkAuth();
    const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setGotoOpen(open=>!open)}};
    const closeAccount=(event:MouseEvent)=>{if(!(event.target as HTMLElement).closest(".topbar-right"))setAccountOpen(false)};
    window.addEventListener("keydown",shortcut); document.addEventListener("mousedown",closeAccount);
    onCleanup(()=>{window.removeEventListener("keydown",shortcut);document.removeEventListener("mousedown",closeAccount)});
  });
  createEffect(()=>{
    setRoutePending(isWeb()&&!authChecked());
    setAvailableViews([...personalViews,...visibleWorkspaceViews(),projectTasksView].map(v=>v.name));
  });
  const nav=(view:View)=><a class="topnav-item" title={view.name} aria-label={view.name} classList={{active:active()===view.name}} {...linkProps({view:view.name})}><span class="nav-icon" aria-hidden="true">{view.icon}</span><span class="topnav-label">{view.name}</span></a>;
  return <Switch>
    <Match when={isWeb()&&!authChecked()}><div class="space-shell-loading"/></Match>
    <Match when={isWeb()&&!currentUser()}><Login/></Match>
    <Match when={true}>
      <div class="space-shell">
        <header class="topbar">
          <div class="topbar-brand"><span class="space-mark" aria-hidden="true">S</span><em>GAIA Space</em></div>
          <nav class="topnav" aria-label="Workspace navigation"><For each={personalViews}>{nav}</For><For each={visibleWorkspaceViews()}>{nav}</For></nav>
          <div class="topbar-right">
            <button class="topbar-search" aria-label="Open Go to search" title="Search (Ctrl/Cmd + K)" onClick={()=>setGotoOpen(true)}><span class="nav-icon" aria-hidden="true">⌕</span><span class="topbar-search-hint">Go to</span></button>
            <Show when={isWeb()}><button class="topbar-account account-trigger" aria-label="Open account menu" aria-expanded={accountOpen()} onClick={()=>setAccountOpen(v=>!v)}><span class="account-avatar" aria-hidden="true">{(currentUser()?.display_name??currentUser()?.username??"?").slice(0,1).toUpperCase()}</span></button><Show when={accountOpen()}><div class="account-dropdown"><AccountFooter/></div></Show></Show>
          </div>
        </header>
        <main class="workspace"><Dynamic component={current().component}/></main>
        <Goto open={gotoOpen()} onClose={()=>setGotoOpen(false)} onNavigate={(kind,id)=>linkEntity(kind,id)}/>
      </div>
    </Match>
  </Switch>;
}
