# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Formål
Traderz Desk: intern prototype af en handelsplatform for el (day-ahead) i DK1 og DK2. Papirhandler mod rigtige spotpriser. Brugerfladen er på dansk.

## Kommandoer
- Kør lokalt: `netlify dev` → http://localhost:8888 (funktionen kører kun via Netlify CLI; åbnes `public/index.html` direkte, vises simulerede priser).
- I en Claude Code cloud-container skal den startes sådan (proxy og manglende Deno):
  `NODE_OPTIONS= NODE_USE_ENV_PROXY=1 netlify dev --offline --internal-disable-edge-functions --port 8888`
- Tjek funktionerne: `curl -s localhost:8888/api/prices`, `curl -s "localhost:8888/api/prices?date=YYYY-MM-DD"`, `curl -s localhost:8888/api/book`, `curl -s localhost:8888/api/funds` og `curl -s localhost:8888/api/waitlist`.
- Tests: `npm install` og derefter `npm test` (= `npm run test:unit` + `npm run test:e2e`). Kræver Node ≥ 22.18 (kører `.mts` direkte).
  - `tests/unit/`: Node test runner for timer/sommertid og de to funktioner (falsk Energi Data Service, Blobs i hukommelsen).
  - `tests/e2e/`: Playwright mod `tests/server.mjs`, som kører de rigtige funktioner med falske priser og styrbar klokke (`POST /__test`). Ingen netværk eller Netlify CLI nødvendig.
- Ingen build eller linter. Verificér også ændringer i browseren.

