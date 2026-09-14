import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "solid-js/web";
import CRM from "./views/CRM";
import { leadInvariantViolations, normalize } from "./crmStore";
import { createMemoryAdapter, initRouter, navigate, registerViews, setAvailableViews } from "./router";

// Rendered-DOM proof that CREATING is context-specific: the toolbar offers the record
// the current tab is about (lead, deal, organization) and each form asks for THAT
// record's facts. Nothing is stubbed but the address bar; every write goes through the
// real crmStore into the real localStorage document.

let dispose: (() => void) | undefined;
const settle = (ms = 15) => new Promise(done => setTimeout(done, ms));
const stored = () => JSON.parse(localStorage.getItem("gaia.crm.prototype.v2")!);

beforeEach(() => {
  localStorage.clear();
  registerViews(["Dashboard", "CRM"]);
  setAvailableViews(null);
  initRouter(createMemoryAdapter("crm/leads"));
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; localStorage.clear(); });

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <CRM /> as any, host);
  return host;
}
const createButton = (host: HTMLElement) =>
  host.querySelector<HTMLElement>(".crm-toolbar button.primary");
const openCreate = async (host: HTMLElement) => { createButton(host)!.click(); await settle(); return host.querySelector<HTMLFormElement>(".crm-create-form")!; };
const fill = (form: HTMLElement, label: string, value: string) => {
  const field = [...form.querySelectorAll("label")].find(node => node.textContent?.startsWith(label))!;
  const input = field.querySelector("input, textarea, select") as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return input;
};
const submit = async (form: HTMLFormElement) => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(); };

test("the toolbar names the record the current tab is about, and stays silent where none fits", async () => {
  const host = mount();
  await settle();
  const labelOn = async (tab: string) => { navigate({ view: "CRM", tab }); await settle(); return createButton(host)?.textContent?.trim(); };
  expect(await labelOn("leads")).toBe("Neuer Lead");
  expect(await labelOn("pipeline")).toBe("Neuer Deal");
  expect(await labelOn("open")).toBe("Neuer Deal");
  expect(await labelOn("won")).toBe("Neuer Deal");
  expect(await labelOn("lost")).toBe("Neuer Deal");
  expect(await labelOn("customers")).toBe("Neue Organisation");
  // Trash, activities and insights create nothing: no action that cannot mean anything.
  expect(await labelOn("trash")).toBeUndefined();
  expect(await labelOn("activities")).toBeUndefined();
  expect(await labelOn("insights")).toBeUndefined();
  // Importing stays a LEAD action.
  const importOn = async (tab: string) => { navigate({ view: "CRM", tab }); await settle(); return !!host.querySelector(".crm-import-trigger"); };
  expect(await importOn("leads")).toBe(true);
  expect(await importOn("pipeline")).toBe(false);
  expect(await importOn("customers")).toBe(false);
});

test("the lead form captures source, person, contact details and address — on the record's location", async () => {
  navigate({ view: "CRM", tab: "leads" });
  const host = mount();
  await settle();
  const form = await openCreate(host);
  expect(form.querySelector("h2")?.textContent).toBe("Neuen Lead anlegen");
  // Without a company name nothing can be created; the action says so by being off.
  expect((form.querySelector("button.primary") as HTMLButtonElement).disabled).toBe(true);
  fill(form, "Organisation / Firma", "Optik Morgenrot");
  fill(form, "Quelle", "Messe Hamburg");
  fill(form, "Verantwortliche Person", "Bjarne");
  fill(form, "Ansprechpartner", "Ida Nord");
  fill(form, "Position", "Inhaberin");
  fill(form, "E-Mail", "ida@morgenrot.de");
  fill(form, "Telefon", "040 1234");
  fill(form, "Adresse", "Hauptstr. 1\n20095 Hamburg");
  fill(form, "Nächster Schritt", "Rückruf vereinbaren");
  await submit(form);

  const org = stored().organizations.find((item: any) => item.name === "Optik Morgenrot");
  expect(org.source).toBe("Messe Hamburg");
  expect(org.owner).toBe("Bjarne");
  expect(org.nextStep).toBe("Rückruf vereinbaren");
  expect(org.leadState).toBe("active");
  expect(stored().deals.filter((deal: any) => deal.organizationId === org.id)).toHaveLength(0);
  // Address and person belong to a LOCATION; an organization has no address of its own.
  expect(org.locations).toHaveLength(1);
  expect(org.locations[0].address).toBe("Hauptstr. 1\n20095 Hamburg");
  expect(org.locations[0].emails).toEqual(["ida@morgenrot.de"]);
  expect(org.locations[0].phones).toEqual(["040 1234"]);
  expect(org.locations[0].contacts[0]).toMatchObject({ name: "Ida Nord", role: "Inhaberin", preferred: "E-Mail" });
  expect(org.decisionMaker).toBe("Ida Nord");
  // The new lead is where leads are: in the inbox, with its reason on the row.
  navigate({ view: "CRM", tab: "leads" });
  await settle();
  const row = [...host.querySelectorAll(".crm-lead-row")].find(node => node.textContent?.includes("Optik Morgenrot"))!;
  expect(row.textContent).toContain("Messe Hamburg");
  expect(leadInvariantViolations(normalize(stored()))).toHaveLength(0);
});

