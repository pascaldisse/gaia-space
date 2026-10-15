import { invoke } from "@tauri-apps/api/core";
// Space-Buy client (docs/space-buy/DESIGN.md). Same /api/cmd bridge as every other api/*.ts.
export type BuyStatus = "wanted" | "approved" | "ordered" | "delivered" | "cancelled";
export const BUY_STATUSES: BuyStatus[] = ["wanted", "approved", "ordered", "delivered", "cancelled"];
export type BuyItem = {
  id: string; project_id: string | null; title: string; url: string; vendor: string;
  price_cents: number | null; currency: string; qty: number; status: BuyStatus; notes: string;
  approver: string | null; ordered_by: string | null; order_ref: string | null;
  created_by: string | null; created_at: number; updated_at: number;
};
export type BuyItemDraft = Partial<BuyItem> & { title: string };
export type BuyVendor = { name: string; kind: "api" | "browser" | "manual"; agent_allowed: boolean; notes: string };
const call = <T>(command: string, args: Record<string, unknown> = {}) => invoke<T>(command, args);
export const buyApi = {
  list: (status?: BuyStatus) => call<BuyItem[]>("list_buy_items", { status: status ?? null }),
  save: (item: BuyItemDraft) => call<BuyItem>("save_buy_item", { item }),
  approve: (id: string) => call<BuyItem>("approve_buy_item", { id }),
  markOrdered: (id: string, orderRef: string) => call<BuyItem>("mark_buy_item_ordered", { id, orderRef }),
  setStatus: (id: string, status: "delivered" | "cancelled") => call<BuyItem>("set_buy_item_status", { id, status }),
  remove: (id: string) => call<void>("delete_buy_item", { id }),
  vendors: () => call<BuyVendor[]>("list_buy_vendors"),
  saveVendor: (vendor: BuyVendor) => call<BuyVendor>("save_buy_vendor", { vendor }),
  removeVendor: (name: string) => call<void>("delete_buy_vendor", { name }),
};
export const formatPrice = (cents: number | null, currency: string) =>
  cents == null ? "" : `${(cents / 100).toFixed(2)} ${currency}`;
export const parsePriceCents = (raw: string): number | null => {
  const v = raw.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
