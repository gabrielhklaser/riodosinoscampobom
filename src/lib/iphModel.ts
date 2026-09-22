/**
 * MODELO DE PREVISÃO ESTATÍSTICO SIMPLIFICADO DA CURVA DO NÍVEL DO RIO
 * =====================================================================
 * Ponto focal: Campo Bom / RS (estação ANA 87380000)
 *
 * Melhorias sobre a versão anterior (auditoria técnica):
 *  ✓ Interpolação IDW (inverso do quadrado da distância) nas forçantes
 *  ✓ 3 sub-bacias conceituais (alto, médio e baixo Sinos) com CN diferenciado
 *  ✓ Reservatório de escoamento de base (Kbas)
 *  ✓ Condição de contorno a jusante: nível do Guaíba (estação 87450020)
 *  ✓ Efeito de remanso empírico calibrado no evento de 2024
 *  ✓ NSE no backtest + linha de base de persistência (controle de habilidade)
 *  ✓ Hidrógrafo triangular com lag variável por sub-bacia
 *
 * Correções (revisão do sysadmin, 09/2026):
 *  ✓ Parse da ANA por tags do XML real (as regex de colunas nunca casavam
 *    com o retorno do webservice — Taquara, Guaíba e a chuva ANA estavam
 *    sempre vazias: sem remanso, sem API de saturação real)
 *  ✓ Recessão de escoamento de base exponencial (K_RECESSAO → H_BASE),
 *    calibrada na recessão pós-pico de maio/2024
 *  ✓ Degradação graciosa: estação fora do ar avisa (console.warn) e
 *    degrada o modelo sem derrubar a curva de 72 h
 *  ✓ Badge "sem dados" quando a fonte de chuva não responde
 */

/* ================================================================== */
/* Classificação de risco                                              */
/* ================================================================== */

export type IphClass = 'verde' | 'amarelo' | 'laranja' | 'vermelho';

export const IPH_CLASS: Record<
  IphClass,
  { label: string; hex: string; text: string; bg: string; ring: string; min: number }
