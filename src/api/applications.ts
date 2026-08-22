import { invoke } from "@tauri-apps/api/core";
const call=<T>(command:string,args:Record<string,unknown>={})=>invoke<T>(command,args);
export type Devfile={id:string;project_id:string;path:string;name:string;content:string;generated:boolean;updated_at:number};
export type IdeLaunch={url:string;ide:string;repository:string};
export type Application={id:string;name:string;description:string|null;application_type:"Application"|"InternalApp"|"MarketplaceApp"|"FeaturedIntegration";endpoint_uri:string|null;client_id:string;client_credentials_flow_enabled:boolean;code_flow_enabled:boolean;pkce_required:boolean;connection_status:"CONNECTING"|"FAILED_TO_CONNECT"|"RECONNECTING"|"CONNECTED";archived:boolean};
export type WebhookSubscription={id:string;application_id:string;event_type:string;filters_json:string|null;endpoint_uri:string;enabled:boolean;secret:string|null;max_attempts:number};
export type WebhookDelivery={id:string;webhook_id:string;payload_json:string;status:"PENDING"|"SUCCEEDED"|"FAILED";attempts:number;response_status:number|null;last_error:string|null;created_at:number;delivered_at:number|null;next_attempt_at:number|null};
export type WebhookSecretMeta={id:string;webhook_id:string;state:"ACTIVE"|"RETIRING";created_at:number;expires_at:number|null};
/** `secret` is presented exactly once, here; the listing never repeats it. */
export type RotatedWebhookSecret={webhook_id:string;secret:string;previous_expires_at:number|null;overlap_seconds:number};
export type ChatbotRegistration={id:string;application_id:string;display_name:string;description:string|null;commands_json:string;enabled:boolean};
export type UiExtension={id:string;application_id:string;extension_type:string;display_name:string;unique_code:string;iframe_url:string|null;enabled:boolean};
export type AppSecret={application_id:string;client_id:string;client_secret:string};
export type AppToken={id:string;application_id:string;scope:string;expires_at:number|null;access_token:string|null};
export type MarketplaceApp={id:string;name:string;vendor:string;description:string|null;capabilities_json:string;compatibility:string|null;listing_url:string|null};
export type AppInstall={id:string;marketplace_app_id:string|null;application_id:string;install_kind:"MARKETPLACE"|"LINK"|"MANUAL"|"JENKINS"|"TEAMCITY";installed_by:string|null;installed_at:number};
/** External bearer-token API paths; use the issued token in `Authorization: Bearer …`. */
export const appHttpApi={me:"/api/app/me",projects:"/api/app/projects"} as const;
export const applicationsApi={
rotateAppSecret:(application_id:string)=>call<AppSecret>("rotate_app_secret",{applicationId:application_id}),
issueAppToken:(client_id:string,client_secret:string,scope?:string,ttl_seconds?:number)=>call<AppToken>("issue_app_token",{clientId:client_id,clientSecret:client_secret,scope:scope??null,ttlSeconds:ttl_seconds??null}),
verifyAppToken:(token:string)=>call<AppToken|null>("verify_app_token",{token}),
revokeAppToken:(id:string)=>call<void>("revoke_app_token",{id}),
appTokens:(application_id:string)=>call<AppToken[]>("list_app_tokens",{applicationId:application_id}),
marketplaceApps:()=>call<MarketplaceApp[]>("list_marketplace_apps"), saveMarketplaceApp:(value:MarketplaceApp)=>call<MarketplaceApp>("save_marketplace_app",{value}),
installMarketplaceApp:(value:AppInstall)=>call<AppInstall>("install_marketplace_app",{value}), appInstalls:()=>call<AppInstall[]>("list_app_installs"), uninstallApp:(id:string)=>call<void>("uninstall_app",{id}),
 devfiles:(project_id?:string)=>call<Devfile[]>("list_devfiles",{projectId:project_id??null}), saveDevfile:(value:Devfile)=>call<Devfile>("save_devfile",{value}), deleteDevfile:(id:string)=>call<void>("delete_devfile",{id}), openInIde:(repository:string,ide:string)=>call<IdeLaunch>("open_in_ide",{repository,ide}),
 applications:()=>call<Application[]>("list_applications"), saveApplication:(value:Application)=>call<Application>("save_application",{value}), deleteApplication:(id:string)=>call<void>("delete_application",{id}),
 webhooks:(application_id:string)=>call<WebhookSubscription[]>("list_webhooks",{applicationId:application_id}), saveWebhook:(value:WebhookSubscription)=>call<WebhookSubscription>("save_webhook",{value}), deleteWebhook:(id:string)=>call<void>("delete_webhook",{id}), deliverWebhook:(webhook_id:string,payload_json:string)=>call<WebhookDelivery>("deliver_webhook",{webhookId:webhook_id,payloadJson:payload_json}), retryWebhookDelivery:(id:string)=>call<WebhookDelivery>("retry_webhook_delivery",{id}), processWebhookQueue:(limit=25)=>call<WebhookDelivery[]>("process_webhook_queue",{limit}), webhookDeliveries:(webhook_id:string)=>call<WebhookDelivery[]>("list_webhook_deliveries",{webhookId:webhook_id}),
rotateWebhookSecret:(webhook_id:string,overlap_seconds?:number)=>call<RotatedWebhookSecret>("rotate_webhook_secret",{webhookId:webhook_id,overlapSeconds:overlap_seconds??null}), webhookSecrets:(webhook_id:string)=>call<WebhookSecretMeta[]>("list_webhook_secrets",{webhookId:webhook_id}),
 chatbots:(application_id:string)=>call<ChatbotRegistration[]>("list_chatbots",{applicationId:application_id}), saveChatbot:(value:ChatbotRegistration)=>call<ChatbotRegistration>("save_chatbot",{value}), deleteChatbot:(id:string)=>call<void>("delete_chatbot",{id}),
 extensions:(application_id:string)=>call<UiExtension[]>("list_ui_extensions",{applicationId:application_id}), saveExtension:(value:UiExtension)=>call<UiExtension>("save_ui_extension",{value}), deleteExtension:(id:string)=>call<void>("delete_ui_extension",{id}),
};
