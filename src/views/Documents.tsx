import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Documents() { return <ResourceView title="Documents" description="My Documents, project docs, and KB share one container model." load={api.listDocuments} primary={item => item.title as string} />; }
