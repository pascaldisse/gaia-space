import { createResource, createSignal, For, Show } from "solid-js";
import { appHttpApi, applicationsApi, type AppDispatch, type AppInstall, type AppSecret, type AppSigningKey, type AppToken, type Application, type ChatbotRegistration, type CommandListing, type RightDto, type ScopeApprovalStatus, type Devfile, type MarketplaceApp, type UiExtension, type WebhookSubscription, type WebhookDelivery, type RotatedWebhookSecret } from "../api/applications";
import { platformApi } from "../api/platform";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import { GhostPill, PillSelect } from "../components/controls";
import "./Applications.css";
import "./operatorForm.css";

/** A picker's resting value IS its label, so the label has to be words. These
 *  four lists were printing wire identifiers at the operator as the control's
 *  own visible text. Stored values untouched. */
const APP_TYPES = ["Application","InternalApp","MarketplaceApp","FeaturedIntegration"] as const;
const appTypeLabel = (type: string): string =>
  type === "InternalApp" ? "Internal app"
  : type === "MarketplaceApp" ? "Marketplace app"
  : type === "FeaturedIntegration" ? "Featured integration"
  : "Application";
const payloadClassLabel = (name: string): string =>
  name.replace(/Payload$/, "").replace(/(?!^)([A-Z])/g, " $1");
