// Packages + CI/CD (Automation) + Deployments API surface — thin invoke() wrappers over
// src-tauri/src/pipelines.rs. Kept standalone from ../api.ts (owned by another lane): types +
// calls needed by views/Packages.tsx + views/Pipelines.tsx + their .css only.
import { invoke } from "@tauri-apps/api/core";

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ---------- Space's real Automation limits (docs/space-knowledge-base/03-packages-cicd.md) ----------
export const MAX_JOBS_PER_SCRIPT = 100;
export const MAX_STEPS_PER_JOB = 50;
export const MAX_JOB_TIMEOUT_SECS = 7200; // 2h — also the max, per docs
export const DEFAULT_JOB_TIMEOUT_SECS = 7200;
export const PACKAGE_FORMATS = ["maven", "npm", "nuget", "pypi", "dart", "container", "composer", "file"] as const;
export type PackageFormat = (typeof PACKAGE_FORMATS)[number];
export const REPO_MODES = ["HOSTING", "PROXY"] as const;

// ---------- pipeline scripts (config-as-code, JSON in place of .space.kts) ----------
/** Tagged like Rust's `#[serde(tag = "type")]` on `TriggerDef`: there is no `rename_all`, so
 * the wire tag is the *variant* name (`{"type":"GitPush",...}`). Pinned against the serialized
 * output in `pipelines::tests::serialized_dsl_tags_are_variant_names`. Legacy snake_case and
 * SCREAMING tags are still accepted on input (Rust keeps serde aliases) but never emitted. */
export type TriggerDef =
  | { type: "Manual" }
  | { type: "GitPush"; branches: string[]; repository?: string | null }
  | { type: "Schedule"; cron: string }
  | { type: "GitBranchDeleted"; branches: string[] }
  | { type: "CodeReviewOpened" }
  | { type: "CodeReviewClosed" }
  | { type: "SafeMerge" };
/** Mirrors Rust `StepDef`: one script per step (singular `script`), optional env map. */
export type StepDef =
  | { type: "Shell"; script: string; env?: Record<string, string> }
  | { type: "Container"; image: string; script: string; env?: Record<string, string> };
/** Mirrors Rust `TriggerEvent` (same tagging rule). */
export type TriggerEvent =
  | { type: "Manual" }
  | { type: "Push"; repository: string; branch: string }
  | { type: "BranchDeleted"; repository: string; branch: string }
  | { type: "CodeReviewOpened"; review_id: string }
  | { type: "CodeReviewClosed"; review_id: string }
  | { type: "SafeMerge"; review_id: string };
export type ScriptJobDef = { name: string; trigger_type: string; timeout_secs: number | null; steps: StepDef[]; triggers?: TriggerDef[] };
export type ScriptDef = { jobs: ScriptJobDef[] };

export type PipelineScript = { id: string; project_id: string; repository: string | null; path: string; source: string; archived: boolean };
export type Job = { id: string; script_id: string; name: string; trigger_type: string; archived: boolean };
export type JobRun = { id: string; job_id: string; status: string; log: string | null; triggered_at: number; started_at: number | null; finished_at: number | null; worker_id: string | null; required_tags_json: string | null };
export type Worker = { id: string; name: string; os: string; tags_json: string; status: "ONLINE" | "OFFLINE" | "DISABLED"; registered_at: number; last_seen_at: number; suspended: boolean };
export type JobArtifact = { id: string; job_run_id: string; name: string; size_bytes: number; created_at: number };
export type JobArtifactInput = { id: string; job_run_id: string; name: string; content: number[] };
export type TestReport = { id: string; job_run_id: string; suite: string; test_name: string; status: "PASSED" | "FAILED" | "SKIPPED"; duration_ms: number | null; message: string | null; created_at: number };
export type TeamCityTestReportInput = { job_run_id: string; messages: string };

