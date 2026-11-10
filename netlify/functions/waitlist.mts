// Venteliste til fonden (Community-visningen).
//
// POST /api/waitlist { name, email, interest?, consent: true } -> { ok: true, count }
// GET  /api/waitlist                                         -> { count }
//
// Hver tilmelding gemmes som sin egen nøgle i Netlify Blobs (store `traderz`, nøgle `waitlist/<hash af e-mail>`),
// så samme e-mail kun tælles én gang, og samtidige tilmeldinger ikke kan overskrive hinanden.
// Navne og e-mails udleveres aldrig via API'et; de kan ses i Netlify-projektets Blobs-oversigt.

import { getStore } from "@netlify/blobs";

const PREFIX = "waitlist/";
const MAX_BODY = 4000;
const INTERESTS = ["investor", "partner", "trader", "andet"];

export type WaitlistStore = {
  setJSON(key: string, value: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
};
type Deps = { store?: () => WaitlistStore; now?: () => number };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createWaitlistHandler({ store = () => getStore({ name: "traderz", consistency: "strong" }) as unknown as WaitlistStore, now = Date.now }: Deps = {}) {
  const count = async (s: WaitlistStore) => (await s.list({ prefix: PREFIX })).blobs.length;

  return async (req: Request) => {
    try {
      const s = store();
      if (req.method === "GET") return json({ count: await count(s) });
      if (req.method !== "POST") return json({ error: "Metoden understøttes ikke" }, 405);

      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "For stor forespørgsel" }, 413);
      let b: any;
      try { b = JSON.parse(text); } catch { return json({ error: "Ugyldig JSON" }, 400); }

      const name = typeof b?.name === "string" ? b.name.trim().slice(0, 80) : "";
      const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
      const interest = INTERESTS.includes(b?.interest) ? b.interest : "andet";
      if (!name) return json({ error: "Skriv dit navn." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: "Skriv en gyldig e-mailadresse." }, 400);
      if (b?.consent !== true) return json({ error: "Du skal give samtykke, før vi kan gemme tilmeldingen." }, 400);

      await s.setJSON(PREFIX + (await sha256(email)), { name, email, interest, consent: true, signedUpAt: new Date(now()).toISOString() });
      return json({ ok: true, count: await count(s) });
    } catch (err) {
      console.error("waitlist: fejl", err);
      return json({ error: "Tilmeldingen kunne ikke gemmes. Prøv igen senere." }, 500);
    }
  };
}

export default createWaitlistHandler();

export const config = { path: "/api/waitlist" };
