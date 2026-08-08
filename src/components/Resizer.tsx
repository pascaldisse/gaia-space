import { createSignal, onCleanup } from "solid-js";

/** Signal backed by localStorage — pane widths survive reloads. */
export function paneWidth(key: string, initial: number) {
  const stored = Number(localStorage.getItem(key));
  const [width, set] = createSignal(
    Number.isFinite(stored) && stored > 0 ? stored : initial,
  );
  const setWidth = (value: number) => {
    set(value);
    localStorage.setItem(key, String(Math.round(value)));
  };
  return [width, setWidth] as const;
}

type Props = {
  width: () => number;
  setWidth: (value: number) => void;
  min?: number;
  max?: number;
};

/** Vertical drag handle. Place it as its own grid track (`var(--handle,5px)`). */
export function Resizer(props: Props) {
  const [dragging, setDragging] = createSignal(false);
  let startX = 0;
  let startW = 0;

  const clamp = (value: number) =>
    Math.min(props.max ?? 900, Math.max(props.min ?? 140, value));

  const onMove = (e: PointerEvent) =>
    props.setWidth(clamp(startW + (e.clientX - startX)));

  const stop = () => {
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
  };

  const start = (e: PointerEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startW = props.width();
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
  };

  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft") props.setWidth(clamp(props.width() - step));
    else if (e.key === "ArrowRight") props.setWidth(clamp(props.width() + step));
    else return;
    e.preventDefault();
  };

  onCleanup(stop);

  return (
    <div
      class="resizer"
      classList={{ dragging: dragging() }}
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={key}
      onDblClick={() => props.setWidth(clamp(props.min ?? 140))}
    />
  );
}
