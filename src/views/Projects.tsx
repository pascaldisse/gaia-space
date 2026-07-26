import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Projects() { return <ResourceView title="Projects" description="Projects persist as the Space container record." load={api.listProjects} primary={item => item.name as string} />; }
