import { For, Show, createMemo, createResource, createSignal, type JSX } from "solid-js";
import { reviewApi, type Review } from "../api/review";
import { personalApi, type Todo } from "../api/personal";
import { profileId, projectId as sessionProject, projects, setProjectId } from "../session";
import { isViewAvailable, linkProps } from "../router";
import PageHeader from "../components/PageHeader";
import ContentHead from "../components/ContentHead";
import { GhostPill } from "../components/controls";
import { ProjectPicker } from "../components/Pickers";
import EmptyState from "../components/EmptyState";
import { projectName } from "../orgScope";
import "../components/paper.css";
import "./Issues.css";
import "./Development.css";

/**
 * Development (`/development`) — the briefing's dev surface: Dev tasks, Pull
 * Requests, Releases (JANIS_BRIEFING.md, dev section).
 *
 * Three sections over the EXISTING data, no fork and no second data path:
 *  - Dev tasks     -> tasks (`personalApi.projectTodos`) with `category === 'dev'`,
 *                     scoped to a picked project. Tasks/Bugs used to be a separate
 *                     tracker entity (Issue) with its own filters, board and drawer;
 *                     task unification folded that into a plain task, so this section
 *                     is now the SAME list every other task surface reads, filtered.
 *  - Pull Requests -> `list_reviews`, scoped to the current project.
 *  - Releases      -> nothing backs it in the data model, so it says so. A fake list
 *                     would be a lie, and a hidden tab would make the briefing's third
 *                     area unreachable.
 */
const SECTIONS = [
  { key: "dev-tasks", label: "Dev tasks" },
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
  const [section, setSection] = createSignal<SectionKey>("dev-tasks");
  const projectIdSig = sessionProject;

  const [reviews] = createResource(() => reviewApi.list().catch(() => [] as Review[]));
  const projectReviews = createMemo(() =>
    (reviews() ?? []).filter((review) => !projectIdSig() || review.project_id === projectIdSig()),
  );

  // Dev tasks are project-scoped by construction (a task's Dev tab lives under its
  // project), so this section reads the session's current project — the same one the
  // project picker below writes, and the same one a task-from-chat lands on.
  const [devTasks] = createResource(
    () => [projectIdSig(), profileId()] as const,
    ([id, profile]) => (id && profile ? personalApi.projectTodos(id, profile, true) : Promise.resolve([] as Todo[])),
  );
  const openDevTasks = createMemo(() => (devTasks() ?? []).filter((task) => task.category === "dev" && !task.done));

  const tabs = () => (
    <span class="dev-tabs actionbar-sections" role="group" aria-label="Development sections">
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
    </span>
  );

  return (
    <section class="dev-view">
      <PageHeader kicker={projectName(projectIdSig())} icon="target" title="Development"
        subline="Dev tasks, pull requests and pipelines — the work that carries a status" />
      <nav class="page-actionbar" aria-label="Development sections">
        <span class="actionbar-view-controls">
          <ProjectPicker label="Project" value={projectIdSig()} onChange={setProjectId} allowAll />
        </span>
        <span class="actionbar-view-controls">{tabs()}</span>
      </nav>

      <Show when={section() === "dev-tasks"}>
        <div class="dev-section">
          <Show when={!projectIdSig()}>
            <EmptyState
              title="Pick a project to see its dev tasks"
              hint="Dev tasks are filed on one project's Dev tab — pick one above to see it."
              actions={<For each={(projects() ?? []).filter((p) => !p.archived).slice(0, 6)}>
                {(project) => <GhostPill onClick={() => setProjectId(project.id)}>{project.name}</GhostPill>}
              </For>}
            />
          </Show>
          <Show when={projectIdSig()}>
            <ContentHead icon="target" title="Dev tasks" line="Tasks filed under this project's Dev tab — bugs, features and improvements." />
            <Show when={devTasks.loading}><p class="hint">Loading dev tasks…</p></Show>
            <Show when={devTasks.error}><p class="error" role="alert">Could not load dev tasks: {String(devTasks.error)}</p></Show>
            <Show when={!devTasks.loading && !openDevTasks().length}>
              <EmptyState
                title="No open dev tasks in this project"
                hint="A dev task is a task with category 'dev' — add one from the project's Dev tab, or link a GitHub issue/PR to an existing task's Links row."
                actions={<GhostPill {...linkProps({ view: "Project Workspace", projectId: projectIdSig(), tab: "dev" })}>Open Dev tab →</GhostPill>}
              />
            </Show>
            <Show when={openDevTasks().length}>
              <ul class="issue-list paper-list">
                <For each={openDevTasks()}>
                  {(task) => (
                    <li>
                      <a class="issue-row" {...linkProps({ view: "Project Workspace", projectId: projectIdSig(), tab: "dev" })}>
                        <span class="row-main">
                          <strong>{task.content}</strong>
                          <Show when={task.notes}>{(notes) => <span class="row-meta"><small>{notes()}</small></span>}</Show>
                        </span>
                        <Show when={(task.links ?? []).length}>
                          <span class="status-name">{(task.links ?? []).length} link{(task.links ?? []).length === 1 ? "" : "s"}</span>
                        </Show>
                      </a>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={section() === "pull-requests"}>
        {/* Which of the sections you are in, and what it is for. */}
        <ContentHead icon="review" title="Pull requests" line="Merge requests on this project's repositories, newest first." />
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
                <GhostPill onClick={() => setSection("dev-tasks")}>Back to dev tasks</GhostPill>
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
        <ContentHead icon="package" title="Releases" line="A release is a published version — nothing in this workspace records one yet." />
        <div class="dev-section">
          {/* HONEST EMPTY STATE: there is no release store behind this app. */}
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
