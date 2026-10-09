"""Bygger kortets data ud fra data/raw/ (se hent.py).

Kør:  python3 -I scripts/byg.py

Skriver
  data/valg.json        – resultater pr. afstemningsområde (FV26 og FV22)
  data/kort_fv26.json   – TopoJSON med storkredsens afstemningsområder ved FV26
  data/kort_fv22.json   – det samme for FV22

Kontroller (scriptet stopper ved fejl):
  * alle områder hos valg.dk matcher præcis ét kortområde og omvendt
  * summen af områderne = valg.dk's opstillingskredstal for alle partier og
    alle LA-kandidater
  * hvert område har en kommune
"""
import html
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROD = Path(__file__).resolve().parent.parent
RAW = ROD / "data" / "raw"
UD = ROD / "data"

LA = "I"
VALG = {
    "fv26": {"navn": "Folketingsvalget 2026", "dato": "2026-03-24", "kort": "historisk_fv26_afstemningsomraader_simpel"},
    "fv22": {"navn": "Folketingsvalget 2022", "dato": "2022-11-01", "kort": "historisk_fv22_afstemningsomraader_simpel"},
}
FEJL = []


def fejl(msg):
    FEJL.append(msg)
    print("FEJL:", msg, file=sys.stderr)


def norm(s):
    return re.sub(r"\s+", " ", s.strip().lower())


def kredsnavn(s):
    """'1. Helsingør' / 'Helsingørkredsen' -> 'helsingør'."""
    s = re.sub(r"^\d+\.\s*", "", s.strip())
    return re.sub(r"kredsen$", "", s.lower())


# ---------- TopoJSON ----------

def ringe_abs(topo):
    """Afkvantiserede buer (lon, lat) – bruges kun til punkt-i-polygon."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    buer = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        buer.append(pts)
    return buer


def polygoner(geom, buer):
    def ring(idx):
        pts = []
        for i in idx:
            a = buer[i] if i >= 0 else buer[~i][::-1]
            pts.extend(a if not pts else a[1:])
        return pts
    if geom["type"] == "Polygon":
        return [[ring(r) for r in geom["arcs"]]]
    if geom["type"] == "MultiPolygon":
        return [[ring(r) for r in p] for p in geom["arcs"]]
    return []


def i_ring(pt, ring):
    x, y = pt
    inde = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inde = not inde
    return inde


def i_polygon(pt, polys):
    return any(i_ring(pt, p[0]) and not any(i_ring(pt, h) for h in p[1:]) for p in polys)


def indre_punkt(polys):
    """Et punkt inde i den største delpolygon (vandret skanlinje gennem midten)."""
    def areal(r):
        return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]))) / 2
    p = max(polys, key=lambda p: areal(p[0]))
    ys = [y for _, y in p[0]]
    y = (min(ys) + max(ys)) / 2
    xs = []
    for r in p:
        for (x1, y1), (x2, y2) in zip(r, r[1:] + r[:1]):
            if (y1 > y) != (y2 > y):
                xs.append((x2 - x1) * (y - y1) / (y2 - y1) + x1)
    xs.sort()
    bedst = max(zip(xs[::2], xs[1::2]), key=lambda s: s[1] - s[0])
    return ((bedst[0] + bedst[1]) / 2, y)


def beskaar_topologi(topo, objektnavn, geoms):
    """Ny TopoJSON med kun de givne geometrier og de buer, de bruger."""
    brugt = sorted({(i if i >= 0 else ~i) for g in geoms for i in _alle_buer(g)})
    ny = {old: new for new, old in enumerate(brugt)}

    def omnummer(a):
        if isinstance(a, list):
            return [omnummer(x) for x in a]
        return ny[a] if a >= 0 else ~ny[~a]
    return {
        "type": "Topology",
        "transform": topo["transform"],
        "objects": {objektnavn: {"type": "GeometryCollection", "geometries": [
            {**g, "arcs": omnummer(g["arcs"])} for g in geoms]}},
        "arcs": [topo["arcs"][i] for i in brugt],
    }


def _alle_buer(g):
    def flad(a):
        for x in a:
            if isinstance(x, list):
                yield from flad(x)
            else:
                yield x
    return flad(g["arcs"])


# ---------- Danmarks Statistik (kandstat) ----------

def dst_kandidater(kode):
    """LA's kandidater i storkredsen fra DST's kandstat: prioriteret i kreds nr.,
    personlige stemmer, valgt nr./stedfortræder nr."""
    t = (RAW / kode / "dst_kandstat.htm").read_text(encoding="utf-8")
    s = t.find("I. Liberal Alliance - Nordsjællands Storkreds")
    slut = t.find('class="partier1"', s + 10)
    ud = {}
    for række in re.findall(r'<tr><td class="personer">(.*?)</tr>', t[s:slut]):
        celler = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.split(r"</td>", række)]
        navn, _opstillet, prio, _i_alt, pers, valgt, stedf = celler[:7]
        ud[navn] = {
            "prioriteret_i": prio,
            "personlige": int(pers.replace(".", "")),
            "valgt": valgt or None,
            "stedfortraeder": stedf or None,
        }
    return ud


# ---------- valg.dk ----------

def omr_id(p):
    """DAGI-id; enkelte nedlagte områder mangler det og får valg.dk's område-id."""
    return p["dagi_id"] or f"ao{p['ao_id']}"


