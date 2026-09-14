/**
 * MODELAGEM PROVISÓRIA DE CENÁRIO DE ALAGAMENTO — Campo Bom / RS
 * ================================================================
 * Cadeia de modelagem (chuva → vazão → cota → mancha):
 *
 *  1. CHUVA  → escoamento superficial pelo método SCS-Curve Number (NRCS),
 *              aplicado à chuva média das estações a montante já usadas no
 *              painel (Campo Bom, Sapiranga, Nova Hartz/Araricá, Parobé,
 *              Taquara e Rolante).
 *  2. ESCOAM.→ vazão de pico por hidrograma unitário triangular do SCS,
 *              com tempo de concentração calibrado para a translação da
 *              onda de cheia do Alto/Médio Sinos até Campo Bom.
 *  3. VAZÃO  → cota, por curva-chave ajustada em tempo real sobre os pares
 *              (nível, vazão) que a própria telemetria da ANA publica na
 *              estação 87380000.
 *  4. COTA   → mancha, comparando a superfície de água com o Modelo Digital
 *              de Elevação e aplicando conectividade hidráulica.
 *
 * O nível de referência do MDE é calibrado com a mancha observada de 2024
 * (pico de 8,56 m na régua), o que amarra o modelo a um evento real.
 *
 * ATENÇÃO: produto experimental, de cunho de teste. Não substitui
 * modelagem hidrodinâmica (HEC-RAS/MGB) nem os alertas oficiais.
 */

import type { Reading } from './ana';
import { BASIN_RING } from './basin';
import { JUN2024_COORDS, parseCompact } from './floodData';

/* ------------------------------------------------------------------ */
/* 1. Base topográfica                                                 */
/* ------------------------------------------------------------------ */

/**
 * Hierarquia de bases topográficas, em ordem de PREFERÊNCIA.
 * O modelo sempre tenta a de maior prioridade disponível.
 */
export const DEM_SOURCES = [
  {
    id: 'mdt-rs-20m',
    name: 'MDT Multiescalas RS (dem_me_rs_20m.tif)',
    resolution: 20,
    vertical: '~2 m',
    provider: 'ANA / IPH-UFRGS / SEMA-RS',
    note:
      'PREFERENCIAL. O produto distribuído é reamostrado a 20 m — a componente RF1 de 2,5 m (cartografia 1:25.000) não é publicada isoladamente. Arquivo único de âmbito estadual (~2 bilhões de células, escala de GB), em Albers ESRI:102033, sem WCS/ImageServer e com o servidor recusando acesso externo (HTTP 403). Inviável de consumir no navegador; exigiria recorte prévio em servidor.',
    priority: 1,
    live: false,
    url: 'https://metadados.snirh.gov.br/geonetwork/srv/api/records/85e68eee-fdda-4346-b0d9-dd9c9546bbd1',
  },
  {
    id: 'worlddem-neo',
    name: 'WorldDEM Neo — Bacia do Guaíba',
    resolution: 5,
    vertical: '~2 m',
    provider: 'Airbus (via ANA/IPH)',
    note: 'Compõe o MDT Multiescalas na bacia do Guaíba. Licença restrita, sem distribuição aberta.',
    priority: 2,
    live: false,
  },
  {
    id: 'srtm30m',
    name: 'SRTM 1 arc-second (30 m)',
    resolution: 30,
    vertical: '~5 m (LE90)',
    provider: 'NASA / USGS',
    note: 'Melhor base com consulta pontual pública. Amostrada com interpolação bilinear.',
    priority: 3,
    live: true,
  },
  {
    id: 'copernicus90',
    name: 'Copernicus DEM GLO-90',
    resolution: 90,
    vertical: '~4 m (LE90)',
    provider: 'ESA / Airbus',
    note: 'Reserva automática, caso o SRTM não responda.',
    priority: 4,
    live: true,
  },
] as const;

export type DemQuality = 'detalhado' | 'rapido';

/** Base efetivamente utilizada conforme a qualidade escolhida. */
export function activeDem(q: DemQuality) {
  return q === 'detalhado' ? DEM_SOURCES[2] : DEM_SOURCES[3];
}

/** Base preferencial (ainda indisponível para consumo direto no navegador). */
export const DEM_PREFERRED = DEM_SOURCES[0];

export const DEM_ACTIVE = DEM_SOURCES[2];

