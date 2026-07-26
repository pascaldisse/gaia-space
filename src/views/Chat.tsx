import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Chat() { return <ResourceView title="Chat" description="Native channels persisted through the chat module." load={api.listChannels} primary={item => (item.name as string | null) ?? item.content_type as string} />; }
