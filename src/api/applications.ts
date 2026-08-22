import { invoke } from "@tauri-apps/api/core";
const call=<T>(command:string,args:Record<string,unknown>={})=>invoke<T>(command,args);
export type Devfile={id:string;project_id:string;path:string;name:string;content:string;generated:boolean;updated_at:number};
export type IdeLaunch={url:string;ide:string;repository:string};
export type IdeSession={id:string;ide:string;repositories:string[];last_seen_at:number};
export type Application={id:string;name:string;description:string|null;application_type:"Application"|"InternalApp"|"MarketplaceApp"|"FeaturedIntegration";endpoint_uri:string|null;client_id:string;client_credentials_flow_enabled:boolean;code_flow_enabled:boolean;pkce_required:boolean;connection_status:"CONNECTING"|"FAILED_TO_CONNECT"|"RECONNECTING"|"CONNECTED";archived:boolean};
export type WebhookSubscription={id:string;application_id:string;event_type:string;filters_json:string|null;endpoint_uri:string;enabled:boolean;secret:string|null;max_attempts:number};
export type WebhookDelivery={id:string;webhook_id:string;payload_json:string;status:"PENDING"|"SUCCEEDED"|"FAILED";attempts:number;response_status:number|null;last_error:string|null;created_at:number;delivered_at:number|null;next_attempt_at:number|null};
export type WebhookSecretMeta={id:string;webhook_id:string;state:"ACTIVE"|"RETIRING";created_at:number;expires_at:number|null};
/** `secret` is presented exactly once, here; the listing never repeats it. */
export type RotatedWebhookSecret={webhook_id:string;secret:string;previous_expires_at:number|null;overlap_seconds:number};
export type RightDto={right_code:string;title:string;right_type:string;request_in_authorized_contexts:boolean};
export type AuthorizedRight={right_code:string;context_identifier:string;granted_by:string|null;comment:string;granted_at:number};
export type ScopeApprovalStatus={application_id:string;context_identifier:string;status:"APPROVED"|"PARTIAL"|"PENDING"|"NOT_REQUESTED";approved:string[];pending:string[];unrequested:string[]};
export type CommandDetail={name:string;description:string};
export type CommandListing={chatbot_id:string;application_id:string;commands:CommandDetail[];source:"app"|"registration";error:string|null};
export type ChatbotRegistration={id:string;application_id:string;display_name:string;description:string|null;commands_json:string;enabled:boolean};
export type UiExtension={id:string;application_id:string;extension_type:string;display_name:string;unique_code:string;iframe_url:string|null;enabled:boolean};
export type AppSshKey={application_id:string;fingerprint:string;public_key:string;comment:string;created_at:number};
export type AppGpgKey={application_id:string;fingerprint:string;public_key:string;revoked_at:number|null;created_at:number};
export type AppSecret={application_id:string;client_id:string;client_secret:string};
export type AppToken={id:string;application_id:string;scope:string;expires_at:number|null;access_token:string|null};
/** Closed typed payload family delivered to an application's own endpoint (`className` tag). */
export type ApplicationPayload=
{className:"InitPayload";serverUrl:string;clientId:string;clientSecret?:string|null;userId?:string|null;state?:string|null}
|{className:"WebhookRequestPayload";webhookId:string;eventType:string;payload:unknown}
|{className:"MessagePayload";userId:string;channelId:string;messageId?:string|null;text:string}
|{className:"ListCommandsPayload";userId:string;prefix?:string|null}
|{className:"MenuActionPayload";actionId:string;userId:string;context?:string|null}
|{className:"UnfurlActionPayload";userId:string;links:string[]}
|{className:"CustomPayload";userId?:string|null;data:unknown}
|{className:"ApplicationUninstalledPayload";serverUrl:string;userId?:string|null}
|{className:"ExternalIssuePayload";issueIds:string[];action:string};
/** Public half of the app's Ed25519 signing pair; the private key is never returned. */
export type AppSigningKey={application_id:string;key_id:string;public_key:string;previous_key_id:string|null;previous_public_key:string|null;created_at:number};
export type AppDispatch={application_id:string;class_name:string;endpoint_uri:string;key_id:string;signature:string;timestamp:number;response_status:number|null;response_body:string|null;error:string|null};
export type MarketplaceApp={id:string;name:string;vendor:string;description:string|null;capabilities_json:string;compatibility:string|null;listing_url:string|null};
export type AppInstall={id:string;marketplace_app_id:string|null;application_id:string;install_kind:"MARKETPLACE"|"LINK"|"MANUAL"|"JENKINS"|"TEAMCITY";installed_by:string|null;installed_at:number};
/** External bearer-token API paths; use the issued token in `Authorization: Bearer …`. */
export const appHttpApi={me:"/api/app/me",projects:"/api/app/projects"} as const;
export const applicationsApi={
rotateAppSecret:(application_id:string)=>call<AppSecret>("rotate_app_secret",{applicationId:application_id}),
addSshKey:(application_id:string,public_key:string,comment?:string)=>call<AppSshKey>("add_app_ssh_key",{applicationId:application_id,publicKey:public_key,comment:comment??null}), sshKeys:(application_id:string)=>call<AppSshKey[]>("list_app_ssh_keys",{applicationId:application_id}), deleteSshKey:(application_id:string,fingerprint:string)=>call<void>("delete_app_ssh_key",{applicationId:application_id,fingerprint}),
addGpgKey:(application_id:string,public_key:string)=>call<AppGpgKey>("add_app_gpg_key",{applicationId:application_id,publicKey:public_key}), gpgKeys:(application_id:string)=>call<AppGpgKey[]>("list_app_gpg_keys",{applicationId:application_id}), deleteGpgKey:(application_id:string,fingerprint:string)=>call<void>("delete_app_gpg_key",{applicationId:application_id,fingerprint}), revokeGpgKey:(application_id:string,fingerprint:string)=>call<AppGpgKey>("revoke_app_gpg_key",{applicationId:application_id,fingerprint}),
issueAppToken:(client_id:string,client_secret:string,scope?:string,ttl_seconds?:number)=>call<AppToken>("issue_app_token",{clientId:client_id,clientSecret:client_secret,scope:scope??null,ttlSeconds:ttl_seconds??null}),
verifyAppToken:(token:string)=>call<AppToken|null>("verify_app_token",{token}),
revokeAppToken:(id:string)=>call<void>("revoke_app_token",{id}),
appTokens:(application_id:string)=>call<AppToken[]>("list_app_tokens",{applicationId:application_id}),
signingKey:(application_id:string)=>call<AppSigningKey>("app_signing_key",{applicationId:application_id}),
rotateSigningKey:(application_id:string)=>call<AppSigningKey>("rotate_app_signing_key",{applicationId:application_id}),
payloadClasses:()=>call<string[]>("application_payload_classes"),
parsePayload:(payload:ApplicationPayload|string)=>call<string>("parse_application_payload",{payloadJson:typeof payload==="string"?payload:JSON.stringify(payload)}),
dispatchPayload:(application_id:string,payload:ApplicationPayload|string)=>call<AppDispatch>("dispatch_application_payload",{applicationId:application_id,payloadJson:typeof payload==="string"?payload:JSON.stringify(payload)}),
marketplaceApps:()=>call<MarketplaceApp[]>("list_marketplace_apps"), saveMarketplaceApp:(value:MarketplaceApp)=>call<MarketplaceApp>("save_marketplace_app",{value}),
installMarketplaceApp:(value:AppInstall)=>call<AppInstall>("install_marketplace_app",{value}), appInstalls:()=>call<AppInstall[]>("list_app_installs"), uninstallApp:(id:string)=>call<void>("uninstall_app",{id}),
 devfiles:(project_id?:string)=>call<Devfile[]>("list_devfiles",{projectId:project_id??null}), saveDevfile:(value:Devfile)=>call<Devfile>("save_devfile",{value}), deleteDevfile:(id:string)=>call<void>("delete_devfile",{id}), openInIde:(repository:string,ide:string)=>call<IdeLaunch>("open_in_ide",{repository,ide}), ideSessions:()=>call<IdeSession[]>("list_ide_sessions"), reportIdeSession:(value:IdeSession)=>call<IdeSession>("report_ide_session",{value}),
 applications:()=>call<Application[]>("list_applications"), eventTypes:()=>call<string[]>("list_event_types"), saveApplication:(value:Application)=>call<Application>("save_application",{value}), deleteApplication:(id:string)=>call<void>("delete_application",{id}),
 webhooks:(application_id:string)=>call<WebhookSubscription[]>("list_webhooks",{applicationId:application_id}), saveWebhook:(value:WebhookSubscription)=>call<WebhookSubscription>("save_webhook",{value}), deleteWebhook:(id:string)=>call<void>("delete_webhook",{id}), deliverWebhook:(webhook_id:string,payload_json:string)=>call<WebhookDelivery>("deliver_webhook",{webhookId:webhook_id,payloadJson:payload_json}), retryWebhookDelivery:(id:string)=>call<WebhookDelivery>("retry_webhook_delivery",{id}), processWebhookQueue:(limit=25)=>call<WebhookDelivery[]>("process_webhook_queue",{limit}), webhookDeliveries:(webhook_id:string)=>call<WebhookDelivery[]>("list_webhook_deliveries",{webhookId:webhook_id}),
rotateWebhookSecret:(webhook_id:string,overlap_seconds?:number)=>call<RotatedWebhookSecret>("rotate_webhook_secret",{webhookId:webhook_id,overlapSeconds:overlap_seconds??null}), webhookSecrets:(webhook_id:string)=>call<WebhookSecretMeta[]>("list_webhook_secrets",{webhookId:webhook_id}),
 chatbots:(application_id:string)=>call<ChatbotRegistration[]>("list_chatbots",{applicationId:application_id}), saveChatbot:(value:ChatbotRegistration)=>call<ChatbotRegistration>("save_chatbot",{value}), deleteChatbot:(id:string)=>call<void>("delete_chatbot",{id}),
 rightCatalog:()=>call<RightDto[]>("application_right_catalog"),
 requiredRights:(application_id:string)=>call<RightDto[]>("get_required_rights",{applicationId:application_id}),
 updateRequiredRights:(application_id:string,add:string[],remove:string[],in_contexts=false)=>call<RightDto[]>("update_required_rights",{applicationId:application_id,rightCodesToAdd:add,rightCodesToRemove:remove,requestRightsInAuthorizedContexts:in_contexts}),
 requestRights:(application_id:string,right_codes:string[])=>call<RightDto[]>("request_rights",{applicationId:application_id,rightCodes:right_codes}),
 authorizedRights:(application_id:string,context_identifier:string)=>call<AuthorizedRight[]>("get_authorized_rights",{applicationId:application_id,contextIdentifier:context_identifier}),
 updateAuthorizedRights:(application_id:string,context_identifier:string,rights:string[],actor?:string,comment?:string)=>call<AuthorizedRight[]>("update_authorized_rights",{applicationId:application_id,contextIdentifier:context_identifier,rights,actor:actor??null,comment:comment??null}),
 scopeApprovalStatus:(application_id:string,context_identifier:string)=>call<ScopeApprovalStatus>("scope_approval_status",{applicationId:application_id,contextIdentifier:context_identifier}),
 approveScope:(application_id:string,context_identifier:string,actor?:string,comment?:string)=>call<ScopeApprovalStatus>("approve_scope",{applicationId:application_id,contextIdentifier:context_identifier,actor:actor??null,comment:comment??null}),
 chatbotCommands:(chatbot_id:string,user_id:string,prefix?:string)=>call<CommandListing>("list_chatbot_commands",{chatbotId:chatbot_id,userId:user_id,prefix:prefix??null}),
 extensions:(application_id:string)=>call<UiExtension[]>("list_ui_extensions",{applicationId:application_id}), saveExtension:(value:UiExtension)=>call<UiExtension>("save_ui_extension",{value}), deleteExtension:(id:string)=>call<void>("delete_ui_extension",{id}),
};