export const JOB_TRIGGER_TYPES = ["MANUAL", "GIT_PUSH", "SCHEDULE", "GIT_BRANCH_DELETED", "CODE_REVIEW_OPENED", "CODE_REVIEW_CLOSED", "SAFE_MERGE"] as const;
export const RUN_TERMINAL_STATUSES = ["FINISHED", "TERMINATED", "FAILED", "SKIPPED"];
export function isTerminalRun(status: string): boolean {
  return RUN_TERMINAL_STATUSES.includes(status);
}

export function emptyScriptDef(): ScriptDef {
  return { jobs: [] };
}
/** Canonical tag for every spelling Rust's serde aliases accept. */
const STEP_TAGS: Record<string, "Shell" | "Container"> = {
  Shell: "Shell", shell: "Shell", SHELL: "Shell", Host: "Shell", host: "Shell", HOST: "Shell",
  Container: "Container", container: "Container", CONTAINER: "Container",
};
const TRIGGER_TAGS: Record<string, TriggerDef["type"]> = {
  Manual: "Manual", manual: "Manual", MANUAL: "Manual",
  GitPush: "GitPush", git_push: "GitPush", gitPush: "GitPush", GIT_PUSH: "GitPush",
  Schedule: "Schedule", schedule: "Schedule", SCHEDULE: "Schedule",
  GitBranchDeleted: "GitBranchDeleted", git_branch_deleted: "GitBranchDeleted", GIT_BRANCH_DELETED: "GitBranchDeleted",
  CodeReviewOpened: "CodeReviewOpened", code_review_opened: "CodeReviewOpened", CODE_REVIEW_OPENED: "CodeReviewOpened",
  CodeReviewClosed: "CodeReviewClosed", code_review_closed: "CodeReviewClosed", CODE_REVIEW_CLOSED: "CodeReviewClosed",
  SafeMerge: "SafeMerge", safe_merge: "SafeMerge", SAFE_MERGE: "SafeMerge",
};
function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;
}
function envOf(value: Record<string, unknown>): { env?: Record<string, string> } {
  return value.env && typeof value.env === "object" && !Array.isArray(value.env) ? { env: value.env as Record<string, string> } : {};
}
/** One input step may expand to several: the pre-DSL `{type:"host",scripts:[…]}` shape (which
 *  the server rejects outright) becomes one `Shell` step per script. */
function normalizeStep(step: unknown): StepDef[] {
  if (typeof step === "string") return [{ type: "Shell", script: step }];
  if (!step || typeof step !== "object") return [];
  const value = step as Record<string, unknown>;
  const tag = typeof value.type === "string" ? STEP_TAGS[value.type] : undefined;
  if (tag === "Shell") {
    if (typeof value.script === "string") return [{ type: "Shell", script: value.script, ...envOf(value) }];
    const legacy = stringArray(value.scripts);
    return legacy ? legacy.map((script): StepDef => ({ type: "Shell", script })) : [];
  }
  if (tag === "Container" && typeof value.image === "string" && typeof value.script === "string") return [{ type: "Container", image: value.image, script: value.script, ...envOf(value) }];
  return [];
}
function normalizeTrigger(trigger: unknown): TriggerDef | null {
  if (!trigger || typeof trigger !== "object") return null;
  const value = trigger as Record<string, unknown>;
  const tag = typeof value.type === "string" ? TRIGGER_TAGS[value.type] : undefined;
  switch (tag) {
    case "Manual": case "CodeReviewOpened": case "CodeReviewClosed": case "SafeMerge": return { type: tag };
    case "GitPush": {
      const branches = stringArray(value.branches) ?? []; // Rust defaults both fields
      return typeof value.repository === "string" ? { type: "GitPush", repository: value.repository, branches } : { type: "GitPush", branches };
    }
    case "Schedule": return typeof value.cron === "string" ? { type: "Schedule", cron: value.cron } : null;
    case "GitBranchDeleted": return { type: "GitBranchDeleted", branches: stringArray(value.branches) ?? [] };
    default: return null;
  }
}
/** Converts legacy string steps and `trigger_type` into the tagged script schema. */
export function normalizeJob(job: unknown): ScriptJobDef | null {
  if (!job || typeof job !== "object") return null;
  const value = job as Record<string, unknown>;
  if (typeof value.name !== "string") return null;
  const steps = Array.isArray(value.steps) ? value.steps.flatMap(normalizeStep) : [];
  const explicitTriggers = Array.isArray(value.triggers) ? value.triggers.map(normalizeTrigger).filter((trigger): trigger is TriggerDef => trigger !== null) : undefined;
  const trigger_type = typeof value.trigger_type === "string" ? value.trigger_type : "MANUAL";
  return { name: value.name, trigger_type, timeout_secs: typeof value.timeout_secs === "number" ? value.timeout_secs : null, steps, ...(explicitTriggers?.length ? { triggers: explicitTriggers } : {}) };
}
export function parseScriptSource(source: string): ScriptDef {
  try {
    const parsed = JSON.parse(source) as { jobs?: unknown };
    if (parsed && Array.isArray(parsed.jobs)) return { jobs: parsed.jobs.map(normalizeJob).filter((job): job is ScriptJobDef => job !== null) };
  } catch { /* fall through to empty */ }
  return emptyScriptDef();
}

