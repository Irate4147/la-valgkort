# Liberal Alliance – valgkort

Interaktivt kort over Liberal Alliances stemmer ved folketingsvalgene 2026 (FV26) og 2022 (FV22) i hele landet – alle 10 storkredse, 98 kommuner og ca. 1.300 afstemningsområder. Samme designsprog som [lau-kort](https://github.com/Irate4147/lau-kort) (MapLibre + OpenFreeMap, sidepanel til venstre).

**Side:** https://irate4147.github.io/la-valgkort/

**Navigation:** Danmark → storkreds → kommune → afstemningsområde. Klik på kortet (eller i listerne) for at gå et niveau ned, eller vælg storkreds i menuen øverst. Opstillingskredsene kan også åbnes fra storkredsens side. Esc, et klik uden for kortet eller brødkrummerne går op igen. Tilstanden står i adressen (`#valg=fv26&sk=Nordsjællands Storkreds&kommune=Hillerød`), så en visning kan deles som link.

**Farvning (værktøjslinjen):**
- *LA-andel* – LA's andel af de gyldige stemmer (blå, 7 faste klasser, samme skala for begge valg).
- *Ændring* – ændring i LA-andel FV22 → FV26 i pct.-point (rød ↔ blå).
- *Største LA-kandidat* – hvilken LA-kandidat der fik flest personlige stemmer i området (kræver valgt storkreds, da kandidaterne er forskellige i hver).
- *Én kandidat* – en kandidats personlige stemmer i pct. af LA's stemmer i området, plus top 10-områder i sidepanelet (kræver valgt storkreds). På landsniveau linker listen over valgte kandidater direkte hertil.
- *Inddeling* – afstemningsområder, kommuner eller (på landsniveau) storkredse.

## Data

| Hvad | Kilde |
|---|---|
| Stemmetal pr. afstemningsområde (parti- og personlige stemmer, vælgere) | valg.dk's offentlige API (samme data som SFTP-udtrækket på data.valg.dk) |
| Kommune for hvert afstemningsområde | valg.dk (FV26); FV22 via DAGI-id / geografi |
| Valgt / stedfortræder, prioriteret i kreds nr. | Danmarks Statistik, kandstat ([FV26](https://www.dst.dk/valg/Valg2546527/kandstat/kandstat.htm), [FV22](https://www.dst.dk/valg/Valg1968094/kandstat/kandstat.htm)) |
| Kort over afstemningsområder | DAGI (Klimadatastyrelsen), forenklet af ValgTal (valgtal.dk/data/kort) |

```
python3 -I scripts/hent.py   # henter rådata til data/raw/ (~5 MB)
python3 -I scripts/byg.py    # skriver data/valg.json, data/kort_fv26.json, data/kort_fv22.json
python3 -m http.server       # åbn http://localhost:8000
```

`byg.py` stopper, hvis noget ikke stemmer: hvert valg.dk-område skal matche præcis ét kortområde, summen af områderne skal give valg.dk's kredstal for alle partier og alle LA-kandidater i alle 92 opstillingskredse, og LA-kandidaternes personlige stemmer skal være identiske med DST's kandstat i alle 10 storkredse. Pr. 2026-10-09 stemmer alt for begge valg (FV26: LA 334.421 stemmer = 9,37 %; FV22: 278.656 = 7,89 %). Færøerne og Grønland er ikke med.

Særtilfælde, som scriptet håndterer:
- DAGI kalder 6. kreds i København "Utterslev", valg.dk "Bispebjerg"; FV22-kredsen "Esbjerg Omegnskredsen" staves anderledes end kortet.
- To FV22-områder i Næstved har samme (afkortede) navn både hos valg.dk og i kortet og kan ikke skelnes – de er lagt sammen til ét område.
- FV22 har ingen kommunemenu hos valg.dk; kommunen findes via DAGI-id, ellers via kortet.

**Sammenligning FV22 → FV26:** Hvert FV22-område kobles til det FV26-område, der indeholder det (indre punkt i polygon), så sammenlagte områder sammenlignes med summen af deres forgængere. Afviger vælgertallet mere end 20 % fra forgængernes, er geografien ikke den samme (typisk delte områder), og så vises ingen ændring. Resultat: 1.255 af 1.314 FV26-områder sammenlignes, 39 af dem med flere forgængere.

**Kortgeometri:** ValgTal's forenklede topologi er ikke helt ren (huller og overlap mellem naboområder). Kommuner og storkredse tegnes derfor som sammenlagte polygoner, hvor sammenlægningen giver et gyldigt resultat, og ellers som deres afstemningsområder; grænselinjer tegnes kun mellem naboer.

**Nyt valg:** tilføj valgets id (fra `https://valg.dk/api/election`) i `VALG` i `hent.py`/`byg.py`, DST-adressen i `DST`, kortnavnet fra valgtal.dk, og `AAR`/`FORRIGE` øverst i `app.js`.
