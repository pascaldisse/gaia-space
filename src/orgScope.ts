import { createResource } from "solid-js";
import { platformApi } from "./api/platform";
import { projects } from "./session";

/** The KICKER of every page header is the SCOPE the page lives in: the
 *  organisation for global views, the project for project-scoped ones.
 *
 *  One module-level resource, so 25 views naming their scope cost one read —
 *  not one per view. A failing/absent org read degrades to an empty kicker
 *  (the header then reserves the line and renders nothing in it); it must
 *  never invent a name. */
const [organization] = createResource(() => platformApi.organization().catch(() => undefined));

export const orgName = (): string => organization()?.name?.trim() ?? "";
export { organization };

/** Kicker for a PROJECT-SCOPED view. Returns undefined when the project is not
 *  known (or none is selected) so PageHeader falls back to the organisation —
 *  the scope line must never go blank or, worse, show a raw id. */
export const projectName = (id?: string): string | undefined =>
  (id ? (projects() ?? []).find((project) => project.id === id)?.name : undefined) || undefined;
