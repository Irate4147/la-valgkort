'use strict';
/* Liberal Alliance ved folketingsvalgene – interaktivt valgkort for hele landet.
   Data: data/valg.json (scripts/byg.py) + data/kort_<valg>.json (TopoJSON).
   Niveauer: Danmark → storkreds → kommune (eller opstillingskreds) → afstemningsområde. */

const CONFIG = {
  basemap: 'https://tiles.openfreemap.org/styles/liberty',
  data: 'data/',
};
const LA = 'I';
const AAR = {fv26: '2026', fv22: '2022'};
const FORRIGE = {fv26: 'fv22'};

// Farver (dataviz-referencepaletten, samme som lau-kort). Sekventiel: én blå rampe, lys → mørk.
const BLAA = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const ANDEL_GRAENSER = [5, 7, 9, 11, 13, 16];             // pct. → 7 klasser
// Divergerende (ændring i pct.-point): rød ↔ grå midte ↔ blå, lige mange trin pr. arm.
const DIV = ['#b8302f', '#e8807f', '#f6c9c8', '#f0efec', '#cde2fb', '#6da7ec', '#256abf'];
const DIV_GRAENSER = [-3, -1.5, -0.5, 0.5, 1.5, 3];
// Kategorisk (største kandidat): fast rækkefølge, valideret for alle par (CVD ΔE ≥ 9,2).
const KAT = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'];
const ANDRE = '#898781';
const UAFGJORT = '#d9d7d0';
const INGEN = '#e1e0d9';

const FARVNINGER = [
  {id: 'andel', navn: 'LA-andel'},
  {id: 'aendring', navn: 'Ændring'},
  {id: 'top', navn: 'Største LA-kandidat', kraeverSk: true},
  {id: 'kandidat', navn: 'Én kandidat', kraeverSk: true},
];
const NIVEAUER = [
  {id: 'omr', navn: 'Afstemningsområder'},
  {id: 'kommune', navn: 'Kommuner'},
  {id: 'storkreds', navn: 'Storkredse'},
];
const GRUPPE_PREFIX = {kommune: 'k:', storkreds: 's:', kreds: 'o:'};

const S = {valg: 'fv26', farve: 'andel', kandidat: null, niveau: 'omr', sk: null, gruppe: null, omr: null, sort: 'andel'};
let D = null;            // valg.json
const E = {};            // forberedte data pr. valg
let MAP = null;
let hoverId = null;
const $ = (id) => document.getElementById(id);

