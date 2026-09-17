import { afterEach, describe, expect, test } from "bun:test";
import { loadState, saveState } from "./state.ts";

const paths: string[] = [];
afterEach(async () => { for (const path of paths.splice(0)) for (const candidate of [path, `${path}.tmp`]) if (await Bun.file(candidate).exists()) await Bun.file(candidate).delete(); });

describe("delivery state", () => {
  test("publishes state through a temporary file then removes it", async () => {
    const path = `bridge/github-push/.test-state-${crypto.randomUUID()}.json`;
    paths.push(path);
    await Bun.write(path, '{"deliveryIds":["old"]}\n');
    await saveState(path, { deliveryIds: ["new"] });
    expect(await loadState(path)).toEqual({ deliveryIds: ["new"] });
    expect(await Bun.file(`${path}.tmp`).exists()).toBe(false);
  });
});
