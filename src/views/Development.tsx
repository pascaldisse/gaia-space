import type { JSX } from "solid-js";
import Issues from "./Issues";

/**
 * Entwicklung (`/development`) — the briefing's dev surface: Tickets, Bugs,
 * Pull Requests, Releases. Stage 1 mounts the EXISTING Issues view (tickets are
 * issues; no fork, no duplicated data path) so the route is never dead. Reviews,
 * pipelines and releases fold in here in a later stage — they stay separately
 * routable meanwhile.
 */
export default function Development(): JSX.Element {
  return <Issues />;
}
