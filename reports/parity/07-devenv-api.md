# 07 — Dev Environments & Applications API parity audit

Scope: current `src/`, `src/api/`, `src-tauri/src/`; KB §4 gap analysis excluded. `done` requires Rust command wired in `tauri::generate_handler!`, a `src/api/*.ts` caller, and a rendered view. `stub` = persisted/backend declaration but no complete command→API→view path. `src-tauri/src/applications.rs` and schema V14 declare local subsets; none of its commands occur in the handler (`src-tauri/src/lib.rs:75-290`), no `src/api/applications.ts` exists (`src/api/` listing), and no relevant view is statically registered (`src/App.tsx:37-44`).
WIP:☀ `feat/tree-devenv-api` — devfile/deep-link + apps UI + webhook delivery/retry; 2026-08-22.

|feature|src(KB/legacy)|status|evidence|note|
|---|---|---|---|---|
|Cloud VM + Docker dev environment / Fleet-Gateway thin client|KB §3.1 #1|missing|`src-tauri/src/applications.rs:1-5`; `src/App.tsx:37-44`|Module explicitly excludes remote-machine provisioning; no VM/container view.|
|Devfile config: instance/IDE/image/env/parameters/secrets|KB §3.1 #2|stub|`src-tauri/src/applications.rs:42-104`; `src-tauri/src/db.rs:271-273`; `src-tauri/src/lib.rs:75-290`|Raw devfile CRUD persists text; commands are not handler-wired and no API/view exists; no structured schema support.|
|Multiple/selectable or generated devfiles|KB §3.1 #3|stub|`src-tauri/src/applications.rs:42-108`; `src-tauri/src/db.rs:271-273`; `src/App.tsx:37-44`|Multiple paths and `generated` flag exist in storage only; no create-dialog selection/generation UI.|
|Warm-up snapshots, schedule/git-push filters, script/indexing|KB §3.1 #4|missing|`src-tauri/src/applications.rs:1-417`; `src-tauri/src/db.rs:271-280`|No warm-up model, trigger, snapshot, command, API, or view.|
|Idle hibernation with persisted home/work tree|KB §3.1 #5|missing|`src-tauri/src/applications.rs:1-417`; `src-tauri/src/db.rs:271-280`|No environment lifecycle/state model.|
|Standby/hot-pool claim|KB §3.1 #6|missing|`src-tauri/src/applications.rs:1-417`|No pool/claim model or surface.|
|Share a running dev environment|KB §3.1 #7|missing|`src/api/chat.ts:58-100`; `src/views/Chat.tsx:42-300`|Native chat exists; no dev-environment sharing entity/action.|
|Instance catalog, cloud policy, org default IDE|KB §3.1 #8|missing|`src-tauri/src/platform.rs:270-319`; `src/views/Admin.tsx:15-177`|Generic admin rights only; no RD catalog/policy/default-IDE records.|
|Dev-env/host-IDE/warm-up debug log pages|KB §3.1 #9|missing|`src/App.tsx:37-44`; `src-tauri/src/applications.rs:1-417`|No environment log/troubleshoot commands or routes.|
|Ten distinct DevEnvironments rights|KB §3.1 #10|partial|`src-tauri/src/platform.rs:270-319`; `src/api/platform.ts:50-70`; `src/views/Admin.tsx:129-177`|Working generic role/right command→API→Admin UI; no `Rd.*` codes or Dev Environments group.|
|Project feature gate depends on repositories|KB §3.1 #11|missing|`src-tauri/src/db.rs:187-220`; `src/views/ProjectSettings.tsx:1-220`|No project-feature data/gate.|
|RD routes: configurations CRUD, environments/details/timeline, open-in-IDE, logs|KB §2.1 routing|stub|`src-tauri/src/applications.rs:67-125`; `src-tauri/src/lib.rs:75-290`; `src/router.ts:25-34`|Backend devfile/list/deep-link declarations only; handler, API, router, and views absent.|
|RD permission group: create/manage/view/join/connect/warmup/settings/policy/debug|KB §2.1 rights|partial|`src-tauri/src/platform.rs:455-614`; `src/api/platform.ts:50-70`; `src/views/Admin.tsx:129-177`|Generic rights are stored, checked, wrapped, and shown; all named RD rights absent.|
|`DEV_ENVIRONMENTS` project feature and DevEnvironment pin/menu hooks|KB §2.1 feature/pin/hooks|missing|`src/router.ts:25-34`; `src/nav.ts:10-20`; `src-tauri/src/db.rs:187-220`|No feature flag, pin kind, start-coding hook, or admin navigation item.|
|Local IDE connections/opened-repository state|KB §2.1 `IdeConnectionId`/`OnlineIde`|stub|`src-tauri/src/applications.rs:111-125`; `src-tauri/src/lib.rs:75-290`; `src/views/Repos.tsx:1-103`|`open_in_ide` returns a fixed Gateway deep-link only; no handler/API/view or IDE/session discovery.|
|Five app extension surfaces: HTTP API, webhooks, chatbot commands, UI extensions, Kotlin/.NET SDK|KB §3.2 #1|stub|`src-tauri/src/applications.rs:222-398`; `src-tauri/src/lib.rs:75-290`; `src/App.tsx:37-44`|Local records cover portions of webhook/chatbot/UI-extension registration; no wiring, HTTP app API, payload callbacks, or SDK.|
|Four app types and five installation paths|KB §3.2 #2|stub|`src-tauri/src/applications.rs:171-196`; `src-tauri/src/db.rs:274`; `src-tauri/src/lib.rs:75-290`|Four stored/validated type strings; no handler/API/view and no five installation paths.|
|App OAuth flows and endpoint-authenticity credentials|KB §3.2 #3|stub|`src-tauri/src/applications.rs:31-38,141-148,171-196`; `src-tauri/src/lib.rs:75-290`|Endpoint URI/SSL-verification fields only; unexposed and lacks OAuth, PKCE, signing/basic/bearer/keystore credentials.|
|Connection-health state, init error, healthy ping, force remove|KB §3.2 #4|stub|`src-tauri/src/applications.rs:128-139,199-218`; `src-tauri/src/db.rs:274`; `src-tauri/src/lib.rs:75-290`|Stored status and manual mutation only; no wiring, monitor, error inspection, healthy ping, or force remove.|
|Typed app endpoint payload dispatcher|KB §3.2 #5|missing|`src-tauri/src/applications.rs:1-417`; `src/api/chat.ts:83-101`|No `ApplicationPayload` family, external endpoint, or dispatch path.|
|Richly filterable cross-domain webhooks|KB §3.2 #6|stub|`src-tauri/src/applications.rs:221-279`; `src-tauri/src/db.rs:275-276`; `src-tauri/src/lib.rs:75-290`|Webhook rows validate a JSON filter and endpoint, but no handler/API/view, event taxonomy, outbound delivery, history, or retry.|
|Flat slash commands plus typed menu parameter forms|KB §3.2 #7|partial|`src/api/chat.ts:54-101`; `src/views/Chat.tsx:42-300`; `src-tauri/src/chat.rs:419-570`|Native chat is command→API→view complete; no app bot callback, slash-command discovery, or typed action form.|
|UI extension pages/menu/context actions with scoped enablement|KB §3.2 #8|stub|`src-tauri/src/applications.rs:339-405`; `src-tauri/src/db.rs:279-280`; `src-tauri/src/lib.rs:75-290`|Stored iframe/type/enabled fields only; no handler/API/view, contexts, or scopes.|
|Two-stage app required-rights vs context-authorized-rights|KB §3.2 #9|partial|`src-tauri/src/platform.rs:455-614`; `src/api/platform.ts:50-70`; `src/views/Admin.tsx:129-177`|Generic rights assignment/checking is complete; no application association, request, context grant, or approval workflow.|
|Parent/child app ownership|KB §3.2 #10|missing|`src-tauri/src/applications.rs:128-218`; `src-tauri/src/db.rs:274`|Application record has no owner/owner-app relation or mutation.|
|Featured integration presets (Jenkins/TeamCity/Jira/YouTrack/Slack)|KB §3.2 #11|stub|`src-tauri/src/applications.rs:174-181`; `src-tauri/src/lib.rs:75-290`|`FeaturedIntegration` is accepted as a type; no preset catalog or install flow.|
|`ES_App` application registry/entity and create/update/get/list/count API|KB §2.2 core application entity/API|stub|`src-tauri/src/applications.rs:128-218`; `src-tauri/src/db.rs:274`; `src-tauri/src/lib.rs:75-290`|Minimal persistent registry/list-save-archive/status exists, but no handler/API/view and omits most ES_App fields/methods.|
|Per-app OAuth settings and endpoint URI/SSL/auth configuration|KB §2.2 `createApp`/`updateApp` fields|stub|`src-tauri/src/applications.rs:141-196`; `src-tauri/src/lib.rs:75-290`|Endpoint URI and SSL boolean only; unexposed; OAuth flows and endpoint-auth options absent.|
|App secrets/tokens, signing/public keys, SSH/GPG keys|KB §2.2 application API methods|missing|`src-tauri/src/secretbox.rs:1-80`; `src-tauri/src/db.rs:271-280`|Secretbox utility and V14 domain schema have no app credential/key records or APIs.|
|App archive/restore and owner profile/owner-app mutation|KB §2.2 application API methods|stub|`src-tauri/src/applications.rs:213-218`; `src-tauri/src/lib.rs:75-290`|Archive flag mutation only, not wired; no restore or ownership mutation.|
|App connection status, HTTP init error, delivery history/header masking|KB §2.2 `AppConnectionStatus`/delivery methods|stub|`src-tauri/src/applications.rs:128-139,199-210`; `src-tauri/src/lib.rs:75-290`|Status enum/mutator only, unexposed; no init errors, deliveries, or header masking.|
|`ApplicationType`, `FeaturedIntegrationType`, `AppKinds` enums|KB §2.2 enums|stub|`src-tauri/src/applications.rs:174-181`; `src-tauri/src/db.rs:274`; `src-tauri/src/lib.rs:75-290`|Application type is persisted/validated; featured subtype and app-kind enums absent; no UI/API exposure.|
|`AppInstallInfo` marketplace/link/manual/Jenkins/TeamCity flows|KB §2.2 install model|missing|`src-tauri/src/applications.rs:1-417`; `src-tauri/src/db.rs:271-280`|No install-info model, commands, API, or view.|
|Marketplace app metadata, capabilities, compatibility, installed-app refs|KB §2.2 `MarketplaceApp`|missing|`src-tauri/src/applications.rs:128-218`; `src-tauri/src/db.rs:274`|A `MarketplaceApp` type string is not marketplace metadata/capabilities/compatibility/install state.|
|Generic app parameter key/value model|KB §2.2 `AppParameter`|missing|`src-tauri/src/db.rs:271-280`; `src/api/platform.ts:97-108`|Custom fields are unrelated; no app parameters table/API.|
|Typed `ApplicationPayload`: init, webhook, message, commands, menu/unfurl/custom, uninstall, external-issue|KB §2.2 payloads SDK|missing|`src-tauri/src/applications.rs:1-417`; `src/api/chat.ts:31-45`|Persisted native chat messages are not external typed application payloads.|
|Webhook records, domain event taxonomy, typed subscription filters|KB §2.2 webhooks/subscriptions|stub|`src-tauri/src/applications.rs:221-279`; `src-tauri/src/db.rs:275-276`; `src-tauri/src/lib.rs:75-290`|Generic webhook record/filter JSON exists only behind unwired functions; no taxonomy, delivery, or endpoint integration.|
|Chatbot extension, `ListCommandsPayload`, flat `CommandDetail` list|KB §2.2 UI extensions/payloads|partial|`src-tauri/src/applications.rs:284-335`; `src/api/chat.ts:54-101`; `src/views/Chat.tsx:42-300`|Native channels/messages work; app chatbot registration is unwired and command payload/list absent.|
|Top-level/home/getting-started/issue-tracker/message/meeting/calendar UI extension declarations|KB §2.2 `AppUiExtensionApi`|stub|`src-tauri/src/applications.rs:339-405`; `src-tauri/src/db.rs:279-280`; `src-tauri/src/lib.rs:75-290`|One generic stored extension type/iframe row; no wiring or concrete extension contracts/rendering.|
|Menu action contexts and typed extension parameter forms|KB §2.2 action contexts/forms|missing|`src-tauri/src/applications.rs:339-405`; `src/views/Chat.tsx:149-300`|No action-context/payload/form model.|
|Org/project/channel/per-user UI extension enablement state|KB §2.2 enabled state API|stub|`src-tauri/src/applications.rs:339-405`; `src-tauri/src/db.rs:279-280`; `src-tauri/src/lib.rs:75-290`|Single row-level `enabled` flag only, unwired; no scoped/per-user state.|
|Application required rights, authorized rights in context, request/approve scope|KB §2.2 `ApplicationRights`|partial|`src-tauri/src/platform.rs:455-614`; `src/api/platform.ts:50-70`; `src/views/Admin.tsx:129-177`|Generic rights catalog/assignment/checker/UI work; app-specific required/authorized/context approval APIs absent.|

## Totals

- done: 0
- partial: 6
- stub: 19
- missing: 17
- rows: 42

## Five worst gaps

1. No complete Dev Environments path: V14 devfile/deep-link backend declarations are not handler-wired, wrapped, routed, or rendered; cloud lifecycle remains absent.
2. All V14 applications commands are unreachable from Tauri and lack `src/api`/view callers, so registry, webhook, chatbot, and extension records are stubs.
3. No app OAuth/credential/key model or external HTTP application API; app installation/marketplace/ownership also absent.
4. No executable webhook system: generic persisted subscription fields lack domain events, payload/signing, external delivery, history, and retry.
5. Native chat and generic rights are functional foundations, but no slash-command/app callback contract or app required-rights/context-approval layer connects to them.
