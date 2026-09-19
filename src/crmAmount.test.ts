import { expect, test } from "bun:test";
import { dealAmount } from "./crmStore";
import { dealAmount as insightsAmount } from "./crmInsights";
import { dealRows, DEAL_COLUMNS } from "./crmExport";
import { emptyDeal, emptyOrganization, seed, type CrmData } from "./crmStore";

// Regression: the value of a deal is free text, and the app's own placeholder suggests
// "z. B. 12.500". Three modules used to read that text with two different rules — the
// board and the export dropped the thousands separator's meaning and reported twelve
// euros for "12.000 €", while the reports said twelve thousand. One deal, two answers.
// There is now ONE reading, and these cases pin it.

const CASES: Array<[string, number]> = [
  ["12.000 €", 12000],
  ["12.500", 12500],
  ["2.500", 2500],
  ["1.234,56", 1234.56],
  ["8500", 8500],
  ["12,5", 12.5],
  ["", 0],
  ["auf Anfrage", 0],
];

test("a German amount is read as it is written, everywhere", () => {
  for (const [value, expected] of CASES) expect(dealAmount({ value })).toBe(expected);
});

test("board, reports and export cannot disagree about one deal's worth", () => {
  for (const [value] of CASES) expect(insightsAmount({ value } as any)).toBe(dealAmount({ value }));
});

test("the exported amount column carries the same number as the pipeline", () => {
  const data: CrmData = { ...seed(), organizations: [], deals: [] };
  const org = emptyOrganization("Optik Nord", "Jannes");
  data.organizations = [org];
  const deal = { ...emptyDeal(org.id, "Neubau", "Jannes"), value: "12.000 €" };
  data.deals = [deal];
  const column = DEAL_COLUMNS.indexOf("Wert");
  expect(column).toBeGreaterThanOrEqual(0);
  const row = dealRows(data, { organizations: data.organizations, deals: data.deals, activities: [] } as any)[0];
  // Exported as a German decimal — the digits must be the twelve thousand, not twelve.
  expect(String(row[column])).toBe("12000");
});