// ---------- formatering ----------
const nf = new Intl.NumberFormat('da-DK');
const nf1 = new Intl.NumberFormat('da-DK', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const int = (n) => nf.format(n);
const pct = (x) => x == null || !isFinite(x) ? '–' : nf1.format(x) + ' %';
const pp = (x) => x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '±') + nf1.format(Math.abs(x)) + ' pct.-point';
const ppKort = (x) => x == null || !isFinite(x) ? '–' : (x > 0 ? '+' : x < 0 ? '−' : '±') + nf1.format(Math.abs(x));
const fortegn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + int(Math.abs(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const klasse = (v, graenser) => { let i = 0; while (i < graenser.length && v >= graenser[i]) i++; return i; };
const kortSk = (navn) => navn.replace(/s? Storkreds$/, '');   // "Nordsjællands Storkreds" → "Nordsjælland"

// ---------- data ----------
async function hentJson(f) {
  const r = await fetch(CONFIG.data + f);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.json();
}

function sum(omraader) {
  const a = {n: omraader.length, la: 0, gyldige: 0, afgivne: 0, stemmeberettigede: 0, la_partistemmer: 0, la_kandidater: {}, alle: {}, partier: {}};
  for (const o of omraader) {
    a.la += o.la; a.gyldige += o.gyldige; a.afgivne += o.afgivne;
    a.stemmeberettigede += o.stemmeberettigede; a.la_partistemmer += o.la_partistemmer;
    for (const [k, v] of Object.entries(o.la_kandidater)) a.la_kandidater[k] = (a.la_kandidater[k] || 0) + v;
    for (const [k, v] of Object.entries(o.alle_kandidater)) a.alle[k] = (a.alle[k] || 0) + v;
    for (const [k, v] of Object.entries(o.partier)) a.partier[k] = (a.partier[k] || 0) + v;
  }
  return a;
}

function forbered(kode, topo) {
  const v = D.valg[kode];
  const e = {kode, v, omr: new Map(), grupper: {storkreds: new Map(), kommune: new Map(), kreds: new Map()}};
  for (const o of v.omraader) {
    o.alle = o.alle_kandidater;
    e.omr.set(o.id, o);
    for (const type of ['storkreds', 'kommune', 'kreds']) {
      const navn = o[type];
      if (!e.grupper[type].has(navn)) e.grupper[type].set(navn, {type, navn, omraader: []});
      e.grupper[type].get(navn).omraader.push(o);
    }
  }
  for (const m of Object.values(e.grupper)) for (const g of m.values()) {
    Object.assign(g, sum(g.omraader));
    g.id = GRUPPE_PREFIX[g.type] + g.navn;
    g.storkredse = [...new Set(g.omraader.map((o) => o.storkreds))];
    g.kredse = [...new Set(g.omraader.map((o) => o.kreds))];
    g.kommuner = [...new Set(g.omraader.map((o) => o.kommune))];
  }
  e.total = sum(v.omraader);
  const obj = topo.objects.omr;
  e.features = topojson.feature(topo, obj).features;
  for (const f of e.features) f.properties = {id: f.id};
  const geomAf = new Map(obj.geometries.map((g) => [g.id, g]));
  const featAf = new Map(e.features.map((f) => [f.id, f]));
  // Kommuner/storkredse som sammenlagte områder – kun til omrids, navne og zoom. Den forenklede
  // topologi er ikke altid ren; giver sammenlægningen et forkert areal, bruges områderne direkte.
  const flet = (g) => {
    const dele = g.omraader.map((o) => featAf.get(o.id)).filter(Boolean);
    const delAreal = dele.reduce((t, f) => t + polyAreal(f.geometry), 0);
    let geom = rens(topojson.merge(topo, g.omraader.map((o) => geomAf.get(o.id)).filter(Boolean)));
    let omrids = null;
    // ugyldig sammenlægning: forkert areal, eller lange kanter, som ingen af områderne har
    const delKant = Math.max(...dele.map((f) => maxKant(f.geometry)));
    if (Math.abs(polyAreal(geom) / delAreal - 1) > 0.05 || maxKant(geom) > delKant * 1.01 || aabenRing(geom)) {
      geom = {type: 'MultiPolygon', coordinates: dele.flatMap((f) => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)};
      // omrids = gruppens ydre buer (mod naboer og kyst); små løkker fra huller i topologien droppes
      const ind = new Set(g.omraader.map((o) => o.id));
      const m = topojson.mesh(topo, obj, (a, b) => ind.has(a.id) !== ind.has(b.id) || (a === b && ind.has(a.id)));
      const laengde = (l) => l.slice(1).reduce((t, pt, i) => t + Math.hypot(pt[0] - l[i][0], pt[1] - l[i][1]), 0);
      omrids = {type: 'MultiLineString', coordinates: m.coordinates.filter((l) => laengde(l) > 0.1)};
    }
    return {type: 'Feature', id: g.id, properties: {id: g.id, navn: g.navn}, geometry: geom, omrids};
  };
  e.gruppeFeatures = {
    kommune: [...e.grupper.kommune.values()].map(flet),
    storkreds: [...e.grupper.storkreds.values()].map(flet),
  };
  e.featureAf = new Map([...e.features, ...e.gruppeFeatures.kommune, ...e.gruppeFeatures.storkreds].map((f) => [f.id, f]));
  // Grænser kun mellem nabo-områder (ydergrænser i den forenklede topologi giver splinter).
  const af = (g) => e.omr.get(g.id);
  e.skGraenser = topojson.mesh(topo, obj, (a, b) => a !== b && af(a).storkreds !== af(b).storkreds);
  e.komGraenser = topojson.mesh(topo, obj, (a, b) => a !== b && af(a).kommune !== af(b).kommune);
  e.kredsGraenser = topojson.mesh(topo, obj, (a, b) => a !== b && af(a).kreds !== af(b).kreds && af(a).kommune === af(b).kommune);
  const label = (f, navn) => ({type: 'Feature', properties: {navn}, geometry: {type: 'Point', coordinates: midtpunkt(f.geometry)}});
  e.skLabels = e.gruppeFeatures.storkreds.map((f) => label(f, kortSk(f.properties.navn)));
  e.komLabels = e.gruppeFeatures.kommune.map((f) => ({...label(f, f.properties.navn), sk: e.grupper.kommune.get(f.properties.navn).storkredse}));
  e.bbox = bbox(e.features.filter((f) => af(f).storkreds !== 'Bornholms Storkreds'));
  return e;
}

// Sammenligning med forrige valg: et område sammenlignes med de områder, det dækkede
// ved forrige valg ("forrige", beregnet geografisk i byg.py); grupper på navn.
const forrigeCache = new Map();
function forrigeAf(enhed) {
  const fk = FORRIGE[S.valg];
  if (!fk || !E[fk]) return null;
  if (enhed.type) return E[fk].grupper[enhed.type].get(enhed.navn) || null;
  if (!enhed.id) return E[fk].total;
  if (!enhed.forrige || !enhed.forrige.length) return null;
  if (!forrigeCache.has(enhed)) forrigeCache.set(enhed, sum(enhed.forrige.map((i) => E[fk].omr.get(i))));
  return forrigeCache.get(enhed);
}
const forrigeNavne = (o) => {
  const fk = FORRIGE[S.valg];
  return o.forrige && o.forrige.length > 1 ? o.forrige.map((i) => E[fk].omr.get(i).navn) : null;
};

// ---------- mål ----------
const andel = (u) => u && u.gyldige ? u.la / u.gyldige * 100 : null;
function aendring(u) {
  const f = forrigeAf(u);
  return f ? andel(u) - andel(f) : null;
}
function topKandidat(u) {
  const r = Object.entries(u.la_kandidater).sort((a, b) => b[1] - a[1]);
  if (!r.length || r[0][1] === 0) return {navn: null, stemmer: 0};
  const delt = r[0][1] === r[1]?.[1];
  return {navn: delt ? null : r[0][0], stemmer: r[0][1], delt: delt ? r.filter((x) => x[1] === r[0][1]).map((x) => x[0]) : null};
}
const kandAndel = (u, k) => u.la ? (u.la_kandidater[k] || 0) / u.la * 100 : null;
const iSk = (o) => !S.sk || o.storkreds === S.sk || (o.storkredse && o.storkredse.includes(S.sk));
const kandidaterISk = () => (S.sk && E[S.valg].v.la_kandidater[S.sk]) || [];

const KAND_FARVE = {};    // pr. valg og storkreds: kandidat → farve
function kandidatFarver() {
  // I hver storkreds får de fire LA-kandidater, der "vandt" flest områder ved hvert valg, en farve.
  // En kandidat beholder sin farve på tværs af valgene; ledige pladser fyldes efter antal vundne områder.
  for (const sk of Object.keys(D.valg.fv26.la_kandidater)) {
    const fast = new Map();
    for (const kode of Object.keys(E)) {
      const t = new Map();
      for (const o of E[kode].omr.values()) {
        if (o.storkreds !== sk) continue;
        const k = topKandidat(o).navn;
        if (k) t.set(k, (t.get(k) || 0) + 1);
      }
      const top = [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, KAT.length).map(([k]) => k);
      const m = new Map();
      for (const k of top) if (fast.has(k)) m.set(k, fast.get(k));
      for (const k of top) if (!m.has(k)) {
        const brugt = [...m.values()];
        const ledig = KAT.find((c) => !brugt.includes(c) && ![...fast.values()].includes(c)) || KAT.find((c) => !brugt.includes(c));
        m.set(k, ledig);
        if (!fast.has(k)) fast.set(k, ledig);
      }
      (KAND_FARVE[kode] ||= {})[sk] = new Map(top.map((k) => [k, m.get(k)]));
    }
  }
}
const kandFarve = (k) => k == null ? UAFGJORT : KAND_FARVE[S.valg]?.[S.sk]?.get(k) || ANDRE;

function kandSkala() {
  const omr = [...E[S.valg].omr.values()].filter((o) => o.storkreds === S.sk);
  const max = Math.max(0, ...omr.map((o) => kandAndel(o, S.kandidat) || 0));
  const trin = [0.5, 1, 2, 2.5, 3, 4, 5, 10].find((t) => t * 7 >= max) || 10;
  return {top: trin * 7, graenser: [1, 2, 3, 4, 5, 6].map((i) => i * trin)};
}

function farveAf(u, skala) {
  if (!u) return INGEN;
  switch (S.farve) {
    case 'andel': return BLAA[klasse(andel(u), ANDEL_GRAENSER)];
    case 'aendring': { const d = aendring(u); return d == null ? INGEN : DIV[klasse(d, DIV_GRAENSER)]; }
    case 'top': return iSk(u) ? kandFarve(topKandidat(u).navn) : INGEN;
    case 'kandidat': return iSk(u) ? BLAA[klasse(kandAndel(u, S.kandidat) ?? 0, skala.graenser)] : INGEN;
  }
  return INGEN;
}
const maalTekst = (u) => {
  switch (S.farve) {
    case 'andel': return pct(andel(u));
    case 'aendring': return ppKort(aendring(u));
    case 'top': { const t = topKandidat(u); return t.navn ? `${t.navn.split(' ')[0]} ${int(t.stemmer)}` : 'delt'; }
    case 'kandidat': return `${int(u.la_kandidater[S.kandidat] || 0)} · ${pct(kandAndel(u, S.kandidat))}`;
  }
};
const maalTal = (u) => {
  switch (S.farve) {
    case 'aendring': return aendring(u) ?? -Infinity;
    case 'kandidat': return u.la_kandidater[S.kandidat] || 0;
    case 'top': return topKandidat(u).stemmer;
    default: return andel(u);
  }
};

// ---------- geometri ----------
function bbox(features) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; return; }
    c.forEach(walk);
  };
  features.forEach((f) => walk(f.geometry.coordinates));
  return [[b[0], b[1]], [b[2], b[3]]];
}
function ringAreal(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a) / 2;
}
const polyAreal = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
  .reduce((t, p) => t + ringAreal(p[0]) - p.slice(1).reduce((u, h) => u + ringAreal(h), 0), 0);
