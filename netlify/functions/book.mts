// Fælles handelsbog i Netlify Blobs, så handler deles mellem brugere og enheder.
//
// GET  /api/book                      -> { book }
// POST /api/book { op: "trade", trade } -> registrér handel (serveren tildeler id)
//                { op: "cancel", id }   -> annullér åben handel
//                { op: "settle" }       -> afregn mod rigtig spotpris (hentes af serveren)
//                { op: "limit", fund, limit } -> produktets grænse pr. time i MW
//                { op: "reset" }        -> slet alle handler og start forfra
//                { op: "import", book } -> overfør handler fra browserens localStorage (kun til tom bog)
//
// Bogen er ét JSON-dokument. Samtidige skrivninger håndteres med ETag (onlyIfMatch) og genforsøg.

import { getStore } from "@netlify/blobs";
import { fetchDays, type Day } from "../lib/energinet.mts";
import { addDays, copenhagenDate, hourly, productSlots, PRODUCTS, type Product } from "../lib/hours.mts";
import { legacyFund, productById, PRODUCTS as FUNDS } from "../lib/funds.mts";

const KEY = "book";
const MAX_TRADES = 5000;
const MAX_BODY = 200_000;
const MAX_DAYS_BACK = 62;

export type Trade = {
  id: number;
  fund: string; // produktet handlen hører til (public/data/products.json)
  area: "DK1" | "DK2";
  product: Product;
  from?: number;
  to?: number;
  side: "buy" | "sell";
  mw: number;
  del: string;
  note: string;
  price: number;
  fair: number;
  tradedOn: string;
  simBasis: boolean;
  settled: boolean;
  createdAt?: string;
  settle?: number;
  pnl?: number;
  settledAt?: string;
};
export type Book = { version: 1; seed: number; limit: number; limits: Record<string, number>; nextId: number; trades: Trade[]; updatedAt: string };

// Den del af Netlify Blobs-API'et, vi bruger (så testene kan give en butik i hukommelsen).
export type BookStore = {
  getWithMetadata(key: string, opts: { type: "json" }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string; etag: string }[] }>;
};

type Deps = { store?: () => BookStore; now?: () => number; fetchImpl?: typeof fetch };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const tradeSlots = (t: Pick<Trade, "product" | "del" | "from" | "to">) => productSlots(t.product, t.del, t.from, t.to);

const defaultLimits = () => Object.fromEntries(FUNDS.map((p) => [p.id, p.limitMw]));
// Bøger fra før produkterne: handler får et produkt, og hvert produkt får en grænse.
function normalize(book: Book): Book {
  for (const t of book.trades) if (!t.fund || !productById(t.fund)) t.fund = legacyFund(t.area);
  book.limits = { ...defaultLimits(), ...(book.limits || {}) };
  return book;
}

function newBook(now: number): Book {
  return { version: 1, seed: Math.floor(Math.random() * 1e9), limit: 50, limits: defaultLimits(), nextId: 1, trades: [], updatedAt: new Date(now).toISOString() };
}

// Kontrollerer en ny handel fra klienten. Prisen beregnes i klienten ud fra prognosen.
function validTrade(x: any, today: string): Omit<Trade, "id" | "tradedOn" | "settled"> {
  const tomorrow = addDays(today, 1);
  if (!x || typeof x !== "object") throw new HttpError(400, "Handel mangler");
  if (x.area !== "DK1" && x.area !== "DK2") throw new HttpError(400, "Ukendt område");
  if (!PRODUCTS.includes(x.product)) throw new HttpError(400, "Ukendt kontrakt");
  const fund = productById(x.fund ?? legacyFund(x.area));
  if (!fund) throw new HttpError(400, "Ukendt produkt");
  if (!fund.areas.includes(x.area)) throw new HttpError(400, fund.name + " må kun handle " + fund.areas.join(" og ") + ".");
  if (x.side !== "buy" && x.side !== "sell") throw new HttpError(400, "Ukendt retning");
  if (!isNum(x.mw) || x.mw <= 0) throw new HttpError(400, "Volumen skal være større end 0 MW.");
  if (x.mw > 500) throw new HttpError(400, "Volumen over 500 MW pr. handel er spærret. Del handlen op.");
  if (!isDate(x.del) || x.del < tomorrow || x.del > addDays(tomorrow, 1)) throw new HttpError(400, "Leveringsdagen kan ikke handles");
  if (!isNum(x.price) || Math.abs(x.price) > 10000 || !isNum(x.fair)) throw new HttpError(400, "Ugyldig pris");
  const t: any = {
    fund: fund.id, area: x.area, product: x.product, side: x.side, mw: Math.round(x.mw * 10) / 10, del: x.del,
    note: typeof x.note === "string" ? x.note.trim().slice(0, 60) : "",
    price: Math.round(x.price * 100) / 100, fair: x.fair, simBasis: !!x.simBasis,
  };
  if (x.product === "block") {
    if (!Number.isInteger(x.from) || !Number.isInteger(x.to) || x.from < 0 || x.to > 24 || x.to <= x.from) {
      throw new HttpError(400, "Til-time skal ligge efter fra-time.");
    }
    t.from = x.from;
    t.to = x.to;
  }
  if (!tradeSlots(t).length) throw new HttpError(400, "Timerne findes ikke på leveringsdagen (sommertid).");
  return t;
}

