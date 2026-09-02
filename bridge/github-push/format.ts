type RecordValue = Record<string, unknown>;
export type FormattedEvent = { repo: string; text: string };

function object(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function text(value: unknown, fallback = "unknown"): string { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function repoName(payload: RecordValue): string {
  const repository = object(payload.repository);
  return text(repository?.full_name, "unknown/repository");
}
function url(value: unknown): string { return typeof value === "string" && value.trim() ? value.trim() : ""; }
function lines(...parts: Array<string | undefined>): string { return parts.filter((part): part is string => !!part).join("\n"); }

export function formatPush(payload: unknown, maxCommits: number): FormattedEvent | null {
  const event = object(payload);
  if (!event || event.deleted === true) return null;
  const repo = repoName(event);
  const branch = text(event.ref, "unknown").replace(/^refs\/heads\//, "");
  const pusher = text(object(event.pusher)?.name);
  const commits = Array.isArray(event.commits) ? event.commits.map(object).filter((commit): commit is RecordValue => !!commit) : [];
  const rendered = commits.slice(0, maxCommits).map((commit) => {
    const author = object(commit.author);
    const subject = text(commit.message, "(no message)").split("\n")[0];
    return `• ${text(commit.id, "???????").slice(0, 7)} ${subject} — ${text(author?.name)}`;
  });
  const more = commits.length > rendered.length ? `+${commits.length - rendered.length} more` : undefined;
  return { repo, text: lines(`⬆ ${repo} → ${branch} · ${commits.length} commits by ${pusher}`, ...rendered, more, url(event.compare)) };
}

export function formatPullRequest(payload: unknown): FormattedEvent | null {
  const event = object(payload);
  const pr = object(event?.pull_request);
  if (!event || !pr) return null;
  const action = text(event.action);
  if (!new Set(["opened", "reopened", "closed", "ready_for_review"]).has(action)) return null;
  const state = action === "closed" ? (pr.merged === true ? "merged" : "closed") : action === "ready_for_review" ? "ready for review" : action;
  const author = text(object(pr.user)?.login);
  const base = text(object(pr.base)?.ref);
  const head = text(object(pr.head)?.ref);
  return { repo: repoName(event), text: lines(`🔀 ${repoName(event)} PR #${text(pr.number, text(event.number))} ${state}: ${text(pr.title, "(no title)")} (by ${author})`, `${base} ← ${head}`, url(pr.html_url)) };
}

export function formatRelease(payload: unknown): FormattedEvent | null {
  const event = object(payload);
  const release = object(event?.release);
  if (!event || !release || text(event.action) !== "published") return null;
  const name = text(release.name, text(release.tag_name, "release"));
  return { repo: repoName(event), text: lines(`🏷 ${repoName(event)} release: ${name}`, url(release.html_url)) };
}

export function formatNotification(input: { repo: string; ref?: string; text: string; url?: string }): FormattedEvent {
  const heading = input.ref?.trim() ? `⬆ ${input.repo} → ${input.ref.trim()}` : `⬆ ${input.repo}`;
  return { repo: input.repo, text: lines(heading, input.text.trim(), input.url?.trim()) };
}
