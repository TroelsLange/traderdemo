# Status

Senest opdateret: 10. november 2026.

## Hvad vi lavede i dag (10. nov. 2026)
1. Fælles handelsbog: ny funktion `/api/book` gemmer handler i Netlify Blobs, så alle brugere og enheder ser de samme handler. Afregning sker nu på serveren mod rigtig spot. Svarer bogen ikke, gemmes handler i browseren med et tydeligt banner, og de flyttes til bogen, når den svarer igen.
2. Sommertid: dage med 23 og 25 timer håndteres korrekt i Marked, handel, position og afregning (time 02A/02B på 25-timers dagen, ingen time 02 på 23-timers dagen). MWh regnes med det faktiske antal timer. Priserne placeres efter UTC-tid (`TimeUTC` hentes nu også).
3. Automatiske tests i repoet: 13 enhedstests (Node test runner) og 11 browsertests (Playwright) for priser, handel, deling, afregning, sommertid og fallback. Kør med `npm test`.
4. Fælles serverkode flyttet til `netlify/lib/` (Energi Data Service-hentning og timer/sommertid).

## Tidligere (9. nov. 2026)
Prototypen lagt på GitHub og omdøbt til Traderz; rigtige spotpriser via `/api/prices`; afregning mod rigtig spot; Netlify forbundet; brugerfladen bygget om efter Naia Core UI Library; handel rykker til næste leveringsdag, når morgendagens spot er ude.

## Hvad virker
- Spotpriser for DK1/DK2 i dag og i morgen, timegennemsnit af kvarterer, verificeret mod Energinets rådata (også 25-timers dagen 25. okt. 2026).
- Prognose og tydelig markering (Prognose / Spot / Simuleret).
- Handel (base, peak, off-peak, timeblok), positioner, grænser, følsomhed, resultat og journal.
- Fælles handelsbog med deling mellem browsere (opdateres hvert 30. sekund).
- Afregning mod rigtig spot på serveren, også ældre dage (maks. 62 dage tilbage).
- 23/25-timers dage.
- Fallback ved prisfejl (simulerede priser + advarsel) og ved bogfejl (localStorage + advarsel).
- Mobilvisning uden vandret scroll.
- `npm test` (enheds- og browsertests uden netværk).

## Halvfærdigt
- Vind og temperatur er simulerede; prognosemodellen er en simpel justering af gårsdagens spot.
- Ingen login: alle med adgang til siden deler én bog, og "Nulstil alle data" sletter alles handler.
- Handelsprisen beregnes i klienten og stoles på af serveren (serveren validerer kun form og grænser).
- Visning kun pr. time, selvom data hentes i kvarterer.
- Fonten PP Radio Grotesk mangler (licens); siden viser Helvetica/Arial.
- Logo: kun tekst "Traderz Desk"; designsystemet har kun et Naia-logo.
- Testene kører ikke automatisk i CI endnu.

## Kendte fejl og begrænsninger
- Den fælles bog er ikke afprøvet i produktion endnu (kun under `netlify dev` og i testene). Tjek efter deploy: lav en handel, åbn siden i en anden browser, afregn.
- Under `netlify dev` er samtidige skrivninger til bogen ikke helt sikre: den lokale Blobs-server sender ingen ETag ved læsning og laver ETag ud fra filens ændringstid, så to skrivninger i samme millisekund kan overskrive hinanden (set ved 5 samtidige handler). I produktion er betingede skrivninger (`onlyIfMatch`) atomiske.
- To 404'er pr. sidevisning, fordi fontfilerne i `/fonts/` ikke findes.
- Handel for i morgen er åben indtil offentliggørelse (ca. 13), ikke kun til den rigtige auktionslukning kl. 12.
- Hukommelsescachen i prisfunktionen virker ikke under `netlify dev` (ny worker pr. kald); CDN-cachen virker i produktion.
- Handler fra den gamle version (nøgle `stroemkurs-desk-v1`) vises ikke.
- Der findes et ekstra Netlify-projekt, `fancy-salmiakki-106317`, som også bygger fra repoet. Bør slettes, hvis det ikke bruges.
- Kosmetisk: toast kan dække indhold; akseetiketter i positionsgrafen bliver store på brede skærme.

## Næste skridt (prioriteret)
1. Deploy og tjek den fælles bog i produktion (se ovenfor).
2. Slet det ekstra Netlify-projekt `fancy-salmiakki-106317`.
3. Login (Netlify team-login / `context.user`), så handler får en ejer, og nulstil kun rammer egne handler.
4. Tilføj PP Radio Grotesk-fontfilerne i `public/fonts/` (fjerner også 404'erne).
5. Kør `npm test` i CI (GitHub Actions) ved push.
6. Rigtige vejrdata (vind, temperatur) til prognosemodellen.
7. Kvartersvisning i Marked og handel med kvartersprodukter.
8. Serveren beregner selv handelsprisen (kræver, at prognosemodellen flyttes til serveren).
9. Traderz-logo i navigationen.
