import { createRoot, createSignal } from "solid-js";
import type { Meeting } from "../api/meetings";
export type ChannelCallJoinRequest = { meeting: Meeting; audioOnly: boolean };
const state = createRoot(() => {
  const [pendingChannelCallJoin, setPendingChannelCallJoin] = createSignal<ChannelCallJoinRequest>();
  const requestChannelCallJoin = (request: ChannelCallJoinRequest) => setPendingChannelCallJoin(request);
  const consumeChannelCallJoin = (channelId: string) => {
    const request = pendingChannelCallJoin();
    if (!request || request.meeting.channel_id !== channelId) return undefined;
    setPendingChannelCallJoin(undefined);
    return request;
  };
  return { pendingChannelCallJoin, requestChannelCallJoin, consumeChannelCallJoin };
});
export const { pendingChannelCallJoin, requestChannelCallJoin, consumeChannelCallJoin } = state;
