import { createEffect, createSignal, untrack } from "solid-js";

// ---------------------------------------------------------------------------
// Semantic path routing.
//
// Web (canonical):  <base>/<view-slug>[/<entity path>]      — real URLs, History API, no "#".
// Tauri (adapter):  #/<view-slug>[/<entity path>]           — the webview has no server, so the
//                                                             hash form stays, but ONLY there.
//
// The grammar itself is shared: adapters only decide how a path string is read from / written to
// the environment. Everything below the adapter boundary is pure and unit-testable.
// ---------------------------------------------------------------------------

export type Route = {
  view: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;      // task context, e.g. project-scoped surfaces
  containerType?: string;  // document context: /documents/<containerType>/<containerId>/<id>
  containerId?: string;
  tab?: string;            // channel workspace tab: /channel/<channelId>/<tab>
                           // activity filter:      /inbox/<filter>
};

/** Activity's worklist filters, as URL segments. A filter IS route state: it changes
 *  what the page shows, the sidebar must highlight the active one, and a filtered
 *  worklist is a thing you link somebody to. (Search terms are not: they are a
 *  view's own scratch state, which is why the grammar strips `?`/`#` above.)
 *  `all` is deliberately NOT a segment — the unfiltered list is the bare view, so it
 *  has exactly one spelling; an unknown segment degrades to it, never to a blank page.
 *  Mirrors ACTIVITY_FILTERS in attention.ts, which owns the filter -> kind meaning;
 *  the two lists are bound by a test rather than by an import, so the router keeps
 *  its zero-import independence. */
export const activityFilters = ["mentions", "messages", "assigned", "reviews", "updates"] as const;
const isActivityFilter = (value: string): value is typeof activityFilters[number] =>
  activityFilters.includes(value as typeof activityFilters[number]);

/** Channel workspace tabs (communication-first shell). `messages` is the default surface;
 *  the work tabs mount EXISTING views scoped to the channel's project (ChannelWorkspace),
 *  and an unknown tab degrades to the fallback view rather than inventing a surface.
 *  A channel WITHOUT a project renders `messages` only — the tab row is not drawn at all. */
export const channelTabs = ["messages", "overview", "tasks", "calendar", "files", "notes"] as const;
const isChannelTab = (value: string): value is typeof channelTabs[number] =>
  channelTabs.includes(value as typeof channelTabs[number]);

/** ── THE PROJECT WORKSPACE TABS ─────────────────────────────────────────────
 *  THE TAB ROW BELONGS TO THE PROJECT. Five tabs, named by the product owner, and
 *  no more. A channel is not a tab: it is an OBJECT selected inside `chats`, which
 *  is why the only tab that takes a child segment is that one
 *  (`projects/<id>/chats/<channelId>`).
 *
 *  The bare `projects/<id>` is deliberately NOT one of these: it is the project's
 *  OVERVIEW — running tasks and running chats — reached by the project's own name,
 *  the way a channel is reached by its name. A tab row where every entry is a
 *  section and the landing is also an entry would name the same place twice.
 *
 *  The legacy spellings `overview`/`steering`/`settings` keep parsing (§parsePath)
 *  so no shipped link dies; they are not tabs and do not appear here. */
export const projectTabs = ["chats", "tasks", "calendar", "knowledge", "dev"] as const;
export type ProjectTab = typeof projectTabs[number];
const isProjectTab = (value: string): value is ProjectTab =>
  projectTabs.includes(value as ProjectTab);

export type ViewSpec = { name: string; slug?: string; aliases?: string[] };

/** Entity URL grammar. `parent` marks entities that carry a project container. */
const entityRoutes: Record<string, { view: string; segment: string; parent?: "project"; container?: boolean }> = {
  project:  { view: "Projects",     segment: "projects" },
  channel:  { view: "Chat",         segment: "channels" },
  document: { view: "Documents",    segment: "documents", container: true },
  blog:     { view: "Blogs",        segment: "blogs" },
  meeting:  { view: "Meetings",     segment: "meetings" },
  profile:  { view: "Members",      segment: "profiles" },
  review:   { view: "Code Reviews", segment: "reviews" },
};
export const entityView = (entityType: string) => entityRoutes[entityType]?.view;