/** Editor shape: steps are edited as one script per line. */
export type EditableJob = { name: string; trigger_type: string; timeout_secs: number | null; stepsText: string; triggers?: TriggerDef[] };
/** Editor → wire. Emits the singular-`script` shape the server accepts; one step per line. */
export function serializeJob(job: EditableJob): ScriptJobDef {
  const steps: StepDef[] = job.stepsText.split("\n").map((s) => s.trim()).filter(Boolean).map((script) => ({ type: "Shell", script }));
  return { name: job.name, trigger_type: job.trigger_type, timeout_secs: job.timeout_secs, steps, ...(job.triggers?.length ? { triggers: job.triggers } : {}) };
}
/** Wire → editor. */
export function editableJob(job: ScriptJobDef): EditableJob {
  const { steps, ...rest } = job;
  return { ...rest, stepsText: steps.map((step) => step.script).join("\n") };
}

// ---------- validation parity with pipelines.rs::parse_and_validate_script ----------
// Anything the server refuses must be refused here too, otherwise the UI reports a save that
// the server dropped. Kept as pure functions so they are testable without a backend.
const LEGACY_TRIGGER_TYPES: Record<string, TriggerDef["type"]> = { MANUAL: "Manual", GIT_PUSH: "GitPush", GITPUSH: "GitPush", GIT_BRANCH_DELETED: "GitBranchDeleted", CODE_REVIEW_OPENED: "CodeReviewOpened", CODE_REVIEW_CLOSED: "CodeReviewClosed", SAFE_MERGE: "SafeMerge" };
/** Mirrors Rust `CronField::parse` + `CronSpec::parse` (5 UTC fields). Returns an error string. */
export function cronError(expr: string): string | null {
  const fields = expr.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return `cron expression needs exactly 5 fields (min hour dom mon dow), got ${fields.length}`;
  const ranges: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  for (let i = 0; i < 5; i += 1) {
    const [min, max] = ranges[i];
    let any = false;
    for (const rawPart of fields[i].split(",")) {
      const part = rawPart.trim();
      if (!part) return `empty cron field element in '${fields[i]}'`;
      const slash = part.indexOf("/");
      const range = slash === -1 ? part : part.slice(0, slash);
      const stepRaw = slash === -1 ? "1" : part.slice(slash + 1);
      if (!/^\d+$/.test(stepRaw)) return `invalid cron step '${stepRaw}'`;
      const step = Number(stepRaw);
      if (step === 0) return `cron step must be >0 in '${part}'`;
      const num = (raw: string): number | null => {
        if (!/^\d+$/.test(raw.trim())) return null;
        const v0 = Number(raw.trim());
        const v = max === 6 && v0 === 7 ? 0 : v0; // cron allows 7 = Sunday
        return v < min || v > max ? null : v;
      };
      let lo: number, hi: number;
      if (range === "*") { [lo, hi] = [min, max]; }
      else {
        const dash = range.indexOf("-");
        if (dash > 0) {
          const a = num(range.slice(0, dash)), b = num(range.slice(dash + 1));
          if (a === null || b === null) return `invalid cron value in '${range}'`;
          [lo, hi] = [a, b];
        } else {
          const v = num(range);
          if (v === null) return `invalid cron value '${range}'`;
          [lo, hi] = [v, v];
        }
      }
      if (lo > hi) return `cron range '${range}' is inverted`;
      if (lo + 0 <= hi) any = true;
    }
    if (!any) return `cron field '${fields[i]}' matches nothing`;
  }
  return null;
}
/** Every reason the server would reject this script, in the server's own wording where practical. */
export function scriptDefErrors(def: ScriptDef): string[] {
  const errors: string[] = [];
  const jobs = def.jobs ?? [];
  if (jobs.length > MAX_JOBS_PER_SCRIPT) errors.push(`script exceeds max ${MAX_JOBS_PER_SCRIPT} jobs/script (has ${jobs.length})`);
  const seen = new Set<string>();
  for (const job of jobs) {
    if (!job.name || !job.name.trim()) { errors.push("every job needs a non-empty name"); continue; }
    if (seen.has(job.name)) errors.push(`duplicate job name '${job.name}' in script`);
    seen.add(job.name);
    if (!job.steps?.length) errors.push(`job '${job.name}' needs at least one step`);
    else if (job.steps.length > MAX_STEPS_PER_JOB) errors.push(`job '${job.name}' exceeds max ${MAX_STEPS_PER_JOB} steps/job (has ${job.steps.length})`);
    if (job.timeout_secs != null && (!Number.isInteger(job.timeout_secs) || job.timeout_secs < 1 || job.timeout_secs > MAX_JOB_TIMEOUT_SECS)) errors.push(`job '${job.name}' timeout_secs must be in 1..=${MAX_JOB_TIMEOUT_SECS} (2h max, per Space docs)`);
    for (const step of job.steps ?? []) {
      if (step.type !== "Shell" && step.type !== "Container") {
        errors.push(`job '${job.name}': unknown step type '${String(step.type)}'`);
        continue;
      }
      if (!step.script?.trim()) errors.push(`job '${job.name}' has a step with an empty script`);
      if (step.type === "Container" && typeof step.image !== "string") errors.push(`job '${job.name}': container step needs an image`);
    }
    const triggers = job.triggers?.length ? job.triggers : null;
    if (!triggers) {
      const legacy = (job.trigger_type ?? "MANUAL").trim().toUpperCase();
      if (legacy === "SCHEDULE") errors.push(`job '${job.name}': legacy SCHEDULE trigger needs an explicit cron expression`);
      else if (!LEGACY_TRIGGER_TYPES[legacy]) errors.push(`job '${job.name}': unknown trigger type '${legacy}'`);
    } else {
      for (const trigger of triggers) {
        if (!Object.hasOwn(TRIGGER_TAGS, trigger.type)) {
          errors.push(`job '${job.name}': unknown trigger type '${String(trigger.type)}'`);
          continue;
        }
        if (trigger.type !== "Schedule") continue;
        const err = typeof trigger.cron === "string" ? cronError(trigger.cron) : "schedule trigger needs a cron expression";
        if (err) errors.push(`job '${job.name}': ${err}`);
      }
    }
  }
  return errors;
}

