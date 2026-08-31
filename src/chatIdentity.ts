import { createSignal } from "solid-js";
import { profileId } from "./session";

/**
 * The acting chat profile, lifted out of views/Chat.tsx (GAIA Space redesign, stage 6b).
 *
 * Chat used to own this as a local signal next to its own sidebar. In the chat-first
 * layout that sidebar is gone, so the picker moved into the shell — and a picker in the
 * shell and a reader in the view must read the SAME cell.
 *
 * The fallback is the point. Chat seeded this from `profiles()[0]`, which is whichever
 * row the directory happens to return first — on this workspace the organisation profile,
 * not the person. That was invisible while a picker sat next to the messages and the
 * reader corrected it by hand. With the picker gone, an unset cell silently made every
 * private channel answer "channel access denied": the caller was acting as somebody who
 * is not a member, including on the caller's OWN private feed.
 *
 * So: the session already knows who you are. Read that, and let the explicit choice win
 * over it. Never fall back to "the first profile in the list" — that is a guess wearing
 * the costume of an identity.
 */
const [override, setActingProfileId] = createSignal<string | null>(null);

/** The explicit choice if one was made, otherwise the session's own profile. */
const actingProfileId = (): string | null => override() || profileId() || null;

/** The raw override, for a picker that must show "no explicit choice" as such. */
const actingOverride = override;

/**
 * THE CHANNEL LIST IS READ IN ONE PLACE AND CHANGED IN ANOTHER.
 *
 * The shell's sidebar holds the channels as a resource; deleting or renaming one
 * happens in the shell's own menu OR inside the channel's page. Without a shared
 * cell the second case cannot reach the first: the row stayed in the list after the
 * conversation was gone, until somebody reloaded the app. (It was the delete that
 * looked broken; the delete was fine, the LIST was stale.)
 *
 * So every writer bumps this counter and every reader depends on it. It carries no
 * data — a version, not a cache: the resource re-reads the truth from the backend.
 */
const [channelsVersion, setChannelsVersion] = createSignal(0);
const bumpChannels = () => setChannelsVersion((value) => value + 1);

export { actingProfileId, actingOverride, setActingProfileId, channelsVersion, bumpChannels };

/* Who a conversation is WITH lives in a pure module (no session, no Solid) so tests can
 * own it; it is re-exported here because this is where callers already look for chat
 * identity. */
export { partitionChannels, dmLabel, isDirectMessage } from "./chatPartition";
