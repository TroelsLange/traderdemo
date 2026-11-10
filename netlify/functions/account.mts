// Brugerkonti (demo): simuleret MitID-profil, egnethedstest, kontantkonto, køb af andele og udtrædelse.
//
// GET  /api/account?user=<id>                 -> { user, holdings, tx } (null, hvis profilen ikke findes)
// POST /api/account { op, user, ... }
//   login    { name }          -> opret eller hent profil (MitID er simuleret: kun et navn)
//   assess   { answers }       -> egnethedstest; niveauet afgør, hvilke produkter der kan købes
//   deposit  { eur }           -> simuleret indbetaling til kontoen (opbevares hos uafhængig depotbank)
//   withdraw { eur }           -> simuleret udbetaling fra kontoen
//   buy      { fund, eur }     -> køb andele til seneste kurs
//   redeem   { fund, units }   -> udtræd; udføres på produktets næste handelsdag til den dags kurs
//
// Alt ligger i ét dokument (nøgle `ledger` i store `traderz`): brugere + produktposter. /api/funds læser posterne.
// Samtidige skrivninger håndteres med ETag (onlyIfMatch) og genforsøg. Ingen rigtige penge eller personoplysninger.

import { getStore } from "@netlify/blobs";
import { copenhagenDate } from "../lib/hours.mts";
import { assessSuitability, computeFund, dealingDate, levelAllows, productById, type LedgerEntry } from "../lib/funds.mts";

const KEY = "ledger";
const MAX_BODY = 8000;
const MAX_DEPOSIT = 1_000_000;

type Tx = { type: "deposit" | "withdraw" | "buy" | "redeem"; eur: number; date: string; fund?: string; units?: number; nav?: number };
type User = {
  id: string; name: string; createdAt: string;
  suitability?: { level: string; score: number; scores: Record<string, number>; at: string };
  cash: number; tx: Tx[];
};
type Ledger = { version: 1; users: Record<string, User>; entries: LedgerEntry[]; nextEntry: number; updatedAt?: string };

export type AccountStore = {
  getWithMetadata(key: string, opts: { type: "json" }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string; etag: string }[] }>;
  get(key: string, opts: { type: "json" }): Promise<any>;
};
type Deps = { store?: () => AccountStore; now?: () => number };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9-]{8,64}$/.test(s);
const round2 = (v: number) => Math.round(v * 100) / 100;