> = {
  verde:    { label: 'Normalidade',        hex: '#34d399', text: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-400/30', min: 0 },
  amarelo:  { label: 'Atenção',            hex: '#facc15', text: 'text-yellow-300',  bg: 'bg-yellow-500/10',  ring: 'ring-yellow-400/30',  min: 4.5 },
  laranja:  { label: 'Alerta',             hex: '#fb923c', text: 'text-orange-300',  bg: 'bg-orange-500/10',  ring: 'ring-orange-400/30',  min: 5.2 },
  vermelho: { label: 'Inundação crítica',  hex: '#f87171', text: 'text-red-300',     bg: 'bg-red-500/10',     ring: 'ring-red-400/30',     min: 6.0 },
};

export function classFor(stage: number): IphClass {
  if (stage >= 6.0) return 'vermelho';
  if (stage >= 5.2) return 'laranja';
  if (stage >= 4.5) return 'amarelo';
  return 'verde';
}

/* ================================================================== */
/* Sub-bacias e estações                                               */
/* ================================================================== */

export interface IphStation {
  id: string;
  name: string;
  city: string;
  anaCode: string;
  kind: 'fluvio' | 'pluvio';
  lat: number;
  lon: number;
  lagH: number;
  weight: number;
  critical: number;
  /** sub-bacia: alto (cabeceiras), medio, baixo */
  subbasin: 'alto' | 'medio' | 'baixo';
}

/**
 * CN por sub-bacia (bibliografia FEPAM/Comitesinos + MapBiomas):
 *  alto  (serra, mata + pastagem): CN ~65
 *  medio (rural misto):            CN ~72
 *  baixo (urbano + várzea):        CN ~84
 */
const CN: Record<string, number> = { alto: 65, medio: 72, baixo: 84 };

/** Lag do hidrógrafo por sub-bacia (h) — tempo até o pico em Campo Bom */
const LAG: Record<string, number> = { alto: 18, medio: 10, baixo: 4 };

/** Fração da área total da bacia (2900 km²) */
const AREA_FRAC: Record<string, number> = { alto: 0.30, medio: 0.45, baixo: 0.25 };

/**
 * Estações do modelo — prioridade ANA (dados medidos) sobre Open-Meteo.
 * `anaRain: true` = a estação retorna chuva pelo webservice da ANA (testado).
 */
export const IPH_STATIONS: (IphStation & { anaRain: boolean })[] = [
  { id: 'caraa',         name: 'Caraá (ANA)',               city: 'Caraá',       anaCode: '87318700', kind: 'pluvio', lat: -29.7692, lon: -50.3572, lagH: 21, weight: 0.06,  critical: 0,   subbasin: 'alto',  anaRain: true },
  { id: 'alto-rolante',  name: 'Alto Rolante',             city: 'Rolante',     anaCode: '2950098',  kind: 'pluvio', lat: -29.645,  lon: -50.5106, lagH: 18, weight: 0.06,  critical: 0,   subbasin: 'alto',  anaRain: false },
  { id: 'rolante',       name: 'Rolante',                  city: 'Rolante',     anaCode: '2950122',  kind: 'pluvio', lat: -29.6653, lon: -50.5819, lagH: 16, weight: 0.08,  critical: 0,   subbasin: 'medio', anaRain: false },
  { id: 'canastra',      name: 'Canastra',                 city: 'Rolante',     anaCode: '2950123',  kind: 'pluvio', lat: -29.5825, lon: -50.4697, lagH: 15, weight: 0.08,  critical: 0,   subbasin: 'medio', anaRain: false },
  { id: 'taquara',       name: 'Taquara (Foz Paranhana)',  city: 'Taquara',     anaCode: '87376000', kind: 'fluvio', lat: -29.6858, lon: -50.8122, lagH: 10, weight: 0.25,  critical: 5.9, subbasin: 'medio', anaRain: false },
  { id: 'sapiranga',     name: 'Sapiranga',                city: 'Sapiranga',   anaCode: '2951040',  kind: 'pluvio', lat: -29.6333, lon: -51.0,    lagH: 3,  weight: 0.15,  critical: 0,   subbasin: 'baixo', anaRain: false },
  // ---- ESTAÇÕES COM PLUVIÔMETRO DA ANA (dados medidos, 15 min) ----
  { id: 'campo-bom',     name: 'Campo Bom (ANA)',          city: 'Campo Bom',   anaCode: '87380000', kind: 'pluvio', lat: -29.6917, lon: -51.0461, lagH: 0,  weight: 0.16,  critical: 0,   subbasin: 'baixo', anaRain: true },
  { id: 'sao-leopoldo',  name: 'São Leopoldo (ANA)',       city: 'São Leopoldo',anaCode: '87382000', kind: 'fluvio', lat: -29.7589, lon: -51.1483, lagH: 0,  weight: 0.10,  critical: 4.5, subbasin: 'baixo', anaRain: true },
  { id: 'guaiba-chuva',  name: 'Guaíba/Gasômetro (ANA)',   city: 'Porto Alegre',anaCode: '87450020', kind: 'pluvio', lat: -30.0347, lon: -51.2419, lagH: 0,  weight: 0.06,  critical: 0,   subbasin: 'baixo', anaRain: true },
];

/** Coordenada de Campo Bom (ponto focal para IDW). */
const CB = { lat: -29.6917, lon: -51.0461 };

/* ================================================================== */
/* Tipos de saída                                                      */
/* ================================================================== */

export interface StationSnap {
  station: IphStation;
  level: number | null;
  cr: number | null;
  dH2h: number | null;
  dH6h: number | null;
  p6: number; p12: number; p24: number; p48: number;
  api: number;
  pEfetiva: number;
  idwWeight: number;
  /** fonte da chuva: 'ANA' (medido), 'Open-Meteo' (modelo) ou 'sem dados' (fonte indisponível) */
  rainSource: 'ANA' | 'Open-Meteo' | 'sem dados';
}

export interface HorizonForecast {
  hours: 6 | 12 | 24;
  stage: number;
  cls: IphClass;
  inertial: number;
  rain: number;
  remanso: number;
}

export interface CurvePoint {
  ts: number;
  observed: number | null;
  ecmwf: number | null;
  gfs: number | null;
  /** chuva horária prevista ECMWF (mm) */
  rainEcmwf: number;
  /** chuva horária prevista GFS (mm) */
  rainGfs: number;
}

export interface BacktestResult {
  horizon: number;
  model: 'ecmwf' | 'gfs';
  pairs: { hour: number; predicted: number; observed: number; errorM: number }[];
  mae: number;
  rmse: number;
  /** null quando o nível observado é constante na janela (NSE indefinido) */
  nse: number | null;
  accuracy: number;
  tolerance: number;
  n: number;
  /** MAE da linha de base de persistência ("o nível fica onde está"), mesmas origens */
  persistMae: number | null;
  /** redução de MAE vs. persistência, em %; > 0 = modelo agrega habilidade */
  skillVsPersist: number | null;
}

export interface IphOutput {
  current: number;
  currentCls: IphClass;
  guaibaLevel: number | null;
  horizons: HorizonForecast[];
  stations: StationSnap[];
  dominant: string;
  boletim: string;
  curve: CurvePoint[];
  fetchedAt: number;
  rainFc: { ecmwf12: number; ecmwf24: number; gfs12: number; gfs24: number };
  backtest: BacktestResult[];
}

/* ================================================================== */
/* Hidrologia                                                          */
/* ================================================================== */

/** γ — decaimento diário de umidade do solo */
const GAMMA = 0.87;

/** API de saturação por sub-bacia (mm) */
const API_SAT: Record<string, number> = { alto: 160, medio: 140, baixo: 110 };

/** Expoente de resposta (similar ao b de Xinanjiang) */
const ETA: Record<string, number> = { alto: 0.8, medio: 1.0, baixo: 1.4 };

/** Constante de recessão do escoamento de base (h⁻¹). */
const K_BAS = 0.004;

/**
 * K_RECESSAO — constante de recessão do escoamento de base (h⁻¹).
 * Decaimento exponencial H(t) → H_BASE. Meia-vida ≈ 7 dias, coerente com a
 * recessão observada após o pico de maio/2024 (pico 04/05 → ~6 m em ~7 dias).
 */
const K_RECESSAO = 0.004;

/** H_BASE — cota de base assintótica da seção (m); piso físico da projeção. */
const H_BASE = 2.0;

/** Nível de referência do Guaíba para início do efeito de remanso (m). */
const GUAIBA_REF = 1.5;

/** Fator de remanso (m de acréscimo em CB por m de excesso no Guaíba).
 *  Calibrado em 2024: Guaíba a ~5,5 m → remanso ~0,6 m em Campo Bom. */
const REMANSO_K = 0.15;

/** API diário a partir de série horária (mm). */
function computeApi(hourly: number[]): number {
  if (!hourly.length) return 0;
  const days = Math.ceil(hourly.length / 24);
  let api = 0;
  for (let d = 0; d < days; d++) {
    const p = hourly.slice(d * 24, d * 24 + 24).reduce((s, v) => s + (v || 0), 0);
    api = p + GAMMA * api;
  }
  return +api.toFixed(1);
}

/** Escoamento efetivo por sub-bacia. */
function pEfetiva(pMm: number, api: number, sub: string): number {
  const sat = Math.min(1, Math.max(0.2, api / (API_SAT[sub] ?? 140)));
  return +(pMm * Math.pow(sat, ETA[sub] ?? 1.0)).toFixed(2);
}

/** SCS-CN runoff (mm). */
function scsCN(pMm: number, cn: number): number {
  const S = 25400 / cn - 254;
  const Ia = 0.2 * S;
  if (pMm <= Ia) return 0;
  return ((pMm - Ia) ** 2) / (pMm - Ia + S);
}

/** Distância em km (Haversine simplificada). */
function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (bLon - aLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const dy = (bLat - aLat) * 110.54;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Calcula pesos IDW para as estações em relação a Campo Bom. */
function idwWeights(stations: IphStation[]): number[] {
  const dists = stations.map((s) => Math.max(0.5, distKm(CB.lat, CB.lon, s.lat, s.lon)));
  const inv = dists.map((d) => 1 / (d * d));
  const sum = inv.reduce((a, v) => a + v, 0) || 1;
  return inv.map((v) => +(v / sum).toFixed(4));
}

function sumLast(h: number[], n: number): number {
  if (!h.length) return 0;
  return +h.slice(-Math.min(n, h.length)).reduce((s, v) => s + (v || 0), 0).toFixed(1);
}

/* ================================================================== */
/* Fetch                                                               */
/* ================================================================== */

const ANA = 'https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos';

function pad(n: number) { return String(n).padStart(2, '0'); }
function brDate(d: Date) { return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }

async function fetchText(url: string, ms = 18000): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
  finally { clearTimeout(t); }
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}

interface AnaSeries {
  /** leituras de nível (m), ordenadas */
  levels: { ts: number; h: number }[];
  /** chuva horária agregada (mm); índice 0 = hora mais antiga */
  rainHourly: number[];
}

function childText(el: Element | null, tag: string): string | null {
  if (!el) return null;
  const found = el.getElementsByTagName(tag);
  if (found.length) return found[0].textContent;
  // fallback: namespaces / capitalização diferente
  for (const child of Array.from(el.children)) {
    const local = child.tagName.replace(/^.*:/, '').toLowerCase();
    if (local === tag.toLowerCase()) return child.textContent;
  }
  return null;
}

/**
 * Parse do XML real do webservice da ANA (diffgram, 1 registro por estação):
 *   <CodEstacao>/<DataHora>/<Vazao>/<Nivel>(cm)/<Chuva>(mm)
 *
 * IMPORTANTE: o retorno é XML com tags — as regex antigas de "colunas
 * separadas por espaço" nunca casavam com o formato real, deixando Taquara,
 * Guaíba e a chuva ANA sempre vazias no modelo. A parse por tags é a mesma
 * da camada ana.ts (usada no gráfico principal, validada em produção).
 */
function parseAnaXml(code: string, xml: string): AnaSeries {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) return { levels: [], rainHourly: [] };

  const num = (t: string | null): number | null => {
    if (t == null) return null;
    const s = String(t).trim().replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const stamps = Array.from(doc.getElementsByTagName('DataHora'));
  const recs: { ts: number; nivelCm: number | null; chuvaMm: number | null }[] = [];
  for (const stamp of stamps) {
    const rec = stamp.parentElement;
    if (!rec) continue;
    const cod = childText(rec, 'CodEstacao');
    if (cod && cod.trim() !== code) continue;
    const m = (stamp.textContent || '').trim().match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) continue;
    const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
    const nivelCm = num(childText(rec, 'Nivel'));
    const chuvaMm = num(childText(rec, 'Chuva'));
    if (nivelCm == null && chuvaMm == null) continue;
    recs.push({ ts, nivelCm, chuvaMm });
  }
  recs.sort((a, b) => a.ts - b.ts);

  const levels: { ts: number; h: number }[] = [];
  const seen = new Set<number>();
  for (const r of recs) {
    if (r.nivelCm == null || r.nivelCm <= 0) continue;
    if (seen.has(r.ts)) continue;
    seen.add(r.ts);
    levels.push({ ts: r.ts, h: +(r.nivelCm / 100).toFixed(2) });
  }

  let rainHourly: number[] = [];
  const rainRecs = recs.filter((r) => r.chuvaMm != null);
  if (rainRecs.length) {
    const firstHour = Math.floor(rainRecs[0].ts / 3600000);
    const lastHour = Math.floor(rainRecs[rainRecs.length - 1].ts / 3600000);
    rainHourly = new Array(lastHour - firstHour + 1).fill(0);
    for (const r of rainRecs) rainHourly[Math.floor(r.ts / 3600000) - firstHour] += r.chuvaMm || 0;
    rainHourly = rainHourly.map((v) => +v.toFixed(1));
  }

  return { levels, rainHourly };
}

