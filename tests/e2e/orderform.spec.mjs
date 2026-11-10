import { test, expect } from "@playwright/test";
import { open } from "./helpers.mjs";

const NOW = { now: "2026-11-10T10:00:00+01:00" };

test("Retning er en radiogruppe med piletaster og beskrivende knaptekst", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  const buy = page.getByRole("radio", { name: "Køb" }), sell = page.getByRole("radio", { name: "Sælg" });
  await expect(buy).toBeChecked();
  await expect(page.locator("#sideHelp")).toContainText("Handlen udføres først, når du bekræfter nederst");
  await expect(page.locator("#placeBtn")).toHaveText(/^Køb 10 MW Base DK1 til \d+,\d\d EUR\/MWh$/);
  await expect(page.locator("#placeBtn")).toHaveClass(/trade buy/);

  // Et klik på Køb/Sælg registrerer ingen handel.
  await sell.check();
  await expect(page.locator("#placeBtn")).toHaveText(/^Sælg 10 MW Base DK1 til/);
  await expect(page.locator("#placeBtn")).toHaveClass(/trade sell/);
  expect((await (await request.get("/api/book")).json()).book.trades).toHaveLength(0);

  // Piletaster skifter valg.
  await sell.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(buy).toBeChecked();
  await expect(buy).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(sell).toBeChecked();
});

test("Formularen har nummererede trin og knappen ligger efter ordreoversigten", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await expect(page.locator("#orderForm .step-h")).toHaveText(["1Marked", "2Retning", "3Volumen og note", "4Ordreoversigt"]);
  const order = await page.evaluate(() => {
    const r = document.querySelector(".receipt"), b = document.querySelector("#placeBtn");
    return !!(r.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
});

test("Stor handel: advarsel før og bekræftelsesdialog, Tilbage annullerer", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.selectOption("#fProd", "peak");
  await page.fill("#fMw", "120");
  await expect(page.locator("#tdWarn")).toContainText("Stor handel");
  await expect(page.locator("#tdWarn")).toContainText("Overskrider positionsgrænsen");
  await page.locator("#placeBtn").click();
  const dlg = page.getByRole("dialog", { name: "Bekræft handlen" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Tilbage" })).toBeFocused();
  await dlg.getByRole("button", { name: "Tilbage" }).click();
  await expect(dlg).toBeHidden();
  expect((await (await request.get("/api/book")).json()).book.trades).toHaveLength(0);

  await page.locator("#placeBtn").click();
  await dlg.getByRole("button", { name: "Bekræft køb" }).click();
  await expect(page.locator("#toast")).toContainText("Handel #1 registreret");
});

test("Lille handel inden for grænsen registreres uden dialog", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await expect(page.locator("#tdWarn")).toBeEmpty();
  await page.locator("#placeBtn").click();
  await expect(page.locator("#toast")).toContainText("Handel #1 registreret");
  await expect(page.locator("#confirmDlg")).toBeHidden();
});

test("Grænsebrud alene kræver også bekræftelse", async ({ page, request }) => {
  await open(page, request, "handel", NOW);
  await page.fill("#fMw", "60");
  await expect(page.locator("#tdWarn")).toContainText("24 timer over Day-Ahead DK1s grænse på 50 MW");
  await expect(page.locator("#tdWarn")).not.toContainText("Stor handel");
  await page.locator("#placeBtn").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#confirmDlg")).toBeHidden();
  expect((await (await request.get("/api/book")).json()).book.trades).toHaveLength(0);
});

test("Mobilbredde 380 px: ingen vandret scroll", async ({ page, request }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await open(page, request, "handel", NOW);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
});
