# LA i Nordsjællands Storkreds – valgkort

Interaktivt kort over Liberal Alliances stemmer ved folketingsvalgene 2026 (FV26) og 2022 (FV22) i Nordsjællands Storkreds, ned på afstemningsområde. Samme designsprog som [lau-kort](https://github.com/Irate4147/lau-kort) (MapLibre + OpenFreeMap, sidepanel til venstre).

**Side:** https://irate4147.github.io/valgkort-nordsjaelland/

**Navigation:** Storkredsen → kommune (klik på kortet eller i listen) → afstemningsområde (klik igen inde i kommunen). Opstillingskredsene kan også åbnes fra oversigten. Esc går et niveau op. Tilstanden står i adressen (`#valg=fv26&kommune=Hillerød&omr=…`), så en visning kan deles som link.

**Farvning (værktøjslinjen):**
- *LA-andel* – LA's andel af de gyldige stemmer (blå, 7 faste klasser, samme skala for begge valg).
- *Ændring* – ændring i LA-andel FV22 → FV26 i pct.-point (rød ↔ blå).
- *Største LA-kandidat* – hvilken LA-kandidat der fik flest personlige stemmer i området.
- *Én kandidat* – en valgt kandidats personlige stemmer i pct. af LA's stemmer i området, plus top 10-områder i sidepanelet.
- *Inddeling* – afstemningsområder eller hele kommuner.

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

`byg.py` stopper, hvis noget ikke stemmer: hvert valg.dk-område skal matche præcis ét kortområde, summen af områderne skal give valg.dk's kredstal for alle partier og alle LA-kandidater, og LA-kandidaternes personlige stemmer skal være identiske med DST's kandstat. Pr. 2026-10-09 stemmer alt (FV26: LA 30.314 stemmer = 10,26 %; FV22: 27.497 = 9,43 %).

**Sammenligning FV22 → FV26:** Hvert FV22-område kobles til det FV26-område, der indeholder det (indre punkt i polygon). To områder blev lagt sammen: Nivå (+ Niverød) og Grønnevang Skole, Østervang (+ Jespervej); de sammenlignes med summen af forgængerne.

**Nyt valg:** tilføj valgets id (fra `https://valg.dk/api/election`) i `VALG` i `hent.py`/`byg.py`, DST-adressen i `DST`, kortnavnet fra valgtal.dk, og `AAR`/`FORRIGE` øverst i `app.js`.