const aabenRing = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
  .some((p) => p.some((r) => Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) > 1e-3));
function maxKant(geom) {
  let m = 0;
  for (const p of (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)) for (const r of p) {
    for (let i = 1; i < r.length; i++) m = Math.max(m, Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
  }
  return m;
}
function rens(geom) {
  // Sammenlægning af forenklede områder efterlader små huller/splinter langs de indre grænser – fjern dem.
  const MIN = 2e-6; // grader² (ca. 0,015 km²)
  const polys = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
    .map((p) => [p[0], ...p.slice(1).filter((h) => ringAreal(h) > MIN * 20)])
    .filter((p) => ringAreal(p[0]) > MIN);
  return {type: 'MultiPolygon', coordinates: polys};
}
function midtpunkt(geom) {
  // tyngdepunkt af den største delpolygons ydre ring
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const r = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}

// ---------- tilstand i adressen ----------
function laesHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  S.valg = p.get('valg') in D.valg ? p.get('valg') : Object.keys(D.valg)[0];
  S.farve = FARVNINGER.some((f) => f.id === p.get('farve')) ? p.get('farve') : 'andel';
  S.niveau = NIVEAUER.some((f) => f.id === p.get('niveau')) ? p.get('niveau') : 'omr';
  S.kandidat = p.get('kandidat') || null;
  const e = E[S.valg];
  S.sk = e.grupper.storkreds.has(p.get('sk')) ? p.get('sk') : null;
  S.gruppe = null; S.omr = null;
  for (const type of ['kommune', 'kreds']) if (p.get(type) && e.grupper[type].has(p.get(type))) S.gruppe = {type, navn: p.get(type)};
  if (p.get('omr') && e.omr.has(p.get('omr'))) {
    S.omr = p.get('omr');
    if (!S.gruppe) S.gruppe = {type: 'kommune', navn: e.omr.get(S.omr).kommune};
  }
  if (S.gruppe && !S.sk) S.sk = e.grupper[S.gruppe.type].get(S.gruppe.navn).storkredse[0];
  ret();
}
function skrivHash() {
  const p = new URLSearchParams();
  p.set('valg', S.valg);
  if (S.farve !== 'andel') p.set('farve', S.farve);
  if (S.farve === 'kandidat' && S.kandidat) p.set('kandidat', S.kandidat);
  if (S.niveau !== 'omr') p.set('niveau', S.niveau);
  if (S.sk) p.set('sk', S.sk);
  if (S.gruppe) p.set(S.gruppe.type, S.gruppe.navn);
  if (S.omr) p.set('omr', S.omr);
  history.replaceState(null, '', '#' + p.toString());
}
function ret() {
  // hold tilstanden konsistent: farvninger, der kræver en storkreds, og en gyldig kandidat
  if (S.farve === 'aendring' && !FORRIGE[S.valg]) S.farve = 'andel';
  if (!S.sk && FARVNINGER.find((f) => f.id === S.farve).kraeverSk) S.farve = 'andel';
  if (S.sk && S.niveau === 'storkreds') S.niveau = 'kommune';
  const navne = kandidaterISk().map((k) => k.navn);
  if (!navne.includes(S.kandidat)) S.kandidat = navne[0] || null;
}

// ---------- kort ----------
function initKort() {
  const e = E[S.valg];
  MAP = new maplibregl.Map({
    container: 'map', style: CONFIG.basemap, bounds: e.bbox,
    fitBoundsOptions: {padding: 40}, attributionControl: {compact: true},
  });
  MAP.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
  MAP.on('load', () => {
    const firstSymbol = MAP.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const tom = {type: 'FeatureCollection', features: []};
    for (const s of ['enheder', 'omr-linjer', 'sk-graenser', 'kom-graenser', 'kreds-graenser', 'labels', 'valgt']) {
      MAP.addSource(s, {type: 'geojson', data: tom, ...(s === 'enheder' ? {promoteId: 'id', tolerance: 0.1} : {})});
    }
    MAP.addLayer({id: 'fyld', type: 'fill', source: 'enheder', paint: {
      'fill-color': ['get', 'farve'], 'fill-outline-color': ['get', 'farve'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.92, ['get', 'opacitet']],
    }}, firstSymbol);
    MAP.addLayer({id: 'omr-linjer', type: 'line', source: 'omr-linjer', minzoom: 7.5, layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {
      'line-color': '#ffffff', 'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 1.4],
    }}, firstSymbol);
    MAP.addLayer({id: 'kreds-linjer', type: 'line', source: 'kreds-graenser', minzoom: 8.5, layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {
      'line-color': '#1f2937', 'line-opacity': 0.5, 'line-dasharray': [3, 2],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 1.6],
    }}, firstSymbol);
    MAP.addLayer({id: 'kom-linjer', type: 'line', source: 'kom-graenser', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {
      'line-color': '#334155', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 9, 0.85],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 1, 12, 2.4],
    }}, firstSymbol);
    MAP.addLayer({id: 'sk-linjer', type: 'line', source: 'sk-graenser', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {
      'line-color': '#0b0b0b', 'line-opacity': 0.8,
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 2.6],
    }}, firstSymbol);
    MAP.addLayer({id: 'hover-linje', type: 'line', source: 'enheder', filter: ['!', ['in', ':', ['get', 'id']]], layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {
      'line-color': '#0b0b0b', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0],
    }});
    MAP.addLayer({id: 'valgt-linje', type: 'line', source: 'valgt', layout: {'line-join': 'round', 'line-cap': 'round'}, paint: {'line-color': '#0b0b0b', 'line-width': 3}});
    MAP.addLayer({id: 'navne', type: 'symbol', source: 'labels', layout: {
      'text-field': ['upcase', ['get', 'navn']], 'text-font': ['Noto Sans Bold'], 'text-letter-spacing': 0.08,
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 11, 14], 'text-allow-overlap': false,
    }, paint: {'text-color': '#0b0b0b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8}});

    MAP.on('mousemove', 'fyld', (ev) => {
      const f = ev.features[0];
      setHover(f.id);
      MAP.getCanvas().style.cursor = 'pointer';
      visTooltip(ev.originalEvent, enhedAf(f.id));
    });
    MAP.on('mouseleave', 'fyld', () => { setHover(null); MAP.getCanvas().style.cursor = ''; skjulTooltip(); });
    MAP.on('click', (ev) => {
      const f = MAP.queryRenderedFeatures(ev.point, {layers: ['fyld']})[0];
      if (f) klikEnhed(f.id); else op();
    });
    tegn(true);
  });
}