def parti_bogstav(navn):
    return navn.split(".", 1)[0].strip() if navn and "." in navn[:3] else None


def læs_område(f):
    d = json.loads(f.read_text())
    vd = d["votingDetails"]
    partier = {}
    kandidater = {}  # (bogstav, navn) -> stemmer
    la_parti = 0
    for p in d["candidateListResultDetailsList"]:
        b = parti_bogstav(p["displayName"])
        if b is None:  # løsgængere: personlige stemmer uden parti
            for c in p["candidateResultListWithListVotes"]:
                kandidater[("–", c["displayName"])] = c["numberOfVotes"]
            continue
        partier[b] = p["numberOfVotes"]
        for c in p["candidateResultListWithListVotes"]:
            if c["displayName"] == "Partistemmer":
                if b == LA:
                    la_parti = c["numberOfVotes"]
            else:
                kandidater[(b, c["displayName"])] = c["numberOfVotes"]
    return {
        "navn": d["countStatusDto"]["name"],
        "stemmeberettigede": vd["numberOfEligibleVoters"],
        "afgivne": vd["totalVotesCount"]["totalVotes"],
        "gyldige": vd["validVotesCount"]["validVotesTotal"],
        "blanke": vd["blankVotesCount"]["blankVotesTotal"],
        "partier": partier,
        "kandidater": kandidater,
        "la_partistemmer": la_parti,
        "adresse": vd["electionAreaDetail"].get("address"),
        "stemmested": vd["electionAreaDetail"].get("pollingStationName"),
    }


def partinavne(raw):
    navne = {}
    for f in sorted(raw.glob("kreds_*.json")):
        for p in json.loads(f.read_text())["partyDetailDto"]:
            b = parti_bogstav(p["partyWholeName"])
            if b:
                navne[b] = p["partyWholeName"].split(".", 1)[1].strip()
    return navne


