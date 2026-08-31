import { invoke } from "@tauri-apps/api/core";

export type Lead = {
  id: string;
  bereich: string;
  interesse: string;
  name: string;
  business: string;
  address: string;
  phone: string;
  email: string;
  created_at: string;
};

/** Administrator-only; contact PII is never fetched directly from Quest by a browser. */
export const leadsApi = {
  list: () => invoke<Lead[]>("list_leads"),
  /** Administrator-only erasure; the server is the sole gate. */
  delete: (id: string) => invoke<void>("delete_lead", { id }),
};
