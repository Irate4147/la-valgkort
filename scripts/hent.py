"""Henter rådata for alle storkredse fra valg.dk (FV26 og FV22, ca. 2.900 kald – hentede filer
springes over ved næste kørsel) og
valgtal.dk's forenklede DAGI-kort (afstemningsområder + kommuner).

Kør:  python3 -I scripts/hent.py      (skriver til data/raw/)

valg.dk's offentlige API kræver headeren X-Election-ID; ellers svarer det
"general.unknown_error". Data er det samme, som valg.dk viser på siden
(fintælling). SFTP-udtrækket (data.valg.dk) er samme kilde, men port 22 er ofte
lukket, så vi bruger HTTP.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.request
from pathlib import Path

ROD = Path(__file__).resolve().parent.parent
RAW = ROD / "data" / "raw"

VALG = {
    "fv26": "47b883ef-d0d3-4cb6-9da5-91963f0e9ba0",  # 24. marts 2026
    "fv22": "987875fe-0dae-42ac-be5b-62cf0bd5d65e",  # 1. november 2022
}

# Danmarks Statistiks certificerede kandidatstatistik (kandstat)
DST = {
    "fv26": "https://www.dst.dk/valg/Valg2546527/kandstat/kandstat.htm",
    "fv22": "https://www.dst.dk/valg/Valg1968094/kandstat/kandstat.htm",
}

KORT = {  # valgtal.dk/data/kort/<navn>.topojson?v=<version>
    "historisk_fv26_afstemningsomraader_simpel": "0dec4f75bc9a",
    "historisk_fv22_afstemningsomraader_simpel": "2f7687c573d6",
    "kv25_kommuner_simpel": "8df6f5a19f5d",
}


def hent(url, valg_id=None, forsøg=4):
    headers = {"Accept": "application/json" if valg_id else "*/*", "User-Agent": "la-valgkort/1.0 (github.com/Irate4147/valgkort-nordsjaelland)"}
    if valg_id:
        headers["X-Election-ID"] = valg_id
    for i in range(forsøg):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
                return r.read()
        except Exception as e:  # netværksfejl: prøv igen med backoff
            if i == forsøg - 1:
                raise
            print(f"  fejl ({e}), prøver igen …", file=sys.stderr)
            time.sleep(2 ** (i + 1))


def hent_valg(navn, valg_id):
    ud = RAW / navn
    ud.mkdir(parents=True, exist_ok=True)
    menu = json.loads(hent("https://valg.dk/api/overview/side-menu", valg_id))
    (ud / "menu.json").write_text(json.dumps(menu, ensure_ascii=False, indent=1))
    opgaver = []
    for sk in menu:
        for kreds in sk["children"]:
            opgaver.append((ud / f"kreds_{kreds['id']}.json",
                            f"https://valg.dk/api/detail/{kreds['id']}/ge-nomination-district-detail"))
            for omr in kreds["children"]:
                opgaver.append((ud / f"omr_{omr['id']}.json",
                                f"https://valg.dk/api/detail/{omr['id']}/ge-election-area-details"))
    mangler = [(f, u) for f, u in opgaver if not f.exists()]
    print(f"{navn}: {len(menu)} storkredse, {len(opgaver)} filer, {len(mangler)} skal hentes")

    def én(fu):
        f, u = fu
        f.write_bytes(hent(u, valg_id))
        time.sleep(0.1)
    with ThreadPoolExecutor(4) as pool:  # høfligt: højst 4 samtidige kald
        for i, _ in enumerate(pool.map(én, mangler), 1):
            if i % 200 == 0:
                print(f"  {navn}: {i}/{len(mangler)}")

    # Kommune → afstemningsområder (valg.dk's egen inddeling). Findes kun for nyere valg.
    omr_ids = {o["id"] for sk in menu for k in sk["children"] for o in k["children"]}
    kommuner = []
    for region in json.loads(hent(f"https://valg.dk/api/export-data/{valg_id}/get-region-list", valg_id)):
        for kom in json.loads(hent(f"https://valg.dk/api/overview/region/{region['id']}/side-menu", valg_id)):
            if kom.get("sideNaviationLinkType") != "Municipality":
                continue
            omr = json.loads(hent(f"https://valg.dk/api/overview/municipality/{kom['id']}/side-menu", valg_id))
            ids = [o["id"] for o in omr if o["id"] in omr_ids]
            if ids:
                kommuner.append({"id": kom["id"], "navn": kom["title"], "omraader": ids})
    (ud / "kommuner.json").write_text(json.dumps(kommuner, ensure_ascii=False, indent=1))
    print(f"{navn}: {len(kommuner)} kommuner, {sum(len(k['omraader']) for k in kommuner)}/{len(omr_ids)} områder")


def main():
    for navn, vid in VALG.items():
        hent_valg(navn, vid)
    for navn, url in DST.items():
        print("DST kandstat:", navn)
        (RAW / navn / "dst_kandstat.htm").write_bytes(hent(url))
    geo = RAW / "geo"
    geo.mkdir(parents=True, exist_ok=True)
    for navn, v in KORT.items():
        print("kort:", navn)
        (geo / f"{navn}.topojson").write_bytes(hent(f"https://valgtal.dk/data/kort/{navn}.topojson?v={v}"))


if __name__ == "__main__":
    main()
