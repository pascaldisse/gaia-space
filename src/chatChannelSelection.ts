import { createSignal } from "solid-js";
import type { ChannelSummary } from "./api/chat";

export type SelectedChannel = ChannelSummary & { headerLabel?: string; avatarUrl?: string | null };
const [selectedChannel, setSelectedChannel] = createSignal<SelectedChannel | null>(null);
export { selectedChannel, setSelectedChannel };
