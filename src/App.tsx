import { createSignal, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import "./App.css";
import Projects from "./views/Projects";
import Repos from "./views/Repos";
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

const views: { name: string; icon: string; component: Component }[] = [
  { name: "Projects", icon: "◈", component: Projects }, { name: "Repos", icon: "⌘", component: Repos },
  { name: "Issues", icon: "✓", component: Issues }, { name: "Boards", icon: "▦", component: Boards },
  { name: "Chat", icon: "◌", component: Chat }, { name: "Documents", icon: "▤", component: Documents },
  { name: "Meetings", icon: "◷", component: Meetings }, { name: "Calendar", icon: "□", component: Calendar },
  { name: "Packages", icon: "◇", component: Packages }, { name: "Pipelines", icon: "▷", component: Pipelines },
  { name: "Members", icon: "♙", component: Members }, { name: "Admin", icon: "⚙", component: Admin },
];

export default function App() {
  const [active, setActive] = createSignal("Projects");
  const current = () => views.find(view => view.name === active())!;
  return <div class="space-shell"><aside class="nav-rail"><div class="space-mark">S</div><nav>{views.map(view => <button title={view.name} classList={{ active: active() === view.name }} onClick={() => setActive(view.name)}><span>{view.icon}</span><em>{view.name}</em></button>)}</nav></aside><aside class="nav-panel"><header>GAIA Space</header><p class="nav-section">Workspace</p>{views.map(view => <button classList={{ active: active() === view.name }} onClick={() => setActive(view.name)}>{view.name}</button>)}</aside><main class="workspace"><Dynamic component={current().component} /></main></div>;
}
