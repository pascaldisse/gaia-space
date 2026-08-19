import { Show, type JSX } from "solid-js";
import "./WorkspaceHeader.css";

/** Shared workspace identity: page mark, purpose, and a stable action edge. */
export function WorkspaceHeader(props: { icon: string; title: string; children?: JSX.Element; actions?: JSX.Element }) {
  return <header class="workspace-header">
    <div class="wh-main"><span class="wh-mark" aria-hidden="true">{props.icon}</span><div class="wh-text"><h1>{props.title}</h1><Show when={props.children}><p>{props.children}</p></Show></div></div>
    <Show when={props.actions}><div class="wh-actions">{props.actions}</div></Show>
  </header>;
}
