/**
 * Camada da última inundação em Campo Bom (KMZ fornecido pela Prefeitura).
 *
 * O arquivo é um KMZ (ZIP contendo doc.kml) hospedado no Google Drive.
 * Fluxo: download (com cadeia de proxies CORS) → unzip (fflate) →
 * KML → GeoJSON → renderização no Leaflet.
 *
 * O resultado é cacheado em localStorage para carregar instantaneamente
 * nas próximas visitas e continuar funcionando se o Drive estiver fora.
 *
 * Também expõe `isInFloodZone(lat, lon)`, base para o cruzamento futuro
 * entre a geolocalização do usuário e a mancha de inundação.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { embeddedKml, JUN2024_COORDS } from './floodData';

export interface FloodLayerMeta {
  key: string;
  driveId: string;
  title: string;
  short: string;
  source: string;
  /** cor padrão caso o KML não traga estilo */
  color: string;
  /** entra no cálculo de área de risco do usuário */
  risk: boolean;
  driveUrl: string;
  /** geometria embarcada no bundle (garante disponibilidade offline) */
  embedded?: string;
}

/**
 * Camada única: a mancha da grande inundação de 2024, com a geometria
 * embarcada no bundle — sempre disponível, sem depender do Google Drive.
 */
export const FLOOD_LAYERS: FloodLayerMeta[] = [
  {
    key: 'jun2024',
    driveId: '11gWP5134EXQ5ddV1SwJywkrgzURvVbtf',
    title: 'Mancha da grande inundação de 2024 — Campo Bom',
    short: 'Mancha da inundação de 2024',
    source: 'Prefeitura Municipal de Campo Bom',
    color: '#f97316',
    risk: true,
    driveUrl: 'https://drive.google.com/file/d/11gWP5134EXQ5ddV1SwJywkrgzURvVbtf/view',
    embedded: embeddedKml('Mancha da grande inundação de 2024 — Campo Bom', JUN2024_COORDS),
  },
];

export const FLOOD_META = FLOOD_LAYERS[0];

const downloadUrl = (id: string) =>
  `https://drive.usercontent.google.com/download?id=${id}&export=download`;

const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 dias

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type Ring = [number, number][]; // [lon, lat]

export interface FloodFeature {
  name: string;
  description: string;
  type: 'Polygon' | 'LineString' | 'Point';
  /** Polygon: [anel externo, ...furos]; LineString: [linha]; Point: [[pt]] */
  rings: Ring[];
  /** cor extraída do estilo KML (#rrggbb), se houver */
  color?: string;
}

export interface FloodData {
  meta: FloodLayerMeta;
  /** de onde veio a geometria atualmente exibida */
  origin?: 'rede' | 'cache' | 'embutida';
  features: FloodFeature[];
  geojson: GeoJSON.FeatureCollection;
  bounds: [[number, number], [number, number]] | null; // [[sul,oeste],[norte,leste]]
  polygonCount: number;
  fetchedAt: number;
}

/** União das camadas carregadas. */
export interface FloodSet {
  layers: FloodData[];
  bounds: [[number, number], [number, number]] | null;
  fetchedAt: number;
}

/* ------------------------------------------------------------------ */
/* Download + unzip                                                    */
/* ------------------------------------------------------------------ */

const PROXIES: ((u: string) => string)[] = [
  (u) => u,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
];

async function fetchBuffer(url: string, timeoutMs = 25000): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/** Extrai o primeiro .kml de dentro de um KMZ; se já for KML, devolve o texto. */
function extractKml(buf: Uint8Array): string {
  // "PK\x03\x04" => ZIP/KMZ
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (!isZip) {
    const txt = strFromU8(buf);
    if (txt.includes('<kml') || txt.includes('<Placemark')) return txt;
    throw new Error('arquivo não é KML nem KMZ');
  }
  const files = unzipSync(buf);
  const name =
    Object.keys(files).find((n) => n.toLowerCase().endsWith('doc.kml')) ??
    Object.keys(files).find((n) => n.toLowerCase().endsWith('.kml'));
  if (!name) throw new Error('KMZ sem arquivo .kml');
  return strFromU8(files[name]);
}

