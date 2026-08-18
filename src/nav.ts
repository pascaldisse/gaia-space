import { createRoot, createSignal } from "solid-js";

// Cross-view navigation request. Views (e.g. Project Home cards) call
// requestView("Issues") to ask the App shell to switch the active destination.
// App consumes it in an effect and clears it back to undefined.
export const [requestedView, requestView] = createRoot(() => createSignal<string | undefined>());

// Deep-link target: a todo id the destination should focus/highlight after the
// view switches. Overview task rows set this alongside requestView("To-Do") so
// "My tasks" can scroll to and flag the exact task. Consumers clear it once used.
export const [requestedTodo, requestTodo] = createRoot(() => createSignal<string | undefined>());

// Deep-link date (YYYY-MM-DD): the Overview mini-calendar sets this alongside
// requestView("Calendar") so the full Calendar workspace opens focused on the
// exact day the user clicked. The Calendar view consumes and clears it.
export const [requestedDate, requestDate] = createRoot(() => createSignal<string | undefined>());
