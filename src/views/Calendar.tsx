import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Calendar() { return <ResourceView title="Calendar" description="Calendar is currently a persisted meeting projection." load={api.listMeetings} primary={item => item.title as string} />; }
