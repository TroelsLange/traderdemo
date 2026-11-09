// Henter day-ahead-spotpriser for DK1 og DK2 fra Energinets Energi Data Service
// (datasættet DayAheadPrices, 15-minutters opløsning) og cacher svaret i 15 minutter.
//
// GET /api/prices              -> i dag og i morgen (dansk tid)
// GET /api/prices?date=YYYY-MM-DD -> én bestemt dag (bruges til at afregne ældre handler)

const API = "https://api.energidataservice.dk/dataset/DayAheadPrices";
const AREAS = ["DK1", "DK2"] as const;
const TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_DAYS_BACK = 62;

type Quarter = { t: string; eur: number; dkk: number };
type Day = Record<(typeof AREAS)[number], Quarter[]>;
type Payload = {
  source: "energinet";
  attribution: string;
  fetchedAt: string;
  today: string;
  tomorrow: string;
  resolution: "PT15M";
  days: Record<string, Day | null>;
};

// Simpel cache i hukommelsen pr. varm funktionsinstans. CDN-cachen (headerne nedenfor)
// tager sig af resten, så API'et højst kaldes ca. én gang pr. kvarter pr. forespørgsel.
const memo = new Map<string, { at: number; body: Payload }>();

function copenhagenDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchRange(start: string, endExclusive: string) {
  const url = new URL(API);
  url.searchParams.set("start", start);
  url.searchParams.set("end", endExclusive);
  url.searchParams.set("filter", JSON.stringify({ PriceArea: AREAS }));
  url.searchParams.set("columns", "TimeDK,PriceArea,DayAheadPriceEUR,DayAheadPriceDKK");
  url.searchParams.set("sort", "TimeDK asc");
  url.searchParams.set("timezone", "dk");
  url.searchParams.set("limit", "0");

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Energi Data Service svarede ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.records)) throw new Error("Uventet svar fra Energi Data Service");
  return json.records as Array<{ TimeDK: string; PriceArea: string; DayAheadPriceEUR: number; DayAheadPriceDKK: number }>;
}

function group(records: Awaited<ReturnType<typeof fetchRange>>, dates: string[]): Record<string, Day | null> {
  const days: Record<string, Day | null> = {};
  for (const date of dates) {
    const day = { DK1: [], DK2: [] } as Day;
    for (const r of records) {
      if (r.TimeDK.slice(0, 10) !== date) continue;
      if (r.PriceArea !== "DK1" && r.PriceArea !== "DK2") continue;
      if (typeof r.DayAheadPriceEUR !== "number") continue;
      day[r.PriceArea].push({ t: r.TimeDK, eur: r.DayAheadPriceEUR, dkk: r.DayAheadPriceDKK });
    }
    // En dag tæller først som offentliggjort, når begge områder har priser.
    days[date] = day.DK1.length && day.DK2.length ? day : null;
  }
  return days;
}

export default async (req: Request) => {
  const today = copenhagenDate(0);
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
  if (hit && Date.now() - hit.at < TTL_MS) return respond(hit.body);

  try {
    const records = await fetchRange(dates[0], addDays(dates[dates.length - 1], 1));
    const body: Payload = {
      source: "energinet",
      attribution: "Data: Energinet, Energi Data Service",
      fetchedAt: new Date().toISOString(),
      today,
      tomorrow,
      resolution: "PT15M",
      days: group(records, dates),
    };
    memo.set(key, { at: Date.now(), body });
    return respond(body);
  } catch (err) {
    console.error("prices: kunne ikke hente fra Energi Data Service", err);
    return Response.json(
      { error: "Energi Data Service svarer ikke", today, tomorrow },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
};

function respond(body: Payload) {
  return Response.json(body, {
    headers: {
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, durable, s-maxage=900, stale-while-revalidate=60",
      "netlify-vary": "query=date",
    },
  });
}

export const config = { path: "/api/prices" };
