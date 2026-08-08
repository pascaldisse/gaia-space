import { createSignal, onCleanup, onMount, type Component } from "solid-js";
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
import Packages from "./views/Packages";
import Pipelines from "./views/Pipelines";
import Members from "./views/Members";
import Admin from "./views/Admin";
import Goto from "./components/Goto";
import { Resizer, paneWidth } from "./components/Resizer";

type View = { name:string; icon:string; component:Component };
const personalViews:View[]=[{name:"Dashboard",icon:"◉",component:Dashboard},{name:"To-Do",icon:"✓",component:Todo},{name:"Absences",icon:"◷",component:Absences}];
const workspaceViews:View[]=[{name:"Projects",icon:"◈",component:Projects},{name:"Repos",icon:"⌘",component:Repos},{name:"Code Reviews",icon:"⇄",component:Reviews},{name:"Issues",icon:"✓",component:Issues},{name:"Boards",icon:"▦",component:Boards},{name:"Chat",icon:"◌",component:Chat},{name:"Documents",icon:"▤",component:Documents},{name:"Meetings",icon:"◷",component:Meetings},{name:"Calendar",icon:"□",component:Calendar},{name:"Packages",icon:"◇",component:Packages},{name:"Pipelines",icon:"▷",component:Pipelines},{name:"Members",icon:"♙",component:Members},{name:"Admin",icon:"⚙",component:Admin}];
const gotoView:Record<string,string>={profile:"Members",project:"Projects",issue:"Issues",channel:"Chat",document:"Documents",review:"Code Reviews",meeting:"Meetings"};

export default function App() {
  const [active,setActive]=createSignal("Dashboard"); const [gotoOpen,setGotoOpen]=createSignal(false); const views=()=>[...personalViews,...workspaceViews]; const current=()=>views().find(view=>view.name===active())!;
  const [navWidth,setNavWidth]=paneWidth("space.nav.width",208);
  const [pinnedCollapsed,setPinnedCollapsed]=createSignal(localStorage.getItem("space.nav.collapsed")==="1");
  const [narrow,setNarrow]=createSignal(false); // viewport too small for labels → icons only
  const collapsed=()=>pinnedCollapsed()||narrow();
  const toggle=()=>{const next=!pinnedCollapsed();setPinnedCollapsed(next);localStorage.setItem("space.nav.collapsed",next?"1":"0")};
  onMount(()=>{
    const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setGotoOpen(open=>!open)}};
    window.addEventListener("keydown",shortcut);
    const mq=window.matchMedia("(max-width: 900px)"); const sync=()=>setNarrow(mq.matches); sync(); mq.addEventListener("change",sync);
    onCleanup(()=>{window.removeEventListener("keydown",shortcut);mq.removeEventListener("change",sync)});
  });
  const nav=(view:View)=><button title={view.name} classList={{active:active()===view.name}} onClick={()=>setActive(view.name)}><span class="nav-icon">{view.icon}</span><em>{view.name}</em></button>;
  return <div class="space-shell" classList={{collapsed:collapsed()}} style={{"--nav-w":(collapsed()?52:navWidth())+"px"}}>
    <aside class="nav">
      <header><div class="space-mark">S</div><em>GAIA Space</em><button class="nav-toggle" title={collapsed()?"Expand sidebar":"Collapse sidebar"} onClick={toggle}>{collapsed()?"»":"«"}</button></header>
      <nav><p class="nav-section">Personal</p>{personalViews.map(nav)}<p class="nav-section">Workspace</p>{workspaceViews.map(nav)}</nav>
    </aside>
    <Resizer width={navWidth} setWidth={setNavWidth} min={160} max={420}/>
    <main class="workspace"><Dynamic component={current().component}/></main>
    <Goto open={gotoOpen()} onClose={()=>setGotoOpen(false)} onNavigate={kind=>setActive(gotoView[kind])}/>
  </div>;
}