function levelAt(series: { ts: number; h: number }[], t: number): number | null {
  if (!series.length) return null;
  let best = series[0], bestD = Math.abs(series[0].ts - t);
  for (const s of series) { const d = Math.abs(s.ts - t); if (d < bestD) { best = s; bestD = d; } }
  return bestD <= 3 * 3600000 ? best.h : null;
}

function dH(series: { ts: number; h: number }[], end: number, hours: number): number | null {
  const a = levelAt(series, end - hours * 3600000);
  const b = levelAt(series, end);
  if (a == null || b == null) return null;
  return +(((b - a) * 100) / hours).toFixed(2);
}

/**
 * Busca telemetria da ANA (nível + chuva) em UM único fetch por estação —
 * antes havia um fetch para nível e outro para chuva do mesmo período.
 * O retorno é XML (diffgram); veja parseAnaXml.
 */
async function fetchAnaData(code: string, days: number): Promise<AnaSeries> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const end = new Date(now.getTime() + 86400000);
  const raw = `${ANA}?codEstacao=${code}&dataInicio=${brDate(start)}&dataFim=${brDate(end)}`;
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(raw)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(raw)}`,
  ];
  for (const u of proxies) {
    try {
      const xml = await fetchText(u);
      const s = parseAnaXml(code, xml);
      if (s.levels.length || s.rainHourly.length) return s;
    } catch { /* tenta o próximo proxy */ }
  }
  return { levels: [], rainHourly: [] };
}

function parseOmHour(iso: string): number {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}


interface RainPack {
  past: Record<string, number[]>;
  /** chuva prevista média da bacia: passado recente (24 h) + futuro (80 h).
   *  Índice 0 = 24 h atrás de agora, índice 24 = agora, índice 25+ = futuro. */
  ecmwf: number[];
  gfs: number[];
}

/**
 * Monta array contínuo passado+futuro a partir de uma resposta Open-Meteo.
 * RAIN_PAST_H horas de passado + RAIN_FUT_H de futuro.
 * Índice RAIN_PAST_H = agora (t=0).
 */
const RAIN_PAST_H = 48;
const RAIN_FUT_H = 100;
const RAIN_TL_LEN = RAIN_PAST_H + RAIN_FUT_H;

function buildRainTimeline(times: string[], values: number[], now: number): number[] {
  const out: number[] = new Array(RAIN_TL_LEN).fill(0);
  for (let i = 0; i < times.length; i++) {
    const ts = parseOmHour(times[i]);
    if (!Number.isFinite(ts)) continue;
    const h = Math.floor((ts - now) / 3600000) + RAIN_PAST_H;
    if (h >= 0 && h < out.length) out[h] += Number(values[i]) || 0;
  }
  return out;
}

/**
 * Busca chuva das estações + previsão meteorológica.
 * A previsão ECMWF/GFS é buscada como MÉDIA das coordenadas das estações
 * a montante (não só Campo Bom), para capturar a chuva nas cabeceiras.
 */
async function fetchRainPack(now: number): Promise<RainPack> {
  const omStations = IPH_STATIONS.filter((s) => !s.anaRain);
  const lats = omStations.map((s) => s.lat).join(',');
  const lons = omStations.map((s) => s.lon).join(',');
  const anaStations = IPH_STATIONS.filter((s) => s.anaRain);

  // coordenadas médias da bacia para a previsão meteorológica
  const allLats = IPH_STATIONS.map((s) => s.lat);
  const allLons = IPH_STATIONS.map((s) => s.lon);
  const fcLat = (allLats.reduce((a, v) => a + v, 0) / allLats.length).toFixed(4);
  const fcLon = (allLons.reduce((a, v) => a + v, 0) / allLons.length).toFixed(4);

  const [hist, ecm, gfs, ...anaResults] = await Promise.all([
    lats
      ? fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation&past_days=14&forecast_days=1&timezone=America%2FSao_Paulo`)
      : null,
    fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=ecmwf_ifs025&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`)
      .catch(() => fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=best_match&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`)),
    fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=gfs_global&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`)
      .catch(() => fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=gfs_seamless&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`)),
    ...anaStations.map((s) =>
      fetchAnaData(s.anaCode, 14).catch((): AnaSeries => ({ levels: [], rainHourly: [] }))
    ),
  ]);

  const past: Record<string, number[]> = {};
  if (hist) {
    const list = Array.isArray(hist) ? hist : [hist];
    list.forEach((b: any, i: number) => {
      if (omStations[i]) past[omStations[i].id] = (b?.hourly?.precipitation as number[]) ?? [];
    });
  }
  anaResults.forEach((data: AnaSeries, i: number) => {
    if (anaStations[i] && data.rainHourly.length > 0) past[anaStations[i].id] = data.rainHourly;
  });

  const ecmTimes = (ecm?.hourly?.time as string[]) ?? [];
  const gfsTimes = (gfs?.hourly?.time as string[]) ?? [];

  return {
    past,
    ecmwf: buildRainTimeline(ecmTimes, (ecm?.hourly?.precipitation as number[]) ?? [], now),
    gfs: buildRainTimeline(gfsTimes, (gfs?.hourly?.precipitation as number[]) ?? [], now),
  };
}