function setHover(id) {
  if (hoverId != null) MAP.setFeatureState({source: 'enheder', id: hoverId}, {hover: false});
  hoverId = id;
  if (id != null && MAP.getSource('enheder')) MAP.setFeatureState({source: 'enheder', id}, {hover: true});
  document.querySelectorAll('ul.rank li[data-id]').forEach((li) => li.classList.toggle('hover', li.dataset.id === id));
}

function enhedAf(id) {
  const e = E[S.valg];
  for (const [type, pre] of Object.entries(GRUPPE_PREFIX)) if (String(id).startsWith(pre)) return e.grupper[type].get(id.slice(pre.length));
  return e.omr.get(id);
}

function klikEnhed(id) {
  const u = enhedAf(id);
  if (!u) return;
  if (u.type === 'storkreds') return vaelg(u.navn);
  if (u.type === 'kommune') return u.storkredse.includes(S.sk) ? vaelg(S.sk, 'kommune', u.navn) : vaelg(u.storkredse[0]);
  if (u.storkreds !== S.sk) return vaelg(u.storkreds);                    // Danmark → storkreds
  const g = S.gruppe;
  const iGruppe = g && (g.type === 'kommune' ? u.kommune === g.navn : u.kreds === g.navn);
  if (iGruppe) return vaelg(S.sk, g.type, g.navn, u.id);                 // inde i valgt kommune: åbn området
  vaelg(S.sk, 'kommune', u.kommune);                                    // ellers: åbn kommunen
}

function vaelg(sk, type = null, navn = null, omr = null) {
  $('sidebar').scrollTop = 0;
  S.sk = sk;
  S.gruppe = type ? {type, navn} : null;
  S.omr = omr;
  ret();
  tegn(true);
}
function op() {
  if (S.omr) vaelg(S.sk, S.gruppe.type, S.gruppe.navn);
  else if (S.gruppe) vaelg(S.sk);
  else if (S.sk) vaelg(null);
}

function kortData() {
  const e = E[S.valg];
  const skala = S.farve === 'kandidat' ? kandSkala() : null;
  const g = S.gruppe;
  const iGruppe = (o) => !g || (g.type === 'kommune' ? o.kommune === g.navn || (o.kommuner && o.kommuner.includes(g.navn)) : o.kreds === g.navn || (o.kredse && o.kredse.includes(g.navn)));
  const opacitet = (u, farve) => farve === INGEN ? 0.12 : !iSk(u) ? 0.22 : iGruppe(u) ? 0.82 : 0.4;
  // På kommune-/storkredsniveau bruges de sammenlagte polygoner; hvor sammenlægningen ikke er
  // gyldig, farves gruppens områder i stedet (med gruppens id, så hover og klik gælder hele gruppen).
  const egenskaber = (id) => {
    const u = enhedAf(id);
    const farve = farveAf(u, skala);
    return {id, farve, opacitet: opacitet(u, farve)};
  };
  let feats;
  if (S.niveau === 'omr') {
    feats = e.features.map((f) => ({type: 'Feature', geometry: f.geometry, properties: egenskaber(f.id)}));
  } else {
    const grupper = e.gruppeFeatures[S.niveau];
    const brudte = new Set(grupper.filter((f) => f.omrids).map((f) => f.id));
    feats = grupper.filter((f) => !brudte.has(f.id)).map((f) => ({type: 'Feature', geometry: f.geometry, properties: egenskaber(f.id)}));
    for (const f of e.features) {
      const id = GRUPPE_PREFIX[S.niveau] + e.omr.get(f.id)[S.niveau];
      if (brudte.has(id)) feats.push({type: 'Feature', geometry: f.geometry, properties: egenskaber(id)});
    }
  }
  return {feats, skala};
}

function tegn(zoom = false) {
  const e = E[S.valg];
  skrivHash();
  knapper();
  if (MAP && MAP.getSource('enheder')) {
    const {feats, skala} = kortData();
    MAP.getSource('enheder').setData({type: 'FeatureCollection', features: feats});
    MAP.getSource('omr-linjer').setData(S.niveau === 'omr' ? {type: 'FeatureCollection', features: e.features} : {type: 'FeatureCollection', features: []});
    MAP.getSource('sk-graenser').setData(e.skGraenser);
    MAP.getSource('kom-graenser').setData(e.komGraenser);
    MAP.getSource('kreds-graenser').setData(e.kredsGraenser);
    const labels = !S.sk ? e.skLabels : S.gruppe ? [] : e.komLabels.filter((l) => l.sk.includes(S.sk));
    MAP.getSource('labels').setData({type: 'FeatureCollection', features: labels});
    MAP.getSource('valgt').setData({type: 'FeatureCollection', features: valgtFeatures()});
    legende(skala);
    if (zoom) {
      const vf = valgtFeatures();
      const b = vf.length ? bbox(vf) : e.bbox;
      MAP.fitBounds(b, {padding: {top: 50, bottom: 110, left: 50, right: 50}, duration: 800, maxZoom: S.omr ? 13 : 12});
    }
  }
  sidepanel();
}

