import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Packages() { return <ResourceView title="Packages" description="Package repositories across Space-supported formats." load={api.listPackageRepositories} primary={item => item.name as string} />; }
