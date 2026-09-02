export type DeliveryState = { deliveryIds: string[] };
export const emptyState = (): DeliveryState => ({ deliveryIds: [] });

export async function loadState(path: string): Promise<DeliveryState> {
  const file = Bun.file(path);
  if (!(await file.exists())) return emptyState();
  const raw: unknown = await file.json();
  if (!raw || typeof raw !== "object") throw new Error(`invalid bridge state: ${path}`);
  const ids = (raw as Partial<DeliveryState>).deliveryIds;
  return { deliveryIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(-500) : [] };
}

export async function saveState(path: string, state: DeliveryState): Promise<void> {
  await Bun.write(path, `${JSON.stringify({ deliveryIds: state.deliveryIds.slice(-500) }, null, 2)}\n`);
}

export function rememberDelivery(state: DeliveryState, deliveryId: string): boolean {
  if (!deliveryId || state.deliveryIds.includes(deliveryId)) return false;
  state.deliveryIds = [...state.deliveryIds, deliveryId].slice(-500);
  return true;
}