function valgtFeatures() {
  const e = E[S.valg];
  if (S.omr) return e.features.filter((f) => f.id === S.omr);
  if (S.gruppe) {
    if (S.gruppe.type === 'kommune') return [omrids(e.featureAf.get('k:' + S.gruppe.navn))];
    return e.features.filter((f) => e.omr.get(f.id).kreds === S.gruppe.navn);
  }
  if (S.sk) return [omrids(e.featureAf.get('s:' + S.sk))];
  return [];
}
const omrids = (f) => f.omrids ? {type: 'Feature', properties: {}, geometry: f.omrids} : f;

// ---------- tegnforklaring ----------
function legende(skala) {
  const el = $('legend');
  const steps = (farver, ticks, titel, note = '') => `<div class="lg-title">${titel}</div>
    <div class="lg-steps">${farver.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
    <div class="lg-ticks">${ticks.map((t) => `<span>${t}</span>`).join('')}</div>${note ? `<div class="lg-note">${note}</div>` : ''}`;
  const aar = AAR[S.valg];
  if (S.farve === 'andel') {
    el.innerHTML = steps(BLAA, ['', ...ANDEL_GRAENSER.map((g) => g + ' %')], `LA's andel af gyldige stemmer, ${aar}`);
  } else if (S.farve === 'aendring') {
    const fk = FORRIGE[S.valg];
    el.innerHTML = steps(DIV, ['', ...DIV_GRAENSER.map((g) => (g > 0 ? '+' : '') + nf1.format(g))], `Ændring i LA-andel ${AAR[fk]} → ${aar} (pct.-point)`,
      'Sammenlagte områder sammenlignes med summen af deres forgængere');
  } else if (S.farve === 'top') {
    const brugt = new Set([...E[S.valg].omr.values()].filter((o) => o.storkreds === S.sk).map((o) => topKandidat(o).navn));
    const farver = KAND_FARVE[S.valg]?.[S.sk] || new Map();
    const cats = [...farver.entries()].filter(([k]) => brugt.has(k)).map(([k, c]) => `<span><i class="swatch" style="background:${c}"></i>${esc(k)}</span>`);
    if ([...brugt].some((k) => k && !farver.has(k))) cats.push(`<span><i class="swatch" style="background:${ANDRE}"></i>Andre</span>`);
    if (brugt.has(null)) cats.push(`<span><i class="swatch" style="background:${UAFGJORT}"></i>Delt førsteplads</span>`);
    el.innerHTML = `<div class="lg-title">LA-kandidaten med flest personlige stemmer, ${esc(kortSk(S.sk))} ${aar}</div><div class="lg-cats">${cats.join('')}</div>`;
  } else {
    el.innerHTML = steps(BLAA, ['', ...skala.graenser.map((g) => nf.format(g) + ' %')],
      `${esc(S.kandidat)}: personlige stemmer i pct. af LA's stemmer, ${aar}`);
  }
}

// ---------- værktøjslinje ----------
function knapper() {
  const chip = (aktiv, tekst, data, disabled = false, title = '') =>
    `<button type="button" class="chip" aria-pressed="${aktiv}" ${data} ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${tekst}</button>`;
  $('valg-knapper').innerHTML = Object.keys(D.valg).map((k) => chip(S.valg === k, 'FV' + AAR[k].slice(2) + ' · ' + AAR[k], `data-valg="${k}"`)).join('');
  $('farve-knapper').innerHTML = FARVNINGER.map((f) => chip(S.farve === f.id, f.navn, `data-farve="${f.id}"`,
    (f.id === 'aendring' && !FORRIGE[S.valg]) || (f.kraeverSk && !S.sk), f.kraeverSk && !S.sk ? 'Vælg først en storkreds – kandidaterne er forskellige i hver storkreds' : '')).join('');
  $('niveau-knapper').innerHTML = NIVEAUER.map((n) => chip(S.niveau === n.id, n.navn, `data-niveau="${n.id}"`, n.id === 'storkreds' && !!S.sk)).join('');
  const skSel = $('sk-valg');
  skSel.innerHTML = `<option value="">Hele landet</option>` + [...E[S.valg].grupper.storkreds.keys()].sort((a, b) => a.localeCompare(b, 'da'))
    .map((n) => `<option value="${esc(n)}" ${n === S.sk ? 'selected' : ''}>${esc(kortSk(n))}</option>`).join('');
  const sel = $('kandidat-valg');
  sel.hidden = S.farve !== 'kandidat';
  sel.innerHTML = kandidaterISk().map((k) => `<option value="${esc(k.navn)}" ${k.navn === S.kandidat ? 'selected' : ''}>${esc(k.navn)} (${int(k.stemmer)})</option>`).join('');
}

function skiftValg(k) {
  S.valg = k;
  const e = E[k];
  if (S.omr && !e.omr.has(S.omr)) S.omr = null;
  if (S.gruppe && !e.grupper[S.gruppe.type].has(S.gruppe.navn)) { S.gruppe = null; S.omr = null; }
  ret();
  tegn(false);
}

