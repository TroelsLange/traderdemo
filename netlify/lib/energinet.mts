// Henter day-ahead-spotpriser for DK1 og DK2 fra Energinets Energi Data Service
// (datasættet DayAheadPrices, 15-minutters opløsning). Bruges af /api/prices og /api/book.

import { addDays, type Quarter } from "./hours.mts";

export const API = "https://api.energidataservice.dk/dataset/DayAheadPrices";
export const AREAS = ["DK1", "DK2"] as const;
export const ATTRIBUTION = "Data: Energinet, Energi Data Service";
const TIMEOUT_MS = 8000;

export type Area = (typeof AREAS)[number];
export type Day = Record<Area, Quarter[]>;
type Rec = { TimeUTC: string; TimeDK: string; PriceArea: string; DayAheadPriceEUR: number; DayAheadPriceDKK: number };

// Henter alle kvarterer for datoerne (sammenhængende interval) og grupperer pr. dag.
// En dag er null, indtil begge områder har priser (dvs. ikke offentliggjort endnu).
export async function fetchDays(dates: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, Day | null>> {
  const sorted = [...dates].sort();
  const url = new URL(API);
  url.searchParams.set("start", sorted[0]);
  url.searchParams.set("end", addDays(sorted[sorted.length - 1], 1));
  url.searchParams.set("filter", JSON.stringify({ PriceArea: AREAS }));
  url.searchParams.set("columns", "TimeUTC,TimeDK,PriceArea,DayAheadPriceEUR,DayAheadPriceDKK");
  url.searchParams.set("sort", "TimeUTC asc");
  url.searchParams.set("timezone", "dk");
  url.searchParams.set("limit", "0");

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Energi Data Service svarede ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.records)) throw new Error("Uventet svar fra Energi Data Service");
  const records = json.records as Rec[];

  const days: Record<string, Day | null> = {};
  for (const date of dates) {
    const day: Day = { DK1: [], DK2: [] };
    for (const r of records) {
      if (r.TimeDK.slice(0, 10) !== date) continue;
      if (r.PriceArea !== "DK1" && r.PriceArea !== "DK2") continue;
      if (typeof r.DayAheadPriceEUR !== "number") continue;
      day[r.PriceArea].push({ t: r.TimeDK, u: r.TimeUTC, eur: r.DayAheadPriceEUR, dkk: r.DayAheadPriceDKK });
    }
    days[date] = day.DK1.length && day.DK2.length ? day : null;
  }
  return days;
}
