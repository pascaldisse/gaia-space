// Dev environment lifecycle API — thin invoke() wrappers over src-tauri/src/devenv.rs.
import { invoke } from "@tauri-apps/api/core";

export type DevEnvironmentState =
  | "STARTING"
  | "RUNNING"
  | "HIBERNATING"
  | "HIBERNATED"
  | "STANDBY"
  | "FAILED"
  | "DELETED";

export type DevEnvironment = {
  id: string;
  project_id: string;
  owner_id: string | null;
  name: string;
  repository: string | null;
  branch: string | null;
  ide: string;
  instance_type: string;
  state: DevEnvironmentState;
  idle_timeout_minutes: number;
  last_activity_at: number;
  hibernated_at: number | null;
  persisted_home: string | null;
  persisted_worktree: string | null;
};

export type NewDevEnvironment = {
  id: string;
  project_id: string;
  owner_id: string | null;
  name: string;
  repository?: string | null;
  branch?: string | null;
  ide?: string | null;
  instance_type?: string | null;
  idle_timeout_minutes?: number | null;
  standby?: boolean;
};

export const devenvApi = {
  list: (projectId: string) => invoke<DevEnvironment[]>("list_dev_environments", { projectId }),
  create: (input: NewDevEnvironment) => invoke<DevEnvironment>("create_dev_environment", { input }),
  // Reports activity; this is what holds idle hibernation off.
  touch: (id: string) => invoke<DevEnvironment>("touch_dev_environment", { id }),
  hibernate: (id: string, actorId: string | null = null) =>
    invoke<DevEnvironment>("hibernate_dev_environment", { id, actorId }),
  sweepIdle: () => invoke<DevEnvironment[]>("hibernate_idle_dev_environments", {}),
  resume: (id: string, actorId: string | null = null) =>
    invoke<DevEnvironment>("resume_dev_environment", { id, actorId }),
  claimStandby: (projectId: string, profileId: string) =>
    invoke<DevEnvironment>("claim_standby_dev_environment", { projectId, profileId }),
  remove: (id: string, actorId: string | null = null) =>
    invoke<void>("delete_dev_environment", { id, actorId }),
};
