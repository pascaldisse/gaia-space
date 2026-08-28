import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js";
import Issues from "./Issues";
import { reviewApi, type Review } from "../api/review";
import { projectId as sessionProject } from "../session";
import { isViewAvailable, linkProps } from "../router";
import PageHeader from "../components/PageHeader";
import { GhostPill } from "../components/controls";
import EmptyState from "../components/EmptyState";
import { projectName } from "../orgScope";
import "../components/paper.css";
import "./Issues.css";
import "./Development.css";

/**
 * Development (`/development`) — the briefing's dev surface: Tickets, Bugs,
 * Pull Requests, Releases (JANIS_BRIEFING.md, dev section).
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
  /* Sentence case, and the same word the rail uses for the surface these live
     on: "Pull Requests" was the only title-cased label on the screen. */
  { key: "pull-requests", label: "Pull requests" },
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

  /* ORDERING (stage 9a): the pills used to render ABOVE the page header, so the
     page began with a switch and only then said what it was. The reading order is
     header (kicker · title · chips · actions) → section pills → content. The two
     ticket sections mount Issues, which owns the header, so the pills are handed
     DOWN into its `sections` slot instead of being printed before it. */
  const tabs = () => (
    <nav class="dev-tabs" aria-label="Development sections">
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
  );

  return (
    <section class="dev-view">
      {/* The guest keeps its whole self but not its name: this page is
          Development (the rail entry that opens it is Development's Overview),
          and the pills say which section. */}
      <Show when={section() === "tickets"}><Issues title="Development" sections={tabs()} /></Show>
      <Show when={section() === "bugs"}><Issues title="Development" filterTagName="bug" sections={tabs()} /></Show>

      <Show when={section() === "pull-requests" || section() === "releases"}>
        {/* These two have no view of their own to bring a header, so this lane
            supplies one — same shape, same order. */}
        <PageHeader kicker={projectName(projectId())} icon="target" title="Development"
          subline="Tickets, boards, pull requests and pipelines — the work that carries a status" />
        {tabs()}
      </Show>

      <Show when={section() === "pull-requests"}>
        <div class="dev-section">
          <Show when={reviews.loading}><p class="hint">Loading pull requests…</p></Show>
          {/* NOTHING YET, and there is no "create a pull request" command in this
              product — a PR is opened from a repository. So no primary is drawn:
              a button that cannot do the thing is worse than no button. The two
              secondaries go where the work actually is, pre-scoped. */}
          <Show when={!reviews.loading && !projectReviews().length}>
            <EmptyState
              title="No pull requests in this project yet"
              hint="Pull requests appear here once a branch is pushed and a review is opened in the repository."
              actions={<>
                {/* Repos is desktop-only: on web the view is not reachable, so the
                    pill is not drawn at all rather than pointing at a fallback. */}
                <Show when={isViewAvailable("Repos")}>
                  <GhostPill {...linkProps({ view: "Repos" })}>Open repositories</GhostPill>
                </Show>
                <GhostPill onClick={() => setSection("tickets")}>Back to tickets</GhostPill>
              </>}
            />
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
          {/* The PageHeader above already says "Releases"; saying it twice was the
              old two-title idiom. */}
          {/* Nothing RECORDS a release, so there is nothing to create and no
              primary is drawn. The one honest action is the surface that does
              build the artefacts people come here looking for. */}
          <EmptyState
            title="Nothing in the workspace records releases yet"
            hint="Pipelines run the builds; a release is not one of their outputs today."
            actions={<Show when={isViewAvailable("Pipelines")}><GhostPill {...linkProps({ view: "Pipelines" })}>Open pipelines</GhostPill></Show>}
          />
        </div>
      </Show>
    </section>
  );
}
