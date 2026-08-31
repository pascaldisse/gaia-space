import { createMemo } from "solid-js";
import type { Todo } from "../api/personal";

/* ── A ROW IS THE TASK, NOT THE READ THAT DELIVERED IT (GS issue #2) ────────────
 *
 * The task surfaces poll every 15s and re-read on window focus. Every read hands
 * back FRESHLY DESERIALISED objects — equal in content, new in identity — and every
 * derived shape above them (the day groups, the project groups) was rebuilt from
 * those objects on the spot. Solid's `<For>` keys BY REFERENCE, so an unchanged
 * list still looked like a whole new list: sections and rows were disposed and
 * rebuilt. When one of those rows was OPEN as an editor, the editor went with it —
 * its `form()` signal (a snapshot taken at mount, TaskRowEdit.tsx) died with the
 * component, so the typed title reverted and the button row was rebuilt
 * mid-keystroke. That is the report: "buttons switch mid change when editing task".
 *
 * The cure is identity, at BOTH levels:
 *   - a task that did not actually change keeps the object it already had (below);
 *   - a group keeps its object and exposes its rows as an ACCESSOR, so rows may
 *     arrive and leave without the section around them being torn down.
 *
 * Not "pause polling while editing": a collaborative surface that stops listening
 * the moment somebody types is a different bug, and the very next read would still
 * take the editor down with it.
 */

/** Reference-equal, element by element — the question `<For>` itself asks. */
export const sameRows = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Keeps the previous object for any key whose content did not change. */
export function stableBy<T>(source: () => T[], keyOf: (item: T) => string, same: (a: T, b: T) => boolean): () => T[] {
  let previous = new Map<string, T>();
  return createMemo(() => {
    const next = source();
    const kept = new Map<string, T>();
    const rows = next.map(item => {
      const key = keyOf(item);
      const before = previous.get(key);
      const row = before !== undefined && same(before, item) ? before : item;
      kept.set(key, row);
      return row;
    });
    previous = kept;
    return rows;
  });
}

const sameTodo = (a: Todo, b: Todo): boolean => {
  const keys = Object.keys(a) as (keyof Todo)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => {
    const left = a[key], right = b[key];
    if (Array.isArray(left) && Array.isArray(right)) return sameRows(left, right);
    return left === right;
  });
};

export const stableTasks = (source: () => Todo[] | undefined): (() => Todo[]) =>
  stableBy(() => source() ?? [], task => task.id, sameTodo);
