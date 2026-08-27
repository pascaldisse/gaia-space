import { createResource, Show } from "solid-js";
import { chatApi } from "../api/chat";
import { linkProps } from "../router";
import "./SourceLink.css";

/** The other half of the message-to-work loop: a task/ticket/date that was born in a
 * channel must lead back to the message that raised it. Given one stored anchor it
 * resolves the channel and renders a real link into it — and when the source is gone
 * it says so instead of pretending the work has no origin. */
export default function SourceLink(props: { entityType: string; entityId: string; label?: string }) {
  const [source] = createResource(
    () => [props.entityType, props.entityId] as const,
    ([entity_type, entity_id]) => chatApi.resolveSourceRef(entity_type, entity_id).catch(() => null),
  );
  return <span class="source-link">
    <Show when={source.loading}><span class="source-link-quiet">{props.label ?? "Quelle"}…</span></Show>
    <Show when={!source.loading && !source()}>
      {/* An anchor with no target is a fact worth showing: the work still knows it
          came from somewhere, and the person is not left wondering why. */}
      <span class="source-link-dead" title={`${props.entityType}: ${props.entityId}`}>Quelle nicht mehr verfügbar</span>
    </Show>
    <Show when={source()}>{ref =>
      <a class="source-link-anchor" {...linkProps({ view: "Chat", entityType: "channel", entityId: ref().channel_id, tab: "messages" })} title={ref().excerpt}>
        <span class="source-link-channel">#{ref().channel_name ?? ref().channel_id}</span>
        <Show when={ref().author_name}>{name => <span class="source-link-author"> · {name()}</span>}</Show>
      </a>
    }</Show>
  </span>;
}
