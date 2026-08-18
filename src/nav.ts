import { createRoot, createSignal } from "solid-js";

// Cross-view navigation request. Views (e.g. Project Home cards) call
// requestView("Issues") to ask the App shell to switch the active destination.
// App consumes it in an effect and clears it back to undefined.
export const [requestedView, requestView] = createRoot(() => createSignal<string | undefined>());
