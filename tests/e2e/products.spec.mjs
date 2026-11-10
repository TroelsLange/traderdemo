import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

const NOW = { now: "2026-11-10T10:00:00+01:00" };

test("Handel: produktet bestemmer områder og grænse, og handlen gemmes med produkt", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await expect(page.locator("#fFund option")).toHaveText(["Day-Ahead DK1", "Intraday Aktiv", "Spread DK1/DK2"]);
  await expect(page.locator('#fArea option[value="DK2"]')).toBeDisabled();
  await expect(page.locator("#fFundHelp")).toContainText("grænse 50 MW");
  await page.selectOption("#fFund", "spread");
  await expect(page.locator('#fArea option[value="DK2"]')).toBeEnabled();
  await expect(page.locator("#fFundHelp")).toContainText("grænse 30 MW");
  await page.selectOption("#fArea", "DK2");
  await page.fill("#fMw", "35");
  await expect(page.locator("#tdWarn")).toContainText("Spread DK1/DK2s grænse på 30 MW");
  await page.fill("#fMw", "20");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("registreret");
  await expect(page.locator("#tdOpen tbody tr td").nth(1)).toHaveText("Spread DK1/DK2");
  const book = await (await request.get("/api/book")).json();
  expect(book.book.trades[0]).toMatchObject({ fund: "spread", area: "DK2" });
  await page.selectOption("#fFund", "intraday");
  await expect(page.locator("#fFundHelp")).toContainText("day-ahead-timeblokke");
});

test("Position: positioner og grænse pr. produkt", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.fill("#fMw", "20");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("registreret");
  await page.goto("/#position");
  await expect(page.locator("#limitInput")).toHaveValue("50");
  await expect(page.locator("#psKpis div").first()).toContainText("480 MWh");
  await page.selectOption("#psFund", "spread");
  await expect(page.locator("#limitInput")).toHaveValue("30");
  await expect(page.locator("#psKpis div").first()).toContainText("0 MWh");
  await page.fill("#limitInput", "25");
  await page.locator("#limitInput").dispatchEvent("change");
  await expect.poll(async () => (await (await request.get("/api/book")).json()).book.limits.spread).toBe(25);
});

test("Kapital: kurs, kapital og ind-/udbetalinger pr. produkt", async ({ page, request }) => {
  await open(page, request, "kapital", NOW);
  const rows = page.locator("#kpTable tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Day-Ahead DK1");
  await expect(rows.nth(0)).toContainText("3/7");
  await expect(page.locator("#kpKpis")).toContainText("Samlet kapital");
  await expect(page.locator("#kpSource")).toContainText("Demodata");
  await expect(page.locator("#kpSource")).toContainText("Papirhandler");
});
