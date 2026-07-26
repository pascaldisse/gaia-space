import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Admin() { return <ResourceView title="Admin" description="Roles and rights foundation." load={api.listRoles} primary={item => item.name as string} />; }