test("the deal form takes the full opportunity and may create its organization inline", async () => {
  navigate({ view: "CRM", tab: "pipeline" });
  const host = mount();
  await settle();
  const form = await openCreate(host);
  expect(form.querySelector("h2")?.textContent).toBe("Neuen Deal anlegen");
  (form.querySelectorAll<HTMLInputElement>(".crm-deal-org-choice input")[1]).click();   // neue Organisation
  await settle();
  fill(form, "Titel", "Filialausstattung 2027");
  fill(form, "Name der neuen Organisation", "Sehzentrum Süd");
  fill(form, "Pipeline-Phase", "Angebot erstellt");
  fill(form, "Verantwortliche Person", "Charles");
  fill(form, "Deal-Wert", "24500");
  fill(form, "Währung", "CHF");
  fill(form, "Quelle", "Empfehlung");
  await submit(form);

  const data = stored();
  const deal = data.deals.find((item: any) => item.title === "Filialausstattung 2027");
  expect(deal).toMatchObject({ stage: "Angebot erstellt", status: "Offen", owner: "Charles", value: "24500", currency: "CHF", source: "Empfehlung" });
  const org = data.organizations.find((item: any) => item.id === deal.organizationId);
  expect(org.name).toBe("Sehzentrum Süd");
  // A deal means the record was qualified: it left the inbox in the same write.
  expect(org.leadState).toBe("converted");
  expect(leadInvariantViolations(normalize(data))).toHaveLength(0);
  navigate({ view: "CRM", tab: "pipeline" });
  await settle();
  expect(host.querySelector(".crm-board")?.textContent).toContain("Filialausstattung 2027");
  navigate({ view: "CRM", tab: "leads" });
  await settle();
  expect([...host.querySelectorAll(".crm-lead-row")].some(node => node.textContent?.includes("Sehzentrum Süd"))).toBe(false);
});

test("the deal form can point at an existing organization instead of inventing one", async () => {
  navigate({ view: "CRM", tab: "open" });
  const host = mount();
  await settle();
  const before = stored().organizations.length;
  const form = await openCreate(host);
  const select = form.querySelector("select[aria-label='Organisation']") as HTMLSelectElement;
  const option = [...select.options].find(item => item.textContent === "Optik Sonnenschein")!;   // the seeded lead
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  fill(form, "Deal-Wert", "8000");
  await submit(form);

  const data = stored();
  expect(data.organizations).toHaveLength(before);                        // no twin record
  const deal = data.deals.find((item: any) => item.organizationId === option.value);
  expect(deal.title).toBe("Optik Sonnenschein");                          // empty title = the org
  expect(deal.value).toBe("8000");
  expect(data.organizations.find((item: any) => item.id === option.value).leadState).toBe("converted");
});

test("an organization typed from the customer list is not called a customer, and says where it went", async () => {
  navigate({ view: "CRM", tab: "customers" });
  const host = mount();
  await settle();
  const form = await openCreate(host);
  expect(form.querySelector("h2")?.textContent).toBe("Neue Organisation anlegen");
  // The form states the definition instead of filing the record into a list it fails.
  const hint = form.querySelector(".crm-create-hint")!;
  expect(hint.textContent).toContain("gewonnenen Deal");
  expect(hint.textContent).toContain("Posteingang");
  fill(form, "Name", "Brillen Weser");
  fill(form, "Website", "brillen-weser.de");
  fill(form, "Mitarbeitende", "9");
  fill(form, "Ansprechpartner", "Ute Weser");
  fill(form, "Telefon", "0421 999");
  fill(form, "Adresse", "Weserstr. 4\n28195 Bremen");
  await submit(form);

  const data = stored();
  const org = data.organizations.find((item: any) => item.name === "Brillen Weser");
  expect(org.website).toBe("brillen-weser.de");
  expect(org.employees).toBe("9");
  expect(org.locations[0].address).toBe("Weserstr. 4\n28195 Bremen");
  expect(org.locations[0].contacts[0]).toMatchObject({ name: "Ute Weser", preferred: "Telefon" });
  expect(org.leadState).toBe("active");
  // Not a customer: the customer list is won deals only, and it stays unchanged.
  navigate({ view: "CRM", tab: "customers" });
  await settle();
  expect(host.querySelector(".crm-directory")?.textContent).not.toContain("Brillen Weser");
  navigate({ view: "CRM", tab: "leads" });
  await settle();
  expect([...host.querySelectorAll(".crm-lead-row")].some(node => node.textContent?.includes("Brillen Weser"))).toBe(true);
});
