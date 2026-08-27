import type { JSX } from "solid-js";

/**
 * Home (`/home`) — the chat-first start view.
 *
 * PLACEHOLDER, stage 1. The real month calendar + selected-day agenda is being built
 * in a parallel lane as `src/views/HomeCalendar.tsx`. When that file lands, replace the
 * body below with:
 *     import HomeCalendar from "./HomeCalendar";
 *     export default function Home() { return <HomeCalendar />; }
 * Nothing else about the shell or the route has to change.
 */
export default function Home(): JSX.Element {
  return (
    <div class="space-placeholder">
      <div class="surface">
        <div class="kicker">Home</div>
        <h1>Heute im Space</h1>
        <p>
          Platzhalter — die Kalender-Startansicht (Monatskalender + ausgewählter Tag mit Terminen,
          fälligen Aufgaben und offenen Nachrichten) kommt als <code>HomeCalendar.tsx</code>.
        </p>
      </div>
    </div>
  );
}
