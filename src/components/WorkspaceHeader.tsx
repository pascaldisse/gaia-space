import { Show, type JSX } from "solid-js";
import { Icon, type IconName } from "./Icon";
import "./WorkspaceHeader.css";

/** Shared workspace identity: SVG mark, purpose, and a stable action edge. */
export function WorkspaceHeader(props: { icon: IconName; title: string; children?: JSX.Element; actions?: JSX.Element; class?: string }) {
  return <header class="workspace-header" classList={props.class ? { [props.class]: true } : undefined}>
    <div class="wh-main"><span class="wh-mark" aria-hidden="true"><Icon name={props.icon} size={22} /></span><div class="wh-text"><h1>{props.title}</h1><Show when={props.children}><p>{props.children}</p></Show></div></div>
    <Show when={props.actions}><div class="wh-actions">{props.actions}</div></Show>
  </header>;
}