// ---------- tooltip ----------
function visTooltip(ev, u) {
  if (!u) return;
  const t = $('tooltip');
  const navn = u.type === 'kommune' ? u.navn + ' Kommune' : u.navn;
  const under = u.type === 'storkreds' ? `${u.n} afstemningsområder · ${u.kommuner.length} kommuner`
    : u.type ? `${u.n} afstemningsområder · ${kortSk(u.storkredse[0])}` : `${u.kommune} Kommune · ${u.kreds} · ${kortSk(u.storkreds)}`;
  const top = topKandidat(u);
  const d = aendring(u);
  let rows = `<div class="tt-row"><span>LA</span><span>${int(u.la)} · <b style="display:inline">${pct(andel(u))}</b></span></div>`;
  if (FORRIGE[S.valg]) rows += `<div class="tt-row"><span>Siden ${AAR[FORRIGE[S.valg]]}</span><span>${d == null ? 'ikke sammenlignelig' : ppKort(d) + ' pct.-p.'}</span></div>`;
  if (u.type !== 'storkreds' || true) rows += `<div class="tt-row"><span>Flest pers. stemmer</span><span>${top.navn ? esc(top.navn) + ' (' + int(top.stemmer) + ')' : top.delt ? 'delt: ' + esc(top.delt.slice(0, 3).join(', ')) + ' (' + int(top.stemmer) + ')' : '–'}</span></div>`;
  if (S.farve === 'kandidat' && iSk(u)) rows += `<div class="tt-row"><span>${esc(S.kandidat)}</span><span>${int(u.la_kandidater[S.kandidat] || 0)} · ${pct(kandAndel(u, S.kandidat))} af LA</span></div>`;
  t.innerHTML = `<b>${esc(navn)}</b><div class="muted">${esc(under)}</div>${rows}`;
  t.hidden = false;
  const x = Math.min(ev.clientX + 14, innerWidth - t.offsetWidth - 8);
  const y = Math.min(ev.clientY + 14, innerHeight - t.offsetHeight - 8);
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function skjulTooltip() { $('tooltip').hidden = true; }

// ---------- sidepanel ----------
function sidepanel() {
  const e = E[S.valg];
  const c = [];
  const led = (tekst, nav, aktiv) => aktiv ? `<span class="cur">${esc(tekst)}</span>` : `<button type="button" data-nav="${nav}">${esc(tekst)}</button>`;
  c.push(led('Danmark', 'top', !S.sk));
  if (S.sk) c.push(led(S.sk, 'sk', !S.gruppe));
  if (S.gruppe) c.push(led(S.gruppe.type === 'kommune' ? S.gruppe.navn + ' Kommune' : S.gruppe.navn + ' (opstillingskreds)', 'gruppe', !S.omr));
  if (S.omr) c.push(led(e.omr.get(S.omr).navn, '', true));
  $('crumbs').innerHTML = c.join('<span class="sep">›</span>');

  let html;
  if (S.omr) html = visOmraade(e.omr.get(S.omr));
  else if (S.gruppe) html = visGruppe(e.grupper[S.gruppe.type].get(S.gruppe.navn));
  else if (S.sk) html = visStorkreds(e.grupper.storkreds.get(S.sk));
  else html = visDanmark();
  $('side-body').innerHTML = html;
}

function tiles(u, ekstra = '') {
  const f = forrigeAf(u);
  const fk = FORRIGE[S.valg];
  const delta = f
    ? `<div class="delta"><span class="${andel(u) - andel(f) >= 0 ? 'up' : 'down'}">${pp(andel(u) - andel(f))}</span> · ${fortegn(u.la - f.la)} stemmer siden ${AAR[fk]}</div>`
    : fk ? `<div class="delta">Området fandtes ikke i samme form i ${AAR[fk]}</div>` : '';
  const sammen = u.id && !u.type && f && forrigeNavne(u) ? `<div class="delta">Sammenlignet med ${AAR[fk]}-områderne ${esc(forrigeNavne(u).join(' + '))}</div>` : '';
  return `<div class="tiles">
    <div class="tile wide"><div class="label">LA's stemmer · FV${AAR[S.valg].slice(2)}</div>
      <div class="value hero">${pct(andel(u))}</div>
      <div class="delta">${int(u.la)} af ${int(u.gyldige)} gyldige stemmer</div>${delta}${sammen}</div>
    <div class="tile"><div class="label">Personlige stemmer på LA-kandidater</div>
      <div class="value">${int(u.la - u.la_partistemmer)}</div>
      <div class="delta">${pct((u.la - u.la_partistemmer) / u.la * 100)} af LA's stemmer</div></div>
    <div class="tile"><div class="label">Valgdeltagelse</div>
      <div class="value">${pct(u.afgivne / u.stemmeberettigede * 100)}</div>
      <div class="delta">${int(u.stemmeberettigede)} stemmeberettigede</div></div>
    ${ekstra}
  </div>`;
}

function kandidatBars(u, sk, {klik = true, meta = true} = {}) {
  const info = new Map((E[S.valg].v.la_kandidater[sk] || []).map((k) => [k.navn, k]));
  const r = Object.entries(u.la_kandidater).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...r.map((x) => x[1]));
  const rows = r.map(([navn, n]) => {
    const k = info.get(navn) || {};
    const badges = (k.valgt ? `<span class="badge valgt">Valgt</span>` : '') + (k.stedfortraeder ? `<span class="badge stedf">Stedf. ${esc(k.stedfortraeder)}</span>` : '');
    const prio = k.prioriteret_i ? (k.prioriteret_i === 'Alle' ? 'Prioriteret i alle kredse' : 'Prioriteret i kreds ' + k.prioriteret_i.replace(/,/g, ', ')) : '';
    const valgt = S.farve === 'kandidat' && S.kandidat === navn;
    return `<li class="${klik ? 'klik' : ''} ${valgt ? 'valgt' : ''}" ${klik ? `tabindex="0" data-kandidat="${esc(navn)}"` : ''}>
      <div class="row"><span class="name">${S.farve === 'top' ? `<i class="swatch" style="background:${kandFarve(navn)}"></i>` : ''}<span class="txt">${esc(navn)}</span>${badges}</span>
      <span class="val">${int(n)} · ${pct(n / u.la * 100)}</span></div>
      <div class="track"><div class="fill" style="width:${n / max * 100}%"></div></div>
      ${meta && prio ? `<div class="meta">${prio}</div>` : ''}</li>`;
  }).join('');
  return `<ul class="bars">${rows}</ul>
    <p class="note">Pct. = andel af LA's ${int(u.la)} stemmer. ${int(u.la_partistemmer)} (${pct(u.la_partistemmer / u.la * 100)}) var partistemmer.${klik ? ' Klik på en kandidat for at farve kortet efter vedkommendes stemmer.' : ''}</p>`;
}

function alleTop(u, n = 5) {
  const v = E[S.valg].v;
  const r = Object.entries(u.alle).sort((a, b) => b[1] - a[1]).slice(0, n);
  const max = r.length ? r[0][1] : 1;
  return `<ul class="bars">${r.map(([i, s]) => {
    const [b, navn] = v.kandidater[i];
    return `<li><div class="row"><span class="name"><span class="parti ${b === LA ? 'la' : ''}" title="${esc(v.partinavne[b] || 'Uden for partierne')}">${esc(b)}</span><span class="txt">${esc(navn)}</span></span>
      <span class="val">${int(s)}</span></div><div class="track"><div class="fill alt" style="width:${s / max * 100}%"></div></div></li>`;
  }).join('')}</ul>`;
}

