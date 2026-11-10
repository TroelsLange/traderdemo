import { test, expect } from "@playwright/test";
import { open, num } from "./helpers.mjs";

async function trade(page, { product = "base", mw = "10", side = "Køb", from, to } = {}) {
  await page.selectOption("#fProd", product);
  if (from != null) { await page.selectOption("#fFrom", String(from)); await page.selectOption("#fTo", String(to)); }
  await page.fill("#fMw", mw);
  await page.getByRole("radio", { name: side }).check();
}

test("handel registreres i den fælles bog og ses fra en anden browser", async ({ page, request, browser }) => {
  await open(page, request, "handel", { now: "2026-11-10T10:00:00+01:00" });
  await trade(page);
  await expect(page.locator("#tdMwh")).toHaveText("240 MWh");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("Handel #1 registreret");
  await expect(page.locator("#tdOpen tbody tr")).toHaveCount(1);

  const other = await browser.newContext({ timezoneId: "Europe/Copenhagen" });
  const p2 = await other.newPage();
  await p2.goto("/#resultat");
  await expect(p2.locator("#rsBlotter tbody tr")).toHaveCount(1);
  await expect(p2.locator("#bookBanner")).toBeHidden();
  await other.close();

  const book = await (await request.get("/api/book")).json();
  expect(book.book.trades[0]).toMatchObject({ id: 1, del: "2026-11-11", mw: 10, product: "base" });
});

test("annullering fjerner handlen", async ({ page, request }) => {
  await open(page, request, "handel", { now: "2026-11-10T10:00:00+01:00" });
  await page.locator("#placeBtn").click();
  await expect(page.locator("#tdOpen tbody tr")).toHaveCount(1);
  await page.locator("[data-cancel]").click();
  await expect(page.locator("#toast")).toContainText("annulleret");
  await expect(page.locator("#tdOpen .empty")).toBeVisible();
});

test("25-timers dag: base er 250 MWh, timeblok 02–03 er to timer", async ({ page, request }) => {
  await open(page, request, "handel", { now: "2026-10-24T10:00:00+02:00" });
  await expect(page.locator("#tdLead")).toContainText("har 25 timer");
  await trade(page);
  await expect(page.locator("#tdMwh")).toHaveText("250 MWh");
  await trade(page, { product: "block", from: 2, to: 3 });
  await expect(page.locator("#tdHours")).toContainText("2 (02–03)");
  await expect(page.locator("#tdMwh")).toHaveText("20 MWh");
  await expect(page.locator("#tdPosChart rect[fill='var(--long)']")).toHaveCount(2);
});

test("23-timers dag: base er 230 MWh, timeblok 02–03 kan ikke handles", async ({ page, request }) => {
  await open(page, request, "handel", { now: "2027-03-27T10:00:00+01:00" });
  await trade(page);
  await expect(page.locator("#tdMwh")).toHaveText("230 MWh");
  await trade(page, { product: "block", from: 2, to: 3 });
  await expect(page.locator("#tdSummary")).toContainText("findes ikke på leveringsdagen");
  await expect(page.locator("#placeBtn")).toBeDisabled();
});

test("afregning venter på spot og afregner derefter mod rigtig pris", async ({ page, request }) => {
  await open(page, request, "handel", { now: "2026-11-10T10:00:00+01:00" });
  await trade(page, { mw: "10" });
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("Handel #1 registreret");
  await page.locator("#settleBtn").click();
  await expect(page.locator("#toast")).toContainText("1 venter på morgendagens spotpris");

  // Klokken bliver 14: morgendagens spot er offentliggjort.
  await request.post("/__test", { data: { now: "2026-11-10T14:00:00+01:00" } });
  await page.clock.setFixedTime(new Date("2026-11-10T14:00:00+01:00"));
  await page.goto("/#resultat");
  await page.reload();
  await expect(page.locator("#settleBtn")).toHaveText("Afregn handler (1)");
  await page.locator("#settleBtn").click();
  await expect(page.locator("#toast")).toContainText("1 handel afregnet mod spotpris");
  // DK1 base i testdata: gennemsnit af 50,15 … 73,15 = 61,65.
  const cells = page.locator("#rsBlotter tbody tr").first().locator("td");
  await expect(cells.nth(8)).toHaveText("61,65");
  const price = num(await cells.nth(7).textContent());
  const pnl = num(await cells.nth(9).textContent());
  expect(Math.abs(pnl - Math.round(240 * (61.65 - price)))).toBeLessThanOrEqual(1);
});