/* ------------------------------------------------------------------ */
/* KML -> GeoJSON                                                      */
/* ------------------------------------------------------------------ */

/** "lon,lat,alt lon,lat,alt ..." -> [[lon,lat], ...] */
function parseCoords(raw: string | null | undefined): Ring {
  if (!raw) return [];
  const out: Ring = [];
  for (const tok of raw.trim().split(/\s+/)) {
    const parts = tok.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

/** aabbggrr (KML) -> #rrggbb */
function kmlColor(abgr: string | null | undefined): string | undefined {
  if (!abgr) return undefined;
  const s = abgr.trim().replace('#', '');
  if (s.length < 8) return undefined;
  return `#${s.slice(6, 8)}${s.slice(4, 6)}${s.slice(2, 4)}`;
}

function text(el: Element | null, tag: string): string {
  if (!el) return '';
  const n = el.getElementsByTagName(tag);
  return n.length ? (n[0].textContent || '').trim() : '';
}

export function kmlToFeatures(kml: string): FloodFeature[] {
  const doc = new DOMParser().parseFromString(kml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('KML inválido');

  // mapa de estilos (id -> cor de preenchimento/linha)
  const styleColor = new Map<string, string>();
  for (const st of Array.from(doc.getElementsByTagName('Style'))) {
    const id = st.getAttribute('id');
    if (!id) continue;
    const poly = st.getElementsByTagName('PolyStyle')[0];
    const line = st.getElementsByTagName('LineStyle')[0];
    const c = kmlColor(text(poly, 'color')) ?? kmlColor(text(line, 'color'));
    if (c) styleColor.set(`#${id}`, c);
  }

  const out: FloodFeature[] = [];

  for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
    const name = text(pm, 'name');
    const description = text(pm, 'description');
    const styleUrl = text(pm, 'styleUrl');
    const color = styleColor.get(styleUrl);

    // polígonos (inclui os que estão dentro de MultiGeometry)
    for (const poly of Array.from(pm.getElementsByTagName('Polygon'))) {
      const rings: Ring[] = [];
      const outer = poly.getElementsByTagName('outerBoundaryIs')[0];
      const outerRing = parseCoords(text(outer, 'coordinates'));
      if (outerRing.length >= 3) rings.push(outerRing);
      for (const inner of Array.from(poly.getElementsByTagName('innerBoundaryIs'))) {
        const r = parseCoords(text(inner, 'coordinates'));
        if (r.length >= 3) rings.push(r);
      }
      if (rings.length) out.push({ name, description, type: 'Polygon', rings, color });
    }

    // linhas soltas
    for (const ls of Array.from(pm.getElementsByTagName('LineString'))) {
      const r = parseCoords(text(ls, 'coordinates'));
      if (r.length >= 2) out.push({ name, description, type: 'LineString', rings: [r], color });
    }

    // pontos (só quando o Placemark não tem geometria de área)
    if (!pm.getElementsByTagName('Polygon').length && !pm.getElementsByTagName('LineString').length) {
      for (const pt of Array.from(pm.getElementsByTagName('Point'))) {
        const r = parseCoords(text(pt, 'coordinates'));
        if (r.length) out.push({ name, description, type: 'Point', rings: [r], color });
      }
    }
  }

  return out;
}

function toGeoJson(features: FloodFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature' as const,
      properties: { name: f.name, description: f.description, color: f.color },
      geometry:
        f.type === 'Polygon'
          ? { type: 'Polygon' as const, coordinates: f.rings }
          : f.type === 'LineString'
            ? { type: 'LineString' as const, coordinates: f.rings[0] }
            : { type: 'Point' as const, coordinates: f.rings[0][0] },
    })),
  } as GeoJSON.FeatureCollection;
}

