// GET /api/prices                 -> DK1+DK2 for i dag og i morgen (dansk tid)
// GET /api/prices?date=YYYY-MM-DD -> én bestemt dag (bruges til at afregne ældre handler)
// Kvarter: { t: TimeDK, u: TimeUTC, eur, dkk }. Svaret caches 15 minutter på CDN'et.

import { ATTRIBUTION, fetchDays, type Day } from "../lib/energinet.mts";
import { addDays, copenhagenDate } from "../lib/hours.mts";

const TTL_MS = 15 * 60 * 1000;
const MAX_DAYS_BACK = 62;

type Payload = {
  source: "energinet";
  attribution: string;
  fetchedAt: string;
  today: string;
  tomorrow: string;
  resolution: "PT15M";
  days: Record<string, Day | null>;
};

type Deps = { now?: () => number; fetchImpl?: typeof fetch };

// Fabrik, så testene kan styre klokken og Energi Data Service.
export function createPricesHandler({ now = Date.now, fetchImpl = fetch }: Deps = {}) {
  // Simpel cache i hukommelsen pr. varm funktionsinstans. CDN-cachen tager sig af resten.
  const memo = new Map<string, { at: number; body: Payload }>();

  return async (req: Request) => {
    const today = copenhagenDate(now());
    const tomorrow = addDays(today, 1);
    const dateParam = new URL(req.url).searchParams.get("date");

    let dates: string[];
    if (dateParam) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || dateParam > tomorrow || dateParam < addDays(today, -MAX_DAYS_BACK)) {
        return Response.json({ error: "Ugyldig dato" }, { status: 400, headers: { "cache-control": "no-store" } });
      }
      dates = [dateParam];
    } else {
      dates = [today, tomorrow];
    }

    const key = dates.join(",");
    const hit = memo.get(key);
    if (hit && now() - hit.at < TTL_MS) return respond(hit.body);

    try {
      const body: Payload = {
        source: "energinet",
        attribution: ATTRIBUTION,
        fetchedAt: new Date(now()).toISOString(),
        today,
        tomorrow,
        resolution: "PT15M",
        days: await fetchDays(dates, fetchImpl),
      };
      memo.set(key, { at: now(), body });
      return respond(body);
    } catch (err) {
      console.error("prices: kunne ikke hente fra Energi Data Service", err);
      return Response.json(
        { error: "Energi Data Service svarer ikke", today, tomorrow },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
  };
}

function respond(body: Payload) {
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, s-maxage=900, stale-while-revalidate=60",
      "netlify-vary": "query=date",
    },
  });
}

export default createPricesHandler();

export const config = { path: "/api/prices" };
