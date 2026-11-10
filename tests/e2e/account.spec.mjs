import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

const NOW = { now: "2026-11-10T10:00:00+01:00" }; // tirsdag

async function login(page, name = "Test Person") {
  await page.goto("/#konto");
  await page.locator("#ktLogin").click();
  await expect(page.getByRole("dialog", { name: "MitID (simuleret)" })).toBeVisible();
  await page.fill("#mitidName", name);
  await page.getByRole("button", { name: "Godkend" }).click();
  await expect(page.locator("#ktName")).toHaveText(name);
}
async function takeTest(page, answers) {
  await page.goto("/#egnethed");
  for (const [q, i] of Object.entries(answers)) await page.locator(`input[name="q-${q}"]`).nth(i).check();
  await page.getByRole("button", { name: "Se mit resultat" }).click();
}

test("Brugerrejse: profil, test, indbetaling, køb, portefølje, udtrædelse; desk'en ser strømmene", async ({ page, request }) => {
  await open(page, request, "produkt/da-dk1", NOW);
  await expect(page.locator("#pdBuy")).toHaveText("Opret profil for at købe");
  await page.locator("#pdBuy").click();
  await expect(page).toHaveURL(/#konto$/);
  await login(page);
  await expect(page.locator("#ktStatus")).toContainText("Følger gratis");

  // Egnethed: Basis (kan købe Day-Ahead DK1, ikke Spread eller Intraday).
  await takeTest(page, { knowledge: 1, experience: 1, economy: 2, risk: 0 });
  await expect(page.locator("#egResult h2")).toHaveText("Dit resultat: Basis");
  await expect(page.locator("#egResult .suit li.ok")).toHaveCount(1);

  await page.goto("/#konto");
  await expect(page.locator("#ktStatus")).toContainText("Investor");
  await expect(page.locator(".custody")).toContainText("uafhængig depotbank");
  await page.fill("#ktDeposit", "10.000");
  await page.locator("#ktDepositBtn").click();
  await expect(page.locator("#ktCash")).toHaveText("10.000 EUR");

  await page.goto("/#produkt/spread");
  await expect(page.locator("#pdBuy")).toBeDisabled();
  await expect(page.locator("#pdBuyNote")).toContainText("kræver egnethedsniveau Udvidet");

  await page.goto("/#produkt/da-dk1");
  await page.locator("#pdBuy").click();
  const dlg = page.getByRole("dialog", { name: "Køb andele i Day-Ahead DK1" });
  await expect(dlg).toBeVisible();
  await page.fill("#buyAmount", "4.000");
  await expect(page.locator("#buyUnits")).toContainText("andele til kurs");
  await dlg.getByRole("button", { name: "Bekræft køb" }).click();
  await expect(page.locator("#buyErr")).toContainText("forstår risikoen");
  await page.locator("#buyAck").check();
  await dlg.getByRole("button", { name: "Bekræft køb" }).click();
  await expect(page.locator("#toast")).toContainText("Købt");

  await page.goto("/#portefolje");
  await expect(page.locator("#pfTable tbody tr")).toHaveCount(1);
  await expect(page.locator("#pfTable tbody tr")).toContainText("Day-Ahead DK1");
  await expect(page.locator("#pfKpis")).toContainText("6.000 EUR"); // saldo

  // Desk'en: indbetalt pr. produkt.
  await page.goto("/#kapital");
  await expect(page.locator("#kpTable tbody tr").nth(0)).toContainText("4.000 EUR");

  // Udtrædelse: venter til fredag.
  await page.goto("/#portefolje");
  await page.locator("[data-redeem]").click();
  await page.getByRole("button", { name: "Bekræft udtrædelse" }).click();
  await expect(page.locator("#toast")).toContainText("fredag 13. november");
  await expect(page.locator("#pfTable tbody tr")).toContainText("13. nov");
  await page.goto("/#kapital");
  await expect(page.locator("#kpKpis")).toContainText("Ventende udtrædelser");
  await expect(page.locator("#kpKpis div").nth(3)).toContainText("4.000 EUR");

  // Fredag: udbetalt til saldo.
  await request.post("/__test", { data: { now: "2026-11-13T10:00:00+01:00" } });
  await page.clock.setFixedTime(new Date("2026-11-13T10:00:00+01:00"));
  await page.goto("/#portefolje");
  await page.reload();
  await expect(page.locator("#pfTable")).toContainText("ingen andele");
  await expect(page.locator("#pfKpis div").nth(3)).toContainText("10.000 EUR");
});

test("Høj risiko kræver højt testresultat", async ({ page, request }) => {
  await open(page, request, "konto", NOW);
  await login(page, "Høj Risiko");
  await takeTest(page, { knowledge: 3, experience: 3, economy: 3, risk: 3 });
  await expect(page.locator("#egResult h2")).toHaveText("Dit resultat: Høj");
  await page.goto("/#produkt/intraday");
  await expect(page.locator("#pdBuy")).toBeEnabled();
  await expect(page.locator("#pdBuy")).toHaveText("Køb andele");
});

test("Egnethedstest kræver svar på alle spørgsmål", async ({ page, request }) => {
  await open(page, request, "konto", NOW);
  await login(page);
  await page.goto("/#egnethed");
  await page.locator('input[name="q-knowledge"]').first().check();
  await page.getByRole("button", { name: "Se mit resultat" }).click();
  await expect(page.locator("#egErr")).toContainText("Erfaring");
});

test("Mobil 380 px: konto, test og portefølje uden vandret scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await open(page, request, "konto", NOW);
  await login(page);
  for (const v of ["konto", "egnethed", "portefolje"]) {
    await page.goto("/#" + v);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
  }
});
