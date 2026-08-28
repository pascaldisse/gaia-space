import { For, Show, createEffect, onCleanup, type JSX } from "solid-js";
import "./ContextMenu.css";

/** ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 *  Row actions used to hang off the card on hover: a pencil, an ✕ and a bin, three
 *  glyphs with no labels, two of which were read as something they were not (the ✕
 *  archived, and looked like a delete). Icons without words are a quiz.
 *
 *  Everything a card can do now lives in ONE menu, opened by right-click — where
 *  people already look for it — or by the card's own ⋯ button, so the same acts are
 *  reachable without a right mouse button and from the keyboard. Every entry is a
 *  WORD, the destructive one is last and red, and Escape or any click outside
 *  closes without doing anything.
 */

export type ContextMenuItem = {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuProps = {
  /** Viewport coordinates of the click that opened it. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

export default function ContextMenu(props: ContextMenuProps): JSX.Element {
  let panel: HTMLDivElement | undefined;

  createEffect(() => {
    const close = () => props.onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    // A click anywhere else is an answer too: "not this".
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    // Focus the first entry so the menu is operable without a mouse.
    (panel?.querySelector("button:not([disabled])") as HTMLButtonElement | undefined)?.focus();
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    });
  });

  /** Never opens off-screen: the menu is placed, not hoped for. */
  const left = () => Math.min(props.x, Math.max(8, window.innerWidth - 220));
  const top = () => Math.min(props.y, Math.max(8, window.innerHeight - (props.items.length * 36 + 16)));

  return (
    <div
      ref={panel}
      class="context-menu"
      role="menu"
      style={{ left: `${left()}px`, top: `${top()}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <For each={props.items}>
        {(item) => (
          <Show when={!item.disabled} fallback={<span class="context-item disabled">{item.label}</span>}>
            <button
              type="button"
              role="menuitem"
              class="context-item"
              classList={{ danger: item.danger }}
              onClick={() => {
                props.onClose();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          </Show>
        )}
      </For>
    </div>
  );
}
