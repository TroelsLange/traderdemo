# Traderz Desk

Intern prototype af en handelsplatform for el i DK1 og DK2.

## Indhold
- `public/index.html` – hele brugerfladen (HTML, CSS og JavaScript i én fil)
- `netlify/functions/prices.mts` – Netlify Function, der henter spotpriser fra Energinet
- `netlify.toml` – opsætning til hosting på Netlify

## Spotpriser
Priserne kommer fra Energinets Energi Data Service, datasættet
[DayAheadPrices](https://api.energidataservice.dk/dataset/DayAheadPrices)
(15-minutters opløsning, EUR/MWh og DKK/MWh). Data: Energinet, Energi Data Service.

- `GET /api/prices` giver kvarterpriser for DK1 og DK2 for i dag og i morgen (dansk tid).
  En dag, der endnu ikke er offentliggjort, er `null`.
- `GET /api/prices?date=YYYY-MM-DD` giver én bestemt dag (højst 62 dage tilbage). Den bruges til at afregne ældre handler.
- Svaret caches i 15 minutter i Netlifys CDN (`Netlify-CDN-Cache-Control`) og i funktionens hukommelse.
- Brugerfladen viser timepriser som gennemsnit af de fire kvarterer i timen.
- Indtil morgendagens priser er offentliggjort (efter middag), viser leveringsdagen prognosemodellen, markeret som prognose.
  Når priserne er ude, vises de rigtige priser, og handel for den leveringsdag lukker.
- Handler afregnes kun mod rigtige spotpriser.
- Svarer API'et ikke, vises simulerede priser med en tydelig advarsel.

## Status
- Vind og temperatur er simulerede.
- Handler gemmes kun i den enkelte browser (localStorage).

## Næste skridt
- Rigtige vejrdata til prognosemodellen
- Database til handler, så data deles mellem brugere og enheder
- Login
- Visning i 15-minutters opløsning (data hentes allerede i kvarterer)

## Kør lokalt
Kræver [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
netlify dev
```

Åbn http://localhost:8888. Åbner du `public/index.html` direkte i en browser, kan funktionen ikke nås,
og siden viser simulerede priser med en advarsel.
