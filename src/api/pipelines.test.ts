import { describe, expect, mock, test } from "bun:test";
import { normalizeJob, parseScriptSource, scriptDefErrors, serializeJob, TRIGGER_EVENT_TYPES, type TriggerEvent } from "./pipelines";

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
  test("accepts container steps because the server accepts their script definition", () => {
    expect(scriptDefErrors({ jobs: [job({ steps: [{ type: "Container", image: "ubuntu", script: "echo" }] })] } as never)).toEqual([]);
  });
  test("rejects JSON shapes Rust serde rejects before validation", () => {
    expect(scriptDefErrors({ jobs: [job({ timeout_secs: -1 })] } as never)[0]).toContain("timeout_secs");
    expect(scriptDefErrors({ jobs: [job({ timeout_secs: 1.5 })] } as never)[0]).toContain("timeout_secs");
    expect(scriptDefErrors({ jobs: [job({ steps: [{ type: "Unknown", script: "echo" }] })] } as never)[0]).toContain("unknown step type");
    expect(scriptDefErrors({ jobs: [job({ triggers: [{ type: "Unknown" }] })] } as never)[0]).toContain("unknown trigger type");
  });
});

/** The wire contract for the event-driven commands: command names and argument keys are what
 *  the Tauri handler and the space-server dispatch table read, and the event tag must stay the
 *  Rust *variant* name. Pinned on the Rust side by
 *  `pipelines::tests::serialized_dsl_tags_are_variant_names`. */
describe("event trigger wire contract", () => {
  async function captureCall(call: (api: typeof import("./pipelines").pipelinesApi) => Promise<unknown>) {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mock.module("@tauri-apps/api/core", () => ({
      invoke: (cmd: string, args: Record<string, unknown>) => {
        calls.push({ cmd, args });
        return Promise.resolve([]);
      },
    }));
    const { pipelinesApi } = await import("./pipelines");
    await call(pipelinesApi);
    return calls[0];
  }

  test("triggerPipelineEvent sends the variant-tagged event under camelCase keys", async () => {
    const call = await captureCall((api) =>
      api.triggerPipelineEvent("script-1", { type: "Push", repository: "repo", branch: "main" }));
    expect(call.cmd).toBe("trigger_pipeline_event");
    expect(call.args).toEqual({ scriptId: "script-1", event: { type: "Push", repository: "repo", branch: "main" } });
  });

  test("review events carry review_id in Rust field spelling", async () => {
    const call = await captureCall((api) =>
      api.triggerPipelineEvent("script-1", { type: "SafeMerge", review_id: "rev-9" }));
    expect(call.args.event).toEqual({ type: "SafeMerge", review_id: "rev-9" });
  });

  test("dueScheduledRuns passes an explicit now, and defaults it to unix seconds", async () => {
    expect((await captureCall((api) => api.dueScheduledRuns(1700)))).toEqual({
      cmd: "due_scheduled_runs", args: { now: 1700 },
    });
    const now = (await captureCall((api) => api.dueScheduledRuns())).args.now as number;
    expect(Number.isInteger(now)).toBe(true);
    expect(Math.abs(now - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  test("every selectable event type is a member of the TriggerEvent union", () => {
    const tags: Array<TriggerEvent["type"]> = [...TRIGGER_EVENT_TYPES];
    expect(tags).toEqual(["Manual", "Push", "BranchDeleted", "CodeReviewOpened", "CodeReviewClosed", "SafeMerge"]);
  });
});
