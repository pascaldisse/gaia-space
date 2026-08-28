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

export { actingProfileId, actingOverride, setActingProfileId };
