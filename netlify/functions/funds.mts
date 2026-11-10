// GET /api/funds -> kurs (NAV), kapital og ind-/udbetalinger pr. produkt.
//
// Beregnes hver gang ud fra den fælles handelsbog (nøgle `book`) og produktregnskabet (nøgle `ledger`)
// i Netlify Blobs. Kursen før produkternes launch er demodata; derefter papirhandler. Alt er demo.

import { getStore } from "@netlify/blobs";
import { copenhagenDate } from "../lib/hours.mts";
import { CATALOG, computeFund, PRODUCTS, type LedgerEntry, type TradeLike } from "../lib/funds.mts";

export type FundsStore = { get(key: string, opts: { type: "json" }): Promise<any> };
type Deps = { store?: () => FundsStore; now?: () => number };

export function createFundsHandler({ store = () => getStore({ name: "traderz", consistency: "strong" }) as unknown as FundsStore, now = Date.now }: Deps = {}) {
  return async (req: Request) => {
    if (req.method !== "GET") return Response.json({ error: "Metoden understøttes ikke" }, { status: 405 });
    try {
      const s = store();
      const [book, ledger] = await Promise.all([s.get("book", { type: "json" }), s.get("ledger", { type: "json" })]);
      const trades: TradeLike[] = Array.isArray(book?.trades) ? book.trades : [];
      const entries: LedgerEntry[] = Array.isArray(ledger?.entries) ? ledger.entries : [];
      const today = copenhagenDate(now());
      return Response.json(
        { demo: true, launch: CATALOG.launch, today, funds: PRODUCTS.map((p) => computeFund(p, trades, entries, today)) },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (err) {
      console.error("funds: fejl", err);
      return Response.json({ error: "Produkternes kurser kunne ikke beregnes" }, { status: 500, headers: { "cache-control": "no-store" } });
    }
  };
}

export default createFundsHandler();

export const config = { path: "/api/funds" };
