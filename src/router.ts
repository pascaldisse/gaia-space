import { createEffect, createSignal } from "solid-js";

// URL-backed navigation. Hash form: #/<viewSlug> or #/<viewSlug>/<entityType>/<entityId>.
// Hash routing works identically in the browser and the Tauri webview, and browser
// back/forward maps to history entries created by assigning location.hash.
export type Route = { view:string; entityType?:string; entityId?:string };

const toSlug = (name:string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// App registers its concrete view names so slugs survive rename/spacing (e.g. "Code Reviews" -> "code-reviews").
let slugToView:Record<string,string> = {};
let viewToSlug:Record<string,string> = {};

const parse = ():Route => {
  const raw = (typeof location !== "undefined" ? location.hash : "").replace(/^#\/?/, "");
  const [slug, entityType, ...rest] = raw.split("/");
  return { view: slugToView[slug] ?? "", entityType: entityType || undefined, entityId: rest.length ? rest.join("/") : undefined };
};

const build = (r:Route) => {
  const slug = viewToSlug[r.view] ?? toSlug(r.view);
  let hash = "#/" + slug;
  if (r.entityType && r.entityId) hash += "/" + r.entityType + "/" + encodeURIComponent(r.entityId);
  return hash;
};

const [route, setRoute] = createSignal<Route>(parse());
export { route };
export const activeView = () => route().view;

export function registerViews(names:string[]) {
  slugToView = {}; viewToSlug = {};
  for (const name of names) { const slug = toSlug(name); slugToView[slug] = name; viewToSlug[name] = slug; }
  setRoute(parse()); // re-resolve now that slugs are known (module-load parse ran with an empty registry)
}

if (typeof window !== "undefined") window.addEventListener("hashchange", () => setRoute(parse()));

// navigate pushes a history entry (assigning location.hash) so back/forward reverse it; replace swaps in place.
export function navigate(view:string, entityType?:string, entityId?:string, replace = false) {
  const next:Route = { view, entityType, entityId };
  const hash = build(next);
  if (typeof location !== "undefined" && location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash); else location.hash = hash;
  }
  setRoute(next);
}

// Deep-link consumer for views that can render a selected entity: fires open(id) whenever
// the route targets this entityType. Idempotent — re-opening the same id is a no-op.
export function useDeepLink(entityType:string, open:(id:string)=>void) {
  createEffect(() => { const r = route(); if (r.entityType === entityType && r.entityId) open(r.entityId); });
}

// linkEntity records the currently-open entity in the URL so it is shareable and back/forward-navigable.
export function linkEntity(entityType:string, entityId:string) {
  const view = activeView(); if (view) navigate(view, entityType, entityId);
}
