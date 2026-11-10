# Status

Senest opdateret: 10. november 2026.

## Hvad vi lavede i dag (10. nov. 2026, aften): private brugere og trading-produkter
Ny forretningsmodel: private brugere sætter (simulerede) penge ind og køber andele i produkter, som desk'ens tradere handler. Bygget i fire dele i [PR #4](https://github.com/TroelsLange/traderdemo/pull/4) (ikke merget endnu, så ikke i produktion).

1. Produkter og kobling til desk'en
   - Produktkatalog som data i `public/data/products.json`: Day-Ahead DK1 (risiko 3/7), Intraday Aktiv (6/7) og Spread DK1/DK2 (4/7).
   - Hver handel har et produkt. Ordreformularen har Produkt og Kontrakt; produktet bestemmer områder og grænse. Gamle handler er knyttet til Day-Ahead DK1 (DK2-handler til Spread).
   - Grænse og positioner pr. produkt i Handel og Position og risiko.
   - `/api/funds`: kurs (NAV, indeks 100) og kapital pr. produkt. Demodata før 1. nov. 2026, derefter produktets papirhandler.
   - Ny desk-fane Kapital: kurs, kapital, ind- og udbetalinger, ventende udtrædelser og kapital til handel pr. produkt.
2. Produktkatalog for brugere (gratis): produktkort og produktsider med kurs, største fald, månedsafkast, strategi, vilkår, tradere, produktets afregnede handler og faktaark (placeholder).
3. Brugerkonto: simuleret MitID (kun navn), egnethedstest (Ikke egnet/Basis/Udvidet/Høj), kontantkonto med simuleret ind- og udbetaling ("opbevares hos uafhængig depotbank"), køb af andele, Min portefølje og udtrædelse på produktets næste handelsdag (`/api/account`).
4. Rolleskifter Trader/Bruger. Den gamle fond-side (Investor/Strategi) er erstattet af produkterne; gebyrberegneren ligger på produktsiden med produktets satser. "Simulerede resultater. Ikke faktiske afkast." står nu på alle sider, også desk'ens.
5. Tests: 25 enhedstests og 35 browsertests.

