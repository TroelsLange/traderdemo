import { test } from "node:test";
import assert from "node:assert/strict";
import { createBookHandler } from "../../netlify/functions/book.mts";
import { createPricesHandler } from "../../netlify/functions/prices.mts";
import { fakeEnerginet, hourPrice, memoryStore } from "../fakes.mjs";

function setup(now = "2026-11-10T10:00:00+01:00", storeOpts) {
  const ctl = { now: Date.parse(now), upstream: "ok", publishHour: 13 };
  const store = memoryStore(storeOpts);
  const deps = { now: () => ctl.now, fetchImpl: fakeEnerginet(() => ctl) };
  const book = createBookHandler({ ...deps, store: () => store });
  const prices = createPricesHandler(deps);
  const call = async (body) => {
    const res = await book(new Request("http://x/api/book", body ? { method: "POST", body: JSON.stringify(body) } : {}));
    return { status: res.status, ...(await res.json()) };
  };
  const getPrices = async (q = "") => {
    const res = await prices(new Request("http://x/api/prices" + q));
    return { status: res.status, ...(await res.json()) };
  };
  return { ctl, store, call, getPrices };
}
const trade = (x = {}) => ({ area: "DK1", product: "base", side: "buy", mw: 10, del: "2026-11-11", note: "", price: 60, fair: 59.5, simBasis: false, ...x });

test("prices: i dag og i morgen, i morgen er null før offentliggørelse", async () => {
  const { getPrices, ctl } = setup();
  const r = await getPrices();
  assert.equal(r.today, "2026-11-10");
  assert.equal(r.days["2026-11-10"].DK1.length, 96);
  assert.ok(r.days["2026-11-10"].DK1[0].u, "kvarteret har UTC-tid");
  assert.equal(r.days["2026-11-11"], null);
  ctl.upstream = "down";
  assert.equal((await getPrices("?date=2026-11-01")).status, 502);
  assert.equal((await getPrices("?date=2026-13-01")).status, 400);
  assert.equal((await getPrices("?date=2026-11-12")).status, 400);
});

test("book: oprettes ved første kald med fast seed", async () => {
  const { call } = setup();
  const a = await call(), b = await call();
  assert.equal(a.status, 200);
  assert.equal(a.book.seed, b.book.seed);
  assert.deepEqual(a.book.trades, []);
});

test("book: validering af handler", async () => {
  const { call } = setup();
  assert.equal((await call({ op: "trade", trade: trade({ mw: 501 }) })).status, 400);
  assert.equal((await call({ op: "trade", trade: trade({ mw: 0 }) })).status, 400);
  assert.equal((await call({ op: "trade", trade: trade({ del: "2026-11-10" }) })).status, 400, "i dag kan ikke handles");
  assert.equal((await call({ op: "trade", trade: trade({ del: "2026-11-13" }) })).status, 400, "for langt frem");
  assert.equal((await call({ op: "trade", trade: trade({ product: "block", from: 5, to: 5 }) })).status, 400);
  assert.equal((await call({ op: "nope" })).status, 400);
  const ok = await call({ op: "trade", trade: trade({ product: "block", from: 17, to: 21, note: "  vind  " }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.trade.id, 1);
  assert.equal(ok.trade.note, "vind");
  assert.equal(ok.trade.tradedOn, "2026-11-10");
});

test("book: timeblok 02–03 findes ikke på 23-timers dagen", async () => {
  const { call } = setup("2027-03-27T10:00:00+01:00");
  const r = await call({ op: "trade", trade: trade({ del: "2027-03-28", product: "block", from: 2, to: 3 }) });
  assert.equal(r.status, 400);
  assert.match(r.error, /sommertid/);
});

test("book: samtidige handler får hver sit id", async () => {
  const { call } = setup();
  await call();
  const res = await Promise.all([1, 2, 3, 4, 5].map((i) => call({ op: "trade", trade: trade({ mw: i }) })));
  assert.ok(res.every((r) => r.status === 200));
  const final = await call();
  assert.equal(final.book.trades.length, 5);
  assert.deepEqual(final.book.trades.map((t) => t.id).sort(), [1, 2, 3, 4, 5]);
  assert.equal(final.book.nextId, 6);
});

test("book: afregning venter på spot og bruger rigtige priser (25-timers dag)", async () => {
  const { call, ctl } = setup("2026-10-24T10:00:00+02:00");
  await call({ op: "trade", trade: trade({ del: "2026-10-25", mw: 10, price: 60 }) });
  await call({ op: "trade", trade: trade({ del: "2026-10-25", side: "sell", product: "block", from: 2, to: 3, mw: 5, price: 50 }) });
  let r = await call({ op: "settle" });
  assert.deepEqual(r.result, { n: 0, total: 0, waiting: 2, failed: 0 });

  ctl.now = Date.parse("2026-10-24T13:30:00+02:00");
  r = await call({ op: "settle" });
  assert.equal(r.result.n, 2);
  const [base, block] = r.book.trades;
  const avg = (slots) => slots.reduce((s, i) => s + hourPrice("DK1", i), 0) / slots.length;
  const baseSlots = [...Array(25).keys()];
  assert.ok(Math.abs(base.pnl - 10 * 25 * (avg(baseSlots) - 60)) < 1e-6, "base afregnes over 25 timer");
  assert.ok(Math.abs(block.pnl - -1 * 5 * 2 * (avg([2, 3]) - 50)) < 1e-6, "02A og 02B tæller begge");
  assert.equal((await call({ op: "cancel", id: base.id })).status, 409);
});

test("book: afregning fejler ikke hele bogen, når Energi Data Service er nede", async () => {
  const { call, ctl } = setup("2026-11-10T14:00:00+01:00");
  await call({ op: "trade", trade: trade() });
  ctl.upstream = "down";
  const r = await call({ op: "settle" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.result, { n: 0, total: 0, waiting: 0, failed: 1 });
  assert.equal(r.book.trades[0].settled, false);
});

test("book: import kun til tom bog, cancel, grænse og nulstil", async () => {
  const { call } = setup();
  const old = { seed: 42, limit: 30, trades: [{ id: 7, area: "DK2", product: "peak", side: "sell", mw: 3, del: "2026-11-01", price: 70, settled: true, settle: 65, pnl: 180 }] };
  let r = await call({ op: "import", book: old });
  assert.equal(r.imported, 1);
  assert.equal(r.book.seed, 42);
  assert.equal(r.book.limit, 30);
  assert.equal(r.book.nextId, 8);
  r = await call({ op: "import", book: old });
  assert.equal(r.imported, 0, "ingen dobbelt-import");
  r = await call({ op: "trade", trade: trade() });
  assert.equal(r.trade.id, 8);
  r = await call({ op: "cancel", id: 8 });
  assert.equal(r.book.trades.length, 1);
  assert.equal((await call({ op: "limit", limit: 0 })).status, 400);
  assert.equal((await call({ op: "limit", limit: 75 })).book.limit, 75);
  r = await call({ op: "reset" });
  assert.equal(r.book.trades.length, 0);
  assert.equal(r.book.nextId, 1);
});

test("book: virker også uden ETag ved læsning (lokal Blobs-server)", async () => {
  const { call } = setup(undefined, { etagOnGet: false });
  await call();
  const res = await Promise.all([1, 2, 3].map((i) => call({ op: "trade", trade: trade({ mw: i }) })));
  assert.ok(res.every((r) => r.status === 200));
  assert.equal((await call()).book.trades.length, 3);
});
