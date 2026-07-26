# JetBrains Space — Dev Environments & Applications/Extensibility

Domain: Dev Environments module (cloud IDE backends) + Applications module (Space's
third-party extensibility platform: HTTP API, webhooks, chatbots/slash commands,
UI extensions, SDK, app install/permissions).
Sources: decompiled Android client at `~/Downloads/space-clients/android/jadx-out/sources/circlet/`
(routing/`client/api/apps/*`/`common/permissions/*` — Kotlin `@Metadata(d2=[...])`
strings give exact field/method names) + **live** docs (`jetbrains.com/help/space/*`
and `.com.cn` mirror — confirmed reachable 2026-07-26, not dead like some pages cited
in files 01-05) + `blog.jetbrains.com/space/*`. Cross-refs: 03's Automation (`.space.kts`,
job triggers, `JobDTO`) is **not** repeated here; 05's `appAuth` (app OAuth
consent/authorization-context model) and app permanent tokens are **not** repeated
here — only cross-referenced.

---

## 1. Feature Overview

### 1.1 Dev Environments

"[Dev environments](https://www.jetbrains.com/help/space/dev-environments.html)
are virtual machines running in the Space cloud. You can use these machines for
software development instead of your local machine: your local machine works as
a frontend... The dev environment works as a backend: it runs all heavy-weight
IDE operations." This is JetBrains' cloud remote-development product (internal
codename/right-prefix **`Rd`** = "Remote Development" — confirmed by the org
feature annotation `circlet.features.Rd` and every related right code being
prefixed `Rd.*`, e.g. `Rd.Workspaces.Create`, `Rd.CloudPolicy.edit`). Originally
launched as "Remote Development with Space" (blog, Nov 2021), later branded
"Dev Environments" in the UI/docs.

**⚠ Naming collision worth flagging explicitly**: in the decompiled client, the
right codes for dev-environment lifecycle use the word **"Workspaces"**
(`Rd.Workspaces.Create`, `Rd.Workspaces.Manage`, `Rd.Workspaces.View`,
`Rd.Workspaces.Unattended.Join`, `Fleet.Workspaces.Connect`) — this is **unrelated**
to the Android client's own `circlet.workspaces.*`/`circlet.platform.workspaces.*`
packages, which model a **Space organization/tenant** ("workspace" = which Space
org + server URL you're logged into, akin to a Slack workspace). Two completely
different concepts share the word "workspace" in this codebase; do not conflate
them in gaia-space's own model.

Supported backends (docs): **JetBrains Fleet** (thin client, lightweight IDE) and
**IntelliJ-based IDEs via JetBrains Gateway** (IntelliJ IDEA, CLion, GoLand,
PhpStorm, PyCharm Professional, RubyMine, WebStorm, Rider). Confirmed client-side
enum of installable desktop IDEs (`circlet.ide.JetBrainsIdeType`, common module):
`Unknown, IntelliJ IDEA, PhpStorm, PyCharm, WebStorm, Rider (jbProtocolHost
"JetBrains Rider"), GoLand, CLion, RubyMine` — used for the "which IDE do you have
installed / open repo in IDE" flow, not dev-environment-specific.

How it works (docs, `dev-environments.html` + `dev-environments-under-the-hood`
blog + `devfile.html` + `configure-warm-up.html`):
- Every project repository page has a **"Start coding"** button → New Dev
  Environment dialog: pick branch, instance type (`regular`/`large`/`xlarge`),
  IDE, create.
- A dev environment = **one dedicated VM** + **one Docker container** running
  inside it. Container image: either Space's default image (Git, cURL, Docker,
  Docker Compose, OpenJDK preinstalled) or a custom image built from a
  **Dockerfile in the repo**, configured via the **devfile**.