/* ------------------------------------------------------------------ */
/* 2. Parâmetros hidrológicos da bacia                                 */
/* ------------------------------------------------------------------ */

/**
 * Estações usadas como entrada de chuva do modelo.
 * Campo Bom (local) e Sapiranga (a montante imediata) recebem o mesmo peso —
 * juntas representam o trecho que controla a cheia no perímetro urbano.
 */
export const MODEL_RAIN_STATIONS = ['campobom', 'sapiranga'] as const;

/**
 * EVENTO DE REFERÊNCIA — cheia de maio/2024 (dados reais).
 *
 * Telemetria da ANA, estação 87380000 (série de 27/04 a 06/05/2024):
 *   • base pré-evento : 2,30 m → 41,7 m³/s
 *   • PICO            : 8,56 m → 779,5 m³/s
 *
 * Chuva média das 6 estações a montante (reanálise ERA5/Open-Meteo):
 *   • 48 h que antecedem o pico (01–02/05) : 102,5 mm
 *   • 5 dias antecedentes (26–30/04)        : 122,1 mm  → solo saturado
 *
 * Toda a cadeia do modelo é calibrada para reproduzir exatamente este
 * evento — e, por consequência, a mancha do KML de 2024.
 */
export const EVENT_2024 = {
  rain48: 102.5,
  antecedent5d: 122.1,
  baseQ: 41.7,
  peakQ: 779.5,
  peakStage: 8.56,
  date: '03–04/05/2024',
};

export const HYDRO = {
  /** área de drenagem da estação 87380000, conforme inventário da ANA (km²) */
  areaKm2: 2900,
  /** Curve Number de referência (AMC II — solo C/D, uso misto rural-urbano) */
  curveNumber: 74,
  /** duração padrão da chuva de projeto (h) */
  durationH: 48,
  /** pico histórico na régua (m) — enchente de maio/2024 */
  peak2024: EVENT_2024.peakStage,
};

/* ---- Condição antecedente de umidade (AMC) ---- */

export type AMC = 'I' | 'II' | 'III';

/** Classifica a AMC pela chuva dos 5 dias anteriores (estação de crescimento). */
export function amcFrom(antecedent5d: number): AMC {
  if (antecedent5d < 35) return 'I';
  if (antecedent5d > 53) return 'III';
  return 'II';
}

/** Converte o CN de referência (AMC II) para a condição observada. */
export function adjustCN(cn: number, amc: AMC): number {
  if (amc === 'I') return (4.2 * cn) / (10 - 0.058 * cn);
  if (amc === 'III') return (23 * cn) / (10 + 0.13 * cn);
  return cn;
}

/** Escoamento superficial direto pelo método SCS-CN (mm). */
export function scsRunoff(rainMm: number, cn = HYDRO.curveNumber): number {
  const S = 25400 / cn - 254; // retenção potencial máxima (mm)
  const Ia = 0.2 * S; // abstração inicial
  if (rainMm <= Ia) return 0;
  return ((rainMm - Ia) ** 2) / (rainMm - Ia + S);
}

/**
 * COEFICIENTE DE PICO CALIBRADO
 * -----------------------------
 * O hidrograma triangular clássico do SCS (Qp = 0,208·A·R/tp) superestima
 * grosseiramente bacias grandes e alongadas como a do Sinos, que tem 190 km
 * de curso principal e forte amortecimento de planície: o pico de 2024
 * levou ~6 dias para se formar.
 *
 * Calibração direta pelo evento observado:
 *   ΔQ = K · R · A     com   K = ΔQ₂₀₂₄ / (R₂₀₂₄ · A)
 *
 * Resulta em tempo de base equivalente de ~146 h, coerente com a
 * observação — e não com as ~22 h que a fórmula original assumia.
 */
export const PEAK_K = (() => {
  const cn = adjustCN(HYDRO.curveNumber, amcFrom(EVENT_2024.antecedent5d));
  const R = scsRunoff(EVENT_2024.rain48, cn);
  return (EVENT_2024.peakQ - EVENT_2024.baseQ) / (R * HYDRO.areaKm2);
})();

/** Tempo de base equivalente do hidrograma (h). */
export const T_BASE_H = 2 / (PEAK_K * 3.6);

