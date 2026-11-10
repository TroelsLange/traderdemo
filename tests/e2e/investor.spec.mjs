import { test, expect } from "@playwright/test";
import { open, num } from "./helpers.mjs";

const NOW = { now: "2026-11-10T10:00:00+01:00" };
const DISCLAIMER = "Simulerede resultater. Ikke faktiske afkast.";

test("Rolleskifter: Trader er desk'en, Investor og Community har egne faner", async ({ page, request }) => {
  await open(page, request, "marked", NOW);
  await expect(page.getByRole("radio", { name: "Trader" })).toBeChecked();
  await expect(page.locator("#settleBtn")).toBeVisible();
  await expect(page.locator("#disclaimer")).toBeHidden();

  await page.getByRole("radio", { name: "Investor" }).check();
  await expect(page).toHaveURL(/#investor$/);
  await expect(page.locator("#settleBtn")).toBeHidden();
  await expect(page.locator('nav[data-role="investor"] a')).toHaveText(["Fonden", "Strategi"]);

  await page.getByRole("radio", { name: "Community" }).check();
  await expect(page).toHaveURL(/#community$/);
  await page.getByRole("radio", { name: "Trader" }).check();
  await expect(page).toHaveURL(/#marked$/);
});

test("Ansvarsfraskrivelsen står på alle Investor- og Community-sider og kan ikke lukkes", async ({ page, request }) => {
  for (const v of ["investor", "strategi", "community"]) {
    await open(page, request, v, NOW);
    const d = page.locator("#disclaimer");
    await expect(d).toBeVisible();
    await expect(d).toContainText(DISCLAIMER);
    await expect(d.locator("button")).toHaveCount(0);
    // Den ligger i det klæbende sidehoved og er synlig, også når man har scrollet.
    await page.mouse.wheel(0, 3000);
    await expect(d).toBeInViewport();
  }
});

test("Investor: nøgletal, NAV-graf og 12 måneders demodata med tabsmåneder", async ({ page, request }) => {
  await open(page, request, "investor", NOW);
  await expect(page.locator("#ivLead .badge")).toHaveText("Demodata");
  await expect(page.locator("#disclaimerSrc")).toContainText("Demodata");
  const labels = ["Samlet afkast", "Afkast i år", "Årligt afkast", "Volatilitet", "Største fald", "Sharpe ratio", "Træfprocent"];
  await expect(page.locator("#ivKpis span")).toHaveText(labels);
  const dd = num(await page.locator("#ivKpis div").nth(4).locator("strong").textContent());
  expect(dd).toBeLessThan(-5);
  await expect(page.locator("#ivChart svg")).toContainText("Største fald");
  const cells = page.locator("#ivMonths tbody td:not(:first-child):not(:last-child) span:not(.muted)");
  await expect(cells).toHaveCount(12);
  await expect(page.locator("#ivMonths .neg")).not.toHaveCount(0);
});

test("Investor: papirhandler uden afregnede handler viser tom tilstand, ikke tal", async ({ page, request }) => {
  await open(page, request, "investor", NOW);
  await page.getByRole("radio", { name: "Papirhandler" }).check();
  await expect(page.locator("#ivChart")).toContainText("Ingen afregnede papirhandler");
  await expect(page.locator("#disclaimerSrc")).toContainText("Papirhandler");
  await expect(page.locator("#disclaimer")).toContainText(DISCLAIMER);
});

test("Investor: aktuel risiko viser kun aggregerede tal", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.fill("#fMw", "30");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("registreret");
  await page.goto("/#investor");
  await expect(page.locator("#ivRisk")).toContainText("30 af 50 MW");
  await expect(page.locator("#ivRisk")).toContainText("Udnyttelse 60 %");
  await expect(page.locator("#ivRisk")).not.toContainText("#1");
});

test("Gebyrberegner: 2 % forvaltning og 20 % af gevinst efter gebyr", async ({ page, request }) => {
  await open(page, request, "investor", NOW);
  await page.fill("#feeAmount", "1.000.000");
  await page.fill("#feeReturn", "12");
  // 120.000 − 20.000 − 20 % af 100.000 = 80.000
  await expect(page.locator("#feeNet")).toHaveText("+80.000 EUR (+8 %)");
  await page.fill("#feeReturn", "-5");
  // −50.000 − 20.000, intet resultathonorar
  await expect(page.locator("#feeNet")).toHaveText("−70.000 EUR (−7 %)");
});

test("Strategi viser grænser fra desk'en", async ({ page, request }) => {
  await open(page, request, "strategi", NOW);
  await expect(page.locator("#stLimits")).toContainText("±50 MW pr. time");
  await expect(page.locator("#stLimits")).toContainText("over 100 MW");
  await expect(page.locator("#stLimits")).toContainText("20 % af gevinst");
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

  const follow = page.locator("[data-follow]").first();
  await follow.click();
  await expect(page.locator("[data-follow]").first()).toHaveText("Følger");
  await expect(page.locator("[data-follow]").first()).toHaveAttribute("aria-pressed", "true");

  await page.fill("#wlName", "Test Person");
  await page.fill("#wlEmail", "test@example.com");
  await page.locator("#wlBtn").click();
  await expect(page.locator("#wlError")).toContainText("samtykke");
  await page.locator("#wlConsent").check();
  await page.locator("#wlBtn").click();
  await expect(page.locator("#wlOk")).toContainText("Tak, du er skrevet op");
  await expect(page.locator("#wlCount")).toHaveText("1 er allerede skrevet op.");
});

test("Afregnet papirhandel dukker op i feedet efter afregning", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.fill("#fNote", "Vindbet");
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("registreret");
  await request.post("/__test", { data: { now: "2026-11-10T14:00:00+01:00" } });
  await page.clock.setFixedTime(new Date("2026-11-10T14:00:00+01:00"));
  await page.reload();
  await page.locator("#settleBtn").click();
  await expect(page.locator("#toast")).toContainText("afregnet");
  await page.goto("/#community");
  await expect(page.locator("#cmFeed")).toContainText("Vindbet");
  await page.goto("/#investor");
  await page.getByRole("radio", { name: "Papirhandler" }).check();
  await expect(page.locator("#ivChart svg")).toBeVisible();
});

test("Mobil 380 px: ingen vandret scroll på de nye sider", async ({ page, request }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  for (const v of ["investor", "strategi", "community"]) {
    await open(page, request, v, NOW);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
  }
});
