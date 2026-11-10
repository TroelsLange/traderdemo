// Timer på en leveringsdag i dansk tid, inkl. sommertidsskift.
// En dag har 24 timer, men 23 når uret stilles frem (sidste søndag i marts, time 02 mangler)
// og 25 når uret stilles tilbage (sidste søndag i oktober, time 02 findes to gange: 02A og 02B).
// Priser og positioner ligger i "slots": én pr. faktisk time på dagen, i tidsorden.
// Samme logik findes i public/index.html (klienten har ingen moduler). Ret begge steder.

const TZ = "Europe/Copenhagen";
const HOUR = 3600_000;

const localFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

// "YYYY-MM-DD HH:MM" i dansk tid for et UTC-tidspunkt.
function local(ms: number): string {
  const p = Object.fromEntries(localFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function copenhagenDate(ms = Date.now()): string {
  return local(ms).slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const startCache = new Map<string, number>();
// UTC-tidspunkt (ms) for midnat dansk tid. Danmark er altid UTC+1 eller UTC+2.
export function dayStartUtc(date: string): number {
  let v = startCache.get(date);
  if (v !== undefined) return v;
  const guess = Date.parse(date + "T00:00:00Z");
  v = [1, 2].map((off) => guess - off * HOUR).find((ms) => local(ms) === `${date} 00:00`);
  if (v === undefined) throw new Error("Ugyldig dato " + date);
  startCache.set(date, v);
  return v;
}

const slotCache = new Map<string, number[]>();
// Klokketimen (0–23) for hver time på dagen, f.eks. [0,1,2,2,3,…] på 25-timers dagen.
export function slotHours(date: string): number[] {
  let v = slotCache.get(date);
  if (v) return v;
  const start = dayStartUtc(date);
  const n = Math.round((dayStartUtc(addDays(date, 1)) - start) / HOUR);
  v = Array.from({ length: n }, (_, i) => +local(start + i * HOUR).slice(11, 13));
  slotCache.set(date, v);
  return v;
}

const hh = (h: number) => String(h).padStart(2, "0");
// Etiketter: "02", eller "02A"/"02B" for den dobbelte time.
export function slotLabels(date: string): string[] {
  const hours = slotHours(date);
  return hours.map((h, i) => {
    const dup = hours.indexOf(h) !== hours.lastIndexOf(h);
    return hh(h) + (dup ? (hours.indexOf(h) === i ? "A" : "B") : "");
  });
}

export type Quarter = { t: string; u?: string; eur: number; dkk?: number };

// Timepris pr. slot = gennemsnit af kvartererne. Bruger UTC-tiden (u), så den dobbelte time
// på 25-timers dagen ikke blandes sammen. Mangler en time, er værdien null.
export function hourly(quarters: Quarter[], date: string): (number | null)[] {
  const hours = slotHours(date);
  const start = dayStartUtc(date);
  const sum = new Array(hours.length).fill(0);
  const n = new Array(hours.length).fill(0);
  for (const q of quarters) {
    const i = q.u
      ? Math.floor((Date.parse(q.u + "Z") - start) / HOUR)
      : hours.indexOf(+q.t.slice(11, 13));
    if (i < 0 || i >= hours.length || typeof q.eur !== "number") continue;
    sum[i] += q.eur;
    n[i]++;
  }
  return sum.map((s, i) => (n[i] ? Math.round((s / n[i]) * 100) / 100 : null));
}

export type Product = "base" | "peak" | "offpeak" | "block";
export const PRODUCTS: Product[] = ["base", "peak", "offpeak", "block"];

// Slots, som et produkt dækker på en dag. Peak = 08–20, off-peak = resten, timeblok = [from, to).
export function productSlots(product: Product, date: string, from = 0, to = 24): number[] {
  const out: number[] = [];
  slotHours(date).forEach((h, i) => {
    const hit =
      product === "base" ? true
      : product === "peak" ? h >= 8 && h < 20
      : product === "offpeak" ? h < 8 || h >= 20
      : h >= from && h < to;
    if (hit) out.push(i);
  });
  return out;
}