function computeBounds(features: FloodFeature[]): FloodData['bounds'] {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  let any = false;
  for (const f of features) {
    for (const ring of f.rings) {
      for (const [lon, lat] of ring) {
        any = true;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }
  return any ? [[minLat, minLon], [maxLat, maxLon]] : null;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

function build(kml: string, meta: FloodLayerMeta): FloodData {
  const features = kmlToFeatures(kml);
  if (!features.length) throw new Error('KML sem geometrias');
  return {
    meta,
    features,
    geojson: toGeoJson(features),
    bounds: computeBounds(features),
    polygonCount: features.filter((f) => f.type === 'Polygon').length,
    fetchedAt: Date.now(),
  };
}

const cacheKey = (k: string) => `cb-flood-${k}-v2`;

function readCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const { kml, at } = JSON.parse(raw);
    if (!kml || Date.now() - at > CACHE_TTL) return null;
    return kml as string;
  } catch {
    return null;
  }
}

function writeCache(key: string, kml: string) {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify({ kml, at: Date.now() }));
  } catch {
    /* cota cheia — ignora */
  }
}

/** Resolve a camada instantaneamente: cache local → cópia embarcada. */
export function loadFloodLayerSync(meta: FloodLayerMeta): FloodData | null {
  const cached = readCache(meta.key);
  if (cached) {
    try {
      return { ...build(cached, meta), origin: 'cache' };
    } catch {
      /* segue */
    }
  }
  if (meta.embedded) {
    try {
      return { ...build(meta.embedded, meta), origin: 'embutida' };
    } catch {
      /* segue */
    }
  }
  return null;
}

