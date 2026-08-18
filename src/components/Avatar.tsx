import { Show } from "solid-js";
import type { JSX } from "solid-js";
import "./Avatar.css";

/**
 * One reusable identity mark used everywhere a person or project is shown.
 * Person avatars are monochrome deep-slate (no rainbow hues); project marks
 * keep the distinct teal brand treatment. Deterministic initials from a name.
 *
 *   <Avatar name="Ada Lovelace" />                 person (default)
 *   <Avatar name="Paloptic" variant="project" />   teal project mark
 *   <Avatar variant="all" />                        "any / all" sentinel
 *
 * Decorative by default (aria-hidden) since the name is almost always shown
 * beside it; pass `label` when the avatar stands alone.
 */
export function initials(label: string): string {
  return (
    label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?"
  );
}

export function Avatar(props: {
  name?: string;
  variant?: "person" | "project" | "all";
  size?: number;
  label?: string;
  class?: string;
}): JSX.Element {
  const variant = () => props.variant ?? "person";
  const style = () => (props.size ? { "--avatar-size": `${props.size}px` } : undefined);
  return (
    <span
      class={`avatar ${variant()}${props.class ? ` ${props.class}` : ""}`}
      style={style()}
      role={props.label ? "img" : "presentation"}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <Show when={variant() === "all"} fallback={initials(props.name ?? "?")}>
        <span aria-hidden="true">*</span>
      </Show>
    </span>
  );
}