// Handler fra den gamle localStorage-version. Kun de kendte felter tages med.
function importedTrades(list: unknown): Trade[] {
  if (!Array.isArray(list) || list.length > MAX_TRADES) throw new HttpError(400, "Ugyldig import");
  return list.map((x: any) => {
    if (!x || !Number.isInteger(x.id) || !isDate(x.del) || !PRODUCTS.includes(x.product) || !isNum(x.mw) || !isNum(x.price)) {
      throw new HttpError(400, "Ugyldig handel i import");
    }
    const t: Trade = {
      id: x.id, fund: legacyFund(x.area), area: x.area === "DK2" ? "DK2" : "DK1", product: x.product, side: x.side === "sell" ? "sell" : "buy",
      mw: x.mw, del: x.del, note: typeof x.note === "string" ? x.note.slice(0, 60) : "", price: x.price,
      fair: isNum(x.fair) ? x.fair : x.price, tradedOn: isDate(x.tradedOn) ? x.tradedOn : x.del, simBasis: !!x.simBasis,
      settled: !!x.settled && isNum(x.settle) && isNum(x.pnl),
    };
    if (x.product === "block") { t.from = x.from; t.to = x.to; }
    if (t.settled) { t.settle = x.settle; t.pnl = x.pnl; t.settledAt = typeof x.settledAt === "string" ? x.settledAt : undefined; }
    return t;
  });
}

