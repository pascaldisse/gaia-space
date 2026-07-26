import { api } from "../api";
import { ResourceView } from "./ResourceView";
export default function Boards() { return <ResourceView title="Boards" description="Board records and their status mapping foundation." load={api.listBoards} primary={item => item.name as string} />; }