export function createAccountHandler({ store = () => getStore({ name: "traderz", consistency: "strong" }) as unknown as AccountStore, now = Date.now }: Deps = {}) {
  async function read(s: AccountStore) {
    const cur = await s.getWithMetadata(KEY, { type: "json" });
    const data = cur?.data as Ledger | undefined;
    if (!data || typeof data.users !== "object") return null;
    data.entries = Array.isArray(data.entries) ? data.entries : [];
    const etag = cur!.etag || (await s.list({ prefix: KEY })).blobs.find((b) => b.key === KEY)?.etag;
    return { data, etag };
  }
  async function mutate<T>(s: AccountStore, fn: (l: Ledger) => T): Promise<{ ledger: Ledger; out: T }> {
    for (let i = 0; i < 6; i++) {
      const cur = await read(s);
      const ledger: Ledger = cur ? cur.data : { version: 1, users: {}, entries: [], nextEntry: 1 };
      const out = fn(ledger);
      ledger.updatedAt = new Date(now()).toISOString();
      const res = await s.setJSON(KEY, ledger, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      if (res.modified) return { ledger, out };
    }
    throw new HttpError(409, "Kontoen blev ændret samtidig. Prøv igen.");
  }

  // Kurser ud fra bogens handler og de udførte poster.
  async function navs(s: AccountStore, ledger: Ledger, today: string) {
    const book = await s.get("book", { type: "json" });
    const trades = Array.isArray(book?.trades) ? book.trades : [];
    return (id: string) => {
      const p = productById(id);
      return p ? computeFund(p, trades, ledger.entries, today).nav : NaN;
    };
  }

  // Udfør udtrædelser, hvis handelsdag er nået: indløs andelene til seneste kurs og sæt beløbet ind på kontoen.
  function settleRedemptions(ledger: Ledger, navOf: (id: string) => number, today: string) {
    let changed = false;
    for (const e of ledger.entries) {
      if (e.type !== "red" || e.status !== "pending" || !e.dealing || e.dealing > today) continue;
      const nav = navOf(e.fund), eur = round2((e.units || 0) * nav);
      e.status = "done"; e.nav = nav; e.eur = eur; e.date = today;
      const u = ledger.users[e.user];
      if (u) { u.cash = round2(u.cash + eur); u.tx.push({ type: "redeem", eur, date: today, fund: e.fund, units: e.units, nav }); }
      changed = true;
    }
    return changed;
  }

  function holdings(ledger: Ledger, userId: string, navOf: (id: string) => number) {
    const by: Record<string, { fund: string; units: number; pendingUnits: number; cost: number; dealing?: string }> = {};
    for (const e of ledger.entries.filter((x) => x.user === userId)) {
      const h = (by[e.fund] = by[e.fund] || { fund: e.fund, units: 0, pendingUnits: 0, cost: 0 });
      if (e.type === "sub" && e.status === "done") { h.units += e.units || 0; h.cost += e.eur || 0; }
      if (e.type === "red") {
        // Gennemsnitlig anskaffelsespris: kostprisen reduceres forholdsmæssigt ved udtrædelse.
        const avg = h.units > 0 ? h.cost / h.units : 0;
        if (e.status === "done") { h.cost -= avg * (e.units || 0); h.units -= e.units || 0; }
        else { h.pendingUnits += e.units || 0; h.dealing = e.dealing; }
      }
    }
    return Object.values(by).filter((h) => h.units > 1e-9).map((h) => {
      const nav = navOf(h.fund), value = h.units * nav;
      return { ...h, nav, value, pnl: value - h.cost, pnlPct: h.cost > 0 ? value / h.cost - 1 : 0, available: h.units - h.pendingUnits };
    });
  }

  function view(ledger: Ledger, userId: string, navOf: (id: string) => number) {
    const u = ledger.users[userId];
    if (!u) return { user: null };
    return {
      user: { id: u.id, name: u.name, createdAt: u.createdAt, suitability: u.suitability || null, cash: u.cash },
      holdings: holdings(ledger, userId, navOf),
      tx: u.tx.slice(-30).reverse(),
      custodian: "Opbevares hos uafhængig depotbank (simuleret)",
    };
  }

  return async (req: Request) => {
    try {
      const s = store();
      const today = copenhagenDate(now()), stamp = new Date(now()).toISOString();
      if (req.method === "GET") {
        const id = new URL(req.url).searchParams.get("user");
        if (!validId(id)) throw new HttpError(400, "Ugyldig bruger");
        let cur = await read(s);
        if (!cur) return json({ user: null });
        let navOf = await navs(s, cur.data, today);
        if (cur.data.entries.some((e) => e.type === "red" && e.status === "pending" && e.dealing && e.dealing <= today)) {
          const { ledger } = await mutate(s, (l) => settleRedemptions(l, navOf, today));
          cur = { data: ledger, etag: undefined };
          navOf = await navs(s, ledger, today);
        }
        return json(view(cur.data, id, navOf));
      }
      if (req.method !== "POST") throw new HttpError(405, "Metoden understøttes ikke");

      const text = await req.text();
      if (text.length > MAX_BODY) throw new HttpError(413, "For stor forespørgsel");
      let b: any;
      try { b = JSON.parse(text); } catch { throw new HttpError(400, "Ugyldig JSON"); }
      if (!validId(b?.user)) throw new HttpError(400, "Ugyldig bruger");
      const uid: string = b.user;

      // Kurserne beregnes før skrivningen; de afhænger af bogen og de udførte poster.
      const before = await read(s);
      const navOf = await navs(s, before ? before.data : { version: 1, users: {}, entries: [], nextEntry: 1 }, today);
      const need = (l: Ledger) => { const u = l.users[uid]; if (!u) throw new HttpError(404, "Opret en profil først."); return u; };

      const { ledger, out } = await mutate(s, (l) => {
        settleRedemptions(l, navOf, today);
        switch (b.op) {
          case "login": {
            const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
            if (!l.users[uid]) {
              if (name.length < 2) throw new HttpError(400, "Skriv dit navn.");
              l.users[uid] = { id: uid, name, createdAt: stamp, cash: 0, tx: [] };
            }
            return null;
          }
          case "assess": {
            const u = need(l);
            let r;
            try { r = assessSuitability(b.answers || {}); } catch (e) { throw new HttpError(400, (e as Error).message); }
            u.suitability = { ...r, at: stamp };
            return r;
          }
          case "deposit": {
            const u = need(l);
            if (!isNum(b.eur) || b.eur < 10 || b.eur > MAX_DEPOSIT) throw new HttpError(400, "Indbetal mellem 10 og 1.000.000 EUR.");
            const eur = round2(b.eur);
            u.cash = round2(u.cash + eur); u.tx.push({ type: "deposit", eur, date: today });
            return null;
          }
          case "withdraw": {
            const u = need(l);
            if (!isNum(b.eur) || b.eur <= 0) throw new HttpError(400, "Ugyldigt beløb.");
            const eur = round2(b.eur);
            if (eur > u.cash + 1e-9) throw new HttpError(400, "Beløbet er større end din saldo.");
            u.cash = round2(u.cash - eur); u.tx.push({ type: "withdraw", eur, date: today });
            return null;
          }
          case "buy": {
            const u = need(l), p = productById(b.fund);
            if (!p) throw new HttpError(400, "Ukendt produkt");
            if (!u.suitability || u.suitability.level === "ingen") throw new HttpError(403, "Tag egnethedstesten, før du køber.");
            if (!levelAllows(u.suitability.level, p)) throw new HttpError(403, p.name + " har risiko " + p.risk + " af 7 og kræver et højere resultat i egnethedstesten.");
            if (!isNum(b.eur) || b.eur <= 0) throw new HttpError(400, "Ugyldigt beløb.");
            const eur = round2(b.eur), owns = l.entries.some((e) => e.user === uid && e.fund === p.id && e.type === "sub");
            if (!owns && eur < p.minEur) throw new HttpError(400, "Minimumsbeløbet for første køb er " + p.minEur.toLocaleString("da-DK") + " EUR.");
            if (eur > u.cash + 1e-9) throw new HttpError(400, "Beløbet er større end din saldo. Indbetal først.");
            const nav = navOf(p.id), units = eur / nav;
            l.entries.push({ id: "e" + l.nextEntry++, user: uid, fund: p.id, type: "sub", eur, units, nav, date: today, status: "done" });
            u.cash = round2(u.cash - eur); u.tx.push({ type: "buy", eur, date: today, fund: p.id, units, nav });
            return { units, nav };
          }
          case "redeem": {
            need(l);
            const p = productById(b.fund);
            if (!p) throw new HttpError(400, "Ukendt produkt");
            const h = holdings(l, uid, navOf).find((x) => x.fund === p.id);
            if (!h) throw new HttpError(400, "Du ejer ingen andele i " + p.name + ".");
            const units = b.units === "all" ? h.available : b.units;
            if (!isNum(units) || units <= 0 || units > h.available + 1e-9) throw new HttpError(400, "Ugyldigt antal andele.");
            const dealing = dealingDate(p, today);
            l.entries.push({ id: "e" + l.nextEntry++, user: uid, fund: p.id, type: "red", units: Math.min(units, h.available), date: today, dealing, status: "pending" });
            return { dealing };
          }
          default:
            throw new HttpError(400, "Ukendt handling");
        }
      });
      // Udtrædelse med handelsdag i dag udføres med det samme.
      if (b.op === "redeem" && (out as any)?.dealing <= today) {
        const nav2 = await navs(s, ledger, today);
        const { ledger: l2 } = await mutate(s, (l) => settleRedemptions(l, nav2, today));
        return json({ ...view(l2, uid, await navs(s, l2, today)), result: out });
      }
      return json({ ...view(ledger, uid, await navs(s, ledger, today)), result: out });
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("account: fejl", err);
      return json({ error: "Kontoen kunne ikke opdateres" }, 500);
    }
  };
}

export default createAccountHandler();

export const config = { path: "/api/account" };