export function createBookHandler({ store = () => getStore({ name: "traderz", consistency: "strong" }) as unknown as BookStore, now = Date.now, fetchImpl = fetch }: Deps = {}) {
  async function read(s: BookStore) {
    const cur = await s.getWithMetadata(KEY, { type: "json" });
    const book = cur?.data as Book | undefined;
    if (!book || !Array.isArray(book.trades)) return null;
    normalize(book);
    // Den lokale Blobs-server under `netlify dev` sender ingen ETag ved læsning; list() gør.
    const etag = cur!.etag || (await s.list({ prefix: KEY })).blobs.find((b) => b.key === KEY)?.etag;
    return { book, etag };
  }

  // Læs, ændr og skriv bogen. Er den ændret imens (anden ETag), prøves forfra.
  async function mutate<T>(s: BookStore, fn: (book: Book) => T): Promise<{ book: Book; out: T }> {
    for (let i = 0; i < 6; i++) {
      const cur = await read(s);
      const book = cur ? cur.book : newBook(now());
      const out = fn(book);
      book.updatedAt = new Date(now()).toISOString();
      const res = await s.setJSON(KEY, book, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
      if (res.modified) return { book, out };
    }
    throw new HttpError(409, "Handelsbogen blev ændret af en anden samtidig. Prøv igen.");
  }

  // Afregning: henter rigtige spotpriser for leveringsdagene og afregner åbne handler.
  // Handler for i morgen venter, indtil prisen er offentliggjort. Simulerede priser bruges aldrig.
  async function settle(s: BookStore) {
    const today = copenhagenDate(now()), tomorrow = addDays(today, 1);
    const cur = await read(s);
    const open = (cur?.book.trades || []).filter((t) => !t.settled && t.del <= tomorrow);
    const prices: Record<string, Day | null | undefined> = {};
    for (const d of [...new Set(open.map((t) => t.del))]) {
      if (d < addDays(today, -MAX_DAYS_BACK)) { prices[d] = undefined; continue; }
      try { Object.assign(prices, await fetchDays([d], fetchImpl)); } catch (e) { console.error("book: kunne ikke hente spot for", d, e); }
    }
    const settledAt = new Date(now()).toISOString();
    return mutate(s, (book) => {
      const r = { n: 0, total: 0, waiting: 0, failed: 0 };
      for (const t of book.trades) {
        if (t.settled || t.del > tomorrow) continue;
        const day = prices[t.del];
        if (!day) { if (day === null && t.del >= tomorrow) r.waiting++; else r.failed++; continue; }
        const real = hourly(day[t.area], t.del), slots = tradeSlots(t);
        const vals = slots.map((i) => real[i]);
        if (!slots.length || vals.some((v) => v == null)) { r.failed++; continue; }
        const px = (vals as number[]).reduce((a, b) => a + b, 0) / vals.length;
        t.settle = Math.round(px * 100) / 100;
        t.pnl = (t.side === "buy" ? 1 : -1) * t.mw * slots.length * (px - t.price);
        t.settled = true;
        t.settledAt = settledAt;
        r.n++;
        r.total += t.pnl;
      }
      return r;
    });
  }

  return async (req: Request) => {
    try {
      const s = store();
      if (req.method === "GET") {
        let cur = await read(s);
        if (!cur) {
          // Første kald: opret bogen, så alle får samme seed (og dermed samme prognose).
          await s.setJSON(KEY, newBook(now()), { onlyIfNew: true });
          cur = await read(s);
        }
        return json({ book: cur!.book });
      }
      if (req.method !== "POST") throw new HttpError(405, "Metoden understøttes ikke");

      const text = await req.text();
      if (text.length > MAX_BODY) throw new HttpError(413, "For stor forespørgsel");
      let body: any;
      try { body = JSON.parse(text); } catch { throw new HttpError(400, "Ugyldig JSON"); }
      const today = copenhagenDate(now());

      switch (body?.op) {
        case "trade": {
          const t = validTrade(body.trade, today);
          const { book, out } = await mutate(s, (b) => {
            if (b.trades.length >= MAX_TRADES) throw new HttpError(409, "Handelsbogen er fuld");
            const trade: Trade = { ...t, id: b.nextId++, tradedOn: today, settled: false, createdAt: new Date(now()).toISOString() };
            b.trades.push(trade);
            return trade;
          });
          return json({ book, trade: out });
        }
        case "cancel": {
          const { book } = await mutate(s, (b) => {
            const t = b.trades.find((x) => x.id === body.id);
            if (!t) throw new HttpError(404, "Handlen findes ikke");
            if (t.settled) throw new HttpError(409, "Handlen er allerede afregnet");
            b.trades = b.trades.filter((x) => x.id !== body.id);
          });
          return json({ book });
        }
        case "settle": {
          const { book, out } = await settle(s);
          return json({ book, result: out });
        }
        case "limit": {
          if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100000) throw new HttpError(400, "Ugyldig grænse");
          const fund = productById(body.fund ?? "da-dk1");
          if (!fund) throw new HttpError(400, "Ukendt produkt");
          const { book } = await mutate(s, (b) => { b.limits[fund.id] = body.limit; if (fund.id === "da-dk1") b.limit = body.limit; });
          return json({ book });
        }
        case "reset": {
          const { book } = await mutate(s, (b) => { Object.assign(b, newBook(now())); });
          return json({ book });
        }
        case "import": {
          const src = body.book || {};
          const trades = importedTrades(src.trades);
          const { book, out } = await mutate(s, (b) => {
            if (b.trades.length) return false;
            b.trades = trades;
            b.nextId = Math.max(b.nextId, ...trades.map((t) => t.id + 1));
            if (Number.isInteger(src.limit) && src.limit > 0) b.limit = src.limit;
            if (Number.isInteger(src.seed)) b.seed = src.seed;
            return true;
          });
          return json({ book, imported: out ? trades.length : 0 });
        }
        default:
          throw new HttpError(400, "Ukendt handling");
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("book: fejl", err);
      return json({ error: "Handelsbogen kunne ikke gemmes eller hentes" }, 500);
    }
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export default createBookHandler();

export const config = { path: "/api/book" };
