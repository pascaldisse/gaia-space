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
export type ScriptJobDef = { name: string; trigger_type: string; timeout_secs: number | null; steps: string[] };
export type ScriptDef = { jobs: ScriptJobDef[] };

export type PipelineScript = { id: string; project_id: string; repository: string | null; path: string; source: string; archived: boolean };
export type Job = { id: string; script_id: string; name: string; trigger_type: string; archived: boolean };
export type JobRun = { id: string; job_id: string; status: string; log: string | null; triggered_at: number; started_at: number | null; finished_at: number | null };
export type Worker = { id: string; name: string; os: string; tags_json: string; status: "ONLINE" | "OFFLINE" | "DISABLED"; registered_at: number; last_seen_at: number };
export type JobArtifact = { id: string; job_run_id: string; name: string; size_bytes: number; created_at: number };
export type JobArtifactInput = { id: string; job_run_id: string; name: string; content: number[] };
export type TestReport = { id: string; job_run_id: string; suite: string; test_name: string; status: "PASSED" | "FAILED" | "SKIPPED"; duration_ms: number | null; message: string | null; created_at: number };

export const JOB_TRIGGER_TYPES = ["MANUAL", "GIT_PUSH", "SCHEDULE", "GIT_BRANCH_DELETED", "CODE_REVIEW_OPENED", "CODE_REVIEW_CLOSED", "SAFE_MERGE"] as const;
export const RUN_TERMINAL_STATUSES = ["FINISHED", "TERMINATED", "FAILED", "SKIPPED"];
export function isTerminalRun(status: string): boolean {
  return RUN_TERMINAL_STATUSES.includes(status);
}

export function emptyScriptDef(): ScriptDef {
  return { jobs: [] };
}
export function parseScriptSource(source: string): ScriptDef {
  try {
    const parsed = JSON.parse(source);
    if (parsed && Array.isArray(parsed.jobs)) return parsed as ScriptDef;
  } catch {
    /* fall through to empty */
  }
  return emptyScriptDef();
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
export type PackageVersion = { id: string; repository_id: string; package_name: string; version: string; metadata_json: string | null; created_at: number; accessed_at: number | null; downloads: number; pinned: boolean };

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
  listWorkers: () => invoke<Worker[]>("list_workers"),
  createJobArtifact: (input: JobArtifactInput) => invoke<JobArtifact>("create_job_artifact", { input }),
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

  // package versions
  listPackageVersions: (repositoryId: string, query?: string) => invoke<PackageVersion[]>("list_package_versions", { repositoryId, query: query ?? null }),
  publishPackageVersion: (args: {
    repositoryId: string;
    packageName: string;
    version: string;
    metadataJson?: string | null;
    payloadFilename?: string | null;
    payloadContent?: string | null;
  }) =>
    invoke<PackageVersion>("publish_package_version", {
      repositoryId: args.repositoryId,
      packageName: args.packageName,
      version: args.version,
      metadataJson: args.metadataJson ?? null,
      payloadFilename: args.payloadFilename ?? null,
      payloadContent: args.payloadContent ?? null,
    }),
  downloadPackagePayload: (repositoryId: string, packageName: string, version: string, filename: string) =>
invoke<number[]>("download_package_payload", { repositoryId, packageName, version, filename }),
setPackageVersionPinned: (id: string, pinned: boolean) => invoke<void>("set_package_version_pinned", { id, pinned }),
deletePackageVersion: (id: string) => invoke<void>("delete_package_version", { id }),
};
