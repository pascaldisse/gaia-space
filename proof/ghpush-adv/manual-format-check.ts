import { formatPush, formatPullRequest, formatRelease } from "../../bridge/github-push/format.ts";

function section(name: string, out: unknown) {
  console.log(`\n=== ${name} ===`);
  console.log(out === null ? "null (ignored)" : (out as { text: string }).text);
}

// 1. deleted branch
section("deleted branch", formatPush({
  ref: "refs/heads/tmp-feature",
  deleted: true,
  before: "abc1234000000000000000000000000000000000",
  after: "0000000000000000000000000000000000000000",
  commits: [],
  pusher: { name: "alice" },
  repository: { full_name: "acme/repo" },
  compare: "https://github.com/acme/repo/compare/abc123...000000",
}, 5));

// 2. force-push (forced:true, github-standard fields; formatPush ignores `forced` today)
section("force-push", formatPush({
  ref: "refs/heads/main",
  forced: true,
  before: "aaaaaaa0000000000000000000000000000000",
  after: "bbbbbbb0000000000000000000000000000000",
  commits: [
    { id: "bbbbbbb1111111111111111111111111111111", message: "rewrite history\n\nlong body here", author: { name: "Bob" } },
  ],
  pusher: { name: "bob" },
  repository: { full_name: "acme/repo" },
  compare: "https://github.com/acme/repo/compare/aaaaaaa...bbbbbbb",
}, 5));

// 3. zero commits (e.g. new empty branch push / merge commit prune)
section("zero commits", formatPush({
  ref: "refs/heads/main",
  commits: [],
  pusher: { name: "carol" },
  repository: { full_name: "acme/repo" },
  compare: "https://github.com/acme/repo/compare/ccccccc...ddddddd",
}, 5));

// 4. tag push
section("tag push", formatPush({
  ref: "refs/tags/v1.2.3",
  commits: [
    { id: "eeeeeee2222222222222222222222222222222", message: "release commit", author: { name: "Dave" } },
  ],
  pusher: { name: "dave" },
  repository: { full_name: "acme/repo" },
  compare: "https://github.com/acme/repo/compare/eeeeeee...fffffff",
}, 5));

// 5. PR closed, merged:false
section("PR closed merged:false", formatPullRequest({
  action: "closed",
  number: 42,
  pull_request: {
    number: 42,
    merged: false,
    title: "Abandon this approach",
    user: { login: "erin" },
    base: { ref: "main" },
    head: { ref: "erin/scrapped" },
    html_url: "https://github.com/acme/repo/pull/42",
  },
  repository: { full_name: "acme/repo" },
}));

// bonus: release published, for completeness
section("release published", formatRelease({
  action: "published",
  release: { name: "v1.2.3", tag_name: "v1.2.3", html_url: "https://github.com/acme/repo/releases/tag/v1.2.3" },
  repository: { full_name: "acme/repo" },
}));