// ---------- deploy targets + deployments ----------
export type DeployTarget = { id: string; project_id: string; name: string; target_key: string; description: string | null; manual_control: boolean; archived: boolean };
export type Deployment = {
  id: string;
  target_id: string;
  version: string;
  status: string; // SCHEDULED | DEPLOYING | FAILED | CURRENT | OBSOLETE | HANGING
  description: string | null;
  job_run_id: string | null;
  scheduled_at: number | null;
  started_at: number | null;
  finished_at: number | null;
};
export type ScheduleDeploymentRequest = { id: string; target_id: string; version: string; description: string | null };

/** Mirrors pipelines.rs allowed_deployment_transition — server is the source of truth; this is UX-only. */
export function allowedDeploymentTransitions(status: string): string[] {
  switch (status) {
    case "SCHEDULED":
      return ["DEPLOYING", "FAILED"];
    case "DEPLOYING":
      return ["CURRENT", "FAILED", "HANGING"];
    case "HANGING":
      return ["FAILED", "CURRENT"];
    case "CURRENT":
      return ["OBSOLETE", "FAILED"];
    default:
      return [];
  }
}

// ---------- package repositories + versions ----------
export type PackageRepository = { id: string; project_id: string | null; name: string; format: string; mode: string; description: string | null; archived: boolean; retention_days: number | null; retention_version_count: number | null; retain_downloaded: boolean; access_level: "PRIVATE" | "PROJECT" | "PUBLIC" };
export type PackageRepositoryAcl = { repository_id: string; profile_id: string; role: "VIEWER" | "WRITER" | "MANAGER" };
export type PackageVersion = { id: string; repository_id: string; package_name: string; version: string; metadata_json: string | null; format_metadata_json: string | null; created_at: number; accessed_at: number | null; downloads: number; pinned: boolean; immutable: boolean };
export type PackageVulnerability = { id: string; package_version_id: string; cve_id: string; severity: string; affected_range: string; title: string | null; description: string | null };
export type DependencyOverview = { version: PackageVersion; vulnerabilities: PackageVulnerability[] };
/** One version a retention policy would delete; `reason` names the limb that matched. */
export type RetentionCandidate = { id: string; package_name: string; version: string; created_at: number; downloads: number; reason: "age" | "count" | "age+count" };

