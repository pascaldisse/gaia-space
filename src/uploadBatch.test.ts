import { expect, test } from "bun:test";
import { settleUploadBatch } from "./uploadBatch";

test("an attachment batch keeps uploading after a middle-file failure", async () => {
  const calls: string[] = [];
  const result = await settleUploadBatch(["first.png", "bad.png", "last.png"], async (file) => {
    calls.push(file);
    if (file === "bad.png") throw new Error("denied");
  });

  expect(calls).toEqual(["first.png", "bad.png", "last.png"]);
  expect(result.successes).toEqual(["first.png", "last.png"]);
  expect(result.failures.map(({ item, error }) => [item, String(error)])).toEqual([["bad.png", "Error: denied"]]);
});