## Arkitektur
- `public/index.html`: hele appen i én fil (CSS + HTML + vanilla JS i en IIFE). Ingen afhængigheder.
- `netlify/functions/prices.mts`: `GET /api/prices` henter DK1+DK2 for i dag og i morgen (dansk tid) fra Energi Data Service; `?date=` henter én dag (maks. 62 dage tilbage). Upubliceret dag = `null`. Cache: `Netlify-CDN-Cache-Control: durable, s-maxage=900` + hukommelse. Ved fejl: 502 + `no-store`.
- `netlify/functions/book.mts`: `/api/book`, den fælles handelsbog i Netlify Blobs (store `traderz`, nøgle `book`, ét JSON-dokument med seed, grænse, nextId, handler). `GET` henter, `POST {op}` med `trade`, `cancel`, `settle`, `limit`, `reset`, `import`. Samtidighed: ETag + `onlyIfMatch` og genforsøg. Afregning sker på serveren mod rigtig spot. Serveren tildeler handels-id og validerer; prisen beregnes i klienten.
- Produkter: `public/data/products.json` er det konfigurerbare katalog (Day-Ahead DK1, Intraday Aktiv, Spread DK1/DK2) med strategi, tradere, risikoklasse, minimumsbeløb, gebyrer, udtrædelsesfrekvens, grænse (`limitMw`), områder, startkapital, demohistorik og faktaark. Læses af både klient (`loadCatalog`) og server (`netlify/lib/funds.mts`).
- Hver handel har `fund` (produkt-id). Serveren afviser områder, som produktet ikke må handle. Gamle handler uden produkt: DK1 → `da-dk1`, DK2 → `spread` (`legacyFund`, `fundOf`). Bogen har `limits` pr. produkt; `POST {op:"limit", fund, limit}`.
- `netlify/functions/funds.mts`: `GET /api/funds` beregner kurs (NAV, indeks 100), kapital, ind-/udbetalinger og ventende udtrædelser pr. produkt ud fra bogen (`book`) og produktregnskabet (`ledger`) i Blobs. Kurs før katalogets `launch` er demodata; derefter produktets afregnede papirhandler pr. andel (`computeFund`). Køb og udtrædelser ændrer andele, ikke kurs. Kursen er før gebyrer.
- `netlify/functions/waitlist.mts`: `/api/waitlist`, venteliste til fonden (Community). `POST {name, email, interest, consent:true}` gemmer én nøgle pr. e-mail (`waitlist/<sha256>`) i store `traderz`; `GET` giver kun antal. Navne og e-mails udleveres aldrig via API'et (se dem i Netlify-projektets Blobs-oversigt).
- `netlify/lib/`: fælles kode til funktionerne. `energinet.mts` henter priser; `hours.mts` har timer/sommertid. Begge funktioner eksporterer en fabrik (`createPricesHandler`, `createBookHandler`), så testene kan give klokke, fetch og butik.
- `netlify.toml`: publish = `public` (funktioner må ikke ligge i publish-mappen).
- Datamodel i klienten: `market.days[dato] = {DK1:[kvarterer], DK2:[...]}`; kvarter `{t (TimeDK), u (TimeUTC), eur, dkk}`. Timepris = gennemsnit af kvartererne (`hourly()`), placeret efter UTC-tid.
- Timer ("slots"): priser og positioner er arrays med én værdi pr. faktisk time på dagen: 24, 23 (sommertid begynder, time 02 mangler) eller 25 (vintertid begynder, time 02 to gange: 02A/02B). `slotHours(dato)` giver klokketimen pr. slot; `productSlots()` giver et produkts slots. Prognosemodellen regner pr. klokketime (24) og oversættes med `toSlots`/`byClock`. Marked viser basisdag og leveringsdag side om side med `alignDays()`. Logikken findes både i `netlify/lib/hours.mts` og i `index.html`; ret begge.
- Roller (demo, uden login): rolleskifteren øverst vælger Trader (desk'en: `#marked`, `#handel`, `#position`, `#resultat`, `#kapital`), Investor (`#investor`, `#strategi`) eller Community (`#community`). Rollen afledes af view'et (`roleOf`, `ROLES`), så links kan deles. Investor og Community læser kun desk'ens data og ændrer intet i handel eller afregning.
- Investor: nøgletal (samlet afkast, i år, årligt, volatilitet, største fald, Sharpe, træfprocent), NAV-graf med fald over `DD_MARK`, månedstabel, aktuel risiko (kun aggregeret pr. område) og gebyrberegner. Datagrundlag: `demoSeries()` (12 hele måneder, `DEMO_MONTHLY`, fast seed) eller `paperSeries()` (afregnede handler pr. leveringsdag + `FUND.CAPITAL`). Konstanter i `FUND` (startkapital, gebyrer, risikofri rente, maks. MW).
- Community: demoprofiler (`TRADERS`), feed med demoindslag (`DEMO_FEED`) plus desk'ens afregnede handler (aldrig åbne), Følg (localStorage `traderz-follow`) og venteliste.
- Datoer: to centrale begreber i scriptet. `DEL()` = i morgen. `TDEL()` = leveringsdagen der handles: i morgen, eller overmorgen når morgendagens spot er offentliggjort. Handel, Position og Marked bruger `TDEL()`.
- Prognose (`forecastFor(target)`): rigtig spot for dagen før + ændring fra en simuleret vind/temperatur-model. Vind og temperatur er simulerede og skal markeres "Simuleret" i UI.
- State: handler, seed og grænse ligger i den fælles bog (`/api/book`), som klienten henter igen hvert 30. sekund. Svarer bogen ikke (f.eks. `index.html` åbnet direkte), bruges `localStorage` nøgle `traderz-desk-v2`, og et banner siger det. Lokale handler flyttes automatisk til bogen, første gang den svarer, hvis bogen er tom.

## Datakilde
Energinet, Energi Data Service, datasættet **DayAheadPrices** (`https://api.energidataservice.dk/dataset/DayAheadPrices`), 15-minutters opløsning, `DayAheadPriceEUR`/`DayAheadPriceDKK`. Brug IKKE det udgåede `Elspotprices`. Kildeangivelse "Data: Energinet, Energi Data Service" skal stå i UI.

## Hosting
GitHub `TroelsLange/traderdemo` (branch `main`) → Netlify-projektet `traderzai` (https://traderzai.netlify.app) bygger automatisk ved push.

## Vigtige beslutninger
- Handler afregnes kun mod rigtige spotpriser, aldrig simulerede. Svarer API'et ikke: simulerede priser + tydelig advarsel.
- Når morgendagens spot er ude, rykker handel og Marked til overmorgen med prognosepris (ellers kunne man handle til prognose med kendt pris).
- Handelspris = prognose ± 0,50 EUR/MWh.
- Investor og Community viser altid "Simulerede resultater. Ikke faktiske afkast." i det klæbende sidehoved (`#disclaimer`, kan ikke lukkes) og om tallene er demodata eller papirhandler. Fjern det ikke.
- Ventelisten gemmer kun med udtrykkeligt samtykke.
- Desk'en: ordreformularen har Produkt (fund) og Kontrakt (base/peak/off-peak/timeblok). Grænser, advarsler og Position og risiko gælder pr. produkt. Fanen Kapital viser kapital pr. produkt.
- Ordreformularen (Handel): trin 1–4, Retning er en radiogruppe (segmented control efter Figma `elements/Switch`), og kun handlingsknappen har fuldt mættet farve (grøn køb, rød salg). Grænsebrud eller over 100 MW (`BIG_MW`) vises som advarsel i ordreoversigten og kræver bekræftelse i en dialog.
- Data i kvarterer, visning pr. time (kvartersvisning kommer senere).
- Design: Figma "🧱 Naia – Core UI Library" (fil `4exYySvrgcHTqeLKfM6xGY`). Brug tokens (CSS-variabler øverst i `index.html`), aldrig hårdkodede værdier. Ikoner hentes fra Figma til `public/assets/` (farvelægges med CSS `mask` + token, f.eks. fluebenet i Retning). Lyst tema er standard; mørkt tema følger systemindstillingen (`prefers-color-scheme`) og er bygget af Figmas Color Surface "Dark" + Prime/Dark red-skalaen. Nye farver skal have en værdi i begge temaer. Font PP Radio Grotesk er licenseret og ligger ikke i repoet.

@docs/STATUS.md
