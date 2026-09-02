import { describe, expect, test } from "bun:test";
import push from "./fixtures/push.json";
import pullRequest from "./fixtures/pull_request.json";
import release from "./fixtures/release.json";
import { formatPullRequest, formatPush, formatRelease } from "./format.ts";

describe("GitHub event formatting", () => {
  test("formats and limits push commits", () => {
    expect(formatPush(push, 2)?.text).toBe("⬆ acme/widgets → main · 3 commits by octocat\n• 0123456 Add bridge — Ada\n• fedcba9 Fix retry — Bob\n+1 more\nhttps://github.com/acme/widgets/compare/a...b");
  });
  test("skips deleted refs", () => { expect(formatPush({ ...push, deleted: true }, 5)).toBeNull(); });
  test("formats merged pull requests", () => {
    expect(formatPullRequest(pullRequest)?.text).toBe("🔀 acme/widgets PR #42 merged: Ship the webhook bridge (by octocat)\nmain ← feature/bridge\nhttps://github.com/acme/widgets/pull/42");
  });
  test("formats published releases", () => {
    expect(formatRelease(release)?.text).toBe("🏷 acme/widgets release: Widgets 1.2.0\nhttps://github.com/acme/widgets/releases/tag/v1.2.0");
  });
});