/** Chuva analisada (passado) de um modelo, com carimbo de hora — usada no
 *  backtest. O carimbo evita o erro de alinhamento por índice (o antigo
 *  `pastRain.length + offset` tratava o fim do array como "agora", com
 *  off-by-one de 1 h). */
export interface RainHistory {
  ts: number;
  mm: number;
}

async function fetchPastModelRain(model: string, pastDays: number): Promise<RainHistory[]> {
  try {
    const j = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=-29.6917&longitude=-51.0461&hourly=precipitation&models=${model}&past_days=${pastDays}&forecast_days=0&timezone=America%2FSao_Paulo`
    );
    const times = (j?.hourly?.time as string[]) ?? [];
    const vals = (j?.hourly?.precipitation as number[]) ?? [];
    const out: RainHistory[] = [];
    for (let i = 0; i < times.length; i++) {
      const ts = parseOmHour(times[i]);
      if (Number.isFinite(ts)) out.push({ ts, mm: Number(vals[i]) || 0 });
    }
    return out;
  } catch { return []; }
}

/* ================================================================== */
/* Motor de previsão                                                   */
/* ================================================================== */

/**
 * DH_SUB — conversão de chuva efetiva em acréscimo de cota (m/mm) por sub-bacia.
 * Calibrado no evento 2024 (102,5 mm / 48 h saturado → +6,26 m em ~6 dias,
 * média ponderada pelas frações de área); o baixo Sinos (urbano) responde
 * ~2× mais rápido que as cabeceiras.
 */
const DH_SUB: Record<string, number> = { alto: 0.010, medio: 0.013, baixo: 0.022 };

/**
 * Converte chuva horária bruta em escoamento efetivo por sub-bacia (mm/h).
 */
function effectiveRain(rawMm: number, api: number, sub: string): number {
  if (rawMm <= 0) return 0;
  const cn = CN[sub] ?? 72;
  const pCN = scsCN(rawMm, cn);
  return pEfetiva(pCN, api, sub);
}

/**
 * PROPAGAÇÃO HORA A HORA — resolve o problema da curva achatada.
 *
 * Em vez de projetar cada horizonte independentemente a partir do nível
 * atual (o que ignora o acúmulo), propaga o nível hora a hora:
 *
 *   H(t+1) = H(t)
 *     + persistência_inercial(1 h)
 *     + Σ_sub[ chuva_efetiva(t - lag_sub) × DH_SUB[sub] × frac_area ]
 *     + escoamento_base(1 h)
 *     + remanso(Guaíba)  [constante no horizonte]
 *     − recessão de escoamento de base K_RECESSAO × (H − H_BASE)
 *
 * `rainTimeline` é o array contínuo passado+futuro onde
 * índice 0 = 24 h atrás de agora, índice RAIN_PAST_H = agora e o
 * restante é o futuro. A chuva da hora T chega a Campo Bom na hora
 * T + lag_sub — assim a chuva das últimas horas a montante (que ainda
 * está "em trânsito") entra na projeção, o que corrige o achatamento
 * da curva após 24 h.
 *
 * @param dH6h — taxa nas últimas 6 h (cm/h) — momentum estável
 * @param dH2h — taxa nas últimas 2 h (cm/h) — responsividade imediata
 */
function propagateCurve(
  current: number,
  maxH: number,
  dH6h: number | null,
  dH2h: number | null,
  rainTimeline: number[],
  meanApi: number,
  guaibaLevel: number | null
): { stages: number[]; inertials: number[]; rains: number[]; rems: number[] } {
  const stages: number[] = [current];
  const inertials: number[] = [0];
  const rains: number[] = [0];
  const rems: number[] = [0];

  const rem = remanso(guaibaLevel);
  const subbasins = ['alto', 'medio', 'baixo'] as const;

  const r2 = dH2h ?? 0;
  const r6 = dH6h ?? r2;

  let h = current;

  for (let t = 1; t <= maxH; t++) {
    // 1. Persistência inercial — mistura taxa 2 h (reativa, decai rápido)
    //    com taxa 6 h (estável, decai devagar)
    const w2 = Math.exp(-t / 6);
    const w6 = Math.exp(-t / 20);
    const blendRate = w2 * r2 + (1 - w2) * r6 * w6;
    const iner = Math.abs(blendRate) > 0.02 ? blendRate / 100 : 0;

    // 2. Chuva efetiva — cada sub-bacia recebe a chuva defasada pelo lag
    //    e com DH diferenciado por sub-bacia (baixo Sinos responde mais rápido)
    let rainContrib = 0;
    for (const sub of subbasins) {
      const lag = LAG[sub];
      const tlIdx = RAIN_PAST_H + t - lag;
      if (tlIdx >= 0 && tlIdx < rainTimeline.length) {
        const rawMm = rainTimeline[tlIdx] || 0;
        if (rawMm > 0) {
          const pEff = effectiveRain(rawMm, meanApi, sub);
          rainContrib += pEff * (DH_SUB[sub] ?? 0.013) * (AREA_FRAC[sub] ?? 0.33);
        }
      }
    }

    // 3. Escoamento de base
    const bf = K_BAS * (meanApi / 140) * 0.001;

    // 4. Recessão natural — decaimento exponencial em direção à vazão de
    //    base (curva de recessão): quanto mais alto sobre a base, mais
    //    rápido o rio recede. Sempre ativa: em cheia age como amortecimento
    //    leve do armazenamento; em período seco desenha a recessão real
    //    em vez de congelar o nível.
    const recession = -K_RECESSAO * (h - H_BASE);

    // 5. Acumula
    h = h + iner + rainContrib + bf + recession + (t === 1 ? rem : 0);
    h = Math.max(h, H_BASE);
    h = +h.toFixed(3);

    stages.push(h);
    inertials.push(+iner.toFixed(4));
    rains.push(+(rainContrib + bf).toFixed(4));
    rems.push(t === 1 ? rem : 0);
  }

  return { stages, inertials, rains, rems };
}

/** Efeito de remanso do Guaíba. */
function remanso(guaibaLevel: number | null): number {
  if (guaibaLevel == null || guaibaLevel <= GUAIBA_REF) return 0;
  return +(REMANSO_K * (guaibaLevel - GUAIBA_REF)).toFixed(3);
}

/* ================================================================== */
/* Backtest com NSE                                                    */
/* ================================================================== */
/* Revisão metodológica (09/2026):
 *  ✓ Fim do viés de look-ahead: o fatiador antigo ancorava a origem no
 *    índice 0, mas propagateCurve lê a chuva em RAIN_PAST_H + t − lag
 *    (espera a origem no índice RAIN_PAST_H). O backtest consumia chuva
 *    de ~48 h DEPOIS da previsão simulada — validação inflada. Agora a
 *    fatia é montada por carimbo de hora, com índice RAIN_PAST_H == tOrigin.
 *  ✓ Linha de base de persistência ("o nível fica onde está"): controle
 *    mínimo de qualquer previsão hidrológica de curto prazo — o modelo só
 *    demonstra habilidade se bater essa referência (skillVsPersist).
 *  ✓ Origens a cada 3 h (antes: 1 h) — janelas sobrepostas de hora em hora
 *    geram amostras fortemente autocorrelacionadas e inflam o n.
 *  ✓ NSE = null quando o nível observado é constante na janela (ssTot = 0):
 *    nesse caso o NSE é INDEFINIDO, não zero.
 *  Mantida (documentada) a aproximação de usar API/Guaíba atuais para as
 *  origens históricas — reconstruir o API de cada época exigiria série de
 *  chuva mais longa que a janela de 4 dias da análise.
 */
const BACKTEST_SPAN_H = 72; // origens de −72 h até −horizonte
const BACKTEST_STEP_H = 3; // passo entre origens (h)

export function runBacktest(
  campoBom: { ts: number; h: number }[],
  pastEcmwf: RainHistory[],
  pastGfs: RainHistory[],
  now: number,
  meanApi: number,
  guaiba: number | null,
  horizonH: number,
  toleranceM: number,
  _idwW: number[]
): BacktestResult[] {
  void _idwW;
  const results: BacktestResult[] = [];

  for (const model of ['ecmwf', 'gfs'] as const) {
    const pastRain = model === 'ecmwf' ? pastEcmwf : pastGfs;
    // chuva analisada indexada pela hora fechada
    const rainByHour = new Map<number, number>();
    for (const r of pastRain) rainByHour.set(Math.floor(r.ts / 3600000) * 3600000, r.mm);

    const pairs: BacktestResult['pairs'] = [];
    const persistErrs: number[] = [];

    for (let offset = -BACKTEST_SPAN_H; offset <= -horizonH; offset += BACKTEST_STEP_H) {
      const tOrigin = now + offset * 3600000;
      const tTarget = tOrigin + horizonH * 3600000;
      const hOrigin = levelAt(campoBom, tOrigin);
      const hTarget = levelAt(campoBom, tTarget);
      if (hOrigin == null || hTarget == null) continue;

      // Aproximação do backtest: usa a taxa local de 2 h (sem a mistura com
      // Taquara) e o API/Guaíba atuais para todas as origens históricas.
      const rate = dH(campoBom, tOrigin, 2);

      // fatia alinhada: índice RAIN_PAST_H == tOrigin; o motor lê a chuva
      // em RAIN_PAST_H + t − lag (t = 1..horizonte), ou seja, só usa chuva
      // da janela [tOrigin − lag_max, tOrigin + horizonte] — sem futuro.
      const tOriginHour = Math.floor(tOrigin / 3600000) * 3600000;
      const rainSlice: number[] = new Array(RAIN_PAST_H + horizonH + 1).fill(0);
      for (let k = 0; k < rainSlice.length; k++) {
        rainSlice[k] = rainByHour.get(tOriginHour + (k - RAIN_PAST_H) * 3600000) ?? 0;
      }

      const prop = propagateCurve(hOrigin, horizonH, rate, rate, rainSlice, meanApi, guaiba);
      const predicted = prop.stages[horizonH] ?? hOrigin;
      pairs.push({ hour: offset, predicted, observed: hTarget, errorM: +(predicted - hTarget).toFixed(3) });
      persistErrs.push(Math.abs(hOrigin - hTarget));
    }

    if (!pairs.length) {
      results.push({
        horizon: horizonH, model, pairs: [], mae: 0, rmse: 0, nse: null,
        accuracy: 0, tolerance: toleranceM, n: 0, persistMae: null, skillVsPersist: null,
      });
      continue;
    }

    const n = pairs.length;
    const mae = +(pairs.reduce((s, p) => s + Math.abs(p.errorM), 0) / n).toFixed(3);
    const rmse = +Math.sqrt(pairs.reduce((s, p) => s + p.errorM ** 2, 0) / n).toFixed(3);
    const hits = pairs.filter((p) => Math.abs(p.errorM) <= toleranceM).length;
    const accuracy = +((hits / n) * 100).toFixed(1);

    // Nash-Sutcliffe — indefinido (null) se o observado é constante na janela
    const obsMean = pairs.reduce((s, p) => s + p.observed, 0) / n;
    const ssRes = pairs.reduce((s, p) => s + (p.observed - p.predicted) ** 2, 0);
    const ssTot = pairs.reduce((s, p) => s + (p.observed - obsMean) ** 2, 0);
    const nse = ssTot > 1e-9 ? +(1 - ssRes / ssTot).toFixed(3) : null;

    // linha de base de persistência: previsão ingênua "nível não muda"
    const persistMae = +(persistErrs.reduce((s, v) => s + v, 0) / n).toFixed(3);
    const skillVsPersist = persistMae > 1e-6 ? +((1 - mae / persistMae) * 100).toFixed(1) : null;

    results.push({ horizon: horizonH, model, pairs, mae, rmse, nse, accuracy, tolerance: toleranceM, n, persistMae, skillVsPersist });
  }
  return results;
}

/* ================================================================== */
/* Textos e curva                                                      */
/* ================================================================== */

function dominantFactor(stations: StationSnap[], inertial: number, rain: number, rem: number): string {
  const tq = stations.find((s) => s.station.id === 'taquara');
  if (rem > 0.05) return `Efeito de remanso do Guaíba (nível elevado a jusante impedindo o escoamento).`;
  if (tq && tq.cr != null && tq.cr > 0 && inertial > rain) return 'Onda de cheia a montante (Taquara acima da cota crítica).';
  if (rain > inertial && rain > 0.08) return 'Chuva efetiva na bacia (solo convertendo precipitação em escoamento).';
  const sat = stations.reduce((a, s) => a + s.api, 0) / stations.length;
  if (sat > 100) return 'Saturação do solo (API elevado) — chuva adicional vira vazão rapidamente.';
  if (inertial > 0.05) return 'Propagação inercial da onda de cheia vinda de Taquara/Rolante.';
  return 'Condições estáveis a montante; variação prevista é pequena.';
}

function boletimText(current: number, h12: HorizonForecast, h24: HorizonForecast, factor: string, guaiba: number | null): string {
  const n = (v: number) => v.toFixed(2).replace('.', ',');
  const dir = h24.stage - current;
  const verbo = dir > 0.05 ? 'elevação' : dir < -0.05 ? 'recesso' : 'estabilidade';
  return (
    `Boletim hidrológico — Campo Bom/RS. Nível atual: ${n(current)} m. ` +
    (guaiba != null ? `Guaíba: ${n(guaiba)} m. ` : '') +
    `Projeção: ${n(h12.stage)} m em 12 h e ${n(h24.stage)} m em 24 h, tendência de ${verbo}. ` +
    `Fator dominante: ${factor} ` +
    `Modelo estatístico simplificado — não substitui os boletins da Defesa Civil.`
  );
}

function buildCurve(
  observed: { ts: number; h: number }[],
  current: number,
  lastObsTs: number,
  dH6h: number | null,
  dH2h: number | null,
  api: number,
  guaiba: number | null,
  ecmwf: number[],
  gfs: number[]
): CurvePoint[] {
  const pts: CurvePoint[] = [];
  const from = lastObsTs - 24 * 3600000;
  let lastBucket = -1;
  for (const o of observed.filter((x) => x.ts >= from)) {
    const bucket = Math.floor(o.ts / 3600000);
    if (bucket === lastBucket) pts[pts.length - 1] = { ts: o.ts, observed: o.h, ecmwf: null, gfs: null, rainEcmwf: 0, rainGfs: 0 };
    else { pts.push({ ts: o.ts, observed: o.h, ecmwf: null, gfs: null, rainEcmwf: 0, rainGfs: 0 }); lastBucket = bucket; }
  }
  pts.push({ ts: lastObsTs, observed: current, ecmwf: current, gfs: current, rainEcmwf: 0, rainGfs: 0 });

  // propagar hora a hora com cada modelo de chuva
  const propE = propagateCurve(current, 72, dH6h, dH2h, ecmwf, api, guaiba);
  const propG = propagateCurve(current, 72, dH6h, dH2h, gfs, api, guaiba);

  for (let h = 1; h <= 72; h++) {
    pts.push({
      ts: lastObsTs + h * 3600000,
      observed: null,
      ecmwf: Number.isFinite(propE.stages[h]) ? +propE.stages[h].toFixed(2) : current,
      gfs: Number.isFinite(propG.stages[h]) ? +propG.stages[h].toFixed(2) : current,
      rainEcmwf: +(ecmwf[RAIN_PAST_H + h] ?? 0).toFixed(1),
      rainGfs: +(gfs[RAIN_PAST_H + h] ?? 0).toFixed(1),
    });
  }
  return pts;
}

/* ================================================================== */
/* Entrada principal                                                   */
/* ================================================================== */

export async function runIphModel(campoBom: { ts: number; h: number }[]): Promise<IphOutput> {
  if (!campoBom.length) throw new Error('sem leituras de Campo Bom');

  const now = campoBom[campoBom.length - 1].ts;
  const current = campoBom[campoBom.length - 1].h;
  const localRate = dH(campoBom, now, 2);

  // cada estação falha de forma independente: uma estação fora do ar
  // degrada o modelo (sem remanso / sem taxa a montante), mas não derruba
  // a curva inteira — o nível atual e a previsão de chuva continuam válidos
  const [taquaraData, guaibaData, rain] = await Promise.all([
    fetchAnaData('87376000', 3).catch((): AnaSeries => ({ levels: [], rainHourly: [] })),
    // 14 dias: cobre o nível (condição de contorno) e a chuva (API) juntos
    fetchAnaData('87450020', 14).catch((): AnaSeries => ({ levels: [], rainHourly: [] })),
    fetchRainPack(now),
  ]);
  const taquara = taquaraData.levels;
  const guaibaRaw = guaibaData.levels;
  if (!taquara.length) console.warn('[iph] Taquara (87376000): sem níveis — fator a montante e taxa mista usam apenas Campo Bom.');
  if (!guaibaRaw.length) console.warn('[iph] Guaíba (87450020): sem níveis — efeito de remanso desativado nesta projeção.');
  const guaibaLevel = guaibaRaw.length ? guaibaRaw[guaibaRaw.length - 1].h : null;
  const idwW = idwWeights(IPH_STATIONS);

  const stations: StationSnap[] = IPH_STATIONS.map((st, i) => {
    const hourly = rain.past[st.id] ?? [];
    const api = computeApi(hourly);
    const p24 = sumLast(hourly, 24);
    const snap: StationSnap = {
      station: st,
      level: null, cr: null, dH2h: null, dH6h: null,
      p6: sumLast(hourly, 6), p12: sumLast(hourly, 12), p24,
      p48: sumLast(hourly, 48), api, pEfetiva: pEfetiva(p24, api, st.subbasin),
      idwWeight: idwW[i],
      // 'sem dados' quando a fonte não respondeu — antes era marcado
      // 'Open-Meteo' mesmo sem haver dado algum (diagnóstico enganoso)
      rainSource:
        st.anaRain && hourly.length > 0
          ? 'ANA' as const
          : hourly.length > 0
            ? 'Open-Meteo' as const
            : 'sem dados' as const,
    };
    if (st.kind === 'fluvio' && taquara.length) {
      snap.level = taquara[taquara.length - 1].h;
      snap.cr = st.critical > 0 ? +(snap.level - st.critical).toFixed(2) : null;
      snap.dH2h = dH(taquara, now, 2);
      snap.dH6h = dH(taquara, now, 6);
    }
    return snap;
  });

  for (const st of IPH_STATIONS) {
    if (st.anaRain && !(rain.past[st.id]?.length)) {
      console.warn(`[iph] ${st.name}: chuva ANA indisponível — API e P24 zerados para esta estação.`);
    }
  }

  const tqRate = stations.find((s) => s.station.id === 'taquara')?.dH2h ?? null;
  const mixRate = tqRate != null && localRate != null ? 0.4 * localRate + 0.6 * tqRate : (tqRate ?? localRate);
  const meanApi = stations.reduce((a, s) => a + s.api * s.idwWeight, 0);

  // propagar a curva ECMWF (referência para os horizontes)
  const localRate6 = dH(campoBom, now, 6);
  const propRef = propagateCurve(current, 24, localRate6, mixRate, rain.ecmwf, meanApi, guaibaLevel);

  const horizons: HorizonForecast[] = ([6, 12, 24] as const).map((hours) => {
    const stage = +propRef.stages[hours].toFixed(2);
    const inerSum = propRef.inertials.slice(1, hours + 1).reduce((a, v) => a + v, 0);
    const rainSum = propRef.rains.slice(1, hours + 1).reduce((a, v) => a + v, 0);
    const remSum = propRef.rems.slice(1, hours + 1).reduce((a, v) => a + v, 0);
    return { hours, stage, cls: classFor(stage), inertial: +inerSum.toFixed(3), rain: +rainSum.toFixed(3), remanso: +remSum.toFixed(3) };
  });

  const h12 = horizons[1];
  const h24 = horizons[2];
  const factor = dominantFactor(stations, h24.inertial, h24.rain, h24.remanso);

  const sumH = (arr: number[], n: number) => arr.slice(RAIN_PAST_H, RAIN_PAST_H + n).reduce((s, v) => s + (v || 0), 0);

  const output: IphOutput = {
    current,
    currentCls: classFor(current),
    guaibaLevel,
    horizons,
    stations,
    dominant: factor,
    boletim: boletimText(current, h12, h24, factor, guaibaLevel),
    curve: buildCurve(campoBom, current, now, localRate6, mixRate, meanApi, guaibaLevel, rain.ecmwf, rain.gfs),
    fetchedAt: Date.now(),
    rainFc: {
      ecmwf12: +sumH(rain.ecmwf, 12).toFixed(1),
      ecmwf24: +sumH(rain.ecmwf, 24).toFixed(1),
      gfs12: +sumH(rain.gfs, 12).toFixed(1),
      gfs24: +sumH(rain.gfs, 24).toFixed(1),
    },
    backtest: [],
  };

  try {
    const [pastE, pastG] = await Promise.all([
      fetchPastModelRain('ecmwf_ifs025', 4),
      fetchPastModelRain('gfs_global', 4).catch(() => fetchPastModelRain('gfs_seamless', 4)),
    ]);
    output.backtest = [
      ...runBacktest(campoBom, pastE, pastG, now, meanApi, guaibaLevel, 6, 0.15, idwW),
      ...runBacktest(campoBom, pastE, pastG, now, meanApi, guaibaLevel, 12, 0.25, idwW),
      ...runBacktest(campoBom, pastE, pastG, now, meanApi, guaibaLevel, 24, 0.40, idwW),
    ];
  } catch (err) {
    // degradação graciosa COM diagnóstico (o painel segue sem o quadro de
    // validação; o console diz o motivo exato)
    console.warn('[iph] validação retrospectiva indisponível:', err instanceof Error ? err.message : err);
  }

  return output;
}