/** Acréscimo de vazão de pico gerado pelo escoamento direto (m³/s). */
export function peakFlow(runoffMm: number, areaKm2 = HYDRO.areaKm2): number {
  return PEAK_K * runoffMm * areaKm2;
}

/* ------------------------------------------------------------------ */
/* 3. Curva-chave ajustada com os dados reais da ANA                   */
/* ------------------------------------------------------------------ */

export interface RatingCurve {
  a: number;
  b: number;
  h0: number;
  /** nº de pares usados no ajuste */
  n: number;
  /** faixa de níveis observados */
  range: [number, number];
}

/**
 * PARES (H, Q) OBSERVADOS NA CHEIA DE 2024 — telemetria da ANA.
 * Cobrem toda a faixa de inundação, de 5,85 m até o pico de 8,56 m,
 * onde a série ao vivo (que raramente sai da faixa 6–7 m) não alcança.
 */
export const RATING_ANCHORS: { h: number; q: number }[] = [
  { h: 5.85, q: 230.2 },
  { h: 6.42, q: 314.1 },
  { h: 6.97, q: 410.2 },
  { h: 7.51, q: 519.9 },
  { h: 8.0, q: 633.3 },
  { h: 8.56, q: 779.5 },
];

/** Nível de vazão nula ajustado à seção de Campo Bom. */
const H0 = 3.0;

function fitPower(pts: { h: number; q: number }[], h0: number): RatingCurve | null {
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (const p of pts) {
    const d = p.h - h0;
    if (d <= 0.05 || p.q <= 0) continue;
    const x = Math.log(d);
    const y = Math.log(p.q);
    sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
  }
  if (n < 4) return null;
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / den;
  const a = Math.exp((sy - b * sx) / n);
  const hs = pts.map((p) => p.h);
  return { a, b, h0, n, range: [Math.min(...hs), Math.max(...hs)] };
}

/**
 * Curva-chave Q = a·(H − h₀)^b.
 *
 * Combina os pares observados na cheia de 2024 (faixa alta, que é a que
 * importa para inundação) com as leituras ao vivo da telemetria, de modo
 * que o ajuste continue representando a seção atual sem perder a
 * ancoragem no evento extremo.
 */
export function fitRating(readings: Reading[]): RatingCurve | null {
  const live = readings
    .filter((r) => r.flow != null && r.flow > 0 && r.level > H0 + 0.2)
    .map((r) => ({ h: r.level, q: r.flow as number }));

  // amostra as leituras vivas para não dominarem o ajuste pelo volume
  const step = Math.max(1, Math.floor(live.length / 40));
  const sampled = live.filter((_, i) => i % step === 0);

  return fitPower([...RATING_ANCHORS, ...sampled], H0);
}

/** Converte vazão em cota pela curva-chave invertida. */
export function flowToStage(q: number, rc: RatingCurve): number {
  if (q <= 0) return rc.h0;
  return rc.h0 + Math.pow(q / rc.a, 1 / rc.b);
}

export function stageToFlow(h: number, rc: RatingCurve): number {
  const d = h - rc.h0;
  return d <= 0 ? 0 : rc.a * Math.pow(d, rc.b);
}

/* ------------------------------------------------------------------ */
/* 4. Malha de terreno                                                 */
/* ------------------------------------------------------------------ */

export interface TerrainGrid {
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  cols: number;
  rows: number;
  /** elevação em metros; NaN quando indisponível */
  z: Float32Array;
  /** metros por célula (aprox.) */
  cellM: number;
  source: string;
  resolution: number;
}

/**
 * Recorte restrito ao município de Campo Bom (planície do Sinos).
 * Limites municipais aproximados, com pequena folga nas margens.
 */
const AREA = { west: -51.082, east: -51.002, south: -29.716, north: -29.668 };

/** Malha conforme a qualidade: detalhada (SRTM 30 m) ou rápida (GLO-90). */
const GRID: Record<DemQuality, { cols: number; rows: number }> = {
  detalhado: { cols: 84, rows: 56 }, // 4.704 pontos · célula ~92 m
  rapido: { cols: 46, rows: 30 }, //    1.380 pontos · célula ~193 m
};

