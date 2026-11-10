import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

const NOW = { now: "2026-11-10T10:00:00+01:00" };

test("Produkter: tre produktkort med risiko, afkast og vilkår og demo-markering", async ({ page, request }) => {
  await open(page, request, "produkter", NOW);
  await expect(page.locator("#disclaimer")).toContainText("Simulerede resultater. Ikke faktiske afkast.");
  await expect(page.locator("#disclaimer")).toContainText("demodata");
  const cards = page.locator(".product-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Day-Ahead DK1");
  await expect(cards.nth(0).locator(".risk")).toHaveAttribute("aria-label", "Risikoklasse 3 af 7");
  await expect(cards.nth(1).locator(".risk")).toHaveAttribute("aria-label", "Risikoklasse 6 af 7");
  await expect(cards.nth(0)).toContainText("1.000 EUR");
  await expect(cards.nth(0)).toContainText("ugentligt");
  await expect(cards.nth(0).locator("dd").first()).toHaveText(/^[+−]\d/);
  await expect(page.locator("#prProfiles .profile")).toHaveCount(3);
  await expect(page.locator("#prFeed li")).not.toHaveCount(0);
});

test("Produktside: kurs, største fald, månedsafkast, strategi, tradere, vilkår og faktaark", async ({ page, request }) => {
  await open(page, request, "produkter", NOW);
  await page.locator(".product-card").nth(2).getByRole("link", { name: "Se produkt" }).click();
  await expect(page).toHaveURL(/#produkt\/spread$/);
  await expect(page.locator("#pdTitle")).toHaveText("Spread DK1/DK2");
  await expect(page.locator('nav[data-role="community"] a[aria-current="page"]')).toHaveText("Produkter");
  await expect(page.locator("#pdKpis span")).toHaveText(["Kurs", "Afkast 12 mdr.", "Afkast i år", "Volatilitet", "Største fald", "Minimum"]);
  await expect(page.locator("#pdChart svg")).toContainText("Største fald");
  await expect(page.locator("#pdChart svg")).toContainText("Papirhandler fra");
  await expect(page.locator("#pdMonths .neg")).not.toHaveCount(0);
  await expect(page.locator("#pdStrategy")).toContainText("forskellen mellem prisen");
  await expect(page.locator("#pdTerms")).toContainText("Udvidet");
  await expect(page.locator("#pdTerms")).toContainText("30 MW pr. time");
  await expect(page.locator("#pdTraders .profile")).toHaveCount(1);
  await expect(page.locator("#pdTraders")).toContainText("Mette K.");
  // Feedet er filtreret til produktet.
  await expect(page.locator("#pdFeed")).not.toContainText("Jonas R.");
  await expect(page.locator("#pdBuy")).toHaveText("Opret profil for at købe");
  const href = await page.locator("#pdFactsheet").getAttribute("href");
  expect(href).toBe("faktaark/spread.html");
  const fs = await request.get("/" + href);
  expect(fs.ok()).toBe(true);
  expect(await fs.text()).toContain("Simulerede resultater. Ikke faktiske afkast.");
});

test("Produktside: ukendt produkt og intraday-notits", async ({ page, request }) => {
  await open(page, request, "produkt/findes-ikke", NOW);
  await expect(page.locator("#pdMissing")).toBeVisible();
  await page.goto("/#produkt/intraday");
  await expect(page.locator("#pdTerms")).toContainText("Høj");
  await expect(page.locator("#pdStrategy")).toContainText("day-ahead-timeblokke");
});

test("Afregnet papirhandel vises i produktets feed", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.selectOption("#fFund", "spread");
  await page.fill("#fNote", "Spread-test");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("registreret");
  await request.post("/__test", { data: { now: "2026-11-10T14:00:00+01:00" } });
  await page.clock.setFixedTime(new Date("2026-11-10T14:00:00+01:00"));
  await page.reload();
  await page.locator("#settleBtn").click();
  await expect(page.locator("#toast")).toContainText("afregnet");
  await page.goto("/#produkt/spread");
  await expect(page.locator("#pdFeed")).toContainText("Spread-test");
  await page.goto("/#produkt/da-dk1");
  await expect(page.locator("#pdFeed")).not.toContainText("Spread-test");
});

test("Mobil 380 px: produktsider uden vandret scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  for (const v of ["produkter", "produkt/da-dk1"]) {
    await open(page, request, v, NOW);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
  }
});
