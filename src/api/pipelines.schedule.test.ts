import { expect, test } from "bun:test";
import { parseScriptSource, scriptDefWarnings } from "./pipelines";

test("pipeline editor exposes source loss and container executor warnings", () => {
  const parsed = parseScriptSource(JSON.stringify({ jobs: [
    { name: "boxed", steps: [{ type: "Container", image: "alpine", script: "echo hi" }, { type: "Unknown" }], triggers: [{ type: "unknown" }] },
  ] }));
  expect(parsed.warnings).toEqual([
    "job 'boxed' has 1 unsupported or malformed step(s) not loaded",
    "job 'boxed' has container step(s): this build cannot execute them; the editor preserves their image and env, but editing such a step's command line will drop it",
    "job 'boxed' has 1 unsupported or malformed trigger(s) not loaded",
  ]);
  expect(scriptDefWarnings(parsed)).toEqual(["job 'boxed': container step 'alpine' is saved but cannot run in this build"]);
});