const cacheKeyFor = (q: DemQuality) => `cb-terrain-v3-${q}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SRTM 30 m com interpolação bilinear (OpenTopoData). */
async function viaSrtm30(lats: number[], lons: number[]): Promise<number[]> {
  const locs = lats.map((la, i) => `${la},${lons[i]}`).join('|');
  const res = await fetch(
    `https://api.opentopodata.org/v1/srtm30m?locations=${locs}&interpolation=bilinear`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j?.results)) throw new Error('resposta inesperada');
  return j.results.map((r: any) => (typeof r.elevation === 'number' ? r.elevation : NaN));
}

/** Copernicus GLO-90 (Open-Meteo) — reserva rápida. */
async function viaOpenMeteo(lats: number[], lons: number[]): Promise<number[]> {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j?.elevation)) throw new Error('resposta inesperada');
  return j.elevation as number[];
}

/**
 * Baixa um lote respeitando a hierarquia de preferência.
 * Em modo detalhado tenta o SRTM 30 m; se falhar, cai para o GLO-90.
 */
async function fetchElevBatch(
  lats: number[],
  lons: number[],
  quality: DemQuality
): Promise<{ z: number[]; src: 'srtm30m' | 'copernicus90' }> {
  if (quality === 'detalhado') {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { z: await viaSrtm30(lats, lons), src: 'srtm30m' };
      } catch {
        await sleep(900 * (attempt + 1));
      }
    }
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { z: await viaOpenMeteo(lats, lons), src: 'copernicus90' };
    } catch (e) {
      lastErr = e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('falha no lote');
}

/** Preenche buracos da malha pela média dos vizinhos válidos. */
function fillGaps(z: Float32Array, cols: number, rows: number): number {
  let missing = 0;
  for (let pass = 0; pass < 4; pass++) {
    missing = 0;
    const copy = Float32Array.from(z);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (Number.isFinite(copy[i])) continue;
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            const v = copy[rr * cols + cc];
            if (Number.isFinite(v)) {
              sum += v;
              n++;
            }
          }
        }
        if (n >= 2) z[i] = sum / n;
        else missing++;
      }
    }
    if (!missing) break;
  }
  return missing;
}

/** Baixa a malha de elevação (com cache local permanente — o relevo não muda). */
export async function loadTerrain(
  quality: DemQuality = 'detalhado',
  onProgress?: (p: number) => void
): Promise<TerrainGrid> {
  const { cols: COLS, rows: ROWS } = GRID[quality];
  const dLon = (AREA.east - AREA.west) / (COLS - 1);
  const dLat = (AREA.north - AREA.south) / (ROWS - 1);
  const cellM = Math.round(dLon * 111320 * Math.cos((-29.7 * Math.PI) / 180));
  const dem = activeDem(quality);

  const base: Omit<TerrainGrid, 'z' | 'source' | 'resolution'> = {
    lat0: AREA.south,
    lon0: AREA.west,
    dLat,
    dLon,
    cols: COLS,
    rows: ROWS,
    cellM,
  };

  const CACHE_KEY = cacheKeyFor(quality);

  // cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o?.cols === COLS && o?.rows === ROWS && Array.isArray(o.z) && o.z.length === COLS * ROWS) {
        onProgress?.(1);
        return {
          ...base,
          z: Float32Array.from(o.z),
          source: o.source ?? dem.name,
          resolution: o.resolution ?? dem.resolution,
        };
      }
    }
  } catch {
    /* ignora */
  }

  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push(+(AREA.south + r * dLat).toFixed(6));
      lons.push(+(AREA.west + c * dLon).toFixed(6));
    }
  }

  const z = new Float32Array(COLS * ROWS).fill(NaN);
  const B = 100;
  const batches: number[] = [];
  for (let i = 0; i < lats.length; i += B) batches.push(i);

  let done = 0;
  let failed = 0;
  let srtmHits = 0;

  // sequencial: o OpenTopoData público aceita ~1 requisição por segundo
  for (const start of batches) {
    const la = lats.slice(start, start + B);
    const lo = lons.slice(start, start + B);
    try {
      const { z: el, src } = await fetchElevBatch(la, lo, quality);
      if (src === 'srtm30m') srtmHits++;
      for (let i = 0; i < el.length; i++) {
        if (Number.isFinite(el[i])) z[start + i] = el[i];
      }
    } catch {
      failed++;
    }
    done++;
    onProgress?.(done / batches.length);
    await sleep(quality === 'detalhado' ? 1050 : 120);
  }

  const valid = z.filter((v) => Number.isFinite(v)).length;
  if (valid < z.length * 0.35) {
    throw new Error(
      `só ${Math.round((valid / z.length) * 100)}% dos pontos responderam (${failed} lotes falharam). ` +
        'Tente novamente em alguns instantes.'
    );
  }
  fillGaps(z, COLS, ROWS);

  // a fonte reportada reflete o que de fato respondeu na maior parte dos lotes
  const usedSrtm = srtmHits > batches.length / 2;
  const source = usedSrtm ? DEM_SOURCES[2].name : DEM_SOURCES[3].name;
  const resolution = usedSrtm ? DEM_SOURCES[2].resolution : DEM_SOURCES[3].resolution;

  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        cols: COLS,
        rows: ROWS,
        source,
        resolution,
        z: Array.from(z, (v) => (Number.isFinite(v) ? +v.toFixed(1) : null)),
      })
    );
  } catch {
    /* cota cheia */
  }

  return { ...base, z, source, resolution };
}