def byg_valg(kode, cfg, kommune_af_dagi, kommune_polys):
    raw = RAW / kode
    menu = json.loads((raw / "menu.json").read_text())
    topo = json.loads((RAW / "geo" / f"{cfg['kort']}.topojson").read_text())
    obj = topo["objects"][cfg["kort"]]
    geoms = [g for g in obj["geometries"] if "Nordsj" in g["properties"]["storkredsnavn"]]
    buer = ringe_abs(topo)

    # kortområder pr. (kreds, navn)
    kort_idx = {}
    for g in geoms:
        p = g["properties"]
        nøgle = (kredsnavn(p["opstillingskredsnavn"]), norm(p["navn"]))
        if nøgle in kort_idx:
            fejl(f"{kode}: dobbelt kortområde {nøgle}")
        kort_idx[nøgle] = g

    # kommune pr. valg.dk-område-id (kun FV26 har valg.dk's kommunemenu)
    kom_af_id = {}
    kf = raw / "kommuner.json"
    if kf.exists():
        for k in json.loads(kf.read_text()):
            for oid in k["omraader"]:
                kom_af_id[oid] = k["navn"].replace(" Kommune", "")

    områder, brugte = [], set()
    kredstal = {}
    la_kand_orden = []
    alle_idx = {}  # (partibogstav, navn) -> indeks i "kandidater"
    for kreds in menu["children"]:
        kn = kredsnavn(kreds["title"])
        kd = json.loads((raw / f"kreds_{kreds['id']}.json").read_text())
        kredstal[kn] = kd
        summer = defaultdict(int)
        for o in kreds["children"]:
            r = læs_område(raw / f"omr_{o['id']}.json")
            g = kort_idx.get((kn, norm(r["navn"])))
            if g is None:
                fejl(f"{kode}: intet kortområde for {kreds['title']} / {r['navn']}")
                continue
            brugte.add(id(g))
            p = g["properties"]
            kom = kom_af_id.get(o["id"]) or kommune_af_dagi.get(p["dagi_id"])
            kilde = "valg.dk" if o["id"] in kom_af_id else "dagi-id"
            if not kom:
                pt = indre_punkt(polygoner(g, buer))
                hits = [k for k, polys in kommune_polys.items() if i_polygon(pt, polys)]
                kom = hits[0] if len(hits) == 1 else None
                kilde = "kort"
                if not kom:
                    fejl(f"{kode}: ingen kommune for {r['navn']} ({hits})")
            for b, n in r["partier"].items():
                summer[b] += n
            la_kand = {navn: n for (b, navn), n in r["kandidater"].items() if b == LA}
            for (b, navn), n in r["kandidater"].items():
                if b == LA:
                    summer[("k", navn)] += n
            if not la_kand_orden:
                la_kand_orden = list(la_kand)
            for bn in r["kandidater"]:
                if bn not in alle_idx:
                    alle_idx[bn] = len(alle_idx)
            områder.append({
                "id": omr_id(p),
                "navn": r["navn"],
                "kreds": p["opstillingskredsnavn"],
                "kommune": kom,
                "kommune_kilde": kilde,
                "stemmested": r["stemmested"],
                "adresse": r["adresse"],
                "stemmeberettigede": r["stemmeberettigede"],
                "afgivne": r["afgivne"],
                "gyldige": r["gyldige"],
                "partier": r["partier"],
                "la": r["partier"].get(LA, 0),
                "la_partistemmer": r["la_partistemmer"],
                "la_kandidater": la_kand,
                "alle_kandidater": {alle_idx[bn]: n for bn, n in r["kandidater"].items() if n},
            })
        # kontrol mod valg.dk's kredstal
        for p in kd["partyDetailDto"]:
            b = parti_bogstav(p["partyWholeName"])
            if b and summer[b] != p["totalOfVotes"]:
                fejl(f"{kode} {kreds['title']}: parti {b} områdesum {summer[b]} ≠ kreds {p['totalOfVotes']}")
            if b == LA:
                for c in p["candidateDetailDtos"]:
                    if summer[("k", c["name"])] != c["candidateVotes"]:
                        fejl(f"{kode} {kreds['title']}: {c['name']} {summer[('k', c['name'])]} ≠ {c['candidateVotes']}")
    for g in geoms:
        if id(g) not in brugte:
            fejl(f"{kode}: kortområde uden resultat: {g['properties']['navn']}")

    # rækkefølge på kandidater: efter samlede personlige stemmer i storkredsen
    tot = defaultdict(int)
    for o in områder:
        for n, v in o["la_kandidater"].items():
            tot[n] += v
    kand = sorted(tot, key=lambda n: -tot[n])
    dst = dst_kandidater(kode)
    if set(dst) != set(kand):
        fejl(f"{kode}: kandidater hos DST {sorted(dst)} ≠ valg.dk {sorted(kand)}")
    for n in kand:
        if n in dst and dst[n]["personlige"] != tot[n]:
            fejl(f"{kode}: {n} har {tot[n]} personlige stemmer hos valg.dk, {dst[n]['personlige']} hos DST")

    # kortet: kun storkredsens geometrier; id = dagi_id
    ud_geoms = [{"type": g["type"], "arcs": g["arcs"], "id": omr_id(g["properties"]),
                 "properties": {"navn": g["properties"]["navn"]}} for g in geoms]
    (UD / f"kort_{kode}.json").write_text(json.dumps(beskaar_topologi(topo, "omr", ud_geoms), separators=(",", ":")))

    la = sum(o["la"] for o in områder)
    gyl = sum(o["gyldige"] for o in områder)
    print(f"{kode}: {len(områder)} områder, LA {la} af {gyl} gyldige ({la / gyl:.2%}); kandidater: {', '.join(f'{n} {tot[n]}' for n in kand)}")
    return {
        **{k: v for k, v in cfg.items() if k != "kort"},
        "kandidater": [[b, n] for (b, n) in alle_idx],
        "partinavne": partinavne(raw),
        "la_kandidater": [{"navn": n, "stemmer": tot[n], **{k: v for k, v in dst.get(n, {}).items() if k != "personlige"}}
                          for n in kand],
        "omraader": områder,
    }


