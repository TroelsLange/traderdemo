// Testserver: serverer public/ og kører de rigtige Netlify-funktioner (/api/prices, /api/book)
// med en falsk Energi Data Service, en handelsbog i hukommelsen og en styrbar klokke.
// Styres af testene via POST /__test (se tests/helpers.mjs). Kør: node tests/server.mjs [port]

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPricesHandler } from "../netlify/functions/prices.mts";
import { createBookHandler } from "../netlify/functions/book.mts";
import { createWaitlistHandler } from "../netlify/functions/waitlist.mts";
import { createFundsHandler } from "../netlify/functions/funds.mts";
import { fakeEnerginet, memoryStore } from "./fakes.mjs";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const PORT = +(process.argv[2] || process.env.PORT || 8899);
const TYPES = { ".json": "application/json", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".js": "text/javascript", ".css": "text/css" };

let ctl, store, prices, book, waitlist, funds;
function reset(opts = {}) {
  ctl = { now: Date.parse(opts.now || "2026-11-10T10:00:00+01:00"), upstream: opts.upstream || "ok", book: opts.book || "ok", publishHour: opts.publishHour ?? 13 };
  store = memoryStore();
  const now = () => ctl.now;
  const fetchImpl = fakeEnerginet(() => ctl);
  prices = createPricesHandler({ now, fetchImpl });
  book = createBookHandler({ now, fetchImpl, store: () => store });
  waitlist = createWaitlistHandler({ now, store: () => store });
  funds = createFundsHandler({ now, store: () => store });
}
reset();

async function toRequest(req) {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise((ok) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
  });
  return new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body });
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/__health") return send(res, Response.json({ ok: true }));
    if (url.pathname === "/__test" && req.method === "POST") {
      const r = await toRequest(req);
      const opts = await r.json();
      if (opts.reset) reset(opts);
      else Object.assign(ctl, opts.now ? { ...opts, now: Date.parse(opts.now) } : opts);
      return send(res, Response.json({ ok: true, now: new Date(ctl.now).toISOString() }));
    }
    if (url.pathname === "/api/prices") return send(res, await prices(await toRequest(req)));
    if (url.pathname === "/api/funds") return send(res, await funds(await toRequest(req)));
    if (url.pathname === "/api/waitlist") return send(res, await waitlist(await toRequest(req)));
    if (url.pathname === "/api/book") {
      if (ctl.book === "down") return send(res, Response.json({ error: "nede" }, { status: 503 }));
      return send(res, await book(await toRequest(req)));
    }
    const file = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file).catch(() => null);
    if (!data) { res.writeHead(404); return res.end("Ikke fundet"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(String(err));
  }
}).listen(PORT, () => console.log(`Testserver på http://localhost:${PORT}`));
