import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js";
import Issues from "./Issues";
import { reviewApi, type Review } from "../api/review";
import { projectId as sessionProject } from "../session";
import { linkProps } from "../router";
import "../components/paper.css";
import "./Issues.css";
import "./Development.css";

/**
 * Entwicklung (`/development`) — the briefing's dev surface: Tickets, Bugs,
 * Pull Requests, Releases (JANIS_BRIEFING.md §Entwicklung).
 *
 * Four sections over the EXISTING data, no fork and no second data path:
 *  - Tickets       -> the Issues view, whole (filters, CSV, board, drawer, detail).
 *  - Bugs          -> the same view pinned to the project's "bug" planning tag.
 *  - Pull Requests -> `list_reviews`, scoped to the current project.
 *  - Releases      -> nothing backs it in the data model, so it says so. A fake list
 *                     would be a lie, and a hidden tab would make the briefing's fourth
 *                     area unreachable.
 */
const SECTIONS = [
  { key: "tickets", label: "Tickets" },
  { key: "bugs", label: "Bugs" },
  { key: "pull-requests", label: "Pull Requests" },
  { key: "releases", label: "Releases" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

/** Colour law for a review's state: open work asks for action (teal), a merged or
 * closed one is finished (neutral). Nothing here is critical on its own. */
const reviewTone = (state: string) => (/merged|closed/i.test(state) ? "done" : "teal");

export default function Development(): JSX.Element {
  const [section, setSection] = createSignal<SectionKey>("tickets");
  const projectId = sessionProject;

  const [reviews] = createResource(() => reviewApi.list().catch(() => [] as Review[]));
  const projectReviews = createMemo(() =>
    (reviews() ?? []).filter((review) => !projectId() || review.project_id === projectId()),
  );

  return (
    <section class="dev-view">
      {/* Section switch only — the page header itself belongs to the header lane. */}
      <nav class="dev-tabs" aria-label="Entwicklung sections">
        <For each={SECTIONS}>
          {(entry) => (
            <button
              type="button"
              class="dev-tab"
              classList={{ active: section() === entry.key }}
              aria-current={section() === entry.key ? "page" : undefined}
              onClick={() => setSection(entry.key)}
            >
              {entry.label}
            </button>
          )}
        </For>
      </nav>

      <Show when={section() === "tickets"}><Issues /></Show>
      <Show when={section() === "bugs"}><Issues filterTagName="bug" /></Show>

      <Show when={section() === "pull-requests"}>
        <div class="dev-section">
          <Show when={reviews.loading}><p class="hint">Loading pull requests…</p></Show>
          <Show when={!reviews.loading && !projectReviews().length}>
            <p class="empty-state">No pull requests in this project yet.</p>
          </Show>
          <Show when={projectReviews().length}>
          <ul class="issue-list paper-list">
            <For each={projectReviews()}>
              {(review) => (
                <li>
                  <a class="issue-row" {...linkProps({ view: "Reviews", entityType: "review", entityId: review.id })}>
                    <span class="row-main">
                      <strong>{review.title}</strong>
                      <span class="row-meta">
                        <span class="issue-number">#{review.number}</span>
                        <Show when={review.source_branch}>{(branch) => <small>{branch()} → {review.target_branch ?? "?"}</small>}</Show>
                      </span>
                    </span>
                    <span class="status-name" classList={{ [reviewTone(review.state)]: true }}>{review.state}</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
          </Show>
        </div>
      </Show>

      <Show when={section() === "releases"}>
        <div class="dev-section">
          {/* HONEST EMPTY STATE: there is no release store behind this app. */}
          <div class="dev-empty" role="status">
            <h2>Releases</h2>
            <p>Not available yet — nothing in the workspace records releases. Pipelines run builds; a release is not one of their outputs today.</p>
            <a class="ghost" {...linkProps({ view: "Pipelines" })}>Open pipelines</a>
          </div>
        </div>
      </Show>
    </section>
  );
}
