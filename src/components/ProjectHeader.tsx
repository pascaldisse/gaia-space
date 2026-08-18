import { Show, type JSX } from "solid-js";
import { Avatar } from "./Avatar";
import "./ProjectHeader.css";

/**
 * One premium, owner-friendly section header shared across project-scoped views
 * (Delivery: Repositories, Code reviews, Pipelines, Packages). Shows the active
 * project's mark so it always reads as "this is <project>'s X", a plain-language
 * purpose line, and an optional right-hand actions slot (e.g. Acting-as).
 */
export function ProjectHeader(props: {
  title: string;
  project?: { name: string } | null | undefined;
  children: JSX.Element; // purpose line
  actions?: JSX.Element; // right slot (pickers / primary action)
}) {
  return (
    <header class="proj-head">
      <div class="proj-head-main">
        <Show
          when={props.project}
          fallback={<span class="proj-mark placeholder" aria-hidden="true">··</span>}
        >
          <Avatar name={props.project!.name} variant="project" size={44} class="proj-mark" />
        </Show>
        <div class="proj-head-text">
          <h1>{props.title}</h1>
          <p>{props.children}</p>
        </div>
      </div>
      <Show when={props.actions}>
        <div class="proj-head-actions">{props.actions}</div>
      </Show>
    </header>
  );
}