/* ------------------------------------------------------------------ */
/* 5. Calibração do datum com a mancha de 2024                         */
/* ------------------------------------------------------------------ */

function sampleZ(g: TerrainGrid, lat: number, lon: number): number {
  const c = Math.round((lon - g.lon0) / g.dLon);
  const r = Math.round((lat - g.lat0) / g.dLat);
  if (c < 0 || c >= g.cols || r < 0 || r >= g.rows) return NaN;
  return g.z[r * g.cols + c];
}

function median(v: number[]): number {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface Datum {
  /** cota altimétrica (m) da superfície de água no pico de 2024 */
  wse2024: number;
  /** WSE = leitura da régua + offset */
  offset: number;
  samples: number;
}

/**
 * A borda da mancha observada de 2024 corresponde à linha d'água no pico
 * (8,56 m na régua). A mediana da elevação nessa borda estima a cota
 * altimétrica da superfície, amarrando régua ↔ MDE.
 */
export function calibrate(g: TerrainGrid): Datum {
  const ring = parseCompact(JUN2024_COORDS);
  const zs: number[] = [];
  for (const [lon, lat] of ring) {
    const z = sampleZ(g, lat, lon);
    if (Number.isFinite(z)) zs.push(z);
  }
  const wse = median(zs);
  return { wse2024: wse, offset: wse - HYDRO.peak2024, samples: zs.length };
}

/* ------------------------------------------------------------------ */
/* 6. Mancha simulada (bathtub + conectividade hidráulica)             */
/* ------------------------------------------------------------------ */

export interface FloodSim {
  /** profundidade por célula (m); 0 = seco */
  depth: Float32Array;
  cols: number;
  rows: number;
  /** cota da superfície de água (m) */
  wse: number;
  /** nível na régua usado (m) */
  stage: number;
  areaKm2: number;
  maxDepth: number;
  cells: number;
}

/** Células-semente: pontos baixos próximos ao eixo do rio. */
function seeds(g: TerrainGrid, wse: number): number[] {
  const out: number[] = [];
  const ring = parseCompact(JUN2024_COORDS);
  // usa o interior da mancha de 2024 como proxy do leito/planície
  for (const [lon, lat] of ring) {
    const c = Math.round((lon - g.lon0) / g.dLon);
    const r = Math.round((lat - g.lat0) / g.dLat);
    if (c < 0 || c >= g.cols || r < 0 || r >= g.rows) continue;
    const i = r * g.cols + c;
    if (Number.isFinite(g.z[i]) && g.z[i] <= wse) out.push(i);
  }
  return out;
}

/**
 * Preenchimento por conectividade: só alaga células abaixo da superfície
 * de água que estejam ligadas ao curso d'água (evita "piscinas" isoladas).
 */
export function simulate(g: TerrainGrid, stage: number, datum: Datum): FloodSim {
  const wse = stage + datum.offset;
  const n = g.cols * g.rows;
  const depth = new Float32Array(n);
  const seen = new Uint8Array(n);
  const stack = seeds(g, wse);
  for (const s of stack) seen[s] = 1;

  let cells = 0;
  let maxDepth = 0;

  while (stack.length) {
    const i = stack.pop()!;
    const z = g.z[i];
    if (!Number.isFinite(z) || z > wse) continue;
    const d = wse - z;
    depth[i] = d;
    if (d > maxDepth) maxDepth = d;
    cells++;

    const r = (i / g.cols) | 0;
    const c = i % g.cols;
    const nb = [
      c > 0 ? i - 1 : -1,
      c < g.cols - 1 ? i + 1 : -1,
      r > 0 ? i - g.cols : -1,
      r < g.rows - 1 ? i + g.cols : -1,
    ];
    for (const j of nb) {
      if (j < 0 || seen[j]) continue;
      seen[j] = 1;
      if (Number.isFinite(g.z[j]) && g.z[j] <= wse) stack.push(j);
    }
  }

  const cellArea = (g.dLon * 111320 * Math.cos((-29.7 * Math.PI) / 180)) * (g.dLat * 110540);
  return {
    depth,
    cols: g.cols,
    rows: g.rows,
    wse,
    stage,
    areaKm2: (cells * cellArea) / 1e6,
    maxDepth,
    cells,
  };
}

/* ------------------------------------------------------------------ */
/* 7. Cenário completo                                                 */
/* ------------------------------------------------------------------ */

export interface Scenario {
  /** chuva de projeto acumulada (mm) */
  rainMm: number;
  /** janela de acumulação usada (h) */
  windowH: 24 | 48;
  /** chuva dos 5 dias anteriores (mm) */
  antecedentMm: number;
  amc: AMC;
  cnUsed: number;
  runoffMm: number;
  peakQ: number;
  /** vazão base observada agora */
  baseQ: number;
  totalQ: number;
  /** cota prevista na régua (m) */
  stage: number;
  /** cota atual observada */
  currentStage: number;
  etaHours: number;
}

export function buildScenario(
  rainMm: number,
  windowH: 24 | 48,
  antecedentMm: number,
  currentStage: number,
  currentFlow: number | null,
  rc: RatingCurve
): Scenario {
  const amc = amcFrom(antecedentMm);
  const cnUsed = adjustCN(HYDRO.curveNumber, amc);
  const runoffMm = scsRunoff(rainMm, cnUsed);
  const peakQ = peakFlow(runoffMm);
  const baseQ = currentFlow ?? stageToFlow(currentStage, rc);
  const totalQ = baseQ + peakQ;
  return {
    rainMm,
    windowH,
    antecedentMm,
    amc,
    cnUsed,
    runoffMm,
    peakQ,
    baseQ,
    totalQ,
    stage: flowToStage(totalQ, rc),
    currentStage,
    // o pico chega em ~metade do tempo de base após o fim da chuva
    etaHours: Math.round(windowH / 2 + T_BASE_H / 4),
  };
}

/**
 * VALIDAÇÃO — reprocessa o evento de 2024 pela mesma cadeia.
 * Se o modelo estiver bem calibrado, deve devolver ~8,56 m.
 */
export function validate2024(rc: RatingCurve) {
  const s = buildScenario(
    EVENT_2024.rain48,
    48,
    EVENT_2024.antecedent5d,
    2.3,
    EVENT_2024.baseQ,
    rc
  );
  return {
    simulatedStage: s.stage,
    observedStage: EVENT_2024.peakStage,
    errorM: s.stage - EVENT_2024.peakStage,
    simulatedQ: s.totalQ,
    observedQ: EVENT_2024.peakQ,
  };
}

/** Cor por profundidade de lâmina d'água. */
export function depthColor(d: number): string {
  if (d < 0.3) return '#bae6fd';
  if (d < 0.75) return '#7dd3fc';
  if (d < 1.5) return '#38bdf8';
  if (d < 2.5) return '#0284c7';
  if (d < 4) return '#1d4ed8';
  return '#4c1d95';
}

export const DEPTH_SCALE = [
  { min: 0, label: '< 0,3 m', color: '#bae6fd' },
  { min: 0.3, label: '0,3–0,75 m', color: '#7dd3fc' },
  { min: 0.75, label: '0,75–1,5 m', color: '#38bdf8' },
  { min: 1.5, label: '1,5–2,5 m', color: '#0284c7' },
  { min: 2.5, label: '2,5–4 m', color: '#1d4ed8' },
  { min: 4, label: '> 4 m', color: '#4c1d95' },
];

/** Área da bacia é usada só para exibição. */
export const BASIN_VERTICES = BASIN_RING.length;
