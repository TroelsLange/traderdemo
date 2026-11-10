# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Formål
Traderz: intern prototype af en handelsplatform for el (day-ahead) i DK1 og DK2. Tradere handler papirhandler mod rigtige spotpriser for en række produkter, og private brugere kan (simuleret) sætte penge ind og købe andele i produkterne. Ingen rigtige penge. Brugerfladen er på dansk.

## Kommandoer
- Kør lokalt: `netlify dev` → http://localhost:8888 (funktionen kører kun via Netlify CLI; åbnes `public/index.html` direkte, vises simulerede priser).
- I en Claude Code cloud-container skal den startes sådan (proxy og manglende Deno):
  `NODE_OPTIONS= NODE_USE_ENV_PROXY=1 netlify dev --offline --internal-disable-edge-functions --port 8888`
- Tjek funktionerne: `curl -s localhost:8888/api/prices`, `curl -s "localhost:8888/api/prices?date=YYYY-MM-DD"`, `curl -s localhost:8888/api/book`, `curl -s localhost:8888/api/funds`, `curl -s "localhost:8888/api/account?user=<id>"` og `curl -s localhost:8888/api/waitlist`.
- Tests: `npm install` og derefter `npm test` (= `npm run test:unit` + `npm run test:e2e`). Kræver Node ≥ 22.18 (kører `.mts` direkte).
  - `tests/unit/`: Node test runner for timer/sommertid, produkter og kurser, egnethed og alle funktioner (falsk Energi Data Service, Blobs i hukommelsen).
  - `tests/e2e/`: Playwright mod `tests/server.mjs`, som kører de rigtige funktioner med falske priser og styrbar klokke (`POST /__test`). Ingen netværk eller Netlify CLI nødvendig.
- Ingen build eller linter. Verificér også ændringer i browseren.

