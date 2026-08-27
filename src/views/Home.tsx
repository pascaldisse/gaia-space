import type { JSX } from "solid-js";
import HomeCalendar from "./HomeCalendar";

/** Home (`/home`) — the chat-first start view: one calm month calendar with the
 *  selected day's agenda. The surface itself lives in HomeCalendar.tsx; this is the
 *  registered view that owns the route. */
export default function Home(): JSX.Element {
  return <HomeCalendar />;
}
