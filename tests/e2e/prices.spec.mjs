import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

const rows = (page) => page.locator("#hourTable tbody tr");
const row = (page, label) => rows(page).filter({ has: page.locator("td:first-child", { hasText: new RegExp("^" + label + "$") }) });

test("Marked viser rigtige spotpriser med kildeangivelse", async ({ page, request }) => {
  await open(page, request, "marked", { now: "2026-11-10T10:00:00+01:00" });
  await expect(page.locator("#mkSource")).toContainText("Data: Energinet, Energi Data Service");
  await expect(rows(page)).toHaveCount(24);
  // Testprisen for DK1 kl. 00–01 er 50 + 0 + 0,15.
  await expect(row(page, "00–01").locator("td").nth(1)).toHaveText("50,15");
  await expect(page.locator("#mkChartTitle .badge")).toHaveText("Prognose");
  await expect(page.locator("#fundTable")).toContainText("Simuleret");
});

test("når morgendagens spot er ude, rykker Marked til overmorgen", async ({ page, request }) => {
  await open(page, request, "marked", { now: "2026-11-10T14:00:00+01:00" });
  await expect(page.locator("#mkLead")).toContainText("rykket til overmorgen");
  await expect(page.locator("#daychip")).toContainText("12. nov");
  await expect(row(page, "23–24").locator("td").nth(1)).toHaveText("73,15");
});

test("25-timers dag: time 02 vises to gange (A og B)", async ({ page, request }) => {
  await open(page, request, "marked", { now: "2026-10-24T10:00:00+02:00" });
  await expect(page.locator("#mkLead")).toContainText("har 25 timer");
  await expect(rows(page)).toHaveCount(25);
  await expect(row(page, "02–03 A")).toHaveCount(1);
  // I dag (24 timer) har ingen B-time.
  await expect(row(page, "02–03 B").locator("td").nth(1)).toHaveText("–");
  await expect(page.locator("#fundTable")).toContainText("Antal timer");
});

test("23-timers dag: time 02 findes ikke på leveringsdagen", async ({ page, request }) => {
  await open(page, request, "marked", { now: "2027-03-27T10:00:00+01:00" });
  await expect(page.locator("#mkLead")).toContainText("har 23 timer");
  await expect(row(page, "02–03").locator("td").nth(3)).toHaveText("–");
  await expect(row(page, "02–03").locator("td").nth(1)).not.toHaveText("–");
});
