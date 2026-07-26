import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Pipelines() { return <ResourceView title="Pipelines" description="Automation scripts; jobs remain parallel by design." load={api.listPipelineScripts} primary={item => item.path as string} />; }
