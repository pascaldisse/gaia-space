# JetBrains Space — Package Registry & CI/CD Automation/Deployments

Domain: Packages module + Automation (CI/CD) module + Deployments module.
Sources: live docs (jetbrains.com/help/space/*, retrieved 2026-07-26) + decompiled
Android client at `~/Downloads/space-clients/android/jadx-out/sources/circlet/{packages,pipelines,deployments}/`
(Kotlin data-class field names recovered from `@Metadata(d2=[...])` annotations —
jadx erases real Kotlin field/getter names in bytecode but the annotation strings
carry the original property list, so names below are exact, not guessed).

---

## 1. Feature Overview

### 1.1 Packages module
Built-in package repository manager ("Even if you are new to the topic, you
probably know about such repositories as Maven Central, Docker Hub, or
NuGet.org. This is exactly what the Packages module does: It lets you create
your own repositories and use them for publishing and sharing packages of
various types: Docker and OCI images, .jar and .pom files, and many others."
— jetbrains.com/help/space/packages.html).

Supported package types confirmed in decompiled client (`circlet/packages/<type>/`):
**Maven, npm, NuGet, PyPI (Python), Dart (pub.dev-style), Container (Docker/OCI +
Helm charts), Composer (PHP), generic Files**. A `PkgCrates` (Rust/crates.io)
org-feature flag exists (`circlet/packages/features/PkgCrates.java`) but there is
**no corresponding `packages/crates/` client module** — Rust package support was
flagged/planned but not shipped in this client build.

Each repository:
- Has a `PackageType` (id string: "maven", "npm", "nuget", "pypi", "dart",
  "container", "composer", "file"...) and a per-type settings object
  `ES_<Type>Settings` implementing composable capability interfaces:
  `PackageRepositoryProxy` (can proxy an upstream/remote registry),
  `PackageRepositoryPublish` (accepts publishes), `VersionedPackageRepositoryRetentionPolicy`
  / `PackageRepositoryRetentionPolicy` (cleanup policy), `PackageVulnerabilityChecks`
  (CVE scanning toggle).
- Repository **mode**: `PackageRepositoryMode` enum = `HOSTING` | `PROXY` (mirrors
  an external index, e.g. proxy npmjs.org or Maven Central).
- Repository **connection type**: `PackageRepositoryConnectionType` enum =
  `REMOTE` | `SPACE` (a Maven repo backed by another Space org's repo, or a
  generic remote URL — see `MavenRepositoryConnectionSettings`/Nexus staging).
- Retention: `RetentionPolicyParams(numberOfDaysToRetain, numberOfVersionsToRetain,
  retainDownloadedOnce)`.
- Vulnerability scanning: `VulnerabilityOverview`/`PackageVulnerability`
  (id, title, description, cvssScore, cvssVector, cve, cwe, reference) — CVE-level
  dependency scanning surfaced per-package-version.
- Sharing/permissions: `PackagesSharingAccessType` (`Manager`/`Writer`/`Viewer`),
  granular per-repository ACLs (`PackagesAccess`, feature-flagged via
  `PackagesFlags.PackagesGranularPermissions`).
- Global package search across repos: `PackagesFlags.PackagesGlobalSearch` +
  `PackagesGlobalSearchFilters` feature flags.
- Container-specific: OCI image health-check flag `ContainerImageHealthcheck`.
- Publishing pipeline: `PackagesPublishing` (publishingId, source, created/started/
  completed timestamps, successful flag, error, principal) tracks async publish
  jobs (e.g. Maven 2-phase Nexus-staging publish via `NexusStagingProfile`).
- Package/version stats: `PackageStats(diskSize, versions, downloads)`,
  `PackageRepositoryStats(diskSize, diskSizeInPercent, diskSizeUsed, diskSizeTotal,
  packages, packageVersions)` — quota/usage dashboards.
- Goto/quick-search integration (`packages/goto/`) — packages indexed in the
  IDE-style "Go to Everything" search.

### 1.2 Automation (CI/CD) module
"Automation is a part of JetBrains Space responsible for CI/CD. It lets you
build, test, and deploy your projects." (automation.html)

Core concepts (automation-concepts.html):
- **Configuration as code**: the *only* way to configure Automation is a script;
  the UI is read-only visualization of results (logs, tests, artifacts).
- **Kotlin-based DSL**: script is a `.space.kts` file in the repo root (exactly
  one per repo), written in a Kotlin DSL. Example: `job("Run gradlew build") {
  container(image = "ubuntu:latest") { shellScript { content = "./gradlew build" } } }`
- **job**: a task made of steps. "it is not possible to create a chain of
  dependent jobs. All jobs within one script always run in parallel." (up to
  100 jobs/script)
- **step**: smallest unit — answers "what to run" (`shellScript`/`kotlinScript`)
  and "where" — two step types:
  - `host`: runs directly on a worker VM; can chain multiple sequential
    scripts sharing one filesystem.
  - `container`: runs inside a Docker container on a worker; only one script
    block per container step.
  Max 50 steps/job; steps run sequentially or in parallel within a job.
- **worker**: host machine executing jobs — either Space-hosted cloud workers
  (`WorkerPools.SPACE_CLOUD`) or **self-hosted workers** on customer infra
  (jobs-and-actions.html, run-environment.html).
- **Job triggers**: default is Git push; also manual run, and other event
  triggers. Decompiled `JobTriggerType` enum confirms exactly:
  `MANUAL, GIT_PUSH, SCHEDULE, GIT_BRANCH_DELETED, CODE_REVIEW_OPENED,
  CODE_REVIEW_CLOSED, SAFE_MERGE`. Each has a typed DTO (`ManualTriggerDTO`,
  `GitPushTriggerDTO{repoName, repository, branch, commit}`,
  `ScheduleTriggerDTO`, `GitBranchDeletedTriggerDTO{branches}`,
  `CodeReviewOpenedTriggerDTO{reviewId}`, `CodeReviewClosedTriggerDTO{reviewId}`,
  `SafeMergeTriggerDTO{userId, serviceName, operation}`), all sharing base
  `TriggerDTO(triggerTime, commitDetails)`.
- **Failure conditions**: `FailureConditionDTO` sealed type with
  `NonZeroExitCodeDTO`, `OutOfMemoryDTO`, `TestFailedDTO`, `TimeOutDTO`.
- Default job timeout 2h (also max, per docs).
- **Artifacts**: build artifacts can be stored and referenced; `Artifact` DTO
  ties an artifact to a `ProjectPackageRepository` (i.e. Automation artifacts
  ARE published into the Packages module) — `Artifact(id, projectRepository,
  name, version, usageType: ArtifactUsageType, path, size)`.
- **File caching between steps**: "Cache Files" / "Share Files Between Steps"
  docs pages — `FileCacheRuleDTO` referenced in `ArtifactServiceProxy`/
  `WorkerServiceApiDecorators`.
- **Test reporting**: rich TeamCity-style service-message protocol
  (`circlet/pipelines/messages/`): `TestStartServiceMessage`,
  `TestPassedServiceMessage`, `TestFailureServiceMessage`,
  `TestIgnoreServiceMessage`, `TestSuiteStartServiceMessage`,
  `TestSuiteEndServiceMessage`, `TestStdOutServiceMessage`,
  `TestStdErrServiceMessage`, `FileShareSizeServiceMessage`,
  `AllLogsReportedServiceMessage`, with `TextMessageSeverity` levels.
- **Compute pools / requirements**: jobs can require specific compute
  (`ComputeEngines`: `K8S_ENGINE_ID`, `EC2_ENGINE_ID`, `LOCAL_DOCKER`),
  `ComputeResourceType` (`Manual`|`Managed`), `ResourceRequirementsDTO
  (minCpuMillis, minMemoryBytes, minVolumeSizeBytes)`, `OSRequirementsDTO
  (type: OsType, name, arch, version)`, `WorkerTagsRequirementsDTO`,
  `StepRequirementsDTO` sealed as `ContainerRequirements`/`HostRequirements`.
- **Self-hosted workers**: `WorkerDTO` is extensive — id, name, owner
  principal, `WorkerInfoDTO`, `WorkerComputePoolDTO`, `WorkerVersionDTO`,
  lastAccessTime, `WorkerStatus`, `WorkerScope`, suspended flag, list of
  `PR_Project` the worker serves, `WorkerTagDTO` tags, `WorkerStepsStatsDTO`,
  `WorkerStatsDTO`, `WorkerCapability` list, `WorkerPermanentTokenInfoDTO`
  (permanent auth token for the worker agent). Worker version pinning/locking
  supported (`WorkerVersionsProxy.lockVersion/clearCache`).
- **Execution graph model** (`pipelines/common/api/`): a job run is a
  `GraphExecution(graphExecutionId)`; steps within it are
  `StepExecution(graphExecutionId, stepExecutionId)`; services started by a
  step are `ServiceExecution`/`NamedServiceExecution`. Execution states:
  `ExecutionStatus` enum (ordered) = `SCHEDULED, PENDING, READY_TO_START,
  RUNNING, FINISHING, FINISHED, TERMINATING, TERMINATED, HIBERNATING,
  HIBERNATED, RESTARTING, FAILED, SKIPPED` — note HIBERNATING/HIBERNATED,
  i.e. Automation can suspend/resume a running job (cost-saving pause).
  Per-action status: `ActionExecutionStatus = PENDING, RUNNING, FINISHED,
  TERMINATED`. Finish semantics: `ExecutionFinishedState = SUCCESSFUL,
  UNSUCCESSFUL, STOPPED, SKIPPED`; `FinishConditionType = MESSAGES_RECEIVED,
  EXECUTION_FINISHED, SNAPSHOT_CREATED`.
- **DSL evaluation service** (`DslEvaluationService`): server-side evaluation
  of the `.space.kts` script producing `ScriptConfigSerializedModel`; supports
  `findDslLineNumber` (jump-to-source for a running step) and
  `getDeclaredJobParameters`/`DeclaredParameterDTO` (typed input parameters,
  incl. `Secret` vs `Text` — see `JobExecutionDeclaredParameter`).
- **Job/Job-execution API surface** (`JobService` — full method list decompiled):
  `listJobs`, `listProjectJobs`, `getProjectJobsByIds`, `findJobInProject`,
  `getJobNames`, `start` (branch + parameters + checkoutRevisions),
  `launch` (by jobName/repo/commit/codeReviewNumber), `overview` (live channel
  of `JobOverviewDTO`), `exists`, `currentJobRevision`,
  `getJobsWithLastExecution`, `getJobsForExecutions`,
  `getLastExecutionsInDefaultBranches`, `getLastExecutions`,
  `resetExecutionNumber`, `findDslLineNumber`, `workersCompatibilityInfo`,
  `getDeclaredJobParameters`, `getGeneratedModel`.
- **Permissions** (`circlet/pipelines/*Automation*.java`, `common/permissions`):
  global rights `ManageAutomation`, `ViewAutomation` (right group
  `AutomationGroup`); separate self-hosted-worker rights group
  `AutomationWorkers` with `ViewAutomationWorkers`, `AdminAutomationWorkers`,
  `CreateOrgAutomationWorkers`, `CreateProjectAutomationWorkers` (the latter
  gated by feature flag `AppFeatureFlag.ProjectScopedAutomationWorkers`).
- Examples/integrations documented: Android, Dart, Docker, Helm Charts,
  Gradle, Maven, .NET / .NET Core / .NET Framework, Node.js/npm, Python,
  Rust, Slack.

### 1.3 Deployments module
"Deployment is delivering source code changes from Space to a deployment
environment (a deployment target in terms of Automation)." (deployments.html)
Key points from docs:
- Deployments are **not** a CI/CD engine themselves — "Deployments don't do
  any CI/CD tasks by themselves: They don't compile code or publish build
  artifacts... A deployment is only a state machine that tracks deployment
  status by receiving updates from a CI/CD tool" — works with Space
  Automation OR external tools (TeamCity, Jenkins, GitHub Actions) via the
  `space` CLI or HTTP API.
- **Deployment target**: a named destination (staging/production/mobile/etc.),
  created per-project with Name, Description, Key (unique id used in API/DSL
  calls), and linked Git Repositories.
- **Deployment status state machine** (docs): `scheduled → deploying → current
  → completed`, plus `hanging` (auto after configurable timeout, default
  30 min) and `failed` (auto after configurable timeout, default 120 min).
  Decompiled `DeploymentStatus` enum confirms: `SCHEDULED, DEPLOYING, FAILED,
  CURRENT, OBSOLETE, HANGING` with helper predicates `isDeployed`,
  `isSuccessfullyDeployed`, `isInProgress`. (Docs' "completed" ≈ decompiled
  `OBSOLETE` — a former CURRENT superseded by a new one.)
  Only one deployment can be CURRENT per branch: "there can be only one
  deployment for a Git branch."
- Auth: CI/CD tool authenticates via a Space application + permanent token
  with permissions `View deployments` / `Modify deployments` / `Modify
  deployment targets`; Space Automation jobs use a built-in service principal
  and don't need a separate token.
- `DeploymentsService` API surface (decompiled): `schedule`, `start`,
  `syncWithAutomationJob` (bool flag — auto-link a deployment to an Automation
  job execution), `finish`, `fail`, `update`, `createOrUpdateHistorical`
  (backfill past deployments), `list`, `getCurrentAndNext`, `delete`,
  `deleteHistorical`, `get`, `listJobs` (Automation jobs associated with a
  deployment), `findNeighbors`, `refresh`.
- `DeployTargetsService` API surface: `create`(key, name, description,
  repositories, manualControl, singleScheduled, hangTimeoutMinutes,
  failTimeoutMinutes, responsibleUsers, responsibleTeams, links, customFields),
  `list`/`search` (with customFilters, showArchived, sort), `listTargetNames`,
  `listFavorites`, `fetchTarget`, `updateTarget`, `deleteTarget`,
  `archiveTarget`/`restoreTarget`, `reorderTargets`, `subscribe`/`unsubscribe`,
  `transferToProject`.
- Deployment change tracking: `DeploymentRecord` carries
  `commitsAdded/mergesAdded/issuesAdded` and `commitsReverted/mergesReverted/
  issuesReverted` counts plus derived `totalCommits/totalMerges/totalIssues`
  — i.e. Space auto-computes the changelog (commits/PRs/issues) between the
  previous and current deployed version, matching docs: "history of changes
  between the previous and the current version."
  `DeploymentCommitRefDetails` list carries the actual commit refs.
- External link support: `ExternalLink` field on both deployment and target
  (e.g. link out to an external CD tool's build/run page).
  `DeploymentWebhookEvent` exists — deployments can notify external systems.
- Health check: docs explicitly flag "(Not yet available) In the future,
  deployments will be able to perform a target health check" — confirmed
  **not implemented** in this era of Space.
- Custom fields on deploy targets (`CustomFieldInputValue`) — deploy targets
  participate in Space's generic custom-fields system.

---

## 2. Real Data Model (from decompile)

Field lists below are reconstructed from `@Metadata(d2=[...])` string tables in
`jadx-out` sources — these preserve original Kotlin property names even though
JVM member names are obfuscated (`f60487a`, etc.), so this is the **actual**
API shape, not inferred.

### 2.1 Common package types (`circlet.client.api.packages`)
```
interface Package { type: PackageType; repository: String; name: String }
interface PackageVersion : Package { version: String; tags: List<String> }
interface PackageVersionDetails : PackageVersion, PinnableVersionInfo {
  created: Long; accessed: Long?; downloads: Long; pinned: Boolean;
  comment: String?; diskSize: Long; author: CPrincipal?; authors: List<CPrincipal>?;
  origin: PackageOrigin?; metadata: Map<String,String>?
}
sealed class PackageOrigin { Build; Url }   // origin = built by a CI job, or manually uploaded via URL
data class PackageData : Package { versions: Long; updated: Long; lastVersion: String }
data class PackageVersionInfo : PackageVersion  // lightweight list-row shape
data class PackageRepository : ARecord {
  id; type: PackageType; name; description; public: Boolean; cleanupEnabled: Boolean;
  settings: ES_PackageRepositorySettings; mode: PackageRepositoryMode; archived: Boolean; arenaId
}
data class ProjectPackageRepository : ARecord {
  id; project: Ref<PR_Project>; name; description; repository: Ref<PackageRepository>;
  permissions: List<...>; archived; arenaId
}
data class GlobalPackageRepository : ARecord { id; name; description; repository: Ref<PackageRepository>; archived; arenaId }
enum PackageRepositoryMode { HOSTING, PROXY }
enum PackageRepositoryConnectionType { REMOTE, SPACE }
data class RetentionPolicyParams(numberOfDaysToRetain: Int?, numberOfVersionsToRetain: Int?, retainDownloadedOnce: Boolean)
data class PackageStats(diskSize: Long, versions: Long, downloads: Long)
data class PackageRepositoryStats(diskSize, diskSizeInPercent: Double?, diskSizeUsed: Long?, diskSizeTotal: Long?, packages: Int, packageVersions: Int)
data class PackagesPublishing(publishingId, source: PublishingSource, created, started: Long?, completed: Long?, successful: Boolean, error: String?, principal: CPrincipal)
data class VulnerabilityOverview(dependencyType, dependencyNamespace, dependencyName, dependencyVersion, newVersion, status, vulnerabilities: List<PackageVulnerability>)
data class PackageVulnerability(id, title, description, cvssScore: Double, cvssVector, cve, cwe, reference)
```

### 2.2 Per-format package version details (all extend `PackageVersionDetails`)

| Type | Class | Type-specific fields |
|---|---|---|
| **Maven** | `MavenPackageVersionDetails` | `packaging, packageName, description, url, licenses: List<String>, scmUrl, dependencies: List<MavenPackageDependency>, kotlinPlatforms: List<KotlinPlatform>, parent: MavenPackageParent?, pathPrefix, files: List<MavenPackageFile>`. Dependency: `MavenPackageDependency(scope, group, artifact, version)`. Settings capabilities: Proxy+Publish+VersionedRetention+VulnerabilityChecks, plus `enableSnapshots: Boolean`. Extra: `NexusService`, `NexusStagingProfile`, `MavenChecksum`, `KotlinPlatform` — Space's Maven repo doubles as a Nexus-compatible staging endpoint for Central-style 2-phase releases. |
| **npm** | `NpmPackageVersionDetails` | `description, dependencies: List<NpmPackageDependency>, keywords, license, projectUrl, repositoryUrl, repositoryRevision, readme, unityVersion` (unityVersion = supports Unity-flavored npm packages). Dependency: `NpmPackageDependency(name, version, type)`. Settings: Proxy+VersionedRetention+VulnerabilityChecks (no explicit Publish interface — publish is implicit/always-on). |
| **NuGet** | `NuGetPackageVersionDetails` | `verbatimVersion, description, projectUrl, license, licenseUrl, icon, title, dependencies: List<NuGetDependency>`. Dependency: `NuGetDependency(targetFramework, id, range)` + computed `version`. Settings: VersionedRetention+Publish+VulnerabilityChecks. |
| **PyPI** | `PythonPackageVersionDetails` | `notNormalizedName, platform, summary, description, descriptionContentType, keywords, homePage, authorFromPackageDetails, authorEmail, maintainer, maintainerEmail, license, classifiers: List<String>, projectUrls: List<PythonPackageUrl>, requiresDist, requiresPython, files: List<PythonPackageFile>`. Settings: Proxy+Publish+VersionedRetention (no vuln-check interface). |
| **Dart** | `DartPackageVersionDetails` | `description, homePage, repositoryUrl, issueTracker, documentation, license, readme, changelog, dependencies: List<DartPackageDependency>, devDependencies, dependencyOverrides, environment`. Dependency: `DartPackageDependency(name, version)` (bare pubspec-style). Settings: Proxy+Publish+VersionedRetention. |
| **Composer (PHP)** | `ComposerPackageVersionDetails` | `description, homepage, dependencies: List<ComposerPackageDependency>, keywords, license, projectUrl, repositoryUrl, repositoryRevision, readme`. Dependency: `ComposerPackageDependency(name, version, type)`. Extra: `ComposerVcsConnection`, `ComposerUser`, `ComposerArchive`, `ComposerSource`, `ComposerMetadata`, `MinimumStabilityEnum`. Settings: VersionedRetention only (no proxy/publish interfaces declared — narrowest of all types). |
| **Container (Docker/OCI + Helm)** | `ContainerPackageVersionDetails` | `schemaVersion: Int, mediaType, manifestType, image: ContainerImage?, chart: ContainerHelmChart?, subject: PackageVersionRef?` (subject = OCI referrers/artifact-attachment support, e.g. signatures/SBOMs). `ContainerManifestContent` base → `{name, description, tags, projectUrl, sourceUrl, version}` shared by `ContainerImage` (adds `platform: ContainerImagePlatform{os,osVersion,arch}, history: List<ContainerImageLayer>, children: List<ContainerManifest>, config: ContainerImageConfig{userName, ports, volumes, env, workingDir, entryPoint, cmd, healthcheck, labels}, annotation: ContainerImageAnnotation{created,buildName,buildUrl,revision,vendor,documentationUrl,licenses}`) and `ContainerHelmChart` (adds `apiVersion, appVersion, dependencies: List<ContainerHelmChartDependency>, type`). Settings: `immutableTags: Boolean` + Proxy+Publish+VersionedRetention. |
| **Files (generic)** | `FileDetails`/`FileType` | Generic blob storage repo type; `FileResources`, `FileStats`, `ProjectFiles`. Settings: base `PackageRepositoryRetentionPolicy` (non-versioned) + Proxy. |

Base `PackageDependency` interface (`circlet.packages.api`): `scope/group/artifact/
version` shape per type, but all expose a computed `readableName` and
`commonDescription: CommonDependencyDescription` used for cross-ecosystem
dependency-graph/vulnerability UI.

### 2.3 Automation / Pipelines (`circlet.pipelines.*`)
```
data class JobDTO(id, name, repoName, repository: RepositoryInProject, archive: Boolean)
data class JobOverviewDTO(job: JobDTO, currentRevision: CurrentJobRevisionDTO, lastFinishedExecution: JobExecutionDTO?, ongoingExecutions: Collection<JobExecutionDTO>)
data class JobWithLastExecutionDTO(job: JobDTO, execution: JobExecutionDTO?)
data class JobExecutionInBranchDTO(job, branch: Branch, execution: JobExecutionDTO?, allBranches: Boolean?, obsolete: Boolean?)
data class JobExecutionDTO(
  executionId, executionNumber: Long, jobId, jobName, projectId, branch,
  status: ExecutionStatus, triggeredTime: Long, startedTime: Long?, finishedTime: Long?,
  changesCount: Int, failureConditions: Collection<FailureConditionDTO>, commitId
)
data class JobExecutionDetailsDTO(  // adds full trigger + repo + permission context
  executionId, executionNumber, jobId, jobName, projectId, status: ExecutionStatus,
  triggeredTime, startedTime, finishedTime,
  repositories: List<RepositoryDTO>, usedWorkers: List<WorkerDTO>,
  repository, isRepositoryDeleted: Boolean, branch, commit, changesFromExclude,
  changesCount: Int, triggerInfo: TriggerDTO, failureConditions: Collection<FailureConditionDTO>,
  permissionsGranted: Collection<JobExecRightDTO>, stoppedBy: CPrincipal?
)
sealed class TriggerDTO(triggerTime: Long, commitDetails: TriggerCommitDetailsDTO?)
  ManualTriggerDTO(+ userId, serviceName)
  GitPushTriggerDTO(+ repoName, repository: RepositoryInProject, branch, commit)
  ScheduleTriggerDTO
  GitBranchDeletedTriggerDTO(+ branches: List<String>)
  CodeReviewOpenedTriggerDTO(+ reviewId: Long)
  CodeReviewClosedTriggerDTO(+ reviewId: Long)
  SafeMergeTriggerDTO(+ userId, serviceName, operation)
enum JobTriggerType { MANUAL, GIT_PUSH, SCHEDULE, GIT_BRANCH_DELETED, CODE_REVIEW_OPENED, CODE_REVIEW_CLOSED, SAFE_MERGE }
sealed class FailureConditionDTO { NonZeroExitCodeDTO; OutOfMemoryDTO; TestFailedDTO; TimeOutDTO }
data class Artifact(id, projectRepository: Ref<ProjectPackageRepository>, name, version, usageType: ArtifactUsageType, path, size: Long?)
enum ExecutionStatus (ordered) { SCHEDULED, PENDING, READY_TO_START, RUNNING, FINISHING, FINISHED, TERMINATING, TERMINATED, HIBERNATING, HIBERNATED, RESTARTING, FAILED, SKIPPED }
enum ActionExecutionStatus { PENDING, RUNNING, FINISHED, TERMINATED }
enum ExecutionFinishedState { SUCCESSFUL, UNSUCCESSFUL, STOPPED, SKIPPED }
enum FinishConditionType { MESSAGES_RECEIVED, EXECUTION_FINISHED, SNAPSHOT_CREATED }
data class GraphExecution(graphExecutionId: Long)
data class StepExecution(graphExecutionId, stepExecutionId: Long)
data class ServiceExecution(graphExecutionId, stepExecutionId, serviceExecutionId: Long)
data class NamedServiceExecution(graphExecutionId, stepExecutionId, serviceName: String)
enum ComputeEngines { K8S_ENGINE_ID, EC2_ENGINE_ID, LOCAL_DOCKER }
enum ComputeResourceType { Manual, Managed }
data class ResourceRequirementsDTO(minCpuMillis: Long, minMemoryBytes: Long, minVolumeSizeBytes: Long?)
data class OSRequirementsDTO(type: OsType, name, arch, version)
sealed class StepRequirementsDTO { ContainerRequirements; HostRequirements }  // + workerTags, resource
data class WorkerDTO(
  id, name, owner: Ref<TD_MemberProfile>, ownerPrincipal: CPrincipal,
  info: WorkerInfoDTO, computePool: WorkerComputePoolDTO, version: WorkerVersionDTO,
  lastAccessTime: Long, status: WorkerStatus, scope: WorkerScope, suspended: Boolean,
  projects: List<PR_Project>, tags: List<WorkerTagDTO>, stepsStats: WorkerStepsStatsDTO,
  workerStats: WorkerStatsDTO, workerCapabilities: List<WorkerCapability>,
  permanentTokenInfo: WorkerPermanentTokenInfoDTO?
)
```

Test-message wire protocol (`circlet.pipelines.messages`, TeamCity-service-message
style): `TestStartServiceMessage, TestPassedServiceMessage, TestFailureServiceMessage,
TestIgnoreServiceMessage, TestSuiteStartServiceMessage, TestSuiteEndServiceMessage,
TestStdOutServiceMessage, TestStdErrServiceMessage, StderrTextServiceMessage,
TextServiceMessage, FileShareSizeServiceMessage, AllLogsReportedServiceMessage`,
enum `TextMessageSeverity`, enum `TraceLevel {TRACE, INFO, WARN, ERROR}`.

### 2.4 Deployments (`circlet.deployments.api`)
```
data class DeploymentRecord : ARecord, ChangeSummary, DeploymentInfo (
  id, version, scheduledStart: KotlinXDateTime?, startedAt, finishedAt, createdAt,
  status: DeploymentStatus, description, channel: Ref<M2ChannelRecord>?,
  target: DeployTargetRecord, targetKey, syncStatus: DeploymentSyncStatus,
  arenaId, commitRefs: List<DeploymentCommitRefDetails>, jobIds: List<String>,
  externalLink: ExternalLink?, archived: Boolean, temporaryId,
  commitsAdded/mergesAdded/issuesAdded: Int?, commitsReverted/mergesReverted/issuesReverted: Int?,
  // computed: initial: Boolean?, totalCommits/totalMerges/totalIssues
)
data class DeploymentData : DeploymentInfo (  // lightweight/subscription shape
  id, version, createdAt, scheduledStart, startedAt, finishedAt, targetKey,
  status: DeploymentStatus, syncStatus: DeploymentSyncStatus, externalLink: ExternalLink?,
  commitRefs: List<DeploymentCommitRefDetails>
)
data class DeployTargetRecord : AExtendedEntityRecord (
  id, projectId, name, key, description, createdAt, lastUpdated, lastDeployed,
  channel: Ref<M2ChannelRecord>?, number: Int?, fullNumberId, connectedChannel,
  arenaId, archived: Boolean, temporaryId
)
enum DeploymentStatus (ordered) { SCHEDULED, DEPLOYING, FAILED, CURRENT, OBSOLETE, HANGING }
  + isDeployed / isSuccessfullyDeployed / isInProgress helpers
```
`DeploymentsService` API: `schedule, start, syncWithAutomationJob, finish, fail,
update, createOrUpdateHistorical, list, getCurrentAndNext, delete,
deleteHistorical, get, listJobs, findNeighbors, refresh`.
`DeployTargetsService` API: `create, list/search (customFilters, showArchived,
sortBy/sortOrder), listTargetNames, listFavorites, fetchTarget, updateTarget,
deleteTarget, archiveTarget/restoreTarget, reorderTargets, subscribe/unsubscribe,
transferToProject`. Deploy targets support `responsibleUsers`/`responsibleTeams`
(ownership), `links: List<DeployTargetLink>`, `customFields`
(`CustomFieldInputValue` — plugged into Space's generic custom-fields engine),
`manualControl`/`singleScheduled` flags, `hangTimeoutMinutes`/`failTimeoutMinutes`
(matches docs' configurable hanging/failed auto-timeouts, defaults 30/120 min).
`DeploymentWebhookEvent` — external notification on status change.

---

## 3. Key Features List

**Packages (registry):**
1. Multi-format hosting: Maven (+Nexus-staging 2-phase publish), npm (+Unity
   flavor), NuGet, PyPI, Dart/pub, Docker/OCI images + Helm charts, Composer
   (PHP), generic file storage. (Rust/crates.io flagged but not shipped.)
2. Repository modes: hosting vs. proxy (mirror upstream public registry).
3. Repository scope: per-project (`ProjectPackageRepository`) or org-global
   (`GlobalPackageRepository`), each independently permissioned.
4. Retention policies (by age/version-count, "keep if ever downloaded" opt-out).
5. Immutability toggles (immutable versions / immutable container tags).
6. CVE vulnerability scanning per dependency (Maven/npm/NuGet only, per
   decompile — not PyPI/Dart/Composer/Container).
7. Package version pinning (`pinned`, `pinnedCopy()` on every version-details type).
8. Disk usage / download-count stats & quota dashboards.
9. Granular sharing (Manager/Writer/Viewer) + global cross-repo package search.
10. Async publish job tracking (`PackagesPublishing` states incl. error capture).
11. OCI "subject" (referrers) support — attach signatures/SBOM/attestations to
    a container artifact.
12. Container image healthcheck (feature-flagged).
13. Goto/Everything quick-search integration for packages.

**Automation (CI/CD):**
1. Kotlin DSL, config-as-code, single `.space.kts` per repo, max 100
   jobs/script, 50 steps/job, 2h max job timeout.
2. Jobs run in parallel (no DAG/dependency chaining between jobs — a real
   product limitation vs. GitHub Actions/GitLab CI `needs:`).
3. Two step execution environments: `host` (VM, sequential multi-script,
   shared FS) vs `container` (Docker, single script).
4. 7 trigger types: manual, git push, schedule (cron), git-branch-deleted,
   code-review-opened, code-review-closed, safe-merge.
5. 4 failure-condition types: non-zero exit, OOM, test-failed, timeout.
6. Rich execution state machine incl. HIBERNATING/HIBERNATED (pause/resume
   long jobs to save compute).
7. TeamCity-style structured test reporting protocol (suite/test start/pass/
   fail/ignore, stdout/stderr streaming, severity levels).
8. Compute engine abstraction: Space-managed K8s / EC2 / local-docker cloud
   workers, or self-hosted workers with tags, capabilities, versions, stats,
   permanent tokens, per-project/org scoping and dedicated permission group.
9. Resource requirement matching (CPU/memory/volume min, OS type/arch/version,
   worker tags) with compatibility-check API (`workersCompatibilityInfo`).
10. Build artifacts stored directly into a project's Package repository
    (`Artifact` ties to `ProjectPackageRepository`), plus inter-step file
    caching/sharing.
11. Declared job parameters, typed Text vs Secret, with default-value
    override detection.
12. DSL server-side evaluation service + "jump to DSL line" for a running step.
13. Job history/browsing: overview channel (live), last-execution-per-branch,
    executions-by-ids, execution revisions (script hash/commit), reset
    execution counter.
14. Fine-grained per-execution permission grants (`JobExecRightDTO`) and
    ability to record who stopped a run (`stoppedBy: CPrincipal`).

**Deployments:**
1. Explicit state machine: scheduled → deploying → current → obsolete
   (completed), plus automatic hanging/failed after configurable timeouts.
2. CI/CD-tool agnostic — works with Space Automation or external tools
   (TeamCity/Jenkins/GitHub Actions) via `space` CLI or HTTP API + permanent
   app tokens.
3. One current deployment per Git branch; explicit branch or commit required.
4. Auto-computed changelog between deployments: commits/merges/issues
   added & reverted (`DeploymentRecord.commitsAdded` etc.), surfaced as
   totals.
5. Deploy targets: named, keyed, linked to repositories, with
   responsible users/teams, custom fields, external links, manual-control
   toggle, single-scheduled-at-a-time toggle, per-target hang/fail timeout.
6. Deployment ↔ Automation-job linkage (`syncWithAutomationJob`,
   `listJobs` on a deployment) and job execution can auto-drive deployment
   status.
7. Historical/backfill deployment creation (`createOrUpdateHistorical`) for
   retroactively importing a deploy history.
8. Webhook notification on deployment status change.
9. Target health-check explicitly documented as **not implemented**
   ("Not yet available") even in Space's final form — a known permanent gap
   in the original product, not something gaia-space needs to "catch up" on.

---

## 4. gaia-space Gap Analysis

Checked: `~/projects/gaia-space/lib/ui/screens/home/pipeline_screen.dart` and
`grep`-scanned all of `lib/` for package/registry/artifact/deployment/npm/
maven/nuget/pypi/docker-registry terms.

**Findings:**
- `lib/ui/screens/home/pipeline_screen.dart` is a **pure UI placeholder** —
  a `Scaffold` wrapping `EmptyState(icon: Icons.account_tree, title: 'CI/CD
  Pipelines', message: 'Set up continuous integration and deployment
  pipelines for your projects.', actionText: 'Create Pipeline')` with a FAB
  whose `onPressed` is `// TODO: Implement pipeline creation`. No pipeline
  list, no job model, no execution status, no DSL editor, nothing wired to
  any backend/service.
- No `lib/core/models/*` file for packages, artifacts, jobs, workers,
  deployments, or deploy targets (models dir only has git/repo/PR/workspace/
  project/document/branch-protection/custom-command/discord/fork-relationship/
  user).
- No `lib/core/services/*` for packages/CI/deployments (services dir only has
  auth/avatar/repository/pull-request/fork/branch-protection/custom-command/
  discord/navigation/git-activity).
- No screen anywhere for: package repositories/browsing, package version
  details, deploy targets, deployment history/state-machine, self-hosted
  workers, job execution logs/test results, `.space.kts`-equivalent script
  editor, triggers configuration, secrets/parameters management.

### Have
- Nothing. (0% coverage of this entire domain.)

### Partial
- `pipeline_screen.dart` exists as a **navigable placeholder route** only —
  UI shell/icon/copy present, zero data model or logic. Counts as "route
  exists" but not "feature partial."

### Missing (full list, in priority-for-parity order)
1. **Package registry module entirely**: no repository CRUD, no per-type
   (Maven/npm/NuGet/PyPI/Dart/Container/Composer/Files) browsing or publish
   UI, no version details/dependency graph, no retention/vulnerability
   settings, no stats/quota dashboards, no proxy-mode config.
2. **CI/CD job/pipeline model**: no `JobDTO`/`JobExecutionDTO` equivalents, no
   execution-status state machine, no trigger configuration UI (manual/git
   push/schedule/branch-deleted/code-review/safe-merge), no failure
   conditions, no artifact-publish-to-package linkage.
3. **Script/DSL editing**: no `.space.kts`-equivalent pipeline-as-code editor
   or evaluation/validation service.
4. **Workers**: no self-hosted-worker registration, tags, capabilities,
   compute-pool/requirements matching, or worker stats UI.
5. **Test reporting**: no structured test-result ingestion/display
   (suite/case pass/fail/stdout streaming).
6. **Deployments module entirely**: no deploy-target CRUD, no deployment
   state machine (scheduled/deploying/current/obsolete/hanging/failed), no
   changelog-between-deployments computation, no deployment↔job linkage, no
   webhook/external-link support, no historical/backfill import.
7. **Permissions**: no equivalent of `ManageAutomation`/`ViewAutomation`/
   worker-admin rights groups, or package sharing (`Manager`/`Writer`/`Viewer`).

### Recommendation for parity work
Given zero existing scaffolding, build order should mirror the module
boundaries above: (1) package repository CRUD + one format (start with
generic Files or Container, since gaia-space likely already has some
artifact/storage concept to build on) → (2) minimal job/pipeline model with
manual trigger only + host-step execution status polling → (3) deploy targets
+ manual status transitions → (4) layer in git-push triggers, DSL/script
storage, self-hosted workers, and vulnerability/retention policy as later
milestones.
