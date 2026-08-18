import { Show, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";
import "./WorkspaceHeader.css";

/**
 * One premium, consistent page-identity banner shared across the top-level
 * workspace destinations (Overview, My tasks, Projects, Calendar, Knowledge,
 * Inbox, Organization). Mirrors the project-scoped ProjectHeader so both IA
 * levels read the same: a restrained brand mark, the page title, a
 * plain-language purpose line, and an optional right-hand actions slot
 * (Acting-as picker, create action, calendar controls…).
 *
 * Reserved for workspace-global scope — project-scoped views keep ProjectHeader
 * so a project's own identity is never doubled up with workspace branding.
 */
export function WorkspaceHeader(props: {
  icon: IconName;
  title: string;
  children?: JSX.Element; // purpose line
  actions?: JSX.Element; // right slot (pickers / primary action / controls)
  class?: string; // optional extra class for view-specific spacing
}) {
  return (
    <header class="workspace-header" classList={props.class ? { [props.class]: true } : undefined}>
      <div class="wh-main">
        <div class="wh-mark" aria-hidden="true">
          <Icon name={props.icon} size={22} />
        </div>
        <div class="wh-text">
          <h1>{props.title}</h1>
          <Show when={props.children}>
            <p>{props.children}</p>
          </Show>
        </div>
      </div>
      <Show when={props.actions}>
        <div class="wh-actions">{props.actions}</div>
      </Show>
    </header>
  );
}
