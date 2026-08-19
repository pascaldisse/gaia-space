export type ChatMapping = { channelId: string };
export type BridgeState = {
  lastUpdateId: number;
  chats: Record<string, ChatMapping>;
  inboundSpaceMessageIds: string[];
  forwardedSpaceMessageIds: string[];
  outboundPrimed: boolean;
};

export const emptyState = (): BridgeState => ({
  lastUpdateId: 0,
  chats: {},
  inboundSpaceMessageIds: [],
  forwardedSpaceMessageIds: [],
  outboundPrimed: false,
});

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-2_000) : [];
}

export async function loadState(path: string): Promise<BridgeState> {
  const file = Bun.file(path);
  if (!(await file.exists())) return emptyState();
  const raw: unknown = await file.json();
  if (!raw || typeof raw !== "object") throw new Error(`invalid bridge state: ${path}`);
  const state = raw as Partial<BridgeState>;
  return {
    lastUpdateId: typeof state.lastUpdateId === "number" && state.lastUpdateId >= 0 ? state.lastUpdateId : 0,
    chats: Object.fromEntries(Object.entries(state.chats ?? {}).filter((entry): entry is [string, ChatMapping] =>
      typeof entry[0] === "string" && !!entry[1] && typeof entry[1].channelId === "string")),
    inboundSpaceMessageIds: ids(state.inboundSpaceMessageIds),
    forwardedSpaceMessageIds: ids(state.forwardedSpaceMessageIds),
    outboundPrimed: state.outboundPrimed === true,
  };
}

export async function saveState(path: string, state: BridgeState): Promise<void> {
  await Bun.write(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function remember(ids: string[], id: string): string[] {
  return [...ids.filter((saved) => saved !== id), id].slice(-2_000);
}