/// Per-format typed detail of one stored version (Rust `package_registry::PackageDetail`).
/// The `format` tag says which fields exist; formats without a protocol model stay generic.
export type DetailDependency = { name: string; requirement: string };
export type OciDescriptor = { digest: string; media_type: string; size: number };
export type PackageDetail =
  | { format: "nuget"; id: string; version: string; authors: string | null; description: string | null; license: string | null; tags: string[]; dependencies: DetailDependency[] }
  | { format: "pypi"; name: string; version: string; summary: string | null; requires_python: string | null; requires_dist: DetailDependency[]; files: string[] }
  | { format: "composer"; name: string; version: string; description: string | null; package_type: string | null; licenses: string[]; require: DetailDependency[] }
  | { format: "container"; name: string; reference: string; media_type: string | null; config: OciDescriptor | null; layers: OciDescriptor[]; total_size: number; subject: string | null }
  | { format: "generic"; name: string; version: string; fields: unknown };

export const pipelinesApi = {
  // scripts
  listScripts: () => invoke<PipelineScript[]>("list_pipeline_scripts"),
  createScript: (script: PipelineScript) => invoke<void>("create_pipeline_script", { script }),
  updateScript: (script: PipelineScript) => invoke<void>("update_pipeline_script", { script }),
  deleteScript: (id: string) => invoke<void>("delete_pipeline_script", { id }),

  // jobs / runs
  listJobsForScript: (scriptId: string) => invoke<Job[]>("list_jobs_for_script", { scriptId }),
  listJobRunsForScript: (scriptId: string) => invoke<JobRun[]>("list_job_runs_for_script", { scriptId }),
  triggerScript: (scriptId: string) => invoke<JobRun[]>("trigger_pipeline_script", { scriptId }),
  triggerOnPush: (scriptId: string, repository: string, branch: string) => invoke<JobRun[]>("trigger_pipeline_on_push", { scriptId, repository, branch }),
  registerWorker: (worker: Worker) => invoke<Worker>("register_worker", { worker }),
  workerHeartbeat: (workerId: string) => invoke<Worker>("worker_heartbeat", { workerId }),
  setWorkerSuspended: (workerId: string, suspended: boolean) => invoke<Worker>("set_worker_suspended", { workerId, suspended }),
  assignJobRun: (workerId: string) => invoke<JobRun | null>("assign_job_run", { workerId }),
  listWorkers: () => invoke<Worker[]>("list_workers"),
  createJobArtifact: (input: JobArtifactInput) => invoke<JobArtifact>("create_job_artifact", { input }),
  downloadJobArtifact: (id: string) => invoke<number[]>("download_job_artifact", { id }),
  listJobArtifacts: (jobRunId: string) => invoke<JobArtifact[]>("list_job_artifacts", { jobRunId }),
  saveTestReport: (report: TestReport) => invoke<void>("save_test_report", { report }),
  listTestReports: (jobRunId: string) => invoke<TestReport[]>("list_test_reports", { jobRunId }),

  // deploy targets
  listDeployTargets: () => invoke<DeployTarget[]>("list_deploy_targets"),
  createDeployTarget: (target: DeployTarget) => invoke<void>("create_deploy_target", { target }),
  updateDeployTarget: (target: DeployTarget) => invoke<void>("update_deploy_target", { target }),
  deleteDeployTarget: (id: string) => invoke<void>("delete_deploy_target", { id }),

  // deployments
  listDeploymentsForTarget: (targetId: string) => invoke<Deployment[]>("list_deployments_for_target", { targetId }),
  scheduleDeployment: (req: ScheduleDeploymentRequest) => invoke<Deployment>("schedule_deployment", { req }),
  transitionDeployment: (id: string, status: string) => invoke<Deployment>("transition_deployment", { id, status }),

  // package repositories
  listPackageRepositories: () => invoke<PackageRepository[]>("list_package_repositories"),
  createPackageRepository: (repo: PackageRepository) => invoke<void>("create_package_repository", { repo }),
  updatePackageRepository: (repo: PackageRepository) => invoke<void>("update_package_repository", { repo }),
  deletePackageRepository: (id: string) => invoke<void>("delete_package_repository", { id }),
  listPackageRepositoryAcl: (repositoryId: string) => invoke<PackageRepositoryAcl[]>("list_package_repository_acl", { repositoryId }),
  setPackageRepositoryAcl: (entry: PackageRepositoryAcl) => invoke<void>("set_package_repository_acl", { entry }),
  removePackageRepositoryAcl: (repositoryId: string, profileId: string) => invoke<void>("remove_package_repository_acl", { repositoryId, profileId }),
  applyPackageRetention: (repositoryId: string) => invoke<number>("apply_package_retention", { repositoryId }),
  packageRetentionCandidates: (repositoryId: string) => invoke<RetentionCandidate[]>("package_retention_candidates", { repositoryId }),
  packageVersionDetail: (repositoryId: string, packageName: string, version: string) =>
    invoke<PackageDetail>("package_version_detail", { repositoryId, packageName, version }),
  repositoryVulnerabilityReport: (repositoryId: string, minSeverity?: string) => invoke<DependencyOverview[]>("repository_vulnerability_report", { repositoryId, minSeverity: minSeverity ?? null }),

  // package versions
  addPackageVulnerability: (vulnerability: PackageVulnerability) => invoke<void>("add_package_vulnerability", { vulnerability }),
  dependencyOverview: (versionId: string) => invoke<DependencyOverview>("dependency_overview", { versionId }),
  listPackageVersions: (repositoryId: string, query?: string) => invoke<PackageVersion[]>("list_package_versions", { repositoryId, query: query ?? null }),
  publishPackageVersion: (args: {
    repositoryId: string;
    packageName: string;
    version: string;
    metadataJson?: string | null;
    payloadFilename?: string | null;
    payloadContent?: string | null;
    immutable?: boolean;
  }) =>
    invoke<PackageVersion>("publish_package_version", {
      repositoryId: args.repositoryId,
      packageName: args.packageName,
      version: args.version,
      metadataJson: args.metadataJson ?? null,
      payloadFilename: args.payloadFilename ?? null,
      payloadContent: args.payloadContent ?? null,
      immutable: args.immutable ?? null,
    }),
  downloadPackagePayload: (repositoryId: string, packageName: string, version: string, filename: string) =>
invoke<number[]>("download_package_payload", { repositoryId, packageName, version, filename }),
setPackageVersionPinned: (id: string, pinned: boolean) => invoke<void>("set_package_version_pinned", { id, pinned }),
deletePackageVersion: (id: string) => invoke<void>("delete_package_version", { id }),
};
