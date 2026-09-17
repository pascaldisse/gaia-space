import { describe, expect, test } from "bun:test";
import { signatureFor, verifyGitHubSignature } from "./verify.ts";

describe("GitHub signature verification", () => {
  test("accepts a valid sha256 HMAC", async () => {
    const body = '{"ok":true}';
    expect(await verifyGitHubSignature("secret", body, await signatureFor("secret", body))).toBe(true);
  });
  test("rejects bad and missing signatures", async () => {
    expect(await verifyGitHubSignature("secret", "{}", "sha256=deadbeef")).toBe(false);
    expect(await verifyGitHubSignature("secret", "{}", null)).toBe(false);
  });
});