export const toSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// An unparseable route degrades to Dashboard. That is the grammar's error value and
// it is deliberately layout-independent — do not tie it to the nav layout.
export const FALLBACK_VIEW = "Dashboard";
/** The EMPTY path is a different question: it lands on the layout's own home.
 *  Chat-first opens the calendar Home of the redesign; the older layouts keep
 *  Dashboard. Read from storage, not from nav.ts, so the router keeps its
 *  zero-import independence. */
const homeView = (): string => {
  try {
    const layout = localStorage.getItem("space.nav.layout");
    return layout === "grouped" || layout === "flat" ? FALLBACK_VIEW : "Home";
  } catch { return FALLBACK_VIEW; }
};
const NO_CONTAINER = "-"; // placeholder for a document container with a null container_id
export const documentContainers = ["my-docs", "project", "kb"] as const;
const isDocumentContainer = (value: string): value is typeof documentContainers[number] =>
  documentContainers.includes(value as typeof documentContainers[number]);
/** A blank container id is no id: it degrades to the null-container placeholder. */
const containerSeg = (id: string | undefined) => (id && id.trim() ? id : NO_CONTAINER);

// --- registry ---------------------------------------------------------------
// App owns the view list; the router only knows slugs. `available` is the subset the current
// user/platform may actually reach (e.g. Code Reviews is desktop-only) — anything else is a
// hidden/unauthorized route and gets visibly normalized away.
let slugToView: Record<string, string> = {};
let viewToSlug: Record<string, string> = {};
let available: Set<string> | null = null;
let pending = false; // auth/identity not resolved yet -> availability is unknown, not "denied"

export function registerViews(views: (string | ViewSpec)[]) {
  slugToView = {}; viewToSlug = {};
  for (const entry of views) {
    const spec: ViewSpec = typeof entry === "string" ? { name: entry } : entry;
    const slug = spec.slug ?? toSlug(spec.name);
    viewToSlug[spec.name] = slug;
    slugToView[slug] = spec.name;
    for (const alias of spec.aliases ?? []) slugToView[alias] ??= spec.name;
  }
  for (const desc of Object.values(entityRoutes)) slugToView[desc.segment] ??= desc.view;
  bump();
  resync();
}

/** Restrict reachable views. Pass null to allow every registered view (Tauri/tests). */
export function setAvailableViews(names: string[] | null) {
  available = names ? new Set(names) : null;
  bump();
  resync();
}

/**
 * While auth is pending the availability set is a lie (an admin-only view looks unauthorized
 * simply because the session has not loaded). Retain the URL untouched in that window: no
 * normalization, no rewrite. When it clears, resync() applies the real policy — admin keeps
 * /users, a member is normalized away from it.
 */
export function setRoutePending(next: boolean) {
  if (pending === next) return;
  pending = next;
  bump();
  resync();
}

const known = (view: string) => !!view && view in viewToSlug && (pending || !available || available.has(view));

