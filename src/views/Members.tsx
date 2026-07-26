import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Members() { return <ResourceView title="Members" description="Organization profiles persisted by the platform module." load={api.listProfiles} primary={item => item.display_name as string} />; }
