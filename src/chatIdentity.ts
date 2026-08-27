import { createSignal } from "solid-js";

/**
 * The acting chat profile, lifted out of views/Chat.tsx (GAIA Space redesign, stage 6b).
 *
 * Chat used to own this as a local signal next to its own sidebar. In the chat-first
 * layout that sidebar is gone, so the picker moved into the shell — and a picker in the
 * shell and a reader in the view must read the SAME cell. This is that cell, nothing
 * more: no fetching, no defaulting policy. Whoever mounts first (Chat's own effect, or
 * the shell's picker) seeds it from the profile list; web pins it to the signed-in
 * account, exactly as before.
 */
const [actingProfileId, setActingProfileId] = createSignal<string | null>(null);

export { actingProfileId, setActingProfileId };