// --- pure grammar -----------------------------------------------------------
const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** path (no base, no leading slash) -> Route. Unknown/unavailable routes fall back. */
export function parsePath(path: string): Route {
  // Search/hash state is owned by a view, never by the route grammar or entity id.
  const pathname = path.split(/[?#]/, 1)[0];
  const segs = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(dec);
  if (!segs.length) return { view: homeView() };
  const [head, ...rest] = segs;

  // /projects/<projectId>[/<tab>|/chats/<channelId>|/issues/<issueId>|/steering|/settings]
  if (head === "projects" && rest.length) {
    const projectId = rest[0];
    // LEGACY: tasks are tasks now (task unification, 2026-09). The migration that
    // folded issues into tasks kept ids, so `<issueId>` IS a task id — but there is
    // no single-task address in this grammar (a task opens inline, in its row), so
    // the old link lands on the project's Tasks tab rather than 404ing.
    if (rest[1] === "issues" && rest[2])
      return norm({ view: "Project Workspace", projectId, tab: "tasks" });
    // A channel SELECTED INSIDE the Chats tab. The channel is an object of the tab,
    // never a tab of its own, so it is a segment BELOW `chats`.
    if (rest.length === 3 && rest[1] === "chats")
      return norm({ view: "Project Workspace", projectId, tab: "chats", entityType: "channel", entityId: rest[2] });
    if (rest.length === 2 && isProjectTab(rest[1]))
      return norm({ view: "Project Workspace", projectId, tab: rest[1] });
    // Steering and Settings are NOT tabs (the owner named five and meant five); they
    // stay reachable as quiet actions in the project header and through More.
    if (rest.length === 2 && rest[1] === "steering") return norm({ view: "Project Steering", projectId });
    if (rest.length === 2 && rest[1] === "settings") return norm({ view: "Project Settings", projectId });
    // LEGACY, kept alive on purpose: `/projects/<id>/overview` was the old Project
    // Overview page. Its content IS the workspace landing now, so the old address
    // lands there and resync() rewrites it to the canonical `/projects/<id>`.
    if (rest.length === 2 && rest[1] === "overview") return norm({ view: "Project Workspace", projectId });
    if (rest.length === 1) return norm({ view: "Project Workspace", projectId });
    // Anything else under a project is NOT a route. Falling through to the generic
    // entity grammar below turned `projects/p-1/nonsense` into a project whose id was
    // literally `p-1/nonsense` — a 404 wearing the costume of a real project.
    return { view: FALLBACK_VIEW };
  }

  // /inbox/<filter> — Activity's worklist, narrowed. Keyed off the registered slug,
  // not a hardcoded word, so it follows the view's own routing key.
  if (slugToView[head] === "Inbox" && rest.length === 1 && isActivityFilter(rest[0]))
    return norm({ view: "Inbox", tab: rest[0] });

  // /channel/<channelId>/<tab> — the channel as a workspace, opening on its chat.
  if (head === "channel" && rest.length === 2 && isChannelTab(rest[1]))
    return norm({ view: "Chat", entityType: "channel", entityId: rest[0], tab: rest[1] });

  // /documents/<id> | /documents/<containerType>/<containerId>[/<id>]
  if (head === "documents" && rest.length) {
    if (rest.length === 1) return norm({ view: "Documents", entityType: "document", entityId: rest[0] });
    const containerType = rest[0];
    if (!isDocumentContainer(containerType) || !rest[1].trim()) return { view: FALLBACK_VIEW };
    const containerId = rest[1] === NO_CONTAINER ? undefined : rest[1];
    const entityId = rest.length > 2 ? rest.slice(2).join("/") : undefined;
    return norm({ view: "Documents", containerType, containerId, ...(entityId ? { entityType: "document", entityId } : {}) });
  }

  // LEGACY: a bare `/issues/<id>` (no project context, e.g. Goto's own history or a
  // bookmark) — there is no project to open the Tasks tab on, so it lands on the
  // reader's own task list rather than 404ing.
  if (head === "issues" && rest.length) return norm({ view: "To-Do" });

  // /<entity-segment>/<id> — incl. context-free entity links (e.g. /reviews/<id> from Goto,
  // where the project is not known yet); the view resolves the owner and canonicalizes after.
  const desc = Object.entries(entityRoutes).find(([, d]) => d.segment === head && !d.container);
  if (desc && rest.length) return norm({ view: desc[1].view, entityType: desc[0], entityId: rest.join("/") });

  return norm({ view: slugToView[head] ?? "" });
}

const norm = (r: Route): Route => (known(r.view) ? r : { view: FALLBACK_VIEW });

/** Route -> path (no base, no leading slash). Always canonical. */
export function buildPath(r: Route): string {
  const view = known(r.view) ? r.view : FALLBACK_VIEW;
  const slug = viewToSlug[view] ?? toSlug(view);
  const desc = r.entityType ? entityRoutes[r.entityType] : undefined;

  // ── THE PROJECT WORKSPACE ────────────────────────────────────────────────
  // One frame, one tab row. The four surfaces that used to be separate pages now
  // BUILD INTO the workspace, so every link already shipped across the app keeps
  // working and simply arrives on the right tab instead of on a page of its own.
  if (r.view === "Project Workspace" && r.projectId) {
    if (r.tab === "chats" && r.entityType === "channel" && r.entityId)
      return `projects/${enc(r.projectId)}/chats/${enc(r.entityId)}`;
    return isProjectTab(r.tab ?? "") ? `projects/${enc(r.projectId)}/${r.tab}` : `projects/${enc(r.projectId)}`;
  }
  if (r.view === "Project Overview" && r.projectId) return `projects/${enc(r.projectId)}`;
  if (r.view === "Project Steering" && r.projectId) return `projects/${enc(r.projectId)}/steering`;
  if (r.view === "Project Settings" && r.projectId) return `projects/${enc(r.projectId)}/settings`;
  if (r.view === "Project Tasks" && r.projectId) return `projects/${enc(r.projectId)}/tasks`;
  if (r.view === "Calendar" && r.projectId) return `projects/${enc(r.projectId)}/calendar`;
  if (r.view === "Documents" && r.projectId && !r.containerType) return `projects/${enc(r.projectId)}/knowledge`;
  if (view === "Inbox" && isActivityFilter(r.tab ?? "")) return `${slug}/${r.tab}`;
  if (r.entityType === "channel" && r.entityId && isChannelTab(r.tab ?? ""))
    return `channel/${enc(r.entityId)}/${r.tab}`;
  if (desc && r.entityId) {
    if (desc.parent === "project" && r.projectId)
      return `projects/${enc(r.projectId)}/${desc.segment}/${enc(r.entityId)}`;
    if (desc.container && isDocumentContainer(r.containerType ?? ""))
      return `documents/${enc(r.containerType!)}/${enc(containerSeg(r.containerId))}/${enc(r.entityId)}`;
    return `${desc.segment}/${enc(r.entityId)}`;
  }
  if (r.view === "Documents" && isDocumentContainer(r.containerType ?? ""))
    return `documents/${enc(r.containerType!)}/${enc(containerSeg(r.containerId))}`;
  return slug;
}

// --- adapters ---------------------------------------------------------------
export type RouterAdapter = {
  read(): string;                                   // current path, base-stripped, no leading slash
  write(path: string, replace: boolean): void;
  href(path: string): string;                       // value for <a href>
  subscribe(onChange: () => void): void;
};

/** Web: real paths under the deployed base (import.meta.env.BASE_URL — never hardcoded). */
export function createPathAdapter(base: string): RouterAdapter {
  const prefix = ("/" + base + "/").replace(/\/+/g, "/");
  const strip = (p: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p.replace(/^\/+/, ""));
  return {
    // Query parameters belong to the current page's data concerns, not route grammar.
    // Reading them here made `issues?q=x` look like an unknown view and rewrote the URL.
    read: () => strip(location.pathname),
    write: (path, replace) => {
      const url = prefix + path;
      if (location.pathname.replace(/\/+$/, "") === url.replace(/\/+$/, "")) return;
      replace ? history.replaceState(null, "", url) : history.pushState(null, "", url);
    },
    href: (path) => prefix + path,
    subscribe: (onChange) => window.addEventListener("popstate", onChange),
  };
}

/** Tauri: no server behind the webview, so hash URLs are used — and only here. */
export function createHashAdapter(): RouterAdapter {
  return {
    read: () => location.hash.replace(/^#\/?/, "").split("?", 1)[0],
    write: (path, replace) => {
      const hash = "#/" + path;
      if (location.hash === hash) return;
      if (replace) history.replaceState(null, "", hash); else location.hash = hash;
    },
    href: (path) => "#/" + path,
    subscribe: (onChange) => window.addEventListener("hashchange", onChange),
  };
}

/** Inert adapter: SSR/tests/module-load before initRouter. */
export const createMemoryAdapter = (initial = ""): RouterAdapter => {
  let path = initial;
  let listener: (() => void) | undefined;
  return {
    read: () => path,
    write: (next) => { path = next; listener?.(); },
    href: (p) => "/" + p,
    subscribe: (fn) => { listener = fn; },
  };
};

let adapter: RouterAdapter = createMemoryAdapter();
/** The registry and the adapter are plain module state, so an href built from them is a
 *  SNAPSHOT: links created before registerViews()/initRouter() froze at the fallback
 *  ("/dashboard") forever, because nothing ever told their computation to re-run. This
 *  version signal is that signal — anything that changes how a path is built bumps it,
 *  and hrefFor() reads it, so every href in the tree corrects itself. */
const [registryVersion, bumpRegistry] = createSignal(0);
const bump = () => bumpRegistry((n) => n + 1);
const [route, setRoute] = createSignal<Route>({ view: homeView() });
export { route };
export const activeView = () => route().view;
export const isViewAvailable = (view: string) => known(view);

/** Read the environment, normalize, and rewrite the URL when it disagrees with the resolved route. */
function resync() {
  const raw = adapter.read();
  const resolved = parsePath(raw);
  setRoute(resolved);
  if (pending) return; // URL retained verbatim until policy is knowable
  const canonical = buildPath(resolved);
  if (canonical !== raw.replace(/^\/+|\/+$/g, "")) adapter.write(canonical, true); // hidden/unknown route -> visible normalize
}

export function initRouter(next: RouterAdapter) {
  adapter = next;
  bump();
  // Back/forward can land on a route that became unavailable since its entry was created.
  // Reuse resync so the rendered route and address bar are canonical together.
  adapter.subscribe(resync);
  resync();
}

export function navigate(routeOrView: string | Route, entityType?: string, entityId?: string, replace = false) {
  const next: Route = typeof routeOrView === "string" ? { view: routeOrView, entityType, entityId } : routeOrView;
  const resolved = known(next.view) ? next : { view: FALLBACK_VIEW };
  adapter.write(buildPath(resolved), replace);
  setRoute(resolved);
}

/** href for a route — real navigable URL, so links are copyable/middle-clickable. */
export const hrefFor = (r: Route) => {
  registryVersion(); // re-run when the registry/availability/adapter changes
  return adapter.href(buildPath(r));
};

/**
 * Props for a navigational anchor: real href + SPA interception that preserves
 * modifier-click / middle-click / target semantics (browser handles those natively).
 */
export function linkProps(r: Route) {
  return {
    href: hrefFor(r),
    onClick: (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.currentTarget.target && event.currentTarget.target !== "_self") return;
      event.preventDefault();
      navigate(r);
    },
  };
}

/** Deep-link consumer: open(id) when the route targets this entity type, clear() when it drops it.
 *  The handler runs untracked: a deep link reacts to the URL and to nothing else.
 *  Tracking whatever the handler happens to read (resources, session project, the
 *  selection it writes itself) turns any failing read — e.g. a 403 on a project the
 *  session may not see — into an unbounded open/refetch/open loop against the server. */
export function useDeepLink(entityType: string, open: (id: string) => void, clear?: () => void) {
  createEffect(() => {
    const r = route();
    if (r.entityType === entityType && r.entityId) untrack(() => open(r.entityId!));
    else untrack(() => clear?.());
  });
}

/** Record the open entity in the URL (context = project / document container). */
export function linkEntity(
  entityType: string,
  entityId: string,
  context: Pick<Route, "projectId" | "containerType" | "containerId"> = {},
  replace = false,
) {
  const view = entityView(entityType) ?? activeView();
  if (view) navigate({ view, entityType, entityId, ...context }, undefined, undefined, replace);
}

/** Record the document container (container switch) without an open document. */
export function linkContainer(containerType: string, containerId?: string) {
  navigate({ view: "Documents", containerType, containerId });
}