def kobl_forrige(nu, før):
    """For hvert FV26-område: hvilke FV22-områder det dækker. Et FV22-område tilhører det
    FV26-område, der indeholder et indre punkt af det. Uændrede områder kobles 1:1;
    sammenlagte områder får flere forgængere, så ændringen måles på samme geografi."""
    def polys(kode):
        topo = json.loads((UD / f"kort_{kode}.json").read_text())
        b = ringe_abs(topo)
        return {g["id"]: polygoner(g, b) for g in topo["objects"]["omr"]["geometries"]}
    p_nu, p_før = polys("fv26"), polys("fv22")
    forgængere = defaultdict(list)
    for fid, pp in p_før.items():
        pt = indre_punkt(pp)
        hits = [nid for nid, np_ in p_nu.items() if i_polygon(pt, np_)]
        if len(hits) != 1:
            fejl(f"FV22-område {fid} ligger i {len(hits)} FV26-områder")
            continue
        forgængere[hits[0]].append(fid)
    før_af = {o["id"]: o for o in før["omraader"]}
    for o in nu["omraader"]:
        f = sorted(forgængere.get(o["id"], []), key=lambda i: i != o["id"])
        o["forrige"] = f
        if f and f != [o["id"]]:
            sb = sum(før_af[i]["stemmeberettigede"] for i in f)
            print(f"  {o['navn']}: sammenlignes med {[før_af[i]['navn'] for i in f]} "
                  f"(stemmeberettigede {sb} → {o['stemmeberettigede']})")


def main():
    # kommuner pr. DAGI-id fra FV26 (valg.dk's egen kommunemenu) til brug for FV22
    raw26 = RAW / "fv26"
    kom_af_id = {oid: k["navn"].replace(" Kommune", "")
                 for k in json.loads((raw26 / "kommuner.json").read_text()) for oid in k["omraader"]}
    topo26 = json.loads((RAW / "geo" / f"{VALG['fv26']['kort']}.topojson").read_text())
    menu26 = json.loads((raw26 / "menu.json").read_text())
    navn_til_id = {(kredsnavn(k["title"]), norm(json.loads((raw26 / f"omr_{o['id']}.json").read_text())["countStatusDto"]["name"])): o["id"]
                   for k in menu26["children"] for o in k["children"]}
    kommune_af_dagi = {}
    for g in topo26["objects"][VALG["fv26"]["kort"]]["geometries"]:
        p = g["properties"]
        oid = navn_til_id.get((kredsnavn(p["opstillingskredsnavn"]), norm(p["navn"])))
        if oid:
            kommune_af_dagi[p["dagi_id"]] = kom_af_id[oid]

    # kommunepolygoner (DAGI, KV25) til punkt-i-polygon for områder uden match
    tk = json.loads((RAW / "geo" / "kv25_kommuner_simpel.topojson").read_text())
    kb = ringe_abs(tk)
    kommuner = set(kom_af_id.values())
    kommune_polys = {g["properties"]["navn"]: polygoner(g, kb)
                     for g in tk["objects"]["kv25_kommuner_simpel"]["geometries"] if g["properties"]["navn"] in kommuner}

    ud = {
        "meta": {
            "bygget": date.today().isoformat(),
            "storkreds": "Nordsjællands Storkreds",
            "parti": "I. Liberal Alliance",
            "kilder": {
                "resultater": "valg.dk (KOMBIT/Netcompany), fintælling pr. afstemningsområde",
                "kandidater": "Danmarks Statistik, Valgte kandidater og stedfortrædere (kandstat)",
                "kort": "DAGI (Klimadatastyrelsen) via ValgTal's forenklede kort over afstemningsområder",
            },
        },
        "valg": {k: byg_valg(k, cfg, kommune_af_dagi, kommune_polys) for k, cfg in VALG.items()},
    }
    kobl_forrige(ud["valg"]["fv26"], ud["valg"]["fv22"])
    if FEJL:
        sys.exit(f"{len(FEJL)} fejl – intet skrevet til valg.json")
    (UD / "valg.json").write_text(json.dumps(ud, ensure_ascii=False, separators=(",", ":")))
    for k, v in ud["valg"].items():
        kilder = defaultdict(int)
        for o in v["omraader"]:
            kilder[o["kommune_kilde"]] += 1
        print(f"{k}: kommune fundet via {dict(kilder)}")
    print("OK – data/valg.json, data/kort_fv26.json, data/kort_fv22.json")


if __name__ == "__main__":
    main()
