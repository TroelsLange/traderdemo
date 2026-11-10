// Produkter (fonde) og deres kurs (NAV pr. andel, indeks 100).
//
// Kursen før katalogets `launch` er demodata (deterministisk, ud fra produktets `demoMonthly`).
// Fra `launch` beregnes den ud fra desk'ens afregnede papirhandler for produktet:
//   kurs_d = kurs_{d-1} + resultat_d / andele_{d-1}
// Andele udstedes ved start (produktets startkapital) og ved brugernes køb; de indløses ved udtrædelse.
// Kursen er før gebyrer.

import catalog from "../../public/data/products.json" with { type: "json" };
import suitability from "../../public/data/suitability.json" with { type: "json" };
import { addDays } from "./hours.mts";

export type Product = (typeof catalog.products)[number];
export const CATALOG = catalog;
export const PRODUCTS = catalog.products as Product[];
export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);

// Handler fra før produkterne: DK1 hører til Day-Ahead DK1, DK2 til Spread DK1/DK2.
export const legacyFund = (area: string) => (area === "DK2" ? "spread" : "da-dk1");

// Krævet niveau i egnethedstesten for et produkt, og om et opnået niveau er nok.
const ORDER = ["basis", "udvidet", "hoej"];
export const requiredLevel = (p: Product) => (catalog.suitability.byRisk as Record<string, string>)[String(p.risk)];
export const levelAllows = (level: string | undefined, p: Product) => !!level && ORDER.indexOf(level) >= ORDER.indexOf(requiredLevel(p));

// Egnethedstest: svar (indeks pr. spørgsmål) -> niveau. Høj kræver både viden, risikovillighed og en lille andel af opsparingen.
export const SUITABILITY = suitability;
export function assessSuitability(answers: Record<string, unknown>): { level: string; score: number; scores: Record<string, number> } {
  const scores: Record<string, number> = {};
  for (const q of suitability.questions) {
    const i = answers?.[q.id];
    if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= q.options.length) throw new Error("Besvar alle spørgsmål.");
    scores[q.id] = q.options[i as number].score;
  }
  const score = Object.values(scores).reduce((a, b) => a + b, 0);
  const level =
    score < 3 ? "ingen"
    : score >= 10 && scores.risk >= 2 && scores.knowledge >= 2 && scores.economy >= 2 ? "hoej"
    : score >= 6 && scores.risk >= 1 ? "udvidet"
    : "basis";
  return { level, score, scores };
}

// Næste handelsdag for udtrædelse på eller efter en dato.
export function dealingDate(p: Product, from: string): string {
  let d = from;
  for (let i = 0; i < 40; i++) {
    const dt = new Date(d + "T12:00:00Z");
    if (p.redemption === "daily") return d;
    if (p.redemption === "weekly" && dt.getUTCDay() === 5) return d;
    if (p.redemption === "monthly" && addDays(d, 1).slice(8) === "01") return d;
    d = addDays(d, 1);
  }
  return d;
}

function rng(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (id: string) => [...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) | 0, 20261110);

export type Point = { date: string; nav: number; demo?: boolean };

// 12 hele måneder før launch, start 100.
export function demoHistory(p: Product): Point[] {
  const launch = catalog.launch, r = rng(seedOf(p.id));
  const gauss = () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const y0 = +launch.slice(0, 4), m0 = +launch.slice(5, 7) - 1, months: string[] = [];
  for (let k = 12; k >= 1; k--) months.push(new Date(Date.UTC(y0, m0 - k, 1)).toISOString().slice(0, 7));
  let nav = 100;
  const pts: Point[] = [{ date: addDays(months[0] + "-01", -1), nav, demo: true }];
  months.forEach((ym, i) => {
    const days: string[] = [];
    for (let d = ym + "-01"; d.slice(0, 7) === ym; d = addDays(d, 1)) days.push(d);
    const z = days.map(() => gauss() * p.demoVol), mean = z.reduce((s, x) => s + x, 0) / z.length;
    const target = Math.log(1 + p.demoMonthly[i]);
    days.forEach((d, j) => { nav *= Math.exp(z[j] - mean + target / days.length); pts.push({ date: d, nav, demo: true }); });
  });
  return pts;
}

export type TradeLike = { fund?: string; area: string; del: string; settled?: boolean; pnl?: number };
// En post i produktregnskabet. sub = køb, red = udtrædelse. Udtrædelser har `units` og udføres på `dealing`.
export type LedgerEntry = {
  id: string; user: string; fund: string; type: "sub" | "red";
  eur?: number; units?: number; nav?: number; date: string; dealing?: string; status: "done" | "pending";
};

export type FundState = {
  id: string; nav: number; navDate: string; demoUntil: string; series: Point[];
  units: number; aum: number; seedCapital: number; inflow: number; outflow: number;
  pendingUnits: number; pendingEur: number; investors: number;
};

// Kurs pr. dato for et produkt (efter launch), givet handler og udførte poster.
export function computeFund(p: Product, trades: TradeLike[], ledger: LedgerEntry[], today: string): FundState {
  const hist = demoHistory(p);
  const launchNav = hist[hist.length - 1].nav, start = addDays(catalog.launch, -1);
  const pnlBy: Record<string, number> = {};
  for (const t of trades) {
    if ((t.fund || legacyFund(t.area)) !== p.id || !t.settled || typeof t.pnl !== "number" || t.del < catalog.launch) continue;
    pnlBy[t.del] = (pnlBy[t.del] || 0) + t.pnl;
  }
  const mine = ledger.filter((e) => e.fund === p.id);
  const flowsBy: Record<string, LedgerEntry[]> = {};
  for (const e of mine) if (e.status === "done") (flowsBy[e.date] = flowsBy[e.date] || []).push(e);

  const settledDays = Object.keys(pnlBy).sort();
  const lastPnl = settledDays.length ? settledDays[settledDays.length - 1] : start;
  const end = [addDays(today, -1), lastPnl].sort()[1];

  let nav = launchNav, units = p.seedCapital / launchNav, inflow = 0, outflow = 0;
  const series: Point[] = hist.slice();
  for (let d = catalog.launch; d <= end; d = addDays(d, 1)) {
    if (units > 0) nav += (pnlBy[d] || 0) / units;
    for (const e of flowsBy[d] || []) {
      if (e.type === "sub") { units += e.units || 0; inflow += e.eur || 0; }
      else { units -= e.units || 0; outflow += e.eur || 0; }
    }
    series.push({ date: d, nav });
  }
  // Poster efter seneste kursdato (f.eks. køb i dag) tæller med i andele og kapital med det samme.
  for (const [d, es] of Object.entries(flowsBy)) {
    if (d <= end) continue;
    for (const e of es) {
      if (e.type === "sub") { units += e.units || 0; inflow += e.eur || 0; }
      else { units -= e.units || 0; outflow += e.eur || 0; }
    }
  }
  const pending = mine.filter((e) => e.type === "red" && e.status === "pending");
  const pendingUnits = pending.reduce((s, e) => s + (e.units || 0), 0);
  const holders = new Set<string>();
  const byUser: Record<string, number> = {};
  for (const e of mine) if (e.status === "done") byUser[e.user] = (byUser[e.user] || 0) + (e.type === "sub" ? 1 : -1) * (e.units || 0);
  for (const [u, n] of Object.entries(byUser)) if (n > 1e-9) holders.add(u);
  return {
    id: p.id, nav, navDate: series[series.length - 1].date, demoUntil: start, series,
    units, aum: units * nav, seedCapital: p.seedCapital, inflow, outflow,
    pendingUnits, pendingEur: pendingUnits * nav, investors: holders.size,
  };
}
