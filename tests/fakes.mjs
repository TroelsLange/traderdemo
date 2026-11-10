// Falske afhængigheder til testene: Energi Data Service og Netlify Blobs.

import { API } from "../netlify/lib/energinet.mts";
import { addDays, copenhagenDate, dayStartUtc } from "../netlify/lib/hours.mts";

// Kendt testpris: DK1 = 50 + time-nr. på dagen + 0,1 pr. kvarter, DK2 = 60 + … .
// Timeprisen (gennemsnit af 4 kvarterer) bliver derfor base + slot + 0,15.
export const quarterPrice = (area, slot, q) => Math.round(((area === "DK1" ? 50 : 60) + slot + q * 0.1) * 100) / 100;
export const hourPrice = (area, slot) => (area === "DK1" ? 50 : 60) + slot + 0.15;

const localFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
function localIso(ms) {
  const p = Object.fromEntries(localFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
}
const utcIso = (ms) => new Date(ms).toISOString().slice(0, 19);

// En dag er offentliggjort, hvis den er i dag eller tidligere, eller i morgen efter kl. publishHour.
function published(date, ctl) {
  const today = copenhagenDate(ctl.now);
  if (date <= today) return true;
  const hour = +localIso(ctl.now).slice(11, 13);
  return date === addDays(today, 1) && hour >= ctl.publishHour;
}

export function fakeEnerginet(getCtl) {
  return async (input, init) => {
    const url = new URL(String(input));
    if (!url.href.startsWith(API)) return fetch(input, init);
    const ctl = getCtl();
    if (ctl.upstream === "down") return new Response("nede", { status: 503 });
    const start = url.searchParams.get("start"), end = url.searchParams.get("end");
    const records = [];
    for (let d = start; d < end; d = addDays(d, 1)) {
      if (!published(d, ctl)) continue;
      const s = dayStartUtc(d), n = (dayStartUtc(addDays(d, 1)) - s) / 900e3;
      for (const area of ["DK1", "DK2"]) {
        for (let k = 0; k < n; k++) {
          const ms = s + k * 900e3, eur = quarterPrice(area, Math.floor(k / 4), k % 4);
          records.push({ TimeUTC: utcIso(ms), TimeDK: localIso(ms), PriceArea: area, DayAheadPriceEUR: eur, DayAheadPriceDKK: Math.round(eur * 746) / 100 });
        }
      }
    }
    records.sort((a, b) => a.TimeUTC.localeCompare(b.TimeUTC));
    return Response.json({ total: records.length, records });
  };
}

// Netlify Blobs i hukommelsen med ETag og betingede skrivninger.
// etagOnGet: false efterligner den lokale Blobs-server i `netlify dev`, der ikke sender ETag ved læsning.
export function memoryStore({ etagOnGet = true } = {}) {
  const data = new Map();
  let n = 0;
  return {
    data,
    async getWithMetadata(key) {
      const v = data.get(key);
      return v ? { data: JSON.parse(v.json), etag: etagOnGet ? v.etag : undefined, metadata: {} } : null;
    },
    async list({ prefix = "" } = {}) {
      return { blobs: [...data].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, etag: v.etag })) };
    },
    async setJSON(key, value, opts = {}) {
      const cur = data.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = `"${++n}"`;
      data.set(key, { json: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
  };
}

