export const CRM_STAGES = [
  "Non-Qualified", "Qualified", "Kontakt hergestellt", "Gespräch vereinbart", "Angebot erstellt", "Verhandlung", "Gewonnen",
] as const;
export type CrmStage = typeof CRM_STAGES[number];
/** Won is terminal: it belongs in the deals archive, not in an active pipeline column. */
export const PIPELINE_STAGES = CRM_STAGES.filter(stage => stage !== "Gewonnen") as Exclude<CrmStage, "Gewonnen">[];
export type ActivityKind = "Anruf" | "E-Mail" | "Besuch" | "Video-Call" | "Aufgabe";
export type Contact = { id: string; name: string; role: string; emails: string[]; phones: string[]; preferred: string };
export type Note = { id: string; title?: string; body: string; author: string; createdAt: string };
export type Activity = { id: string; kind: ActivityKind; title: string; dueDate: string; outcome: string; done: boolean };
export type CrmFile = { id: string; name: string; type: string; data: string; createdAt: string };
export type Location = {
  id: string; name: string; stage: CrmStage; status: "Aktiv" | "Verloren"; address: string; employees: string; emails: string[]; phones: string[];
  nextStep: string; nextStepDate: string; contacts: Contact[]; notes: Note[]; activities: Activity[]; files: CrmFile[];
};
export type Account = { id: string; name: string; website: string; locationCount: number; employees: string; decisionMaker?: string; software: string; source: string; owner: string; stage: CrmStage; status: "Aktiv" | "Verloren"; dealScope: "Betrieb" | "Standorte"; locations: Location[] };

const KEY = "gaia.crm.prototype.v1";
export const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const seed = (): Account[] => [{
  id: "account-example", name: "Beispiel Optik GmbH", website: "", locationCount: 2, employees: "12", software: "", source: "Beispieldaten", owner: "Jannes", stage: "Qualified", status: "Aktiv", dealScope: "Betrieb", locations: [
    { id: "location-example-1", name: "Beispiel Optik · Mitte", stage: "Qualified", status: "Aktiv", address: "Musterstraße 12\n10115 Berlin", employees: "7", emails: ["kontakt@beispiel-optik.de"], phones: ["030 123456"], nextStep: "Erstgespräch terminieren", nextStepDate: "", contacts: [{ id: "contact-example", name: "Max Mustermann", role: "Inhaber", emails: ["max@beispiel-optik.de"], phones: ["030 123456"], preferred: "Telefon" }], notes: [], activities: [], files: [] },
    { id: "location-example-2", name: "Beispiel Optik · Prenzlauer Berg", stage: "Kontakt hergestellt", status: "Aktiv", address: "Musterallee 4\n10405 Berlin", employees: "5", emails: [], phones: [], nextStep: "Follow-up senden", nextStepDate: "", contacts: [], notes: [], activities: [], files: [] },
  ],
}];
export const loadCrm = (): Account[] => { try { const raw = localStorage.getItem(KEY); const accounts: Account[] = raw ? JSON.parse(raw) : seed(); return accounts.map(account => ({ ...account, locationCount: account.locations.length, stage: account.stage ?? account.locations[0]?.stage ?? "Non-Qualified", status: account.status ?? account.locations[0]?.status ?? "Aktiv", dealScope: account.dealScope ?? "Betrieb", locations: account.locations.map(location => ({ ...location, employees: location.employees ?? "" })) })); } catch { return seed(); } };
export const saveCrm = (accounts: Account[]) => localStorage.setItem(KEY, JSON.stringify(accounts));
export const emptyLocation = (name = "") : Location => ({ id: id("location"), name, stage: "Non-Qualified", status: "Aktiv", address: "", employees: "", emails: [], phones: [], nextStep: "", nextStepDate: "", contacts: [], notes: [], activities: [], files: [] });