- **Devfile** (`.space/*.devfile.yaml`, or `.space/generated.devfile.yaml` if
  auto-generation is enabled) — Space supports a **feature subset of the open
  [devfile.io 2.2.0 spec](https://devfile.io/docs/devfile/2.2.0/user-guide/)**.
  Schema (from docs example): `schemaVersion: 2.2.0`, `metadata.name`,
  `attributes.space.instanceType` (regular/large/xlarge), `attributes.space.editor
  {type, version, updateChannel: Release|EAP}`, `attributes.space.vmoptions`
  (JVM opts appended to `default.vmoptions`), `attributes.space.warmup` (see
  below), `attributes.space.requiredParameters`/`requiredSecrets` (named env vars
  /secrets injected at dev-env creation — a per-devenv parameters/secrets
  mechanism distinct from, but parallel to, Automation's job parameters in 03),
  `components[].container.image` (can point at a **Space Packages Container
  repository** — direct integration with the Packages module from 03), `env`
  (container env vars). A project can have multiple `*.devfile.yaml` files
  (e.g. `frontend.devfile.yaml`, `backend.devfile.yaml`); user picks one when
  creating the dev environment.
- **Warm-up**: precomputes a "warm-up snapshot" (a Docker volume containing
  `/root` + `/mnt/space`, i.e. project indexes + cloned repo) so a new dev
  environment skips IDE index-building. Configured via `devfile.warmup`:
  `startOn` triggers — `schedule` (cron, UTC, runs only on the project's default
  branch) and/or `gitPush` (with `branchFilter`/`pathFilter`, each supporting
  `include`/`exclude`/`includeRegex`/`excludeRegex`, `*`/`**` glob wildcards, and
  a "more specific path wins" precedence rule); `script` (custom shell script,
  runs in addition to automatic IDE index-building); `indexing: false` to skip
  IDE index-building entirely. Space keeps **only the latest snapshot per
  (IDE type × Git branch)** combination — not per IDE version. Snapshot storage
  counts against disk-storage billing. Right to control this:
  `ManageWarmupTriggering` ("Manage warm-up automatic triggers", project-scoped);
  by default warm-up triggers are disabled per-project until an admin enables them
  on the project's Dev Environments settings tab.
- **Lifecycle / hibernation**: "If there's no activity with a dev environment for
  more than 30 minutes, Space hibernates the environment: it performs a graceful
  shutdown for the container (`docker stop`) and releases the virtual machine."
  Working-directory + home-directory contents are saved on hibernate and restored
  on next start (uncommitted changes survive). This 30-minute idle timeout is a
  hardcoded product default, not configurable in the docs shown.
- **Storage layout** (identical for a running dev environment and a warm-up
  snapshot): `/root` (user dir + IDE indexes) and `/mnt/space/{system, work/
  {git-repo-name}}` (system files + the cloned working directory) — everything
  else in the container is ephemeral/discarded, so ad-hoc `apt-get install` in a
  running session does **not** persist across restarts (must go in a custom
  Dockerfile image instead).
- **Sharing**: a dev environment can be shared with other team members for
  collaborative work (right: `JoinHotPoolDevEnvironments` = "join dev
  environments from standby pool and become their owner" — a *hot pool* of
  pre-warmed/pooled environments members can claim, separate from ad-hoc sharing).
- **Instance types & cloud policy**: `RdInstanceTypesManageLocation` (deep-link
  route, "Instance Types" admin page) + `RdCloudPolicyManageLocation` ("Cloud
  Policy" admin page) — org-level compute-tier catalog and usage/cost policy,
  gated by rights `ViewCloudPolicy`/`EditCloudPolicy` ("Rd.CloudPolicy.view/edit")
  and `ViewDevEnvironmentSettings`/`EditDevEnvironmentSettings`
  ("Rd.Settings.View/Edit" — e.g. org default IDE version).
- **Debug/troubleshooting**: dedicated "View dev environments debug data" right
  (`ViewDevEnvironmentDebugData`, `Rd.DebugData.View`) and a "Troubleshoot report"
  deep-link (`RdLocation.Companion.TROUBLESHOOT_REPORT`) plus per-environment log
  viewers (`devEnvLogs`, `hostIdeLogs`, `warmupLogs` routes on `RdLocation`) —
  Space ships operator-facing log/trace viewers for dev-env and warm-up execution,
  not just end-user create/connect UI.
- **Billing**: disk storage for warm-up snapshots is metered separately (linked
  docs page `billing-of-dev-environments.html`, not deep-dived here — flagged for
  future digging if billing/quota parity ever matters).

### 1.2 Applications & Extensibility

"A Space application is an external server-side service or client-side
application (JavaScript, mobile, or desktop) that can interact with Space via
the Space HTTP API." (blog, "Introduction to Space Applications", Nov 2020).
Five extension surfaces, confirmed both by the "Extensibility Manifesto" blog
and the decompiled `circlet.client.api.apps` package (100+ classes — by far the
largest single API surface found in the whole decompile after Packages/Automation):

1. **HTTP API** — Space exposes essentially its entire object model over a REST-
   like HTTP API (`/api/http/...`); apps authenticate via OAuth2 (Client
   Credentials or Authorization Code flow — full flow detail in 05 §3; not
   repeated here). Confirmed live at `jetbrains.com/help/space/applications-api.html`
   (not dead) with paths like `post /api/http/applications`,
   `get /api/http/applications/paged`, `post /api/http/applications/report-application-as-healthy`,
   `post /api/http/applications/{application}/force-remove`.
2. **Webhooks** (subscriptions → payload push) — an app subscribes to Space
   events; Space POSTs a `WebhookRequestPayload` to the app's registered
   endpoint URL when the event fires.
3. **Chatbots + slash commands** — apps register a chat-channel presence;
   users `/command` in the bot's channel; Space POSTs a payload, app replies
   with a formatted `ChatMessage` (via a message-builder DSL).
4. **UI extensions** — apps contribute top-level pages, menu items, application
   homepage panels, "Getting Started" tiles, external-issue-tracker connectors,
   context-menu actions on messages/meetings/calendar events, etc., rendered by
   Space around iframe URLs or declarative payloads the app returns.
5. **Space SDK** (Kotlin and .NET) — official client libraries wrapping the HTTP
   API + a "Payloads SDK" for parsing incoming request payloads + a message-
   builder DSL. Sources: `github.com/JetBrains/space-kotlin-sdk`,
   `github.com/JetBrains/space-dotnet-sdk` (still public on GitHub, NuGet has
   `JetBrains.Space.*` packages — **not dead**, unlike most `jetbrains.com/help`
   pages cited in files 01-05). Kotlin SDK Maven coordinates were served from
   Space's own package registry (`public.jetbrains.space/p/space-sdk/packages/maven/maven`)
   which is now dead (per 00-INDEX, `*.registry.jetbrains.space` has zero healthy
   backends) — so Maven packages are likely unrecoverable even though GitHub
   sources survive.

Getting started requires (per blog): an IDE, the Space SDK, the Ktor framework
(app is typically a small Ktor server), and a tunneling service (ngrok) during
development so Space's cloud can reach a locally-running app server via its
public `endpointUri`.

App **types** (confirmed decompiled enum `ApplicationType`): `Application`
(generic/private, org-scoped), `InternalApp`, `MarketplaceApp` (published,
publicly installable, reviewable/ratable), `FeaturedIntegration` (JetBrains-
built first-party connectors — confirmed decompiled enum
`FeaturedIntegrationType`: `Unknown, Jenkins, TeamCity, Jira, YouTrack, Slack`;
these ship dedicated install-payload types `AppInstallJenkins`/`AppInstallTeamCity`
carrying an `AppPreset`, vs. generic `AppInstallFromMarketplace(marketplaceAppId,
state)`, `AppInstallFromLink`, `AppInstallManualEntry`, `AppInstallIncorrectParams`
— i.e. Space has **5 distinct app-install code paths**, not one generic
"install app" flow).

App **lifecycle/connection health** (decompiled `AppConnectionStatus` enum):
`CONNECTING, FAILED_TO_CONNECT, RECONNECTING, CONNECTED` — Space actively
monitors whether an app's `endpointUri` is reachable and surfaces connection
errors (`AppConnectionError`, `lastInitPayloadHttpError` API) and health
("Report application as healthy" endpoint — "mandatory for applications that
connect external issue trackers"); an app that never responds can be
force-removed by an admin (`force-remove` endpoint) without further payload
delivery attempts.

---

## 2. Real Data Model (from decompile)

### 2.1 Dev Environments (`circlet.client.api` routing + `circlet.common.permissions`)

The Android client has **no dev-environment CRUD/DTO layer at all** — it only
carries (a) deep-link routing classes to open the relevant web-app pages, and
(b) the permission-rights model. This strongly suggests the mobile app never
implemented in-app dev-environment management, only "jump to web" links —
consistent with dev environments being an IDE-centric feature with no mobile
use case.

```
// Routing (circlet.client.api) — Location subclasses building URL paths, not data models
RdProjectLocation(location)              // per-project "Dev Environments" section root
  .devConfigurations -> RdDevConfLocation("dev-configurations")   // devfile config list
    .new / .selected(devConfId) / .copy / .alter                 // devfile CRUD-ish routes
  .warmup -> RdWarmupLocation("warmup")
    .overview / .steps / .tracing / .warmupExecId(id)
  .devEnvironments -> RdDevEnvironmentsLocation("environments")
    .environmentDetails/environmentTimeline/environmentSteps/environmentTracing(workspaceNumber)
    .openInIde(workspaceNumber)
  .openEnv -> RdOpenEnvLocation("open-env")
    .withRepoDetails(repoUrls, defaultBranch, selectedBranch?)
  .environments(repoName?, state?, ideType?, owner?, devConfig?, branchName?, ideTypeId?, configVisibility?)
RdLocation (top-level "rd" route)
  .devEnvLogs(devEnvId) / .hostIdeLogs(devEnvId) / .warmupLogs(warmupExecId)
  Companion: LOG_DEV_ENV_TPL, LOG_DEV_ENV_TPL_FALLBACK, LOG_WARMUP_TPL, TROUBLESHOOT_REPORT
RdCloudPolicyManageLocation("cloud-policy-manage").cloudPolicy(id)
RdInstanceTypesManageLocation("instance-types-manage").instanceType(id).withConnection(connectionId)
  Filters.CONNECTION
```

```
// Rights (circlet.common.permissions) — RightGroup.DevEnvironments ("Dev Environments")
CreateDevEnvironments        : ProjectRight  "Rd.Workspaces.Create"          "Create dev environments" — implies ViewDevEnvironmentSettings
ManageDevEnvironmentsInProject: ProjectRight "Rd.Workspaces.Manage"          "Manage dev environments of all project members" — implies ViewDevEnvironmentsInProject
ViewDevEnvironmentsInProject  : ProjectRight "Rd.Workspaces.View"            "View dev environments that the user doesn't own"
JoinHotPoolDevEnvironments    : ProjectRight "Rd.Workspaces.Unattended.Join" "Join dev environments from standby pool ... become their owner" — implies CreateDevEnvironments
ConnectToFleetWorkspaces      : ProjectRight "Fleet.Workspaces.Connect"      "Connect to Fleet Workspaces" (implicit/member flag)
ManageWarmupTriggering        : ProjectRight "Rd.Warmup.Triggering.Manage"   "Manage warm-up automatic triggers"
ViewDevEnvironmentSettings    : GlobalRight  "Rd.Settings.View"              "View the organization's dev environments settings (like default IDE version)"
EditDevEnvironmentSettings    : GlobalRight  "Rd.Settings.Edit"              same, edit — implies ViewDevEnvironmentSettings
ViewCloudPolicy               : GlobalRight  "Rd.CloudPolicy.view"           "View cloud policies for dev environment"
EditCloudPolicy               : GlobalRight  "Rd.CloudPolicy.edit"          "Manage cloud policy" — implies ViewCloudPolicy
ViewDevEnvironmentDebugData   : GlobalRight  "Rd.DebugData.View"             "View debug data"
```
Project-feature gate: `ProjectFeature.DEV_ENVIRONMENTS` (order 7, depends on
`REPOSITORIES`; a project must have repositories enabled before dev environments
can be enabled — matches "Start coding" living on the repository page). Pin
kind for "pin to sidebar": `ProjectPinnedItemKind.DevEnvironment`. Extension/menu
hooks confirmed: `ExtensionIds.canDevEnvBeDisabled`, `startCodingCreateDevEnvTab`,
`issueStartCodingButton` (an Issue can launch straight into a dev environment),
`automationRdWorkerIdProvider` (Automation worker ↔ dev-environment id linkage,
i.e. warm-up jobs run as Automation jobs under the hood), `sandboxRdFakeProjectCardData`
(internal UI-sandbox mock data, confirms "Rd" as the internal short-name used
throughout even in unrelated tooling); `MenuIds.administrationDevEnvs` (org
admin nav item). `IdeConnectionId`/`OnlineIde`/`OpenedRepository`/`IdeListItem`
(`circlet.ide` + `circlet.client.api.ide`) model **locally-installed desktop IDEs
and which repos they have open** — used to decide "open in existing IDE session"
vs. "launch new" when clicking "Open in IDE"; independent of dev-environment
backend state.

### 2.2 Applications (`circlet.client.api.apps`, ~150 classes)

**Core Application entity and API surface:**
```
interface Applications : Api   // HTTP API surface, ~35 methods, confirmed decompiled signatures:
  createApp(name, description?, pictureAttachmentId?, defaultExternalPicture?, email?,
    clientId?, clientSecret?, clientCredentialsFlowEnabled?, codeFlowEnabled?,
    codeFlowRedirectURIs?, pkceRequired?, publicClientsAllowed?, implicitFlowEnabled?,
    implicitFlowRedirectURIs?, endpointUri?, endpointSslVerification?,
    appLevelAuth: EndpointAuthCreate?, sslKeystoreAuth?, hasSigningKey?,
    hasPublicKeySignature?, basicAuthUsername?, basicAuthPassword?, bearerAuthToken?,
    connectToSpace?, state?, featuredIntegrationType?) -> Ref<ES_App>
  updateApp(application: ApplicationIdentifier, ...same fields as KOption...)
  retryConnectingToApp(applicationIdentifier)
  getAppById(applicationIdentifier) -> Ref<ES_App>
  getLastClientCredentialsAccess(applicationIdentifier) -> AccessRecord?
  getAppsPaged(batchInfo, owner?, withArchived?, withManaged?, ordering: AppsOrdering?) -> Batch<Ref<ES_App>>
  getChatBotApps(batchInfo, query?) -> Batch<Ref<ES_App>>
  chatBotApps(batchInfo, query?, expression: SearchExpression?, defaultStateWhenEmpty) -> Batch<ApplicationHitDetails>
  getAppInfoPaged(batchInfo, query?, fromMarketplace?, addedByOtherUsers?, tags?,
    ?, ordering: AppsOrdering?) -> Batch<AppInfo>
  getAppsWithConnectionProblems() -> List<ES_AppMetadata>
  getAppsCount(...) -> Int ; haveAnyApps() -> Boolean
  getAppSecret / regenerateAppSecret / archiveApp / forceArchiveApp / restoreApp
  regenerateSigningKey / getSigningKey / getPublicKeys
  regenerateVerificationToken / getVerificationToken / getBearerToken
  addAppSshKey(applicationIdentifier, publicKey, comment) -> List<SshKeyData>
  getAppSshKeys / deleteAppSshKey(fingerprint)
  addAppGpgKey -> GpgKeyData ; getAppGpgKeys ; deleteAppGpgKey ; revokeAppGpgKey
  latestMessagesDeliveries(applicationIdentifier, batchInfo) -> List<AppMessageDeliveryDTO>
  lastInitPayloadHttpError(applicationIdentifier) -> AppConnectionError?
  getMaskedRequestHeaderValue(applicationIdentifier, deliveryRecordId, headerName)
  setOwner(applicationIdentifier, newOwner: ProfileIdentifier)
  setOwnerApp(applicationIdentifier, newOwnerApp: ApplicationIdentifier)  // apps can own other apps
  appCompatibilityStatus(minSpaceVersion?, maxSpaceVersion?) -> AppCompatibilityStatus
  setErrorMessage(message?)  // shown on the app's page in Space UI
  reportApplicationAsHealthy()
```
```
data class ES_App : ARecord (
  id, owner: Ref<TD_MemberProfile>?, ownerApp: Ref<ES_App>?, clientId, name, email?,
  picture?, defaultExternalPicture?, createdAt: KotlinXDateTime?, kind, presentableName?,
  applicationType: ApplicationType?, clientCredentialsFlowEnabled: Boolean?,
  codeFlowEnabled: Boolean?, codeFlowRedirectURIs?, pkceRequired: Boolean?,
  implicitFlowEnabled: Boolean?, implicitFlowRedirectURIs?, endpointURI?,
  hasVerificationToken: Boolean?, hasSigningKey: Boolean?, hasPublicKeySignature: Boolean?,
  endpointSslVerification: Boolean?, basicAuthUsername?, hasBearerToken: Boolean?,
  sslKeystoreAuth?, archived: Boolean, arenaId
)
enum ApplicationType { Application, InternalApp, MarketplaceApp, FeaturedIntegration }
enum FeaturedIntegrationType (OrderedEnum) { Unknown, Jenkins, TeamCity, Jira, YouTrack, Slack }
enum AppKinds (string consts) { Application, Subscription, SlackSubscription, ProjectAutomation }
enum AppConnectionStatus { CONNECTING, FAILED_TO_CONNECT, RECONNECTING, CONNECTED }
sealed AppInstallInfo { AppInstallFromMarketplace(marketplaceAppId, state?)
  AppInstallFromLink ; AppInstallManualEntry ; AppInstallIncorrectParams
  AppInstallJenkins(appPreset: AppPreset) ; AppInstallTeamCity(appPreset: AppPreset) }
interface ApplicationInstall : Api { appInstallInfo(appPreset: AppPreset) -> AppInstallInfo }
data class MarketplaceApp(
  id, name, endpointUrl, fullDescription, vendorName, vendorUrl?,
  developers: List<MarketplaceAppDeveloper>, installationCount: Long, icon?, rating: Double?,
  tags: List<String>, screenshots: List<String>, multipleInstallationsAllowed: Boolean,
  appCompatibilityStatus: AppCompatibilityStatus?, installedApps: List<Ref<ES_App>>,
  installedAppsMetadata: List<Ref<ES_AppMetadata>>, capabilities: List<MpAppCapabilityApi>?,
  specialInstallInfo: MpAppSpecialInstallInfo?
)
sealed MpAppCapabilityApi { ExternalIssueTrackerApi(trackerName, canCreateIssues: Boolean) }
data class AppParameter(key, value)   // generic app config key/value pair
```

**Payloads SDK** — the request bodies Space POSTs to an app's `endpointUri`
(sealed `ApplicationPayload` family, confirmed classes): `InitPayload
(clientSecret, serverUrl, state, clientId, userId, verificationToken)` — sent
once at multi-org app install/connect time (`connectToSpace=true`); `WebhookRequestPayload
(verificationToken?, clientId, webhookId, payload: WebhookEvent, userId?)` — one
per triggered webhook subscription; `MessagePayload` — user sent text to a
chatbot channel; `ListCommandsPayload` — user typed `/` (or any char while a
slash-menu is open) in a chatbot channel, app must return its `Commands` list
filtered to the typed prefix; `MenuActionPayload`/`MessageActionPayload`/
`UnfurlActionPayload`/`CustomActionPayload` — user interacted with a UI
extension (menu item click, message button click, link-unfurl action);
`ApplicationUninstalledPayload`; `NewExternalIssueEventPayload`;
`CreateExternalIssueRequestPayload`. All implement marker interface
`ApplicationPayload`. Chat commands: `Commands(commands: List<CommandDetail>)`,
`CommandDetail(name, description)` — this is the literal `/command` autocomplete
list definition, keyed only by name+description (no typed-parameter schema in
the DTO itself — parameter parsing is left to the app's own `MessagePayload`
text handling, confirmed by the blog's hand-written `command.run(context,
payload)` pattern, i.e. Space does not have a declarative slash-command-args
schema the way e.g. Slack's app manifest does).

**Webhooks/subscriptions** (`circlet.platform.api.subscriptions` + per-domain
webhook event classes): `WebhookEvent` — empty marker interface, one concrete
subclass per subscribable domain event, confirmed decompiled examples across
many modules: `CodeReviewWebhookEvent`, `CodeReviewUpdatedWebhookEvent`,
`CodeReviewDiscussionWebhookEvent`, `CodeReviewCommitsUpdatedWebhookEvent`,
`CodeReviewParticipantWebhookEvent`, `SRepoPushWebhookEvent`,
`SRepoCommitsWebhookEvent`, `SRepoHeadsWebhookEvent` (git module — cross-ref 01),
`IssueWebhookEvent`, `IssueWebhookCustomFieldUpdate`,
`IssueImportTransactionWebhookEvent` (planning — cross-ref 02),
`AutomationJobEvent`/`AutomationJobStarted`/`AutomationJobFinished`/
`AutomationJobFailed`/`AutomationJobTerminated` (pipelines — cross-ref 03),
`BlogWebhookEvent`, `DocumentWebhookEvent`, `AbsenceWebhookEvent`,
`AbsenceApprovalWebhookEvent`, `FeatureFlagWebhookEvent`,
`ApplicationSshKeyWebhookEvent`, `WebhookRecord` (the subscription/registration
record itself), `DeploymentWebhookEvent` (cross-ref 03 §Deployments). Each
domain that supports webhooks also exposes a `*SubscriptionFilterVm` (e.g.
`RepoCommitsSubscriptionFilterVm`, `CodeReviewSubscriptionFilterVM`,
`AutomationJobSubscriptionFilter` with typed sub-filters
`AutomationJobSubject`/`GitCheckout`/`JobExecutionTrigger`/`JobExecutionStatus`)
— webhooks are **scoped/filterable per event type**, not just "subscribe to
everything of type X". `WebhookSubscriptionsVmHost`/`NewWebhookSubscriptionsVmHost`
manage the create/list/edit UI-state for an app's webhook registrations.
Generic (non-webhook-specific) subscription plumbing lives in `circlet.subscriptions`
(`SubscriptionVm`, `EventTypeVm`, `SubjectsRegistry`, `PersonalSubscriptionsVmHost`,
`ChannelSubscriptionsVmHost`) shared with human-user notification subscriptions
(not app-specific) — `EventType`/`EventSubject` (`circlet.platform.api.subscriptions`)
are the base taxonomy both webhook subscriptions and personal notification
subscriptions are built on.

**UI extension types** — sealed family `AppUiExtensionApi` (declared by the app,
shown to Space), each mirrored by an `AppUiExtensionIn` (Space→app config) and
often an `*Internal` variant. Confirmed concrete extension points:
```
ChatBotUiExtensionApi / ChatBotUiExtensionIn                  — registers a chatbot
MenuItemUiExtensionApi(displayName, description, menuItemUniqueCode,
  visibilityFilters: List<MenuItemVisibilityFilterApi>,
  parametersForm: ExtensionActionParametersForm?)              — generic menu-item contribution
TopLevelPageUiExtensionApi(displayName, description, uniqueCode, iframeUrl)
  typeName = "Top level menu"                                  — full page, own nav entry
PageUiExtensionApi (sealed) -> ApplicationHomepageUiExtensionApi(iframeUrl?)
  typeName = "Application settings"                             — app's own settings/home page
GettingStartedUiExtensionApi/In/Internal                       — "Getting Started" onboarding tiles
ExternalIssueTrackerUiExtensionApi(domain, trackerName, canCreateIssues)
  typeName = "External issue tracker"                          — Jira/YouTrack-style connector surface
ChatMessageMenuItemUiExtensionApi/In + ChatMessageMenuItemVisibilityFilterApi/In
  — per-message context-menu action (right-click a chat message)
MeetingMenuItemUiExtensionApi/In ; CalendarEventPreviewMenuActionContext
  ; ChannelMessageMenuActionContext                            — context-specific menu action contexts
```
Menu action contexts and payloads: `MenuActionContext`/`MenuActionContextIn`
(sealed by surface: channel message, meeting, calendar event, document, etc.),
`ExtensionActionParametersForm`/`ExtensionActionFormParameter`/
`ExtensionActionFormParameterValue`/`ExtensionActionPlacement` — apps can
declare a **typed input form** for a menu action (Space renders the form,
collects values, then calls the app) — this is more structured than the
free-text slash-command model above. `AppUiEnabledState`/`ExtensionEnabledState`
— per-context enable/disable + per-user override (`enableAppUiForMe`/
`disableAppUiForMe` vs. org/project-wide `enableAppUi`/`disableAppUi`) confirmed
on the `ApplicationUiExtensions` API surface (`getUiExtensions`,
`setUiExtensions`, `enableAppUi`, `disableAppUi`, `enableAppUiForMe`,
`disableAppUiForMe`, `addChatBot`, `removeChatBot`). Ordering: `AppsOrdering`
(list-sort enum, e.g. for the app marketplace/list screens).

**Rights/permissions for apps** (`ApplicationRights` API — distinct from the
`appAuth` consent/authorization-context model in 05 §2.3, which governs what
an *already-installed* app is allowed to call; `ApplicationRights` here is the
**admin-facing "which rights does this app require / has been granted" editor**):
`getRequiredRights(application) -> List<RightDTO>`,
`updateRequiredRights(application, rightCodesToAdd, rightCodesToRemove,
requestRightsInAuthorizedContexts)`, `getAuthorizedRights(application,
contextIdentifier)`, `updateAuthorizedRights(application, contextIdentifier,
rights, actor: PrincipalIn, comment)`, `requestRights(rightCodes)`,
`scopeApprovalStatus(scope) -> ScopeApprovalStatus`, `approveScope(application,
scope)`. Confirms Space distinguishes **"rights an app declares it needs"**
(developer-authored manifest-like list) from **"rights actually granted in a
given context"** (admin-approved, per org/project/channel) — a two-stage
request→approve model layered on top of 05's Right/RightType/Role system.

---

## 3. Key Features List

**Dev Environments:**
1. Cloud VM + Docker container per dev environment; thin local client (Fleet or
   JetBrains-Gateway-driven desktop IDE) does only UI rendering, all heavy
   compute happens server-side.
2. Devfile config-as-code (`.space/*.devfile.yaml`, devfile.io 2.2.0 subset):
   instance type, IDE + version + update channel, JVM options, container image
   (can pull from the project's own Space Packages Container repo), env vars,
   required parameters/secrets injected at creation.
3. Multiple devfiles per project (pick one at dev-env creation time); optional
   auto-generated devfile from the creation-dialog UI.
4. Warm-up snapshots: scheduled (cron, UTC, default-branch-only) or git-push-
   triggered (with branch/path include/exclude/regex filters), custom warm-up
   script + automatic IDE index building; one snapshot kept per (IDE × branch).
5. 30-minute idle auto-hibernation (graceful `docker stop` + VM release) with
   full working-dir/home-dir state preservation across hibernate/restart.
6. Standby/"hot pool" of pre-warmed environments members can claim
   (`JoinHotPoolDevEnvironments`) for faster cold-start.
7. Sharing a running dev environment with teammates for pair/collaborative work.
8. Org-level instance-type catalog + cloud policy admin pages; per-org default
   IDE version setting.
9. Dedicated debug/troubleshoot log viewers (dev-env logs, host-IDE logs,
   warm-up logs) surfaced through their own routed pages — not just end-user UX.
10. Fine-grained rights: separate create/manage-others'/view-others'/join-pool/
    connect-to-Fleet/manage-warmup-triggers/view-or-edit-org-settings/view-or-
    edit-cloud-policy/view-debug-data rights (10 distinct rights in one
    `DevEnvironments` right group).
11. Feature-gated on `REPOSITORIES` project feature (no repo → no dev envs).

**Applications & Extensibility:**
1. Five extension surfaces: HTTP API, webhooks, chatbots+slash-commands, UI
   extensions (pages/menus/context-actions), official Kotlin/.NET SDKs.
2. Four app types (`Application`/`InternalApp`/`MarketplaceApp`/
   `FeaturedIntegration`) with 5 distinct install code-paths (marketplace, link,
   manual entry, Jenkins preset, TeamCity preset).
3. Multiple auth flows per app (Client Credentials, Authorization Code +PKCE,
   Implicit — legacy) plus endpoint-authenticity verification (signing
   key/public-key signature/basic-auth/bearer-token/SSL-keystore options) so the
   app's own server can trust that a payload really came from Space.
4. Connection health monitoring: `AppConnectionStatus` state machine,
   last-init-error inspection, mandatory self-reported healthy-ping for issue-
   tracker-connecting apps, admin force-remove for dead apps.
5. Payloads SDK: typed sealed payload family (`InitPayload`, `WebhookRequestPayload`,
   `MessagePayload`, `ListCommandsPayload`, menu/message/unfurl/custom action
   payloads, uninstall payload) an app's single endpoint must dispatch on.
6. Webhooks are richly filterable per source-domain event (not just "all events
   of type X") via per-domain `*SubscriptionFilterVm`s; ~15+ distinct webhook
   event classes span git, code review, planning, automation, deployments,
   blogs, documents, absences, feature flags, SSH keys.
7. Slash commands are a flat name+description list with app-owned free-text
   command parsing (no declarative args schema) — but menu-item UI extensions
   *do* support a declarative typed parameters form
   (`ExtensionActionParametersForm`) as a more structured alternative.
8. UI extension points: full top-level page (own nav item + iframe), app
   homepage/settings page, "Getting Started" tiles, external-issue-tracker
   connector surface, per-message/meeting/calendar-event context-menu actions —
   each independently enable/disable-able org-wide, per-project/channel, or
   per-user ("for me").
9. Two-stage app rights model: developer-declared "required rights" list vs.
   admin-approved "authorized rights in context", separate from (but feeding
   into) 05's org-wide Right/Role/Scope system.
10. Apps can own other apps (`ownerApp`/`setOwnerApp`) — supports multi-service
    app architectures where a parent app manages child app registrations.
11. Featured Integrations are first-party pre-built connectors (Jenkins,
    TeamCity, Jira, YouTrack, Slack) installed via dedicated preset flows,
    distinct from generic marketplace/manual apps.

---

## 4. gaia-space Gap Analysis

Checked: `src/` (Tauri/Solid.js frontend — 7 files total: `App.tsx`, `Diff.tsx`,
`index.tsx`, `api.ts`, plus scaffolding) and `src-tauri/src/` (Rust backend —
`git.rs`, `review.rs`, `issues.rs`, `chat.rs`, `db.rs`, `platform.rs`,
`debug_server.rs`, `main.rs`, `lib.rs`). The current app (per 00-INDEX, a
Tauri rewrite superseding the old `legacy/flutter/` client) is confirmed a
**day-one skeleton**: it has thin Rust modules for git operations, code review,
issues, and chat, and a minimal Solid.js UI shell — there is no `packages.rs`,
`pipelines.rs`/`automation.rs`, `deployments.rs` (matching 03's 0% finding), and
correspondingly **no `devenv.rs` or `apps.rs`/`applications.rs` at all** for
either domain covered in this file. `grep`-scanning both `src/` and `src-tauri/src/`
for `devenv`/`dev.?environment`/`application`/`marketplace`/`webhook`/`chatbot`/
`extension`/`fleet`/`gateway`/`devfile` returns zero matches.

### Have
- Nothing. 0% coverage of both Dev Environments and Applications/Extensibility.

### Partial
- N/A — unlike Packages/CI-CD (03), which at least has a placeholder route in
  the old Flutter client, the current Tauri app has no route, page, or model
  stub for either domain at all (expected, given the whole app is early-stage
  and these are two of the more specialized/lower-priority Space modules).

### Missing (full list)
**Dev Environments:**
1. Entire feature: no VM/container provisioning concept (out of scope for a
   desktop git/review/issues client anyway — gaia-space is not a cloud
   infra provider, so a literal re-implementation of "spin up a cloud dev VM"
   is almost certainly **not** the right parity target).
2. What *could* be parity-relevant instead: the **devfile-as-metadata** concept
   (repo-local `.space/*.devfile.yaml` describing "how to build/run this repo")
   and **"Open in IDE" / "Start coding" launch UX** (deep-linking out to a local
   IDE or a remote backend the user already has) — both are plausibly in-scope
   without gaia-space owning any cloud compute.
3. No devfile parser/editor, no warm-up concept, no instance-type catalog, no
   dev-env rights (all 10 rights absent, consistent with 05's finding of zero
   Right/Role model in gaia-space at all).

**Applications & Extensibility:**
1. No app registry/model (`ES_App` equivalent), no app installation flow of any
   kind, no OAuth app credentials (client ID/secret, flows) — this depends on
   05's foundational OAuth/appAuth gap being closed first.
2. No webhook subscription model (registration, per-event filters, delivery
   tracking/retry, payload types) for any domain — code review, issues, or
   future CI events currently have no way to notify an external system.
3. No chatbot/slash-command surface (gaia-space's own "Chat" is noted elsewhere
   in this KB as a Discord-bot bridge, 0% native — so there's no native chat
   channel for a bot to even live in yet; building native chat, per 00-INDEX's
   suggested build order, is a prerequisite here too).
4. No UI-extension/plugin mechanism of any kind (no iframe-page-embedding, no
   menu-contribution API, no per-message context actions) — gaia-space has no
   plugin/extension architecture at all today.
5. No app rights/consent UI (depends on 05's Right/Role/Scope foundation).

### Recommendation
Given gaia-space is a single-user-feeling desktop app today (not yet a
multi-tenant SaaS with third parties needing to integrate), **Applications/
Extensibility is low-priority relative to 00-INDEX's suggested foundational
build order** (persistence, Right/Role/Scope, custom fields, Issue model, native
chat) — a plugin/webhook/app-marketplace platform only becomes valuable once
those foundations and at least one or two consuming features (native chat for
chatbots; an Issue/PR model for webhooks to fire on) exist. **Dev Environments**
is lower-priority still and arguably **out of scope in its literal cloud-VM
form** for a desktop app; the only transferable ideas are devfile-style
repo-local dev-setup metadata and "open in IDE" deep-linking, which could be
folded into a future "repository settings" feature rather than built as a
standalone module.
