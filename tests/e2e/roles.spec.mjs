import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

const NOW = { now: "2026-11-10T10:00:00+01:00" };
const DISCLAIMER = "Simulerede resultater. Ikke faktiske afkast.";

test("Rolleskifter: Trader og Bruger med hver sine faner", async ({ page, request }) => {
  await open(page, request, "marked", NOW);
  await expect(page.locator('input[name="role"]')).toHaveCount(2);
  await expect(page.getByRole("radio", { name: "Trader" })).toBeChecked();
  await expect(page.locator("#settleBtn")).toBeVisible();
  await expect(page.locator('nav[data-role="trader"] a')).toHaveText(["Marked", "Handel", "Position og risiko", "Resultat", "Kapital"]);

  await page.getByRole("radio", { name: "Bruger" }).check();
  await expect(page).toHaveURL(/#produkter$/);
  await expect(page.locator("#settleBtn")).toBeHidden();
  await expect(page.locator('nav[data-role="bruger"] a')).toHaveText(["Produkter", "Portefølje", "Konto", "Community"]);
  await expect(page.locator("#brandSub")).toHaveText("Invest");

  await page.getByRole("radio", { name: "Trader" }).check();
  await expect(page).toHaveURL(/#marked$/);
});

test("Gamle links til investor-demoen sender videre til Produkter", async ({ page, request }) => {
  await open(page, request, "investor", NOW);
  await expect(page).toHaveURL(/#produkter$/);
  await page.goto("/#strategi");
  await expect(page).toHaveURL(/#produkter$/);
  await expect(page.getByRole("radio", { name: "Bruger" })).toBeChecked();
});

test("Demo-markeringen står på alle sider og kan ikke lukkes", async ({ page, request }) => {
  const views = ["marked", "handel", "position", "resultat", "kapital", "produkter", "produkt/da-dk1", "portefolje", "konto", "egnethed", "community"];
  await open(page, request, "marked", NOW);
  for (const v of views) {
    await page.goto("/#" + v);
    const d = page.locator("#disclaimer");
    await expect(d, v).toBeVisible();
    await expect(d, v).toContainText(DISCLAIMER);
    await expect(d, v).toContainText("Ingen rigtige penge");
    await expect(d.locator("button"), v).toHaveCount(0);
  }
  await page.goto("/#produkter");
  await page.mouse.wheel(0, 3000);
  await expect(page.locator("#disclaimer")).toBeInViewport();
});

test("Gebyrberegner på produktsiden bruger produktets satser", async ({ page, request }) => {
  await open(page, request, "produkt/da-dk1", NOW);
  // Day-Ahead DK1: 1 % og 15 %. 10.000 × 12 % = 1.200 − 100 − 15 % af 1.100 = 935.
  await page.fill("#pdFeeAmount", "10.000");
  await page.fill("#pdFeeReturn", "12");
  await expect(page.locator("#pdFeeNet")).toHaveText("+935 EUR (+9,4 %)");
  // Spread DK1/DK2: 1,5 % og 20 %. 1.200 − 150 − 20 % af 1.050 = 840.
  await page.goto("/#produkt/spread");
  await page.fill("#pdFeeReturn", "12");
  await expect(page.locator("#pdFeeNet")).toHaveText("+840 EUR (+8,4 %)");
  // Tab: intet resultathonorar.
  await page.fill("#pdFeeReturn", "-5");
  await expect(page.locator("#pdFeeNet")).toHaveText("−650 EUR (−6,5 %)");
});

test("Community: feed viser kun afregnede handler, Følg og venteliste", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.fill("#fNote", "Åben handel må ikke ses");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("registreret");
  await page.goto("/#community");
  await expect(page.locator("#cmProfiles .profile")).toHaveCount(3);
  await expect(page.locator("#cmFeed")).not.toContainText("Åben handel må ikke ses");
  await expect(page.locator("#cmFeed li")).not.toHaveCount(0);
  await page.locator("[data-follow]").first().click();
  await expect(page.locator("[data-follow]").first()).toHaveText("Følger");
  await page.fill("#wlName", "Test Person");
  await page.fill("#wlEmail", "test@example.com");
  await page.locator("#wlBtn").click();
  await expect(page.locator("#wlError")).toContainText("samtykke");
  await page.locator("#wlConsent").check();
  await page.locator("#wlBtn").click();
  await expect(page.locator("#wlOk")).toContainText("Tak, du er skrevet op");
  await expect(page.locator("#wlCount")).toHaveText("1 er allerede skrevet op.");
});

test("Mobil 380 px: rolleskifter og bruger-sider uden vandret scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  for (const v of ["marked", "kapital", "produkter", "community"]) {
    await open(page, request, v, NOW);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), v).toBeLessThanOrEqual(380);
  }
});