function rangliste(enheder, {sub = () => '', sortering = true, max = Infinity} = {}) {
  const sorter = {
    andel: (a, b) => andel(b) - andel(a),
    stemmer: (a, b) => b.la - a.la,
    maal: (a, b) => maalTal(b) - maalTal(a),
    navn: (a, b) => a.navn.localeCompare(b.navn, 'da'),
  };
  const s = sorter[S.sort] || sorter.andel;
  const skala = S.farve === 'kandidat' ? kandSkala() : null;
  const alle = [...enheder].sort(s);
  const li = alle.slice(0, max).map((u) => `<li tabindex="0" data-id="${esc(u.id)}">
    <span class="dot" style="background:${farveAf(u, skala)}"></span><span class="name">${esc(u.type === 'storkreds' ? kortSk(u.navn) : u.navn)}</span>
    <span class="val">${S.farve === 'andel' ? pct(andel(u)) : pct(andel(u)) + ' · ' + maalTekst(u)}</span>
    <span class="sub">${sub(u)}</span></li>`).join('');
  const valg = sortering ? `<label class="sort">Sortér efter <select data-sort>
      ${[['andel', 'LA-andel'], ['stemmer', 'LA-stemmer'], ...(S.farve !== 'andel' ? [['maal', FARVNINGER.find((f) => f.id === S.farve).navn]] : []), ['navn', 'Navn']]
        .map(([k, t]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${t}</option>`).join('')}
    </select></label>` : '';
  const mere = alle.length > max ? `<p class="note">Viser ${max} af ${alle.length}.</p>` : '';
  return valg + `<ul class="rank">${li}</ul>` + mere;
}

function topSub(u) {
  const t = topKandidat(u);
  return `${int(u.la)} stemmer · flest: ${t.navn ? esc(t.navn) + ' (' + int(t.stemmer) + ')' : t.delt ? 'delt (' + int(t.stemmer) + ')' : '–'}`;
}

function kandidatSektion(enheder, overskrift) {
  if (S.farve !== 'kandidat' || !S.kandidat) return '';
  const k = S.kandidat;
  const skala = kandSkala();
  const r = [...enheder].sort((a, b) => (b.la_kandidater[k] || 0) - (a.la_kandidater[k] || 0)).slice(0, 10);
  return `<h2>${overskrift.replace('%k', esc(k))}</h2>
    <ul class="rank">${r.map((o) => `<li tabindex="0" data-id="${esc(o.id)}"><span class="dot" style="background:${farveAf(o, skala)}"></span>
      <span class="name">${esc(o.navn)}</span><span class="val">${int(o.la_kandidater[k] || 0)}</span>
      <span class="sub">${esc(o.kommune)} · ${pct(kandAndel(o, k))} af LA's stemmer</span></li>`).join('')}</ul>`;
}

function visDanmark() {
  const e = E[S.valg];
  const valgte = Object.entries(e.v.la_kandidater).flatMap(([sk, l]) => l.filter((k) => k.valgt).map((k) => ({...k, sk})))
    .sort((a, b) => b.stemmer - a.stemmer);
  const ekstra = `<div class="tile wide"><div class="label">Valgte LA-kandidater</div>
    <div class="value">${valgte.length}</div><div class="delta">Kilde: Danmarks Statistik, kandstat</div></div>`;
  const valgteListe = `<ul class="bars">${valgte.map((k) => `<li class="klik" tabindex="0" data-sk-kandidat="${esc(k.sk)}|${esc(k.navn)}">
      <div class="row"><span class="name"><span class="txt">${esc(k.navn)}</span></span><span class="val">${int(k.stemmer)}</span></div>
      <div class="meta">${esc(kortSk(k.sk))}${k.valgt.includes('T') ? ' · tillægsmandat' : k.valgt.includes('K') ? ' · kredsmandat' : ''}</div></li>`).join('')}</ul>
    <p class="note">Personlige stemmer i storkredsen. Klik for at se kandidatens stemmer på kortet.</p>`;
  return `<p class="sub-head">${esc(e.v.navn)} · ${e.omr.size} afstemningsområder · ${e.grupper.kommune.size} kommuner · ${e.grupper.storkreds.size} storkredse</p>
    ${tiles(e.total, ekstra)}
    <h2>Storkredse</h2>
    ${rangliste(e.grupper.storkreds.values(), {sub: (u) => `${int(u.la)} stemmer · ${u.kommuner.length} ${u.kommuner.length === 1 ? 'kommune' : 'kommuner'}`})}
    <h2>Valgte LA-kandidater</h2>
    ${valgteListe}
    <h2>Kommuner</h2>
    ${rangliste(e.grupper.kommune.values(), {sub: (u) => `${int(u.la)} stemmer · ${esc(kortSk(u.storkredse[0]))}`, sortering: false, max: 25})}`;
}

function visStorkreds(g) {
  const e = E[S.valg];
  const alle = [...e.grupper.storkreds.values()].sort((a, b) => andel(b) - andel(a));
  const valgte = (e.v.la_kandidater[g.navn] || []).filter((k) => k.valgt);
  const ekstra = `<div class="tile wide"><div class="label">Valgt for LA i storkredsen</div>
    <div class="value" style="font-size:17px">${valgte.length ? valgte.map((k) => esc(k.navn)).join(', ') : 'Ingen'}</div>
    <div class="delta">${alle.indexOf(g) + 1}. højeste LA-andel af ${alle.length} storkredse · landet: ${pct(andel(e.total))}</div></div>`;
  const kredse = [...e.grupper.kreds.values()].filter((k) => k.storkredse.includes(g.navn));
  const kommuner = [...e.grupper.kommune.values()].filter((k) => k.storkredse.includes(g.navn));
  return `<h2 class="navn">${esc(g.navn)}</h2>
    <p class="sub-head">${g.n} afstemningsområder · ${kommuner.length} kommuner · ${kredse.length} opstillingskredse</p>
    ${tiles(g, ekstra)}
    <h2>LA-kandidaternes personlige stemmer</h2>
    ${kandidatBars(g, g.navn)}
    ${kandidatSektion(g.omraader, 'Hvor fik %k flest stemmer?')}
    <h2>Kommuner</h2>
    ${rangliste(kommuner, {sub: topSub})}
    <h2>Opstillingskredse</h2>
    ${rangliste(kredse, {sub: (u) => esc(u.kommuner.join(', ')), sortering: false})}`;
}

function visGruppe(g) {
  const e = E[S.valg];
  const alle = [...e.grupper[g.type].values()].filter((x) => x.storkredse.includes(S.sk)).sort((a, b) => andel(b) - andel(a));
  const rang = alle.indexOf(g) + 1;
  const titel = g.type === 'kommune' ? g.navn + ' Kommune' : g.navn;
  const under = g.type === 'kommune' ? `Opstillingskreds: ${g.kredse.join(', ')}` : `Opstillingskreds med ${g.kommuner.join(' og ')} Kommune`;
  const skg = e.grupper.storkreds.get(S.sk);
  const ekstra = `<div class="tile wide"><div class="label">Placering blandt ${alle.length} ${g.type === 'kommune' ? 'kommuner' : 'opstillingskredse'} i storkredsen (LA-andel)</div>
    <div class="value">${rang}. plads</div><div class="delta">${esc(kortSk(S.sk))}: ${pct(andel(skg))} · landet: ${pct(andel(e.total))}</div></div>`;
  return `<h2 class="navn">${esc(titel)}</h2><p class="sub-head">${esc(under)} · ${g.n} afstemningsområder</p>
    ${tiles(g, ekstra)}
    <h2>LA-kandidater – personlige stemmer</h2>
    ${kandidatBars(g, S.sk)}
    <h2>Flest personlige stemmer – alle partier</h2>
    ${alleTop(g)}
    ${kandidatSektion(g.omraader, 'Hvor i ' + esc(g.navn) + ' fik %k flest stemmer?')}
    <h2>Afstemningsområder</h2>
    ${rangliste(g.omraader, {sub: topSub})}`;
}

function visOmraade(o) {
  const e = E[S.valg];
  const kom = e.grupper.kommune.get(o.kommune);
  const skg = e.grupper.storkreds.get(o.storkreds);
  const iKom = [...kom.omraader].sort((a, b) => andel(b) - andel(a)).indexOf(o) + 1;
  const iSkR = [...skg.omraader].sort((a, b) => andel(b) - andel(a)).indexOf(o) + 1;
  const ekstra = `<div class="tile wide"><div class="label">Placering (LA-andel)</div>
    <div class="value" style="font-size:17px">${iKom}. af ${kom.n} i kommunen · ${iSkR}. af ${skg.n} i storkredsen</div>
    <div class="delta">${esc(o.kommune)}: ${pct(andel(kom))} · ${esc(kortSk(o.storkreds))}: ${pct(andel(skg))}</div></div>`;
  return `<h2 class="navn">${esc(o.navn)}</h2>
    <p class="sub-head">${esc(o.kommune)} Kommune · ${esc(o.kreds)}</p>
    <dl class="stamdata"><dt>Stemmested</dt><dd>${esc(o.stemmested || '–')}</dd><dt>Adresse</dt><dd>${esc(o.adresse || '–')}</dd></dl>
    ${tiles(o, ekstra)}
    <h2>LA-kandidater – personlige stemmer</h2>
    ${kandidatBars(o, o.storkreds, {meta: false})}
    <h2>Flest personlige stemmer – alle partier</h2>
    ${alleTop(o)}`;
}

// ---------- hændelser ----------
function haendelser() {
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-valg],[data-farve],[data-niveau],[data-nav],[data-kandidat],[data-sk-kandidat],ul.rank li[data-id]');
    if (!b || b.disabled) return;
    if (b.dataset.valg) return skiftValg(b.dataset.valg);
    if (b.dataset.farve) { S.farve = b.dataset.farve; ret(); return tegn(false); }
    if (b.dataset.niveau) { S.niveau = b.dataset.niveau; return tegn(false); }
    if (b.dataset.nav === 'top') return vaelg(null);
    if (b.dataset.nav === 'sk') return vaelg(S.sk);
    if (b.dataset.nav === 'gruppe') return vaelg(S.sk, S.gruppe.type, S.gruppe.navn);
    if (b.dataset.kandidat) { S.farve = 'kandidat'; S.kandidat = b.dataset.kandidat; ret(); return tegn(false); }
    if (b.dataset.skKandidat) {
      const [sk, navn] = b.dataset.skKandidat.split('|');
      S.farve = 'kandidat'; S.kandidat = navn;
      return vaelg(sk);
    }
    if (b.dataset.id) {
      const u = enhedAf(b.dataset.id);
      if (!u) return;
      if (u.type === 'storkreds') return vaelg(u.navn);
      if (u.type) return vaelg(S.sk && u.storkredse.includes(S.sk) ? S.sk : u.storkredse[0], u.type, u.navn);
      const g = S.gruppe && (S.gruppe.type === 'kommune' ? u.kommune === S.gruppe.navn : u.kreds === S.gruppe.navn) ? S.gruppe : {type: 'kommune', navn: u.kommune};
      return vaelg(u.storkreds, g.type, g.navn, u.id);
    }
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('ul.rank li[data-id], .bars li[data-kandidat], .bars li[data-sk-kandidat]')) { ev.preventDefault(); ev.target.click(); }
    if (ev.key === 'Escape' && !ev.target.matches('select')) op();
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'kandidat-valg') { S.kandidat = ev.target.value; tegn(false); }
    if (ev.target.id === 'sk-valg') vaelg(ev.target.value || null);
    if (ev.target.matches('[data-sort]')) { S.sort = ev.target.value; sidepanel(); }
  });
  // hover i listerne fremhæver enheden på kortet (når den er tegnet på det aktuelle niveau)
  $('side-body').addEventListener('mouseover', (ev) => {
    const li = ev.target.closest('ul.rank li[data-id]');
    if (!li || !MAP) return;
    if (MAP.getSource('enheder') && enhedAf(li.dataset.id)) {
      const u = enhedAf(li.dataset.id);
      if ((u.type || 'omr') === S.niveau) setHover(li.dataset.id);
    }
  });
  $('side-body').addEventListener('mouseleave', () => MAP && setHover(null));
  addEventListener('hashchange', () => { laesHash(); tegn(true); });
}

async function main() {
  try {
    D = await hentJson('valg.json');
    const koder = Object.keys(D.valg);
    const topo = await Promise.all(koder.map((k) => hentJson(`kort_${k}.json`)));
    koder.forEach((k, i) => { E[k] = forbered(k, topo[i]); });
    kandidatFarver();
    laesHash();
    $('updated').textContent = `Liberal Alliances stemmer ved folketingsvalgene ${koder.map((k) => AAR[k]).reverse().join(' og ')} – hele landet, ned på afstemningsområde`;
    $('method').innerHTML = `<b>Kilder.</b> Stemmetal: valg.dk (fintælling pr. afstemningsområde). Valgte og stedfortrædere samt prioriterede kredse: Danmarks Statistik, kandstat. Kort: DAGI (Klimadatastyrelsen), forenklet af ValgTal. Alle tal er summeret fra afstemningsområderne og kontrolleret mod valg.dk's kredstal og DST's kandidattal. Data bygget ${esc(D.meta.bygget)}.<br>
      <b>Læsevejledning.</b> Ved sideordnet opstilling står alle LA's kandidater på stemmesedlen i hele storkredsen, men en kandidat, der er <i>prioriteret</i> i en kreds, står øverst dér – det giver typisk flere personlige stemmer i den kreds. Kandidaterne er forskellige i hver storkreds, så "Største LA-kandidat" og "Én kandidat" kræver, at en storkreds er valgt. Ændringer måles mod de områder, der dækkede samme geografi ved forrige valg. Færøerne og Grønland er ikke med.`;
    haendelser();
    knapper();
    sidepanel();
    initKort();
  } catch (err) {
    $('side-body').innerHTML = `<p class="empty">Kunne ikke indlæse data: ${esc(err.message)}</p>`;
    console.error(err);
  }
}
document.addEventListener('DOMContentLoaded', main);
