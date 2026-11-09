# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Formål
Traderz Desk: intern prototype af en handelsplatform for el (day-ahead) i DK1 og DK2. Papirhandler mod rigtige spotpriser. Brugerfladen er på dansk.

## Kommandoer
- Kør lokalt: `netlify dev` → http://localhost:8888 (funktionen kører kun via Netlify CLI; åbnes `public/index.html` direkte, vises simulerede priser).
- I en Claude Code cloud-container skal den startes sådan (proxy og manglende Deno):
  `NODE_OPTIONS= NODE_USE_ENV_PROXY=1 netlify dev --offline --internal-disable-edge-functions --port 8888`
- Tjek funktionen: `curl -s localhost:8888/api/prices` og `curl -s "localhost:8888/api/prices?date=YYYY-MM-DD"`.
- Ingen build, linter eller automatiske tests. Verificér ændringer i browseren (Playwright er installeret i cloud-containeren).

## Arkitektur
- `public/index.html`: hele appen i én fil (CSS + HTML + vanilla JS i en IIFE). Ingen afhængigheder.
- `netlify/functions/prices.mts`: `GET /api/prices` henter DK1+DK2 for i dag og i morgen (dansk tid) fra Energi Data Service; `?date=` henter én dag (maks. 62 dage tilbage) til afregning af ældre handler. Upubliceret dag = `null`. Cache: `Netlify-CDN-Cache-Control: durable, s-maxage=900` + hukommelse. Ved fejl: 502 + `no-store`.
- `netlify.toml`: publish = `public` (funktioner må ikke ligge i publish-mappen).
- Datamodel i klienten: `market.days[dato] = {DK1:[kvarterer], DK2:[...]}`; kvarter `{t (TimeDK), eur, dkk}`. Timepris = gennemsnit af kvartererne (`hourly()`).
- Datoer: to centrale begreber i scriptet. `DEL()` = i morgen. `TDEL()` = leveringsdagen der handles: i morgen, eller overmorgen når morgendagens spot er offentliggjort. Handel, Position og Marked bruger `TDEL()`.
- Prognose (`forecastFor(target)`): rigtig spot for dagen før + ændring fra en simuleret vind/temperatur-model. Vind og temperatur er simulerede og skal markeres "Simuleret" i UI.
- State: `localStorage` nøgle `traderz-desk-v2` (handler, seed, grænse). Ingen backend-database.

## Datakilde
Energinet, Energi Data Service, datasættet **DayAheadPrices** (`https://api.energidataservice.dk/dataset/DayAheadPrices`), 15-minutters opløsning, `DayAheadPriceEUR`/`DayAheadPriceDKK`. Brug IKKE det udgåede `Elspotprices`. Kildeangivelse "Data: Energinet, Energi Data Service" skal stå i UI.

## Hosting
GitHub `TroelsLange/traderdemo` (branch `main`) → Netlify-projektet `traderzai` (https://traderzai.netlify.app) bygger automatisk ved push.

## Vigtige beslutninger
- Handler afregnes kun mod rigtige spotpriser, aldrig simulerede. Svarer API'et ikke: simulerede priser + tydelig advarsel.
- Når morgendagens spot er ude, rykker handel og Marked til overmorgen med prognosepris (ellers kunne man handle til prognose med kendt pris).
- Handelspris = prognose ± 0,50 EUR/MWh.
- Data i kvarterer, visning pr. time (kvartersvisning kommer senere).
- Design: Figma "🧱 Naia – Core UI Library" (fil `4exYySvrgcHTqeLKfM6xGY`). Brug tokens (CSS-variabler øverst i `index.html`), aldrig hårdkodede værdier. Ikoner hentes fra Figma til `public/assets/`. Light-only. Font PP Radio Grotesk er licenseret og ligger ikke i repoet.

@docs/STATUS.md