## Arkitektur
- `public/index.html`: hele appen i én fil (CSS + HTML + vanilla JS i en IIFE). Ingen afhængigheder.
- `netlify/functions/prices.mts`: `GET /api/prices` henter DK1+DK2 for i dag og i morgen (dansk tid) fra Energi Data Service; `?date=` henter én dag (maks. 62 dage tilbage). Upubliceret dag = `null`. Cache: `Netlify-CDN-Cache-Control: durable, s-maxage=900` + hukommelse. Ved fejl: 502 + `no-store`.
- `netlify/functions/book.mts`: `/api/book`, den fælles handelsbog i Netlify Blobs (store `traderz`, nøgle `book`, ét JSON-dokument med seed, grænse, nextId, handler). `GET` henter, `POST {op}` med `trade`, `cancel`, `settle`, `limit`, `reset`, `import`. Samtidighed: ETag + `onlyIfMatch` og genforsøg. Afregning sker på serveren mod rigtig spot. Serveren tildeler handels-id og validerer; prisen beregnes i klienten.
- Produkter: `public/data/products.json` er det konfigurerbare katalog (Day-Ahead DK1, Intraday Aktiv, Spread DK1/DK2) med strategi, tradere, risikoklasse, minimumsbeløb, gebyrer, udtrædelsesfrekvens, grænse (`limitMw`), områder, startkapital, demohistorik og faktaark. Læses af både klient (`loadCatalog`) og server (`netlify/lib/funds.mts`).
- Hver handel har `fund` (produkt-id). Serveren afviser områder, som produktet ikke må handle. Gamle handler uden produkt: DK1 → `da-dk1`, DK2 → `spread` (`legacyFund`, `fundOf`). Bogen har `limits` pr. produkt; `POST {op:"limit", fund, limit}`.
- `netlify/functions/funds.mts`: `GET /api/funds` beregner kurs (NAV, indeks 100), kapital, ind-/udbetalinger og ventende udtrædelser pr. produkt ud fra bogen (`book`) og produktregnskabet (`ledger`) i Blobs. Kurs før katalogets `launch` er demodata; derefter produktets afregnede papirhandler pr. andel (`computeFund`). Køb og udtrædelser ændrer andele, ikke kurs. Kursen er før gebyrer.
- `netlify/functions/account.mts`: `/api/account`, brugerkonti (demo). `GET ?user=<id>`; `POST {op, user}` med `login` (simuleret MitID: kun navn), `assess` (egnethedstest), `deposit`/`withdraw` (simuleret kontantkonto, "opbevares hos uafhængig depotbank"), `buy` (andele til seneste kurs; kræver egnethed og minimumsbeløb ved første køb) og `redeem` (udføres på produktets næste handelsdag via `dealingDate`). Brugere og produktposter ligger i ét dokument (nøgle `ledger`) med ETag + `onlyIfMatch`. Bruger-id genereres i browseren (localStorage `traderz-user`).
- Egnethedstest: spørgsmål i `public/data/suitability.json`; niveau beregnes på serveren (`assessSuitability` i `netlify/lib/funds.mts`): Ikke egnet, Basis (risiko 1–3), Udvidet (1–5), Høj (alle; kræver også viden, risikovillighed og lille andel af opsparingen).
- `netlify/functions/waitlist.mts`: `/api/waitlist`, venteliste til nye produkter (Community). `POST {name, email, interest, consent:true}` gemmer én nøgle pr. e-mail (`waitlist/<sha256>`) i store `traderz`; `GET` giver kun antal. Navne og e-mails udleveres aldrig via API'et (se dem i Netlify-projektets Blobs-oversigt).
- `netlify/lib/`: fælles kode til funktionerne. `energinet.mts` henter priser; `hours.mts` har timer/sommertid; `funds.mts` har produktkatalog, kurser, egnethed og handelsdage. Alle funktioner eksporterer en fabrik (`createPricesHandler`, `createBookHandler`, `createFundsHandler`, `createAccountHandler`, `createWaitlistHandler`), så testene kan give klokke, fetch og butik.
- `netlify.toml`: publish = `public` (funktioner må ikke ligge i publish-mappen).
- Datamodel i klienten: `market.days[dato] = {DK1:[kvarterer], DK2:[...]}`; kvarter `{t (TimeDK), u (TimeUTC), eur, dkk}`. Timepris = gennemsnit af kvartererne (`hourly()`), placeret efter UTC-tid.
- Timer ("slots"): priser og positioner er arrays med én værdi pr. faktisk time på dagen: 24, 23 (sommertid begynder, time 02 mangler) eller 25 (vintertid begynder, time 02 to gange: 02A/02B). `slotHours(dato)` giver klokketimen pr. slot; `productSlots()` giver et produkts slots. Prognosemodellen regner pr. klokketime (24) og oversættes med `toSlots`/`byClock`. Marked viser basisdag og leveringsdag side om side med `alignDays()`. Logikken findes både i `netlify/lib/hours.mts` og i `index.html`; ret begge.
- Roller (demo, uden login): rolleskifteren øverst vælger Trader (desk'en: `#marked`, `#handel`, `#position`, `#resultat`, `#kapital`) eller Bruger (`#produkter`, `#produkt/<id>`, `#portefolje`, `#konto`, `#egnethed`, `#community`). Rollen afledes af view'et (`roleOf`, `ROLES`), så links kan deles. Gamle links `#investor`/`#strategi` sendes til `#produkter` (`MOVED`). Brugerdelen ændrer intet i desk'ens handel eller afregning.
- Bruger: Produkter (kort pr. produkt), produktside (kurs, afkast, største fald, kursgraf med markering af papirhandlernes start, månedsafkast, strategi, vilkår, gebyrberegner med produktets satser, tradere, produktets afregnede handler, faktaark i `public/faktaark/<id>.html`), Konto (profil, egnethed, kontantkonto), Portefølje (beholdning, værdi, afkast; udtrædelse) og køb fra produktsiden. Statistik (`fundStats`, `monthlyReturns`, `navChart`) og konstanter i `FUND`.
- Community: demoprofiler (`TRADERS`), feed med demoindslag (`DEMO_FEED`, med produkt) plus desk'ens afregnede handler (aldrig åbne), Følg (localStorage `traderz-follow`) og venteliste. Profiler og feed kan filtreres pr. produkt.
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
- Alle sider viser "Simulerede resultater. Ikke faktiske afkast." i det klæbende sidehoved (`#disclaimer`, kan ikke lukkes) med en linje om demodata, papirhandler og at der ikke er rigtige penge. Fjern det ikke.
- Ingen rigtige penge, betalinger eller MitID. Kun et demonavn gemmes om brugerne. Afkast og kurser er før gebyrer og skal stå sådan.
- Ventelisten gemmer kun med udtrykkeligt samtykke.
- Desk'en: ordreformularen har Produkt (fund) og Kontrakt (base/peak/off-peak/timeblok). Grænser, advarsler og Position og risiko gælder pr. produkt. Fanen Kapital viser kapital pr. produkt.
- Ordreformularen (Handel): trin 1–4, Retning er en radiogruppe (segmented control efter Figma `elements/Switch`), og kun handlingsknappen har fuldt mættet farve (grøn køb, rød salg). Grænsebrud eller over 100 MW (`BIG_MW`) vises som advarsel i ordreoversigten og kræver bekræftelse i en dialog.
- Data i kvarterer, visning pr. time (kvartersvisning kommer senere).
- Design: Figma "🧱 Naia – Core UI Library" (fil `4exYySvrgcHTqeLKfM6xGY`). Brug tokens (CSS-variabler øverst i `index.html`), aldrig hårdkodede værdier. Ikoner hentes fra Figma til `public/assets/` (farvelægges med CSS `mask` + token, f.eks. fluebenet i Retning). Lyst tema er standard; mørkt tema følger systemindstillingen (`prefers-color-scheme`) og er bygget af Figmas Color Surface "Dark" + Prime/Dark red-skalaen. Nye farver skal have en værdi i begge temaer. Font PP Radio Grotesk er licenseret og ligger ikke i repoet.

@docs/STATUS.md
