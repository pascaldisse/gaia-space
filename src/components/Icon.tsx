import type { JSX } from "solid-js";

/**
 * One local, dependency-free SVG line-icon system for the whole space.
 * No CDN, no icon font — just currentColor stroke paths on a 24×24 grid so
 * every glyph inherits text colour and sizing and stays crisp on any surface.
 *
 * Usage:
 *   <Icon name="search" />                        decorative (aria-hidden)
 *   <Icon name="power" label="Log out" />         meaningful → role=img + label
 * Pair a labelled control (aria-label / title on the button) with a decorative
 * icon; only give the icon its own `label` when it is the sole accessible name.
 */

// 24×24 viewBox path data. Line style: no fill, rounded caps/joins, weight 2.
const PATHS: Record<string, JSX.Element> = {
  home: <path d="M4 11.5 12 4l8 7.5M6 10v10h4v-6h4v6h4V10" />,
  check: <path d="M5 12.5 10 17 19 7" />,
  inbox: <path d="M3 13h5l2 3h4l2-3h5M4 13l2.5-8h11L20 13v6H4z" />,
  org: <path d="M4 20V6l6-2v16M14 20V9l6 2v9M4 20h16M7.5 8v0M7.5 12v0M7.5 16v0M17 14v0M17 17v0" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M4.2 6.5l2.1 2.1M17.7 15.4l2.1 2.1M2 12h3M19 12h3M4.2 17.5l2.1-2.1M17.7 8.6l2.1-2.1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 5.6M17 14.4a5.5 5.5 0 0 1 3.5 5.1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  repo: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="8" r="2.4" />
      <path d="M6 8.4v7.2M18 10.4c0 4-4 3.6-6 5.6" />
    </>
  ),
  review: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M6 8.4v7.2M18 15.6V11a3 3 0 0 0-3-3H9.5m0 0 2.2-2.2M9.5 8l2.2 2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.3-4.3" />
    </>
  ),
  enter: <path d="M20 6v5a3 3 0 0 1-3 3H5m0 0 4-4M5 14l4 4" />,
  key: (
    <>
      <circle cx="8" cy="8" r="3.4" />
      <path d="m10.4 10.4 8.6 8.6M16 16l2-2M13.5 13.5l2.5 2.5" />
    </>
  ),
  power: <path d="M12 3v9M7.5 6.4a7 7 0 1 0 9 0" />,
  "chevron-left": <path d="m14 6-6 6 6 6" />,
  "chevron-right": <path d="m10 6 6 6-6 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  doc: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  columns: <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z" />,
  layers: <path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 8v0" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  // Separate nav key avoids a stale Solid dynamic-registry render observed for
  // the primary Calendar destination while retaining the shared calendar glyph.
  "calendar-nav": <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  book: <path d="M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2zM5 4v18M16 6h3v14M9 8h4M9 11h4" />,
  "book-nav": <path d="M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2zM5 4v18M16 6h3v14M9 8h4M9 11h4" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  chat: <path d="M5 5h14v10H9l-4 4z" />,
  pipeline: <path d="M4 8h9a3 3 0 0 1 3 3v2a3 3 0 0 0 3 3h1M9 8 6 5M9 8l-3 3M20 16l-2.5-2.5M20 16l-2.5 2.5" />,
  package: <path d="M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  "clock-nav": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; label?: string; class?: string }): JSX.Element {
  const size = () => props.size ?? 16;
  return (
    <svg
      class={props.class ? `icon ${props.class}` : "icon"}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? "img" : "presentation"}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      {PATHS[props.name]}
    </svg>
  );
}
