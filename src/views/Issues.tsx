import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Issues() { return <ResourceView title="Issues" description="Standalone issue records from the planning tracker." load={api.listIssues} primary={item => `#${item.number} ${item.title}`} />; }
