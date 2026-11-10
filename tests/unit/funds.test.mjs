import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, PRODUCTS, computeFund, dealingDate, demoHistory, levelAllows, productById, requiredLevel } from "../../netlify/lib/funds.mts";
import { createBookHandler } from "../../netlify/functions/book.mts";
import { createFundsHandler } from "../../netlify/functions/funds.mts";
import { fakeEnerginet, hourPrice, memoryStore } from "../fakes.mjs";

test("katalog: tre produkter med de krævede felter", () => {
  assert.deepEqual(PRODUCTS.map((p) => [p.id, p.risk]), [["da-dk1", 3], ["intraday", 6], ["spread", 4]]);
  for (const p of PRODUCTS) {
    for (const k of ["name", "strategy", "traders", "risk", "minEur", "feeMgmt", "feePerf", "redemption", "factsheet", "limitMw", "areas"]) assert.ok(p[k] != null, p.id + " mangler " + k);
    assert.equal(p.demoMonthly.length, 12);
  }
});

test("egnethed: høj risiko kræver højt niveau", () => {
  const intra = productById("intraday"), dk1 = productById("da-dk1"), spread = productById("spread");
  assert.equal(requiredLevel(intra), "hoej");
  assert.equal(levelAllows("basis", dk1), true);
  assert.equal(levelAllows("basis", spread), false);
  assert.equal(levelAllows("udvidet", spread), true);
  assert.equal(levelAllows("udvidet", intra), false);
  assert.equal(levelAllows("hoej", intra), true);
  assert.equal(levelAllows(undefined, dk1), false);
});

test("udtrædelse: næste handelsdag efter frekvens", () => {
  assert.equal(dealingDate(productById("da-dk1"), "2026-11-10"), "2026-11-13"); // fredag
  assert.equal(dealingDate(productById("intraday"), "2026-11-10"), "2026-11-30"); // sidste dag i måneden
});

test("demohistorik: 12 måneder før launch og de konfigurerede månedsafkast", () => {
  const p = productById("da-dk1"), h = demoHistory(p);
  assert.equal(h[h.length - 1].date, "2026-10-31");
  assert.equal(h[0].nav, 100);
  // Samlet afkast = produktet af månedsafkastene.
  const expected = p.demoMonthly.reduce((c, m) => c * (1 + m), 1) * 100;
  assert.ok(Math.abs(h[h.length - 1].nav - expected) < 1e-6);
});

test("kurs: papirhandler flytter kursen pr. andel, køb ændrer andele, ikke kursen", () => {
  const p = productById("da-dk1"), launchNav = demoHistory(p).at(-1).nav;
  const units0 = p.seedCapital / launchNav;
  const trades = [{ fund: "da-dk1", area: "DK1", del: "2026-11-05", settled: true, pnl: 40000 }, { fund: "spread", area: "DK2", del: "2026-11-05", settled: true, pnl: 99999 }];
  const ledger = [{ id: "a", user: "u", fund: "da-dk1", type: "sub", eur: 10000, units: 10000 / launchNav, nav: launchNav, date: "2026-11-03", status: "done" }];
  const f = computeFund(p, trades, ledger, "2026-11-10");
  const nav = launchNav + 40000 / (units0 + 10000 / launchNav);
  assert.ok(Math.abs(f.nav - nav) < 1e-9);
  assert.equal(f.navDate, "2026-11-09");
  assert.equal(f.inflow, 10000);
  assert.equal(f.investors, 1);
  assert.ok(Math.abs(f.aum - (units0 + 10000 / launchNav) * nav) < 1e-6);
});

test("bog: handel kræver gyldigt produkt og område; gamle handler får produkt", async () => {
  const ctl = { now: Date.parse("2026-11-10T10:00:00+01:00"), upstream: "ok", publishHour: 13 };
  const store = memoryStore();
  await store.setJSON("book", { version: 1, seed: 1, limit: 50, nextId: 3, trades: [
    { id: 1, area: "DK1", product: "base", side: "buy", mw: 1, del: "2026-11-01", price: 1, fair: 1, settled: false },
    { id: 2, area: "DK2", product: "base", side: "buy", mw: 1, del: "2026-11-01", price: 1, fair: 1, settled: false } ] });
  const h = createBookHandler({ now: () => ctl.now, fetchImpl: fakeEnerginet(() => ctl), store: () => store });
  const call = async (b) => { const r = await h(new Request("http://x/api/book", b ? { method: "POST", body: JSON.stringify(b) } : {})); return { status: r.status, ...(await r.json()) }; };
  const g = await call();
  assert.deepEqual(g.book.trades.map((t) => t.fund), ["da-dk1", "spread"]);
  assert.deepEqual(g.book.limits, { "da-dk1": 50, intraday: 40, spread: 30 });
  const t = { area: "DK2", product: "base", side: "buy", mw: 5, del: "2026-11-11", price: 60, fair: 59.5 };
  const bad = await call({ op: "trade", trade: { ...t, fund: "da-dk1" } });
  assert.equal(bad.status, 400);
  assert.match(bad.error, /kun handle DK1/);
  assert.equal((await call({ op: "trade", trade: { ...t, fund: "nope" } })).status, 400);
  const ok = await call({ op: "trade", trade: { ...t, fund: "spread" } });
  assert.equal(ok.trade.fund, "spread");
  const lim = await call({ op: "limit", fund: "spread", limit: 25 });
  assert.equal(lim.book.limits.spread, 25);
});

test("/api/funds: kurser for alle produkter, papirhandel efter afregning", async () => {
  const ctl = { now: Date.parse("2026-11-10T14:00:00+01:00"), upstream: "ok", publishHour: 13 };
  const store = memoryStore();
  const book = createBookHandler({ now: () => ctl.now, fetchImpl: fakeEnerginet(() => ctl), store: () => store });
  const funds = createFundsHandler({ now: () => ctl.now, store: () => store });
  const get = async () => (await funds(new Request("http://x/api/funds"))).json();
  const before = await get();
  assert.equal(before.funds.length, 3);
  assert.equal(before.launch, CATALOG.launch);
  const dk1Before = before.funds.find((f) => f.id === "da-dk1").nav;
  ctl.now = Date.parse("2026-11-09T10:00:00+01:00");
  await book(new Request("http://x/api/book", { method: "POST", body: JSON.stringify({ op: "trade", trade: { fund: "da-dk1", area: "DK1", product: "base", side: "buy", mw: 10, del: "2026-11-10", price: 50, fair: 49.5 } }) }));
  ctl.now = Date.parse("2026-11-10T14:00:00+01:00");
  await book(new Request("http://x/api/book", { method: "POST", body: JSON.stringify({ op: "settle" }) }));
  const after = await get();
  const dk1 = after.funds.find((f) => f.id === "da-dk1");
  // Base DK1 i testdata: gennemsnit 61,65; købt til 50 → +2.796 EUR (10 MW × 24 t × 11,65).
  const units = productById("da-dk1").seedCapital / demoHistory(productById("da-dk1")).at(-1).nav;
  assert.ok(Math.abs(dk1.nav - (dk1Before + 10 * 24 * (hourPrice("DK1", 0) + 11.5 - 50) / units)) < 1e-6);
  assert.equal(dk1.navDate, "2026-11-10");
  assert.equal(after.funds.find((f) => f.id === "spread").nav, before.funds.find((f) => f.id === "spread").nav);
});
