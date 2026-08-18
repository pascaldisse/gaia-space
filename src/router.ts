import { createEffect, createSignal } from "solid-js";

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
  projectId?: string;      // issue context: /projects/<projectId>/issues/<id>
  containerType?: string;  // document context: /documents/<containerType>/<containerId>/<id>
  containerId?: string;
};

export type ViewSpec = { name: string; slug?: string; aliases?: string[] };

/** Entity URL grammar. `parent` marks entities that carry a project container. */
const entityRoutes: Record<string, { view: string; segment: string; parent?: "project"; container?: boolean }> = {
  project:  { view: "Projects",     segment: "projects" },
  issue:    { view: "Issues",       segment: "issues", parent: "project" },
  channel:  { view: "Chat",         segment: "channels" },
  document: { view: "Documents",    segment: "documents", container: true },
  meeting:  { view: "Meetings",     segment: "meetings" },
  profile:  { view: "Members",      segment: "profiles" },
  review:   { view: "Code Reviews", segment: "reviews" },
};
export const entityView = (entityType: string) => entityRoutes[entityType]?.view;

export const toSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const FALLBACK_VIEW = "Dashboard";
const NO_CONTAINER = "-"; // placeholder for a document container with a null container_id

// --- registry ---------------------------------------------------------------
// App owns the view list; the router only knows slugs. `available` is the subset the current
// user/platform may actually reach (e.g. Code Reviews is desktop-only) — anything else is a
// hidden/unauthorized route and gets visibly normalized away.
let slugToView: Record<string, string> = {};
let viewToSlug: Record<string, string> = {};
let available: Set<string> | null = null;

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
  resync();
}

/** Restrict reachable views. Pass null to allow every registered view (Tauri/tests). */
export function setAvailableViews(names: string[] | null) {
  available = names ? new Set(names) : null;
  resync();
}

const known = (view: string) => !!view && view in viewToSlug && (!available || available.has(view));

// --- pure grammar -----------------------------------------------------------
const enc = (s: string) => encodeURIComponent(s);
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** path (no base, no leading slash) -> Route. Unknown/unavailable routes fall back. */
export function parsePath(path: string): Route {
  const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(dec);
  if (!segs.length) return { view: FALLBACK_VIEW };
  const [head, ...rest] = segs;

  // /projects/<projectId>[/issues/<issueId>]
  if (head === "projects" && rest.length) {
    const projectId = rest[0];
    if (rest[1] === "issues" && rest[2])
      return norm({ view: "Issues", entityType: "issue", entityId: rest.slice(2).join("/"), projectId });
    if (rest.length === 1)
      return norm({ view: "Projects", entityType: "project", entityId: projectId });
  }

  // /documents/<id> | /documents/<containerType>/<containerId>[/<id>]
  if (head === "documents" && rest.length) {
    if (rest.length === 1) return norm({ view: "Documents", entityType: "document", entityId: rest[0] });
    const containerType = rest[0];
    const containerId = rest[1] === NO_CONTAINER ? undefined : rest[1];
    const entityId = rest.length > 2 ? rest.slice(2).join("/") : undefined;
    return norm({ view: "Documents", containerType, containerId, ...(entityId ? { entityType: "document", entityId } : {}) });
  }

  // /<entity-segment>/<id>
  const desc = Object.entries(entityRoutes).find(([, d]) => d.segment === head && !d.parent && !d.container);
  if (desc && rest.length) return norm({ view: desc[1].view, entityType: desc[0], entityId: rest.join("/") });

  return norm({ view: slugToView[head] ?? "" });
}

const norm = (r: Route): Route => (known(r.view) ? r : { view: FALLBACK_VIEW });

/** Route -> path (no base, no leading slash). Always canonical. */
export function buildPath(r: Route): string {
  const view = known(r.view) ? r.view : FALLBACK_VIEW;
  const slug = viewToSlug[view] ?? toSlug(view);
  const desc = r.entityType ? entityRoutes[r.entityType] : undefined;

  if (desc && r.entityId) {
    if (desc.parent === "project" && r.projectId)
      return `projects/${enc(r.projectId)}/${desc.segment}/${enc(r.entityId)}`;
    if (desc.container && r.containerType)
      return `documents/${enc(r.containerType)}/${enc(r.containerId ?? NO_CONTAINER)}/${enc(r.entityId)}`;
    return `${desc.segment}/${enc(r.entityId)}`;
  }
  if (r.view === "Documents" && r.containerType)
    return `documents/${enc(r.containerType)}/${enc(r.containerId ?? NO_CONTAINER)}`;
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
    read: () => strip(location.pathname) + location.search.replace(/^\?$/, ""),
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
    read: () => location.hash.replace(/^#\/?/, ""),
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
const [route, setRoute] = createSignal<Route>({ view: FALLBACK_VIEW });
export { route };
export const activeView = () => route().view;

/** Read the environment, normalize, and rewrite the URL when it disagrees with the resolved route. */
function resync() {
  const raw = adapter.read();
  const resolved = parsePath(raw);
  setRoute(resolved);
  const canonical = buildPath(resolved);
  if (canonical !== raw.replace(/^\/+|\/+$/g, "")) adapter.write(canonical, true); // hidden/unknown route -> visible normalize
}

export function initRouter(next: RouterAdapter) {
  adapter = next;
  adapter.subscribe(() => setRoute(parsePath(adapter.read())));
  resync();
}

export function navigate(routeOrView: string | Route, entityType?: string, entityId?: string, replace = false) {
  const next: Route = typeof routeOrView === "string" ? { view: routeOrView, entityType, entityId } : routeOrView;
  const resolved = known(next.view) ? next : { view: FALLBACK_VIEW };
  adapter.write(buildPath(resolved), replace);
  setRoute(resolved);
}

/** href for a route — real navigable URL, so links are copyable/middle-clickable. */
export const hrefFor = (r: Route) => adapter.href(buildPath(r));

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

/** Deep-link consumer: open(id) when the route targets this entity type, clear() when it drops it. */
export function useDeepLink(entityType: string, open: (id: string) => void, clear?: () => void) {
  createEffect(() => {
    const r = route();
    if (r.entityType === entityType && r.entityId) open(r.entityId);
    else clear?.();
  });
}

/** Record the open entity in the URL (context = project / document container). */
export function linkEntity(
  entityType: string,
  entityId: string,
  context: Pick<Route, "projectId" | "containerType" | "containerId"> = {},
) {
  const view = entityView(entityType) ?? activeView();
  if (view) navigate({ view, entityType, entityId, ...context });
}

/** Record the document container (container switch) without an open document. */
export function linkContainer(containerType: string, containerId?: string) {
  navigate({ view: "Documents", containerType, containerId });
}