## Tidligere i dag (10. nov. 2026, eftermiddag): investor- og community-demo (erstattet af produkterne)
Merget til `main` via [PR #2](https://github.com/TroelsLange/traderdemo/pull/2) og deployet automatisk til https://traderzai.netlify.app. Netlifys deploy preview byggede uden fejl. Produktionen er ikke kontrolleret i browser endnu (kan ikke nås fra Claudes cloud-container).

1. Rolleskifter øverst: Trader (desk'en, uændret), Investor og Community. Demo uden login; rollen følger URL'en.
2. Investor, Fonden: nøgletal (samlet afkast, afkast i år, årligt afkast, volatilitet, største fald, Sharpe, træfprocent), NAV-graf med markering af fald over 3 %, månedstabel, aktuel risiko i DK1/DK2 i forhold til grænsen (kun aggregerede tal) og gebyrberegner (2 % forvaltning, 20 % resultathonorar, konfigurerbart i `FUND`).
3. Investor, Strategi: hvad fonden handler, hvordan risiko styres, og en tabel med grænser og satser hentet fra desk'ens konstanter.
4. Data: vælg mellem demodata (12 måneder med 4 tabsmåneder og et fald på ca. 10 % fra marts til juni) og papirhandler (desk'ens afregnede handler med en antaget startkapital på 10 mio. EUR).
5. "Simulerede resultater. Ikke faktiske afkast." står fast i sidehovedet på alle Investor- og Community-sider sammen med datagrundlaget.
6. Community: tre demoprofiler med resultater og stil, feed med positioner og kommentarer vist først efter afregning, Følg-knap og venteliste (`/api/waitlist`, Netlify Blobs, kræver samtykke).
7. Tests: 14 enhedstests og 27 browsertests (10 nye for roller, ansvarsfraskrivelse, nøgletal, gebyrer, feed og venteliste).

## Tidligere i dag (10. nov. 2026, formiddag)
Alt er merget til `main` via [PR #1](https://github.com/TroelsLange/traderdemo/pull/1) og deployet automatisk til https://traderzai.netlify.app. Netlifys deploy preview byggede uden fejl. Produktionen er ikke kontrolleret i browser endnu (kan ikke nås fra Claudes cloud-container).

1. Fælles handelsbog: ny funktion `/api/book` gemmer handler i Netlify Blobs, så alle brugere og enheder ser de samme handler. Afregning sker på serveren mod rigtig spot. Svarer bogen ikke, gemmes handler i browseren med et tydeligt banner, og de flyttes til bogen, når den svarer igen.
2. Sommertid: dage med 23 og 25 timer håndteres korrekt i Marked, handel, position og afregning (time 02A/02B på 25-timers dagen, ingen time 02 på 23-timers dagen). MWh regnes med det faktiske antal timer. Priserne placeres efter UTC-tid (`TimeUTC` hentes nu også).
3. Automatiske tests i repoet: 13 enhedstests (Node test runner) og 17 browsertests (Playwright) for priser, handel, deling, afregning, sommertid, fallback og ordreformular. Kør med `npm test`.
4. Fælles serverkode flyttet til `netlify/lib/` (Energi Data Service-hentning og timer/sommertid).
5. Ordreformularen på Handel er bygget om:
   - Retning (Køb/Sælg) er en radiogruppe som segmented control (Figma `elements/Switch`) med flueben, piletaster og hjælpetekst, ikke knapper.
   - Trin: 1 Marked, 2 Retning, 3 Volumen og note, 4 Ordreoversigt (kvittering med egen baggrund). Handlingsknappen ligger direkte efter oversigten, i fuld bredde, som eneste fuldt mættede farve og med tekst som "Køb 10 MW Base DK1 til 46,32 EUR/MWh".
   - Advarsel i ordreoversigten ved grænsebrud og ved handler over 100 MW; begge kræver bekræftelse i en dialog.
   - Rettet: Fra/Til time blev vist, selvom produktet ikke var Timeblok.
6. Mørkt tema for hele appen, efter systemindstillingen.

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
- Rolleskifter Trader/Bruger med fast demo-markering på alle sider.
- Produkter med egen kurs, grænse og kapital; desk'en ser ind- og udbetalinger pr. produkt.
- Brugerrejse: profil, egnethedstest, indbetaling, køb, portefølje og udtrædelse (alt simuleret).
- Venteliste med samtykke.
- `npm test` (enheds- og browsertests uden netværk).

## Halvfærdigt
- Vind og temperatur er simulerede; prognosemodellen er en simpel justering af gårsdagens spot.
- Ingen login: alle med adgang til siden deler én bog, og "Nulstil alle data" sletter alles handler.
- Handelsprisen beregnes i klienten og stoles på af serveren (serveren validerer kun form og grænser).
- Visning kun pr. time, selvom data hentes i kvarterer.
- Fonten PP Radio Grotesk mangler (licens); siden viser Helvetica/Arial.
- Logo: kun tekst "Traderz Desk"; designsystemet har kun et Naia-logo.
- Testene kører ikke automatisk i CI endnu.
- Produkternes kurser er demodata før 1. nov. 2026 og derefter papirhandler. Profilerne er fiktive demoprofiler, og Følg gemmes kun i browseren.
- Kurser og afkast er før gebyrer; gebyrer trækkes ikke fra kursen.
- Brugerprofilen er bundet til et id i browseren. Log ud glemmer profilen, og der er ingen vej tilbage til den.
- Intraday Aktiv handles med day-ahead-timeblokke, indtil intraday-handel er bygget.
- Faktaark er placeholder-sider.

## Kendte fejl og begrænsninger
- Den fælles bog er ikke afprøvet i produktion endnu (kun under `netlify dev` og i testene). Tjek: lav en handel, åbn siden i en anden browser, afregn.
- Deploy previews og produktion bruger samme Blobs-lager (`traderz`), så testhandler, demokonti og testtilmeldinger i en preview havner i de rigtige data.
- Under `netlify dev` er samtidige skrivninger til bogen ikke helt sikre: den lokale Blobs-server sender ingen ETag ved læsning og laver ETag ud fra filens ændringstid, så to skrivninger i samme millisekund kan overskrive hinanden (set ved 5 samtidige handler). I produktion er betingede skrivninger (`onlyIfMatch`) atomiske.
- To 404'er pr. sidevisning, fordi fontfilerne i `/fonts/` ikke findes.
- Handel for i morgen er åben indtil offentliggørelse (ca. 13), ikke kun til den rigtige auktionslukning kl. 12.
- Hukommelsescachen i prisfunktionen virker ikke under `netlify dev` (ny worker pr. kald); CDN-cachen virker i produktion.
- Handler fra den gamle version (nøgle `stroemkurs-desk-v1`) vises ikke.
- Der findes et ekstra Netlify-projekt, `fancy-salmiakki-106317`, som også bygger fra repoet. Bør slettes, hvis det ikke bruges.
- Kosmetisk: toast kan dække indhold; akseetiketter i positionsgrafen bliver store på brede skærme.
- Hvid tekst på handlingsknapperne (grøn #09955A ca. 3,9:1, rød #F43F48 ca. 3,7:1) opfylder 3:1 for UI-elementer, men ikke 4,5:1 for normal tekst. Farverne er designsystemets Signal/Deep.
- Mørkt tema: tokens til kort, kanter og knapper er afledt af Prime/Dark red-skalaen, fordi Figma kun definerer baggrund og tekst for Dark.
- Ventelisten har ingen side til at se eller eksportere tilmeldinger (kun Netlifys Blobs-oversigt) og ingen funktion til at slette en tilmelding ved tilbagetrukket samtykke.
- Inden siden vises for eksterne: få afklaret de juridiske krav til at markedsføre investeringsprodukter til private (også med simulerede tal), egnethedstest, opbevaring af kundemidler og venteliste.
- Egnethedstesten er forenklet og ikke en godkendt test.
- Produkternes gebyrer, minimumsbeløb og startkapital er valgt til demoen og kan ændres i `products.json`.

## Næste skridt (prioriteret)
1. Merge PR #4 og tjek i produktion: handel med produkt, Kapital, brugerrejsen (profil, test, indbetaling, køb, udtrædelse) og ventelisten.
2. Juridisk afklaring af produkterne for private (markedsføring, egnethed, kundemidler, GDPR, privatlivstekst).
3. Rigtigt login (bruger og trader), så profiler og handler får en ejer.
4. Gebyrer trukket i kursen og et rigtigt faktaark pr. produkt.
5. Slet det ekstra Netlify-projekt `fancy-salmiakki-106317`.
6. Tilføj PP Radio Grotesk-fontfilerne i `public/fonts/` (fjerner også 404'erne).
7. Kør `npm test` i CI (GitHub Actions) ved push.
8. Rigtige vejrdata (vind, temperatur) til prognosemodellen.
9. Kvartersvisning i Marked og handel med kvartersprodukter.
10. Serveren beregner selv handelsprisen (kræver, at prognosemodellen flyttes til serveren).
11. Traderz-logo i navigationen.
