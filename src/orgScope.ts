import { createResource } from "solid-js";
import { platformApi } from "./api/platform";

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
