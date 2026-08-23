import { describe, expect, test } from "bun:test";
import { normalizeJob, parseScriptSource, scriptDefErrors, serializeJob } from "./pipelines";

describe("pipeline script normalization", () => {
  test("upgrades legacy trigger_type and string steps without losing compatibility", () => {
    expect(normalizeJob({ name: "build", trigger_type: "GIT_PUSH", timeout_secs: 60, steps: ["bun test"] })).toEqual({
      name: "build", trigger_type: "GIT_PUSH", timeout_secs: 60,
      steps: [{ type: "Shell", script: "bun test" }],
    });
  });
  test("keeps tagged multi-trigger jobs and rejects malformed tagged members", () => {
    const script = parseScriptSource(JSON.stringify({ jobs: [{ name: "release", steps: [], triggers: [{ type: "schedule", cron: "0 0 * * *" }, { type: "git_push", repository: "repo", branches: ["main"] }, { type: "schedule" }] }] }));
    expect(script.jobs[0]).toEqual({
      name: "release", trigger_type: "MANUAL", timeout_secs: null, steps: [],
      triggers: [{ type: "Schedule", cron: "0 0 * * *" }, { type: "GitPush", repository: "repo", branches: ["main"] }],
    });
  });
});

// Contract tests. Expected strings are copied from the Rust test
// `pipelines::tests::serialized_dsl_tags_are_variant_names` (src-tauri/src/pipelines.rs),
// which serializes the real enums — not from reading the type definitions.
describe("rust wire contract", () => {
  test("parses the PascalCase tags the server actually emits", () => {
    const source = JSON.stringify({
      jobs: [{
        name: "release", trigger_type: "GIT_PUSH", timeout_secs: null,
        steps: [
          { type: "Shell", script: "echo hi", env: {} },
          { type: "Container", image: "ubuntu", script: "echo boxed", env: {} },
        ],
        triggers: [
          { type: "GitPush", branches: ["main"], repository: "repo" },
          { type: "Schedule", cron: "0 0 * * *" },
          { type: "GitBranchDeleted", branches: [] },
          { type: "CodeReviewOpened" }, { type: "CodeReviewClosed" }, { type: "SafeMerge" }, { type: "Manual" },
        ],
      }],
    });
    const job = parseScriptSource(source).jobs[0];
    expect(job.steps).toEqual([
      { type: "Shell", script: "echo hi", env: {} },
      { type: "Container", image: "ubuntu", script: "echo boxed", env: {} },
    ]);
    expect(job.triggers?.map((t) => t.type)).toEqual([
      "GitPush", "Schedule", "GitBranchDeleted", "CodeReviewOpened", "CodeReviewClosed", "SafeMerge", "Manual",
    ]);
  });

  test("never emits a plural `scripts` step — the server rejects that shape", () => {
    const out = serializeJob({ name: "b", trigger_type: "MANUAL", timeout_secs: null, stepsText: "a\nb", triggers: undefined });
    expect(out.steps).toEqual([{ type: "Shell", script: "a" }, { type: "Shell", script: "b" }]);
    expect(JSON.stringify(out)).not.toContain("scripts");
  });

  test("still reads legacy plural host steps written by older builds", () => {
    const job = normalizeJob({ name: "b", steps: [{ type: "host", scripts: ["one", "two"] }] });
    expect(job?.steps).toEqual([{ type: "Shell", script: "one" }, { type: "Shell", script: "two" }]);
  });
});

// Mirrors parse_and_validate_script in src-tauri/src/pipelines.rs: whatever the server
// refuses must be refused here too, or the UI shows a "saved" script the server dropped.
describe("validation parity with parse_and_validate_script", () => {
  const job = (over: Record<string, unknown> = {}) => ({ name: "b", trigger_type: "MANUAL", timeout_secs: null, steps: [{ type: "Shell", script: "echo" }], ...over });
  test("accepts a valid script", () => {
    expect(scriptDefErrors({ jobs: [job()] } as never)).toEqual([]);
  });
  test("rejects a job with no steps", () => {
    expect(scriptDefErrors({ jobs: [job({ steps: [] })] } as never)[0]).toContain("at least one step");
  });
  test("rejects an empty step script", () => {
    expect(scriptDefErrors({ jobs: [job({ steps: [{ type: "Shell", script: "   " }] })] } as never)[0]).toContain("empty script");
  });
  test("rejects duplicate and blank job names", () => {
    expect(scriptDefErrors({ jobs: [job(), job()] } as never)[0]).toContain("duplicate");
    expect(scriptDefErrors({ jobs: [job({ name: " " })] } as never)[0]).toContain("non-empty name");
  });
  test("rejects legacy SCHEDULE without explicit cron, like from_legacy does", () => {
    expect(scriptDefErrors({ jobs: [job({ trigger_type: "SCHEDULE" })] } as never)[0]).toContain("cron");
  });
  test("rejects an unknown legacy trigger_type", () => {
    expect(scriptDefErrors({ jobs: [job({ trigger_type: "WHENEVER" })] } as never)[0]).toContain("unknown trigger type");
  });
  test("rejects out-of-range timeouts", () => {
    expect(scriptDefErrors({ jobs: [job({ timeout_secs: 0 })] } as never)[0]).toContain("timeout_secs");
    expect(scriptDefErrors({ jobs: [job({ timeout_secs: 7201 })] } as never)[0]).toContain("timeout_secs");
  });
  test("rejects an invalid cron in a typed schedule trigger", () => {
    expect(scriptDefErrors({ jobs: [job({ triggers: [{ type: "Schedule", cron: "*/0 * * * *" }] })] } as never)[0]).toContain("cron");
    expect(scriptDefErrors({ jobs: [job({ triggers: [{ type: "Schedule", cron: "31 2 *" }] })] } as never)[0]).toContain("cron");
    expect(scriptDefErrors({ jobs: [job({ triggers: [{ type: "Schedule", cron: "0 0 30 2 *" }] })] } as never)).toEqual([]);
  });
  test("warns that container steps never execute in this build", () => {
    expect(scriptDefErrors({ jobs: [job({ steps: [{ type: "Container", image: "ubuntu", script: "echo" }] })] } as never)[0]).toContain("container");
  });
});
