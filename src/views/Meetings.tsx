import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Meetings() { return <ResourceView title="Meetings" description="Meeting records, recurrence RRULEs, and RSVP foundation." load={api.listMeetings} primary={item => item.title as string} />; }
