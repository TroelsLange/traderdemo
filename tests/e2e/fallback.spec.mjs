import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

test("Energi Data Service nede: simulerede priser og advarsel", async ({ page, request }) => {
  await open(page, request, "marked", { now: "2026-11-10T10:00:00+01:00", upstream: "down" });
  await expect(page.locator("#banner")).toContainText("Energi Data Service svarer ikke");
  await expect(page.locator("#mkSource .badge")).toHaveText("Simuleret");
  await request.post("/__test", { data: { upstream: "ok" } });
  await page.locator("#retryBtn").click();
  await expect(page.locator("#banner")).toBeHidden();
  await expect(page.locator("#mkSource")).toContainText("Data: Energinet");
});

test("handelsbogen nede: handler gemmes lokalt og flyttes senere til bogen", async ({ page, request }) => {
  await open(page, request, "handel", { now: "2026-11-10T10:00:00+01:00", book: "down" });
  await expect(page.locator("#bookBanner")).toContainText("Handler gemmes kun i denne browser");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("Handel #1 registreret");
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("traderz-desk-v2")));
  expect(local.trades).toHaveLength(1);

  await request.post("/__test", { data: { book: "ok" } });
  await page.reload();
  await expect(page.locator("#toast")).toContainText("flyttet til den fælles handelsbog");
  await expect(page.locator("#bookBanner")).toBeHidden();
  const book = await (await request.get("/api/book")).json();
  expect(book.book.trades).toHaveLength(1);
});