const id=(kind:string)=>`${kind}-${crypto.randomUUID?.()??`${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const blankApp=():Application=>({id:id("app"),name:"",description:null,application_type:"Application",endpoint_uri:null,client_id:"",client_credentials_flow_enabled:true,code_flow_enabled:false,pkce_required:false,connection_status:"CONNECTING",archived:false,owner_profile_id:null,owner_application_id:null});
export default function Applications(){
 const [error,setError]=createSignal(""); const [delivery,setDelivery]=createSignal<WebhookDelivery|null>(null); const [rotated,setRotated]=createSignal<RotatedWebhookSecret|null>(null); const [selected,setSelected]=createSignal<Application|null>(null); const [appForm,setAppForm]=createSignal(blankApp()); const [repoPath,setRepoPath]=createSignal(""); const [ide,setIde]=createSignal("JetBrains Gateway");
 const [apps,{refetch:reloadApps}]=createResource(applicationsApi.applications); const [ideSessions]=createResource(applicationsApi.ideSessions); const [projects]=createResource(platformApi.projects); const [projectId,setProjectId]=createSignal(""); const [devfiles,{refetch:reloadDevfiles}]=createResource(projectId,projectId=>projectId?applicationsApi.devfiles(projectId):Promise.resolve([] as Devfile[]));
 const [hookEvents,setHookEvents]=createSignal<string[]>([]); const [hookFilters,setHookFilters]=createSignal("");
const [eventTypes]=createResource(applicationsApi.eventTypes);
 const [webhooks,{refetch:reloadWebhooks}]=createResource(()=>selected()?.id,id=>id?applicationsApi.webhooks(id):Promise.resolve([] as WebhookSubscription[])); const [bots,{refetch:reloadBots}]=createResource(()=>selected()?.id,id=>id?applicationsApi.chatbots(id):Promise.resolve([] as ChatbotRegistration[])); const [extensions,{refetch:reloadExtensions}]=createResource(()=>selected()?.id,id=>id?applicationsApi.extensions(id):Promise.resolve([] as UiExtension[]));
 // OAuth credentials + marketplace installs for the selected application.
 const [secret,setSecret]=createSignal<AppSecret|null>(null); const [issued,setIssued]=createSignal<AppToken|null>(null); const [scope,setScope]=createSignal("read");
 const [tokens,{refetch:reloadTokens}]=createResource(()=>selected()?.id,id=>id?applicationsApi.appTokens(id):Promise.resolve([] as AppToken[]));
const [signingKey,{refetch:reloadSigningKey}]=createResource(()=>selected()?.id,id=>id?applicationsApi.signingKey(id):Promise.resolve(null as AppSigningKey|null));
const [payloadClasses]=createResource(applicationsApi.payloadClasses);
const [payloadClass,setPayloadClass]=createSignal("InitPayload");
const [dispatched,setDispatched]=createSignal<AppDispatch|null>(null);
// Slash-menu preview: asks the bot's own endpoint the way a channel would.
const [slashPrefix,setSlashPrefix]=createSignal("/"); const [commands,setCommands]=createSignal<CommandListing|null>(null);
// Two-stage app rights: the declared list is the app's, the grant is the admin's.
const [rightContext,setRightContext]=createSignal("org"); const [approval,setApproval]=createSignal<ScopeApprovalStatus|null>(null);
const [rightCatalog]=createResource(applicationsApi.rightCatalog);
const [requiredRights,{refetch:reloadRequiredRights}]=createResource(()=>selected()?.id,id=>id?applicationsApi.requiredRights(id):Promise.resolve([] as RightDto[]));
const declareRight=async(code:string,declared:boolean)=>{try{const id=selectedId(); if(!id)return; await applicationsApi.updateRequiredRights(id,declared?[code]:[],declared?[]:[code],true); reloadRequiredRights(); await refreshApproval();}catch(e){setError(String(e));}};
const refreshApproval=async()=>{try{const id=selectedId(); if(!id)return; setApproval(await applicationsApi.scopeApprovalStatus(id,rightContext()));}catch(e){setError(String(e));}};
const approveScope=async()=>{try{const id=selectedId(); if(!id)return; setApproval(await applicationsApi.approveScope(id,rightContext(),"default-org","approved from the applications view"));}catch(e){setError(String(e));}};
const revokeScope=async()=>{try{const id=selectedId(); if(!id)return; await applicationsApi.updateAuthorizedRights(id,rightContext(),[],"default-org","revoked"); await refreshApproval();}catch(e){setError(String(e));}};
const previewCommands=async(chatbotId:string)=>{try{setCommands(await applicationsApi.chatbotCommands(chatbotId,"default-org",slashPrefix()));}catch(e){setError(String(e));}};
 const [market,{refetch:reloadMarket}]=createResource(applicationsApi.marketplaceApps); const [installs,{refetch:reloadInstalls}]=createResource(applicationsApi.appInstalls); const [listingName,setListingName]=createSignal(""); const [listingVendor,setListingVendor]=createSignal(""); const [trackerName,setTrackerName]=createSignal("External ticket tracker");
 const rotateSecret=async()=>{try{const app=selected();if(!app)return;setIssued(null);setSecret(await applicationsApi.rotateAppSecret(app.id));await reloadTokens();}catch(e){setError(String(e));}};
 const issueToken=async()=>{try{const current=secret();if(!current)throw new Error("Generate a client secret first.");setIssued(await applicationsApi.issueAppToken(current.client_id,current.client_secret,scope()||undefined));await reloadTokens();}catch(e){setError(String(e));}};
 const revokeToken=async(tokenId:string)=>{try{await applicationsApi.revokeAppToken(tokenId);await reloadTokens();}catch(e){setError(String(e));}};
 const addListing=async()=>{try{const name=listingName().trim();const vendor=listingVendor().trim();if(!name||!vendor)throw new Error("Marketplace listing name and vendor are required.");await applicationsApi.saveMarketplaceApp({id:id("market"),name,vendor,description:null,capabilities_json:'["webhooks"]',compatibility:"Space 1.x",listing_url:null});setListingName("");setListingVendor("");await reloadMarket();}catch(e){setError(String(e));}};
const linkExternalTracker=async()=>{try{const app=selected();if(!app)throw new Error("Select an application to link an external issue tracker.");const endpoint=app.endpoint_uri?.trim();if(!endpoint)throw new Error("The selected application needs an HTTPS tracker URL.");await applicationsApi.saveExtension({id:id("tracker"),application_id:app.id,extension_type:"ExternalIssueTracker",display_name:trackerName().trim()||"External ticket tracker",unique_code:`external-tracker-${app.id}`,iframe_url:endpoint,enabled:true});await reloadExtensions();}catch(e){setError(String(e));}};
 const install=async(app:MarketplaceApp,kind:AppInstall["install_kind"])=>{try{const target=selected();if(!target)throw new Error("Select an application to install into.");await applicationsApi.installMarketplaceApp({id:id("install"),marketplace_app_id:kind==="MARKETPLACE"?app.id:null,application_id:target.id,install_kind:kind,installed_by:null,installed_at:0});await reloadInstalls();}catch(e){setError(String(e));}};
 const uninstall=async(installId:string)=>{try{await applicationsApi.uninstallApp(installId);await reloadInstalls();}catch(e){setError(String(e));}};
 const rotateSigningKey=async()=>{try{const app=selected();if(!app)return;await applicationsApi.rotateSigningKey(app.id);await reloadSigningKey();}catch(e){setError(String(e));}};
// Sample payload per class: enough to be accepted by the typed Rust parser.
const samplePayload=(className:string,app:Application):string=>{const server=window.location.origin;const bodies:Record<string,unknown>={InitPayload:{className,serverUrl:server,clientId:app.client_id},WebhookRequestPayload:{className,webhookId:"preview",eventType:"issue.created",payload:{}},MessagePayload:{className,userId:"me",channelId:"preview",text:"/help"},ListCommandsPayload:{className,userId:"me"},MenuActionPayload:{className,actionId:"preview",userId:"me"},UnfurlActionPayload:{className,userId:"me",links:[server]},CustomPayload:{className,data:{}},ApplicationUninstalledPayload:{className,serverUrl:server},ExternalIssuePayload:{className,issueIds:["E-1"],action:"IMPORT"}};return JSON.stringify(bodies[className]??{className});};
const dispatchPayload=async()=>{try{const app=selected();if(!app)return;setDispatched(await applicationsApi.dispatchPayload(app.id,samplePayload(payloadClass(),app)));}catch(e){setDispatched(null);setError(String(e));}};
const saveApp=async()=>{try{const saved=await applicationsApi.saveApplication(appForm());setSelected(saved);setAppForm(blankApp());reloadApps();}catch(e){setError(String(e));}};
 const saveDevfile=async()=>{try{if(!projectId())throw new Error("Choose a project first.");const project=projects()?.find(p=>p.id===projectId());await applicationsApi.saveDevfile({id:id("devfile"),project_id:projectId(),path:".space/default.devfile.yaml",name:project?.name??"Dev setup",content:"schemaVersion: 2.2.0\nmetadata:\n  name: development\n",generated:false,updated_at:0});reloadDevfiles();}catch(e){setError(String(e));}};
 const openIde=async()=>{try{const launch=await applicationsApi.openInIde(repoPath(),ide());window.location.assign(launch.url);}catch(e){setError(String(e));}};
 const selectedId=()=>selected()?.id??"";
 const toggleHookEvent=(event:string,checked:boolean)=>setHookEvents(current=>checked?[...current,event]:current.filter(value=>value!==event));
const saveWebhook=async()=>{try{if(!selectedId())return;const chosen=hookEvents();const available=eventTypes()??[];if(!chosen.length||chosen.some(event=>!available.includes(event)))throw new Error("Choose one or more supported event types.");await Promise.all(chosen.map(event_type=>applicationsApi.saveWebhook({id:id("webhook"),application_id:selectedId(),event_type,filters_json:hookFilters().trim()||null,endpoint_uri:selected()?.endpoint_uri??"https://example.invalid/webhook",enabled:true,secret:null,max_attempts:5})));reloadWebhooks();}catch(e){setError(String(e));}};
 const deliverWebhook=async(webhook_id:string)=>{try{setDelivery(await applicationsApi.deliverWebhook(webhook_id,JSON.stringify({event:"IssueWebhookEvent",sentAt:new Date().toISOString()})));}catch(e){setError(String(e));}};
// The rotated secret is held in view state only: it is shown once and never re-fetched.
const rotateWebhookSecret=async(webhook_id:string)=>{try{setRotated(await applicationsApi.rotateWebhookSecret(webhook_id));reloadWebhooks();}catch(e){setError(String(e));}};
const retryDelivery=async(id:string)=>{try{setDelivery(await applicationsApi.retryWebhookDelivery(id));}catch(e){setError(String(e));}};
const drainQueue=async()=>{try{const done=await applicationsApi.processWebhookQueue();setDelivery(done[0]??delivery());setError(done.length?"":"No deliveries are due for retry.");}catch(e){setError(String(e));}};
const saveBot=async()=>{try{if(!selectedId())return;await applicationsApi.saveChatbot({id:id("bot"),application_id:selectedId(),display_name:"Space bot",description:"Registered chatbot",commands_json:'[{"name":"help","description":"Show help"}]',enabled:true});reloadBots();}catch(e){setError(String(e));}};
 const saveExtension=async()=>{try{if(!selectedId())return;await applicationsApi.saveExtension({id:id("extension"),application_id:selectedId(),extension_type:"TopLevelPage",display_name:"Application page",unique_code:`app-page-${Date.now()}`,iframe_url:selected()?.endpoint_uri??null,enabled:true});reloadExtensions();}catch(e){setError(String(e));}};
  /* ── THE VIEW ──────────────────────────────────────────────────────────────
   *
   *  This return was ONE 10,295-character line. Reformatting it is not tidying:
   *  it is the only way to see that the surface holds three panels, four
   *  pickers that print raw enum values, a dozen loose inputs with no names,
   *  and — until this commit — not a single empty state anywhere. The
   *  structure below is byte-for-byte the same elements in the same order.
   */
  return (
    <section class="apps-view">
      <PageHeader
        title="Applications"
        subline="Integrations, webhooks, bots and OAuth clients"
      />
      <Show when={error()}><p class="apps-error">{error()}</p></Show>

      <div class="apps-grid">
        {/* ── panel 1: the applications themselves ───────────────────────── */}
        <section class="apps-panel">
          <h2>Applications</h2>
          {/* Stays on the surface: Applications is an operator tool and an
              administrator registers integrations in runs (L3 relaxed, L4 in
              full). */}
          <div class="apps-form op-form">
            <input class="op-input op-grow" aria-label="Application name" placeholder="Application name" value={appForm().name} onInput={e=>setAppForm({...appForm(),name:e.currentTarget.value})}/>
            <input class="op-input op-grow" aria-label="Client ID" placeholder="Client ID" value={appForm().client_id} onInput={e=>setAppForm({...appForm(),client_id:e.currentTarget.value})}/>
            <input class="op-input op-grow" aria-label="Endpoint URL" placeholder="https://app.example/endpoint" value={appForm().endpoint_uri??""} onInput={e=>setAppForm({...appForm(),endpoint_uri:e.currentTarget.value||null})}/>
            <PillSelect label="Application type" value={appForm().application_type} onChange={value=>setAppForm({...appForm(),application_type:value as Application["application_type"]})}>
              <For each={APP_TYPES}>{type=><option value={type}>{appTypeLabel(type)}</option>}</For>
            </PillSelect>
            <button class="primary" onClick={saveApp}>Register application</button>
          </div>
          {/* Applications had NO empty state at all: with nothing registered the
              panel was a heading over a void. */}
          <Show when={!apps.loading && !(apps()??[]).length}>
            <EmptyState
              title="No applications registered yet"
              hint="An application is an integration that talks to GAIA Space over webhooks, a bot or the OAuth API."
              actions={<button class="primary" type="button" onClick={()=>document.querySelector<HTMLInputElement>('.apps-view input[aria-label="Application name"]')?.focus()}>Register an application</button>}
            />
          </Show>
          <ul class="apps-list">
            <For each={apps()}>{app=>
              <li classList={{active:selectedId()===app.id}} onClick={()=>setSelected(app)}>
                <strong>{app.name}</strong>
                <span>{app.application_type} · {app.connection_status}</span>
              </li>
            }</For>
          </ul>
        </section>

        {/* ── panel 2: devfile + open in IDE ─────────────────────────────── */}
        <section class="apps-panel">
          <h2>Devfile &amp; Open in IDE</h2>
          <div class="op-form">
            <PillSelect label="Project" value={projectId()} onChange={setProjectId}>
              <option value="">Project…</option>
              <For each={projects()}>{project=><option value={project.id}>{project.name}</option>}</For>
            </PillSelect>
            <GhostPill onClick={saveDevfile}>Add default .space devfile</GhostPill>
          </div>
          <Show when={projectId() && !devfiles.loading && !(devfiles()??[]).length}>
            <EmptyState title="No devfile in this project" hint="A devfile describes the workspace a dev environment starts from." />
          </Show>
          <ul class="apps-list">
            <For each={devfiles()}>{file=>
              <li>
                <strong>{file.path}</strong>
                <span>{file.generated?"generated":"repo metadata"}</span>
                <GhostPill onClick={()=>applicationsApi.deleteDevfile(file.id).then(reloadDevfiles)}>Remove</GhostPill>
              </li>
            }</For>
          </ul>
          <div class="apps-form op-form">
            <input class="op-input op-grow" aria-label="Local repository path" placeholder="Local repository path" value={repoPath()} onInput={e=>setRepoPath(e.currentTarget.value)}/>
            <PillSelect label="IDE" value={ide()} onChange={setIde}>
              <option>JetBrains Gateway</option>
              <option>IntelliJ IDEA</option>
              <option>WebStorm</option>
              <option>PyCharm</option>
            </PillSelect>
            <GhostPill onClick={openIde}>Open in IDE</GhostPill>
          </div>
          <Show when={ideSessions()?.length} fallback={<p class="apps-hint">No local IDE sessions reported.</p>}>
            <p class="apps-hint">Local IDE sessions:</p>
            <For each={ideSessions()}>{session=>
              <div class="extension-row">
                <strong>{session.ide}</strong>
                <span>{session.repositories.join(", ")||"no repository open"}</span>
                <For each={session.repositories}>{repository=>
                  <GhostPill onClick={()=>{setRepoPath(repository);setIde(session.ide)}}>Use</GhostPill>
                }</For>
              </div>
            }</For>
          </Show>
          <p class="apps-hint">Opens a JetBrains URL only after your click; GAIA Space never provisions a cloud VM.</p>
        </section>

        {/* ── panel 3: everything you can register ON one application ────── */}
        <section class="apps-panel apps-extensions">
          <h2>Extension registration</h2>
          {/* A missing SELECTION, not an empty store: the applications are one
              panel to the left, so nothing is offered here. */}
          <Show when={selected()} fallback={<EmptyState variant="no-match" title="No application selected" hint="Pick an application on the left to register its webhooks, bots, rights and UI." />}>
            <div class="extension-actions op-form">
              <fieldset class="hook-event-picker">
                <legend>Event types</legend>
                <For each={eventTypes()??[]}>{event=>
                  <label><input type="checkbox" value={event} checked={hookEvents().includes(event)} onChange={e=>toggleHookEvent(event,e.currentTarget.checked)}/>{event}</label>
                }</For>
              </fieldset>
              {/* A RAW JSON payload is the one field whose answer is genuinely
                  unguessable, so it keeps a caption and gets one honest line
                  saying what it expects. No filter builder is invented here —
                  that is a feature, not a sweep. */}
              {/* `.hook-filters` STAYS on the <input>, not on this wrapper:
                  applications.webhook-events.test.tsx addresses the field by
                  that class and writes a value into it. Moving the class up one
                  element made the test set `.value` on a <label>, which does
                  nothing. The test was right and the markup was wrong. */}
              <label class="op-field op-grow hook-filters-field">
                <span>Delivery filter</span>
                <input class="op-input hook-filters" placeholder={'{"issue.priority":"HIGH"}'} value={hookFilters()} onInput={e=>setHookFilters(e.currentTarget.value)}/>
              </label>
              <GhostPill onClick={saveWebhook}>+ Webhook</GhostPill>
              <GhostPill onClick={drainQueue}>Run retry queue</GhostPill>
              <GhostPill onClick={saveBot}>+ Chatbot</GhostPill>
              <GhostPill onClick={saveExtension}>+ UI extension</GhostPill>
            </div>
            <p class="op-hint">A filter is raw JSON matched against the event payload; leave it empty to receive every event of the chosen types.</p>

            <h3>Webhooks</h3>
            <For each={webhooks()}>{hook=>
              <p class="extension-row">
                <code>{hook.event_type}</code>
                <span>{hook.filters_json&&hook.filters_json!=="{}"?`filters ${hook.filters_json} · `:"no filters · "}{hook.endpoint_uri}{hook.secret?" · signed":" · unsigned"} · max {hook.max_attempts}</span>
                <GhostPill class="small" onClick={()=>void deliverWebhook(hook.id)}>Deliver test</GhostPill>
                <GhostPill class="small" onClick={()=>void rotateWebhookSecret(hook.id)}>Rotate secret</GhostPill>
                <GhostPill class="small" onClick={()=>applicationsApi.deleteWebhook(hook.id).then(reloadWebhooks)}>Remove</GhostPill>
              </p>
            }</For>
            <Show when={rotated()}>{value=>
              <p class="apps-hint">New signing secret <code>{value().secret}</code> — shown once.{value().previous_expires_at?` Previous secret keeps co-signing for ${value().overlap_seconds}s.`:""}</p>
            }</Show>
            <Show when={delivery()}>{item=>
              <p class="apps-hint">Delivery {item().status} · attempt {item().attempts}{item().response_status?` · HTTP ${item().response_status}`:""}{item().last_error?` · ${item().last_error}`:""}
                <Show when={item().status==="FAILED"}><GhostPill class="small" onClick={()=>void retryDelivery(item().id)}>Retry now</GhostPill></Show>
              </p>
            }</Show>

            <h3>Chatbots &amp; slash commands</h3>
            <div class="extension-actions op-form">
              <input class="op-input" aria-label="Slash prefix" placeholder="/de" value={slashPrefix()} onInput={e=>setSlashPrefix(e.currentTarget.value)}/>
            </div>
            <For each={bots()}>{bot=>
              <p class="extension-row">
                <strong>{bot.display_name}</strong>
                <span>{bot.commands_json}</span>
                <GhostPill class="small" onClick={()=>void previewCommands(bot.id)}>Slash menu</GhostPill>
                <GhostPill class="small" onClick={()=>applicationsApi.deleteChatbot(bot.id).then(reloadBots)}>Remove</GhostPill>
              </p>
            }</For>
            <Show when={commands()}>{listing=>
              <p class="apps-hint">{listing().source==="app"?"answered by the app endpoint":`declared fallback · ${listing().error??""}`}: {listing().commands.map(command=>`/${command.name} — ${command.description}`).join(" · ")||"no matching command"}</p>
            }</Show>

            <h3>Required &amp; authorized rights</h3>
            <div class="extension-actions op-form">
              <input class="op-input op-grow" aria-label="Rights context" placeholder="org | project:demo-project" value={rightContext()} onInput={e=>setRightContext(e.currentTarget.value)}/>
              <GhostPill onClick={refreshApproval}>Check scope</GhostPill>
              <GhostPill onClick={approveScope}>Approve scope</GhostPill>
              <GhostPill onClick={revokeScope}>Revoke all here</GhostPill>
            </div>
            <fieldset class="hook-event-picker">
              <legend>Declared required rights</legend>
              <For each={rightCatalog()??[]}>{right=>
                <label><input type="checkbox" value={right.right_code} checked={(requiredRights()??[]).some(declared=>declared.right_code===right.right_code)} onChange={e=>void declareRight(right.right_code,e.currentTarget.checked)}/>{right.title}</label>
              }</For>
            </fieldset>
            <Show when={approval()}>{status=>
              <p class="apps-hint">{status().context_identifier}: {status().status} · approved {status().approved.join(", ")||"none"} · pending {status().pending.join(", ")||"none"}{status().unrequested.length?` · granted but no longer declared: ${status().unrequested.join(", ")}`:""}</p>
            }</Show>

            <h3>OAuth credentials</h3>
            <div class="extension-actions op-form">
              <GhostPill onClick={rotateSecret}>Generate client secret</GhostPill>
              <input class="op-input" aria-label="Token scope" placeholder="Scope" value={scope()} onInput={e=>setScope(e.currentTarget.value)}/>
              <GhostPill onClick={issueToken}>Issue token</GhostPill>
            </div>
            <Show when={secret()}>{value=>
              <p class="apps-hint">client_id <code>{value().client_id}</code> · secret <code>{value().client_secret}</code> — shown once.</p>
            }</Show>
            <Show when={issued()}>{value=>
              <p class="apps-hint">access_token <code>{value().access_token}</code> · scope {value().scope||"(none)"} · bearer API <code>{appHttpApi.me}</code> / <code>{appHttpApi.projects}</code></p>
            }</Show>
            <For each={tokens()}>{token=>
              <p class="extension-row">
                <strong>{token.id}</strong>
                <span>{token.scope||"no scope"}</span>
                <GhostPill class="small" onClick={()=>void revokeToken(token.id)}>Revoke</GhostPill>
              </p>
            }</For>

            <h3>Payload signing key</h3>
            <Show when={signingKey()} fallback={<p class="apps-hint">No signing key yet.</p>}>{value=>
              <p class="apps-hint">key <code>{value()!.key_id}</code> · public key <code>{value()!.public_key}</code>{value()!.previous_public_key?<> · previous <code>{value()!.previous_public_key}</code> still verifies in-flight payloads</>:null}</p>
            }</Show>
            <div class="extension-actions op-form">
              <GhostPill onClick={rotateSigningKey}>Rotate signing key</GhostPill>
            </div>

            <h3>Typed payload dispatch</h3>
            <div class="extension-actions op-form">
              <PillSelect label="Payload class" value={payloadClass()} onChange={setPayloadClass}>
                <For each={payloadClasses()??[]}>{className=><option value={className}>{payloadClassLabel(className)}</option>}</For>
              </PillSelect>
              <GhostPill onClick={dispatchPayload}>Send to app endpoint</GhostPill>
            </div>
            <Show when={dispatched()}>{item=>
              <p class="apps-hint">{item().class_name} → {item().endpoint_uri} · signed with <code>{item().key_id}</code>{item().response_status?` · HTTP ${item().response_status}`:""}{item().error?` · ${item().error}`:""}</p>
            }</Show>

            <h3>Marketplace</h3>
            <div class="extension-actions op-form">
              <input class="op-input op-grow" aria-label="Marketplace listing name" placeholder="Listing name" value={listingName()} onInput={e=>setListingName(e.currentTarget.value)}/>
              <input class="op-input op-grow" aria-label="Marketplace vendor" placeholder="Vendor" value={listingVendor()} onInput={e=>setListingVendor(e.currentTarget.value)}/>
              <GhostPill onClick={addListing}>+ Listing</GhostPill>
            </div>
            <For each={market()}>{listing=>
              <p class="extension-row">
                <strong>{listing.name}</strong>
                <span>{listing.vendor} · {listing.capabilities_json}</span>
                <GhostPill class="small" onClick={()=>void install(listing,"MARKETPLACE")}>Install</GhostPill>
                <GhostPill class="small" onClick={()=>void install(listing,"MANUAL")}>Manual install</GhostPill>
              </p>
            }</For>
            <For each={installs()}>{item=>
              <p class="extension-row">
                <strong>{item.install_kind}</strong>
                <span>{item.application_id}</span>
                <GhostPill class="small" onClick={()=>void uninstall(item.id)}>Uninstall</GhostPill>
              </p>
            }</For>

            <h3>UI extension points</h3>
            <div class="extension-actions op-form">
              <input class="op-input op-grow" aria-label="External tracker name" placeholder="External tracker name" value={trackerName()} onInput={e=>setTrackerName(e.currentTarget.value)}/>
              <GhostPill onClick={linkExternalTracker}>Link external ticket tracker</GhostPill>
            </div>
            <For each={extensions()}>{extension=>
              <p class="extension-row">
                <strong>{extension.display_name}</strong>
                <span>{extension.extension_type} · {extension.iframe_url??"declarative"}</span>
                <GhostPill class="small" onClick={()=>applicationsApi.deleteExtension(extension.id).then(reloadExtensions)}>Remove</GhostPill>
              </p>
            }</For>
          </Show>
        </section>
      </div>
    </section>
  );
}
