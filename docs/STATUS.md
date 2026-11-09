# Status

Senest opdateret: 9. november 2026.

## Hvad vi lavede i dag (9. nov. 2026)
1. Prototypen "Strømkurs Desk" lagt på GitHub (`TroelsLange/traderdemo`) og omdøbt til Traderz.
2. Rigtige spotpriser: Netlify Function `/api/prices` mod Energi Data Service (DayAheadPrices), cache 15 min, fallback til simulerede priser med advarsel, kildeangivelse.
3. Afregning af handler mod rigtig spotpris. Prognose for leveringsdagen, indtil prisen er offentliggjort.
4. Netlify forbundet (projekt `traderzai`), deploy og CDN-cache verificeret.
5. Brugerfladen bygget om efter Naia Core UI Library i Figma (tokens, navigation, faner med ikoner, knapper, badges, kort, tabeller, inputfelter, alert).
6. Fejlrettelse: Køb-knappen var deaktiveret efter kl. ca. 13. Nu rykker handel og Marked til næste leveringsdag, når morgendagens spot er ude.

## Hvad virker
- Spotpriser for DK1/DK2 i dag og i morgen, timegennemsnit af kvarterer, verificeret mod Energinets rådata.
- Prognose og tydelig markering (Prognose / Spot / Simuleret).
- Handel (base, peak, off-peak, timeblok), positioner, grænser, følsomhed, resultat og journal.
- Afregning mod rigtig spot, også ældre dage via `?date=`.
- Fallback ved API-fejl med advarsel og "Prøv igen".
- Mobilvisning uden vandret scroll.

## Halvfærdigt
- Vind og temperatur er simulerede; prognosemodellen er en simpel justering af gårsdagens spot.
- Handler ligger kun i browserens localStorage (ingen deling, ingen login).
- Visning kun pr. time, selvom data hentes i kvarterer.
- Fonten PP Radio Grotesk mangler (licens); siden viser Helvetica/Arial.
- Logo: kun tekst "Traderz Desk"; designsystemet har kun et Naia-logo.
- Ingen automatiske tests i repoet; testet manuelt med Playwright-scripts uden for repoet.

## Kendte fejl og begrænsninger
- To 404'er pr. sidevisning, fordi fontfilerne i `/fonts/` ikke findes.
- Sommertidsskift: UI har 24 timer. På 25-timers dagen er time 02 gennemsnit af 8 kvarterer; på 23-timers dagen mangler time 02. MWh pr. handel regnes altid med 24 timer.
- Handel for i morgen er åben indtil offentliggørelse (ca. 13), ikke kun til den rigtige auktionslukning kl. 12.
- Hukommelsescachen i funktionen virker ikke under `netlify dev` (ny worker pr. kald); CDN-cachen virker i produktion.
- Handler fra den gamle version (nøgle `stroemkurs-desk-v1`) vises ikke længere.
- Der findes et ekstra Netlify-projekt, `fancy-salmiakki-106317`, som også bygger fra repoet. Bør slettes, hvis det ikke bruges.
- Kosmetisk: toast kan dække indhold; akseetiketter i positionsgrafen bliver store på brede skærme.

## Næste skridt (prioriteret)
1. Slet det ekstra Netlify-projekt `fancy-salmiakki-106317`.
2. Tilføj PP Radio Grotesk-fontfilerne i `public/fonts/` (fjerner også 404'erne).
3. Database til handler (f.eks. Netlify Database/Blobs), så data deles mellem brugere og enheder.
4. Login (Netlify team-login / `context.user`).
5. Rigtige vejrdata (vind, temperatur) til prognosemodellen.
6. Kvartersvisning i Marked og handel med kvartersprodukter.
7. Korrekt håndtering af 23/25-timers dage.
8. Automatiske tests (Playwright) for priser, handel, afregning og fallback.
9. Traderz-logo i navigationen.
