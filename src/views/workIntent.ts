import { createSignal } from "solid-js";

/** ── "create this, over there" ──────────────────────────────────────────────
 *
 *  Stage 10a rule: an empty state's primary action must actually DO the thing
 *  it names. A surface that has no create form of its own (the project
 *  Overview) can only navigate — and a button labelled "New task" that merely
 *  lands you on another page, still empty, is exactly the dead-end this stage
 *  removes.
 *
 *  So the intent travels with the navigation. It is a ONE-SHOT signal: the
 *  destination view consumes it, opens the right form, and clears it, so a
 *  later visit to the same view is not ambushed by a form nobody asked for.
 *
 *  It is deliberately NOT in the route grammar: it is not addressable state,
 *  nobody should be able to bookmark or share "the tasks page with an open
 *  form", and the router stays free of view intent.
 */
export type WorkIntent = "new-task";

const [intent, setIntent] = createSignal<WorkIntent | undefined>();

/** Ask the destination work surface to open this form once it mounts. */
export const requestWorkIntent = (next: WorkIntent) => setIntent(next);

/** Read and clear. Returns undefined when nothing was requested. */
export function takeWorkIntent(): WorkIntent | undefined {
  const value = intent();
  if (value) setIntent(undefined);
  return value;
}
