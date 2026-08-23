import { describe, expect, test } from "bun:test";
import { normalizeJob, parseScriptSource } from "./pipelines";

describe("pipeline script normalization", () => {
  test("upgrades legacy trigger_type and string steps without losing compatibility", () => {
    expect(normalizeJob({ name: "build", trigger_type: "GIT_PUSH", timeout_secs: 60, steps: ["bun test"] })).toEqual({
      name: "build", trigger_type: "GIT_PUSH", timeout_secs: 60,
      steps: [{ type: "host", scripts: ["bun test"] }],
    });
  });
  test("keeps tagged multi-trigger jobs and rejects malformed tagged members", () => {
    const script = parseScriptSource(JSON.stringify({ jobs: [{ name: "release", steps: [], triggers: [{ type: "schedule", cron: "0 0 * * *" }, { type: "git_push", repository: "repo", branches: ["main"] }, { type: "schedule" }] }] }));
    expect(script.jobs[0]).toEqual({ name: "release", trigger_type: "MANUAL", timeout_secs: null, steps: [], triggers: [{ type: "schedule", cron: "0 0 * * *" }, { type: "git_push", repository: "repo", branches: ["main"] }] });
  });
});
