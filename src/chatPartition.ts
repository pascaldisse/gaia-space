/**
 * WHO A CONVERSATION IS WITH, NOT WHAT IT WAS NAMED.
 *
 * The sidebar used to split its list by whether a channel carried a NAME: named rows
 * were "channels", nameless rows were "direct messages". But Chat's own create path
 * names a direct message after BOTH people (`"Bjarne \u00b7 Jannes"`), so every DM made in
 * this app landed in the channel sections, labelled with the reader's own name in it.
 *
 * A direct message is a KIND plus a HEAD COUNT, and both already exist on the row:
 * `content_type === "dm"` and the membership. Three or more people is a channel even
 * when the backend still calls it a dm \u2014 the head count decides, never a parsed string.
 *
 * These are pure functions on purpose: the shell renders them, the tests own them, and
 * neither needs a running Tauri to decide which section a row belongs in.
 */

/** The shape both the sidebar and the tests can supply \u2014 a subset of `ChannelSummary`. */
export type PartitionableChannel = {
  id: string;
  name: string | null;
  content_type: string;
  member_count?: number;
  archived?: boolean;
};

/** Membership lookup: channel id -> profile ids. Absent means "ask `member_count`". */
export type MemberLookup = (channelId: string) => string[] | undefined;

/** Profile id -> display name. Absent means "the id is all we have". */
export type NameLookup = (profileId: string) => string | undefined;

export const DIRECT_CONTENT_TYPE = "dm";
/** Chat's create path joins the two names with this; the ONLY place the glyph is known. */
export const DIRECT_NAME_SEPARATOR = "\u00b7";
/** Shown when neither membership nor name can name the other person. */
export const DIRECT_FALLBACK_LABEL = "Direct message";

/** People in a conversation: the membership when known, else the row's own count. */
export const participantCount = (channel: PartitionableChannel, members?: MemberLookup): number => {
  const ids = members?.(channel.id);
  if (ids) return new Set(ids).size;
  return channel.member_count ?? 2;
};

/**
 * A 1:1 conversation. Both halves must hold: the row is of the direct KIND, and at most
 * two people are in it. A "dm" that grew to three members is a channel \u2014 that is the
 * case the old name-based split could never see.
 */
export const isDirectMessage = (channel: PartitionableChannel, members?: MemberLookup): boolean =>
  channel.content_type.trim().toLowerCase() === DIRECT_CONTENT_TYPE && participantCount(channel, members) <= 2;

/**
 * The other person's name.
 *
 * Membership first: drop yourself, name whoever is left. When the membership is not
 * loaded, fall back to the stored name and drop the segment that is YOUR name \u2014 the
 * label "Bjarne \u00b7 Jannes" read by Jannes is "Bjarne". Nothing here matches on a literal
 * person; the reader's own name comes from the same directory the row does.
 */
export const dmLabel = (
  channel: PartitionableChannel,
  selfId: string | null | undefined,
  options: { members?: MemberLookup; nameOf?: NameLookup } = {},
): string => {
  const { members, nameOf } = options;
  const ids = members?.(channel.id);
  if (ids) {
    const others = [...new Set(ids)].filter((id) => id !== selfId);
    // Talking to yourself is a real conversation: with nobody else in it, you ARE the label.
    const target = others.length ? others[0] : ids[0];
    if (target) {
      const name = nameOf?.(target)?.trim();
      if (name) return name;
      if (!channel.name) return target;
    }
  }
  const selfName = (selfId ? nameOf?.(selfId) : undefined)?.trim().toLowerCase();
  const parts = (channel.name ?? "")
    .split(DIRECT_NAME_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  const others = selfName ? parts.filter((part) => part.toLowerCase() !== selfName) : parts;
  const remaining = others.length ? others : parts;
  if (remaining.length) return remaining.join(` ${DIRECT_NAME_SEPARATOR} `);
  return DIRECT_FALLBACK_LABEL;
};

/** The chat header uses the sidebar's personal DM label, never the stored two-name title. */
export const chatHeaderLabel = (
  channel: PartitionableChannel,
  selfId: string | null | undefined,
  options: { members?: MemberLookup; nameOf?: NameLookup } = {},
): string => isDirectMessage(channel, options.members)
  ? dmLabel(channel, selfId, options)
  : channel.name ?? channel.content_type;

/**
 * Split a list into the two sections the sidebar draws. Order is preserved inside each
 * section \u2014 sorting is the caller's business, not the partition's.
 *
 * `_selfId` is accepted so the call site reads like the label call beside it, but the
 * split deliberately does NOT depend on who is asking: the same list must produce the
 * same two sections for everyone, or two people would disagree about what a channel is.
 * Only the LABEL is personal (`dmLabel`).
 */
export const partitionChannels = <T extends PartitionableChannel>(
  channels: readonly T[],
  _selfId?: string | null,
  members?: MemberLookup,
): { channels: T[]; dms: T[] } => {
  const grouped: { channels: T[]; dms: T[] } = { channels: [], dms: [] };
  for (const channel of channels) {
    if (isDirectMessage(channel, members)) grouped.dms.push(channel);
    else grouped.channels.push(channel);
  }
  return grouped;
};
