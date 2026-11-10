import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountHandler } from "../../netlify/functions/account.mts";
import { createFundsHandler } from "../../netlify/functions/funds.mts";
import { assessSuitability, demoHistory, productById } from "../../netlify/lib/funds.mts";
import { memoryStore } from "../fakes.mjs";

const U = "user-0001-test";
function setup(now = "2026-11-10T10:00:00+01:00") {
  const ctl = { now: Date.parse(now) };
  const store = memoryStore();
  const h = createAccountHandler({ now: () => ctl.now, store: () => store });
  const f = createFundsHandler({ now: () => ctl.now, store: () => store });
  const post = async (op, x = {}, user = U) => { const r = await h(new Request("http://x/api/account", { method: "POST", body: JSON.stringify({ op, user, ...x }) })); return { status: r.status, ...(await r.json()) }; };
  const get = async (user = U) => (await h(new Request("http://x/api/account?user=" + user))).json();
  const funds = async () => (await f(new Request("http://x/api/funds"))).json();
  return { ctl, post, get, funds };
}
const HIGH = { knowledge: 3, experience: 3, economy: 3, risk: 3 };
const BASIC = { knowledge: 1, experience: 1, economy: 2, risk: 0 };

test("egnethedstest: niveauer", () => {
  assert.equal(assessSuitability({ knowledge: 0, experience: 0, economy: 0, risk: 1 }).level, "ingen");
  assert.equal(assessSuitability(BASIC).level, "basis");
  assert.equal(assessSuitability({ knowledge: 2, experience: 2, economy: 1, risk: 1 }).level, "udvidet");
  assert.equal(assessSuitability(HIGH).level, "hoej");
  // Høj kræver også, at man kun sætter en lille del af opsparingen i.
  assert.equal(assessSuitability({ knowledge: 3, experience: 3, economy: 1, risk: 3 }).level, "udvidet");
  assert.throws(() => assessSuitability({ knowledge: 1 }));
});

test("konto: profil, test, indbetaling, køb inden for egnethed og minimum", async () => {
  const { post, get } = setup();
  assert.equal((await get()).user, null);
  assert.equal((await post("deposit", { eur: 100 })).status, 404, "kræver profil");
  assert.equal((await post("login", { name: "" })).status, 400);
  const me = await post("login", { name: "Test Person" });
  assert.equal(me.user.name, "Test Person");
  assert.equal(me.custodian.includes("uafhængig depotbank"), true);
  assert.equal((await post("deposit", { eur: 5 })).status, 400);
  assert.equal((await post("deposit", { eur: 20000 })).user.cash, 20000);
  assert.equal((await post("buy", { fund: "da-dk1", eur: 2000 })).status, 403, "kræver test");
  await post("assess", { answers: BASIC });
  const blocked = await post("buy", { fund: "spread", eur: 3000 });
  assert.equal(blocked.status, 403);
  assert.match(blocked.error, /risiko 4 af 7/);
  assert.equal((await post("buy", { fund: "da-dk1", eur: 500 })).status, 400, "under minimum");
  assert.equal((await post("buy", { fund: "da-dk1", eur: 50000 })).status, 400, "over saldo");
  const bought = await post("buy", { fund: "da-dk1", eur: 2000 });
  const nav = demoHistory(productById("da-dk1")).at(-1).nav;
  assert.ok(Math.abs(bought.result.nav - nav) < 1e-9);
  assert.equal(bought.user.cash, 18000);
  assert.equal(bought.holdings.length, 1);
  assert.ok(Math.abs(bought.holdings[0].units - 2000 / nav) < 1e-9);
  assert.ok(Math.abs(bought.holdings[0].value - 2000) < 1e-6);
  // Efter første køb gælder minimum ikke.
  assert.equal((await post("buy", { fund: "da-dk1", eur: 100 })).status, 200);
  await post("assess", { answers: HIGH });
  assert.equal((await post("buy", { fund: "intraday", eur: 5000 })).status, 200);
  assert.equal((await post("withdraw", { eur: 999999 })).status, 400);
  assert.equal((await post("withdraw", { eur: 900 })).user.cash, 12000);
});

test("udtrædelse: venter til handelsdag og udbetales til saldo; desk'en ser strømmene", async () => {
  const { ctl, post, get, funds } = setup("2026-11-10T10:00:00+01:00"); // tirsdag
  await post("login", { name: "Anna" });
  await post("deposit", { eur: 10000 });
  await post("assess", { answers: BASIC });
  await post("buy", { fund: "da-dk1", eur: 4000 });
  let f = (await funds()).funds.find((x) => x.id === "da-dk1");
  assert.equal(f.inflow, 4000);
  assert.equal(f.investors, 1);
  const r = await post("redeem", { fund: "da-dk1", units: "all" });
  assert.equal(r.result.dealing, "2026-11-13"); // fredag
  assert.equal(r.holdings[0].available, 0);
  assert.ok(r.holdings[0].pendingUnits > 0);
  f = (await funds()).funds.find((x) => x.id === "da-dk1");
  assert.ok(Math.abs(f.pendingEur - 4000) < 1e-6);
  assert.equal((await post("redeem", { fund: "da-dk1", units: 1 })).status, 400, "intet tilbage at udtræde");
  ctl.now = Date.parse("2026-11-13T09:00:00+01:00");
  const after = await get();
  assert.equal(after.holdings.length, 0);
  assert.ok(Math.abs(after.user.cash - 10000) < 0.01);
  assert.equal(after.tx[0].type, "redeem");
  f = (await funds()).funds.find((x) => x.id === "da-dk1");
  assert.ok(Math.abs(f.outflow - 4000) < 0.01);
  assert.equal(f.pendingEur, 0);
  assert.equal(f.investors, 0);
});

test("konto: brugere er adskilte, og ugyldige id'er afvises", async () => {
  const { post, get } = setup();
  await post("login", { name: "Anna" });
  await post("deposit", { eur: 100 });
  await post("login", { name: "Bent" }, "user-0002-test");
  assert.equal((await get("user-0002-test")).user.cash, 0);
  assert.equal((await post("login", { name: "X" }, "x")).status, 400);
});
