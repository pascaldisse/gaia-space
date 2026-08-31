export type GroupableMessage = { author_id: string | null; created_at: number };

const GROUP_WINDOW_SECONDS = 5 * 60;

/** Consecutive authored messages inside the chat window share one visual group. */
export const isGrouped = (
  previous: GroupableMessage | undefined,
  current: GroupableMessage,
) => previous?.author_id !== null
  && previous?.author_id === current.author_id
  && current.created_at >= previous.created_at
  && current.created_at - previous.created_at < GROUP_WINDOW_SECONDS;
