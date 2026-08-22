import { invoke } from "@tauri-apps/api/core";
const call=<T>(command:string,args:Record<string,unknown>={})=>invoke<T>(command,args);
export type Devfile={id:string;project_id:string;path:string;name:string;content:string;generated:boolean;updated_at:number};
export type IdeLaunch={url:string;ide:string;repository:string};
export type Application={id:string;name:string;description:string|null;application_type:"Application"|"InternalApp"|"MarketplaceApp"|"FeaturedIntegration";endpoint_uri:string|null;client_id:string;client_credentials_flow_enabled:boolean;code_flow_enabled:boolean;pkce_required:boolean;connection_status:"CONNECTING"|"FAILED_TO_CONNECT"|"RECONNECTING"|"CONNECTED";archived:boolean};
export type WebhookSubscription={id:string;application_id:string;event_type:string;filters_json:string|null;endpoint_uri:string;enabled:boolean};
export type ChatbotRegistration={id:string;application_id:string;display_name:string;description:string|null;commands_json:string;enabled:boolean};
export type UiExtension={id:string;application_id:string;extension_type:string;display_name:string;unique_code:string;iframe_url:string|null;enabled:boolean};
export const applicationsApi={
 devfiles:(project_id?:string)=>call<Devfile[]>("list_devfiles",{projectId:project_id??null}), saveDevfile:(value:Devfile)=>call<Devfile>("save_devfile",{value}), deleteDevfile:(id:string)=>call<void>("delete_devfile",{id}), openInIde:(repository:string,ide:string)=>call<IdeLaunch>("open_in_ide",{repository,ide}),
 applications:()=>call<Application[]>("list_applications"), saveApplication:(value:Application)=>call<Application>("save_application",{value}), deleteApplication:(id:string)=>call<void>("delete_application",{id}),
 webhooks:(application_id:string)=>call<WebhookSubscription[]>("list_webhooks",{applicationId:application_id}), saveWebhook:(value:WebhookSubscription)=>call<WebhookSubscription>("save_webhook",{value}), deleteWebhook:(id:string)=>call<void>("delete_webhook",{id}),
 chatbots:(application_id:string)=>call<ChatbotRegistration[]>("list_chatbots",{applicationId:application_id}), saveChatbot:(value:ChatbotRegistration)=>call<ChatbotRegistration>("save_chatbot",{value}), deleteChatbot:(id:string)=>call<void>("delete_chatbot",{id}),
 extensions:(application_id:string)=>call<UiExtension[]>("list_ui_extensions",{applicationId:application_id}), saveExtension:(value:UiExtension)=>call<UiExtension>("save_ui_extension",{value}), deleteExtension:(id:string)=>call<void>("delete_ui_extension",{id}),
};