/** Baixa a camada da rede (cadeia de proxies). Usado para atualizar em 2º plano. */
export async function fetchFloodLayer(meta: FloodLayerMeta): Promise<FloodData> {
  let lastErr: unknown = null;
  for (const proxy of PROXIES) {
    try {
      const buf = await fetchBuffer(proxy(downloadUrl(meta.driveId)), 18000);
      const kml = extractKml(buf);
      const data = build(kml, meta);
      writeCache(meta.key, kml);
      return { ...data, origin: 'rede' };
    } catch (e) {
      lastErr = e;
      // pequena pausa evita rate-limit em proxies públicos
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  throw new Error(
    `não foi possível baixar "${meta.short}" (${lastErr instanceof Error ? lastErr.message : 'falha de rede'})`
  );
}

/** Compatibilidade: tenta rede e cai para cache/embutida. */
export async function loadFloodLayer(meta: FloodLayerMeta): Promise<FloodData> {
  const local = loadFloodLayerSync(meta);
  if (local) return local;
  return fetchFloodLayer(meta);
}

function makeSet(layers: FloodData[]): FloodSet {
  let bounds: FloodSet['bounds'] = null;
  for (const l of layers) {
    if (!l.bounds) continue;
    if (!bounds) {
      bounds = [[...l.bounds[0]], [...l.bounds[1]]] as FloodSet['bounds'];
      continue;
    }
    bounds[0][0] = Math.min(bounds[0][0], l.bounds[0][0]);
    bounds[0][1] = Math.min(bounds[0][1], l.bounds[0][1]);
    bounds[1][0] = Math.max(bounds[1][0], l.bounds[1][0]);
    bounds[1][1] = Math.max(bounds[1][1], l.bounds[1][1]);
  }
  return { layers, bounds, fetchedAt: Date.now() };
}

/** Camadas disponíveis imediatamente (cache/embutida), sem rede. */
export function loadFloodSetSync(): FloodSet | null {
  const layers = FLOOD_LAYERS.map(loadFloodLayerSync).filter((l): l is FloodData => !!l);
  return layers.length ? makeSet(layers) : null;
}

/**
 * Atualiza as camadas pela rede, SEQUENCIALMENTE (evita rate-limit dos
 * proxies públicos). Mantém a versão local das que falharem.
 */
export async function refreshFloodSet(current: FloodSet | null): Promise<FloodSet> {
  const out: FloodData[] = [];
  for (const meta of FLOOD_LAYERS) {
    try {
      out.push(await fetchFloodLayer(meta));
    } catch {
      const prev = current?.layers.find((l) => l.meta.key === meta.key) ?? loadFloodLayerSync(meta);
      if (prev) out.push(prev);
    }
  }
  if (!out.length) throw new Error('nenhuma camada de inundação disponível');
  return makeSet(out);
}

/** Carrega todas as camadas configuradas; ignora as que falharem. */
export async function loadAllFloodLayers(): Promise<FloodSet> {
  const layers: FloodData[] = [];
  for (const meta of FLOOD_LAYERS) {
    try {
      layers.push(await loadFloodLayer(meta));
    } catch {
      /* ignora a camada indisponível */
    }
  }

  if (!layers.length) {
    throw new Error('nenhuma camada de inundação disponível');
  }
  return makeSet(layers);
}

/* ------------------------------------------------------------------ */
/* Área de risco — base para o cruzamento com a geolocalização         */
/* ------------------------------------------------------------------ */

function pointInRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const hit = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Testa uma coordenada contra UMA camada. Respeita furos (anéis internos). */
export function isInFloodZone(
  lat: number,
  lon: number,
  data: FloodData | null
): { inside: boolean; feature: FloodFeature | null } {
  if (!data) return { inside: false, feature: null };
  for (const f of data.features) {
    if (f.type !== 'Polygon' || !f.rings.length) continue;
    if (!pointInRing(lat, lon, f.rings[0])) continue;
    const inHole = f.rings.slice(1).some((h) => pointInRing(lat, lon, h));
    if (!inHole) return { inside: true, feature: f };
  }
  return { inside: false, feature: null };
}

export interface RiskAssessment {
  /** true se o ponto cai em pelo menos uma mancha */
  atRisk: boolean;
  /** camadas que contêm o ponto */
  hits: FloodData[];
  /** camadas avaliadas */
  checked: number;
}

/** Avalia a coordenada contra TODAS as manchas carregadas. */
export function assessRisk(lat: number, lon: number, set: FloodSet | null): RiskAssessment {
  if (!set) return { atRisk: false, hits: [], checked: 0 };
  const risky = set.layers.filter((l) => l.meta.risk);
  const hits = risky.filter((l) => isInFloodZone(lat, lon, l).inside);
  return { atRisk: hits.length > 0, hits, checked: risky.length };
}

export type RiskLevel = 'dentro' | 'limitrofe' | 'fora';

export interface RiskVerdict {
  level: RiskLevel;
  hits: FloodData[];
  /** distância até a borda mais próxima, em metros */
  distanceM: number | null;
  /** margem de erro considerada (m) */
  accuracyM: number;
}

/**
 * Classifica o risco considerando a incerteza do GPS.
 * Se o ponto está fora mas o círculo de precisão alcança a mancha,
 * o veredito é "limítrofe" — não dá para afirmar com segurança.
 */
export function classifyRisk(
  lat: number,
  lon: number,
  accuracyM: number,
  set: FloodSet | null
): RiskVerdict {
  const { atRisk, hits } = assessRisk(lat, lon, set);
  const km = distanceToFloodKm(lat, lon, set);
  const distanceM = km == null ? null : km * 1000;

  if (atRisk) return { level: 'dentro', hits, distanceM: distanceM ?? 0, accuracyM };
  if (distanceM != null && distanceM <= accuracyM) {
    return { level: 'limitrofe', hits, distanceM, accuracyM };
  }
  return { level: 'fora', hits, distanceM, accuracyM };
}

/** Menor distância (km) do ponto até a borda de qualquer mancha de risco. */
export function distanceToFloodKm(lat: number, lon: number, set: FloodSet | null): number | null {
  if (!set) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const kmLat = 111.32;
  const kmLon = 111.32 * Math.cos(toRad(lat));
  let best = Infinity;

  for (const layer of set.layers) {
    if (!layer.meta.risk) continue;
    for (const f of layer.features) {
      for (const ring of f.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          // projeção local plana (suficiente nesta escala)
          const px = (lon - x1) * kmLon;
          const py = (lat - y1) * kmLat;
          const vx = (x2 - x1) * kmLon;
          const vy = (y2 - y1) * kmLat;
          const len2 = vx * vx + vy * vy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0;
          const dx = px - t * vx;
          const dy = py - t * vy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) best = d;
        }
      }
    }
  }
  void R;
  return Number.isFinite(best) ? best : null;
}
