import { invoke } from "@tauri-apps/api/core";
export type ChannelSubscription = { channel_id:string; profile_id:string; enabled:boolean };
export const channelFeedsApi = {
  list: (profileId:string) => invoke<ChannelSubscription[]>("list_channel_subscriptions", { profileId }),
  save: (value:ChannelSubscription) => invoke<ChannelSubscription>("save_channel_subscription", { value }),
};
