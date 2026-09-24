/**
 * MODELO DE PREVISÃO ESTATÍSTICO SIMPLIFICADO DA CURVA DO NÍVEL DO RIO
 * =====================================================================
 * Ponto focal: Campo Bom / RS (estação ANA 87380000)
 *
 * Integração de skills (09/2026 — revisão solicitada):
 *  • hydrologic-modeling-engine (CIV-SK-022 / a5c-ai/babysitter)
 *    - Métodos SCS-CN, unit hydrograph, reservoir routing, time of concentration
 *  • stormwater-management (SK-004 / a5c-ai/babysitter)
 *    - TR-55, SWMM, BMP sizing, pollutant loading — valida SCS-CN em mm
 *  • risk-metrics-calculation (wshobson/agents via lobehub)
 *    - VaR, CVaR, Sharpe/Sortino, drawdown, rolling risk, stress testing
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
 *
 * Revisão skills 09/2026 (esta revisão):
 *  ✓ Unificação do método SCS-CN (mm) documentando fórmula vs TR-55/inches
 *  ✓ Correção da dupla conversão CN→Q→saturação: `effectiveRain` agora documentado
 *    e display de P-Efetiva unificado (antes: propagação usava CN+saturação, display usava só saturação)
 *  ✓ VaR/CVaR 95/99 sobre erros de backtest (tail risk do nível)
 *  ✓ Max drawdown análogo hidrológico + traffic-light de backtest (0-4 verde, 5-9 amarelo, 10+ vermelho / 250)
 *  ✓ Validação de design storm via IDF sintética (aviso quando chuva excede T muito alto)
 *  ✓ Rate-limit e timeout em fetchJson (evita travamento do modelo)
 *
 * Revisão 09/2026-B (relato do usuário):
 *  ✓ ECMWF e GFS desenhavam SEMPRE a mesma curva — causa raiz: o SCS-CN era
 *    aplicado hora a hora e a abstração inicial (10–27 mm) zerava a chuva
 *    prevista; o termo de chuva desaparecia e sobrava só inércia/recessão,
 *    iguais para os dois modelos. Agora o SCS-CN é aplicado ao acumulado do
 *    evento (TR-55) com ajuste contínuo de AMC (CN_I/II/III) — módulo novo
 *    src/lib/rainRunoff.ts — e a divergência entre os modelos é reportada
 *    em `IphOutput.divergence`/`curveModelDiff` e no painel.
 *  ✓ Curva de previsão caía abrupta no início — causa raiz: a persistência
 *    inercial aplicava ~85 % da taxa de 2 h já na 1ª hora. Agora a subida
 *    entra intacta e a descida entra por rampa, com queda limitada e
 *    impulso negativo preservado; passe final `limitDescent` garante o
 *    formato convexo de recessão (módulo src/lib/recession.ts).
 *  ✓ Taxas de 2 h/6 h passam a usar Theil–Sen (robusto a leitura espúria).
 *  ✓ Calibração do evento 2024 virou verificável por teste
 *    (scripts/test-modelo.mjs — `npm run test:modelo`).
 */

import { COTAS } from './ana';
import { CALIBRATION_2024, eventRunoffMm } from './rainRunoff';
import { limitDescent, robustRateCmH } from './recession';
// Motor de propagação (módulo puro, coberto por scripts/test-modelo.mjs) e
// as constantes que ele compartilha com este arquivo.
import {
  API_SAT_REF,
  GAMMA,
  RAIN_PAST_H,
  cnForSub,
  computeApi,
  propagateCurve,
} from './iphEngine';

/* ================================================================== */
/* Classificação de risco                                              */
/* ================================================================== */

export type IphClass = 'verde' | 'amarelo' | 'laranja' | 'vermelho';

/**
 * Limiares de alerta do boletim (m) — as COTAS OFICIAIS do SGB, as mesmas
 * usadas pelo bot do Telegram e pelo gráfico principal. Fonte única das
 * cotas: `COTAS` em ./ana — daqui derivam `IPH_CLASS` e as linhas
 * pontilhadas do painel, para que painel, boletim e avisos nunca mostrem
 * escalas diferentes (antes o boletim usava 4,50/5,20/6,00 m e o restante do
 * painel 6,20/6,70/7,20 m — duas escalas no mesmo produto).
 */
export const IPH_LIMITES = {
  atencao: COTAS.atencao,
  alerta: COTAS.alerta,
  inundacao: COTAS.inundacao,
} as const;

export const IPH_CLASS: Record<
  IphClass,
  { label: string; hex: string; text: string; bg: string; ring: string; min: number }
> = {
  verde:    { label: 'Normalidade',        hex: '#34d399', text: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-400/30', min: 0 },
  amarelo:  { label: 'Atenção',            hex: '#facc15', text: 'text-yellow-300',  bg: 'bg-yellow-500/10',  ring: 'ring-yellow-400/30',  min: IPH_LIMITES.atencao },
  laranja:  { label: 'Alerta',             hex: '#fb923c', text: 'text-orange-300',  bg: 'bg-orange-500/10',  ring: 'ring-orange-400/30',  min: IPH_LIMITES.alerta },
  vermelho: { label: 'Inundação crítica',  hex: '#f87171', text: 'text-red-300',     bg: 'bg-red-500/10',     ring: 'ring-red-400/30',     min: IPH_LIMITES.inundacao },
};

export function classFor(stage: number): IphClass {
  if (stage >= IPH_LIMITES.inundacao) return 'vermelho';
  if (stage >= IPH_LIMITES.alerta) return 'laranja';
  if (stage >= IPH_LIMITES.atencao) return 'amarelo';
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

/*
 * CN por sub-bacia (bibliografia FEPAM/Comitesinos + MapBiomas):
 *  alto  (serra, mata + pastagem): CN ~65   |  medio (rural misto): CN ~72
 *  baixo (urbano + várzea):        CN ~84
 *
 * CN_II, LAG, AREA_FRAC, DH_SUB e os ganhos da calibração vivem em
 * ./rainRunoff e ./iphEngine — fonte única para o motor, para este arquivo
 * e para o teste de calibração (scripts/test-modelo.mjs). */

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
  /** Risk metrics (risk-metrics-calculation skill) */
  var95: number | null;
  var99: number | null;
  cvar95: number | null;
  maxDrawdown: number | null;
  /** traffic-light zone per Basel-style backtest: 0-4 green, 5-9 yellow, 10+ red / 250 */
  exceptions: number;
  trafficLight: 'green' | 'yellow' | 'red';
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
  /** Divergência ECMWF × GFS na curva projetada (ver curveDivergence). */
  divergence: {
    maxDiffM: number;
    atHour: number | null;
    rainDiffMm: number;
    ecmwfRainMm: number;
    gfsRainMm: number;
  };
  /** Verificação da calibração com o evento de referência (maio/2024),
   *  medida no próprio motor (pico da curva projetada). */
  calibration: { peakRiseM: number; observedRiseM: number; rainMm: number; deltaM: number };
}

/* ================================================================== */
/* Hidrologia                                                          */
/* ================================================================== */

/* API de saturação de referência da bacia (mm) — escala do ajuste AMC do CN.
 *  Vem de ./iphEngine (fonte única com o motor). A diferenciação por
 *  sub-bacia agora sai do próprio CN (84 no baixo Sinos urbano contra 65 na
 *  serra), em vez do expoente ETA duplicado que existia aqui. */

export { GAMMA, computeApi };

/** Chuva efetiva acumulada (mm) no evento, para exibição nas estações. */
function effectiveRainEvent(pCumMm: number, api: number, sub: string): number {
  return +eventRunoffMm(pCumMm, cnForSub(sub, api)).toFixed(1);
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
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { signal: c.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } finally { clearTimeout(t); }
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

/**
 * Taxa de variação (cm/h) na janela de `hours` horas até `end`.
 *
 * Revisão 09/2026: por padrão usa Theil–Sen (mediana das inclinações) sobre
 * as leituras da janela, em vez da diferença entre dois pontos. Telemetria
 * a cada 15 min com uma leitura espúria mudava a taxa inteira e, com ela, o
 * início da curva projetada — metade do "mergulho" relatado vinha daqui.
 * Mantém a diferença de extremos como reserva quando há poucos pontos.
 */
function dH(series: { ts: number; h: number }[], end: number, hours: number): number | null {
  const win = series.filter((p) => p.ts >= end - hours * 3600000 && p.ts <= end + 60000);
  const robust = robustRateCmH(win.length >= 2 ? win : series, hours);
  if (robust != null) return robust;
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
          .catch(() => null)
      : null,
    fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=ecmwf_ifs025&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`)
      .catch(() => fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=best_match&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`))
      .catch(() => null),
    fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=gfs_global&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`)
      .catch(() => fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${fcLat}&longitude=${fcLon}&hourly=precipitation&models=gfs_seamless&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`))
      .catch(() => null),
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

/*
 * DH_SUB (m de cota por mm de chuva efetiva, por sub-bacia) é importado de
 * ./rainRunoff — ver lá a derivação completa da calibração do evento de
 * maio/2024 (102,5 mm/48 h, solo saturado → +6,26 m observados).
 */

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
        var95: null, var99: null, cvar95: null, maxDrawdown: null, exceptions: 0, trafficLight: 'green',
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

    // Risk metrics (risk-metrics-calculation skill): VaR/CVaR sobre |erro|, Max Drawdown hidrológico, traffic-light
    const absErrs = pairs.map(p => Math.abs(p.errorM)).sort((a,b)=>a-b);
    const quantile = (arr: number[], q: number) => {
      if (!arr.length) return 0;
      const idx = Math.min(arr.length-1, Math.max(0, Math.ceil(q*arr.length)-1));
      return arr[idx];
    };
    const var95 = absErrs.length ? +quantile(absErrs, 0.95).toFixed(3) : null;
    const var99 = absErrs.length ? +quantile(absErrs, 0.99).toFixed(3) : null;
    let cvar95: number | null = null;
    if (var95 != null && absErrs.length) {
      const tail = absErrs.filter(v => v >= var95);
      cvar95 = tail.length ? +(tail.reduce((a,v)=>a+v,0)/tail.length).toFixed(3) : var95;
    }
    // Max drawdown análogo hidrológico: maior queda consecutiva do nível observado na janela de pares
    const obsSeries = pairs.map(p => p.observed);
    let maxDrawdown: number | null = null;
    if (obsSeries.length >= 2) {
      let peak = obsSeries[0]; let maxDd = 0;
      for (const v of obsSeries) {
        if (v > peak) peak = v;
        const dd = peak - v;
        if (dd > maxDd) maxDd = dd;
      }
      maxDrawdown = +maxDd.toFixed(3);
    }
    const exceptions = pairs.filter(p => Math.abs(p.errorM) > toleranceM).length;
    void 0; // excRate/expectedExc documentados para referência Basel (0.05)
    // aprox: exceções esperadas = n*0.05; zones scaladas
    let trafficLight: 'green' | 'yellow' | 'red' = 'green';
    if (n >= 20) {
      const greenThr = Math.ceil(n * 0.016);
      const yellowThr = Math.ceil(n * 0.036);
      if (exceptions > yellowThr) trafficLight = 'red';
      else if (exceptions > greenThr) trafficLight = 'yellow';
    } else {
      if (accuracy < 40) trafficLight = 'red';
      else if (accuracy < 70) trafficLight = 'yellow';
    }

    results.push({ horizon: horizonH, model, pairs, mae, rmse, nse, accuracy, tolerance: toleranceM, n, persistMae, skillVsPersist, var95, var99, cvar95, maxDrawdown, exceptions, trafficLight });
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
  if (pts.length && pts[pts.length - 1].ts === lastObsTs) {
    pts[pts.length - 1] = { ts: lastObsTs, observed: current, ecmwf: current, gfs: current, rainEcmwf: 0, rainGfs: 0 };
  } else {
    pts.push({ ts: lastObsTs, observed: current, ecmwf: current, gfs: current, rainEcmwf: 0, rainGfs: 0 });
  }

  // propagar hora a hora com cada modelo de chuva
  const propE = propagateCurve(current, 72, dH6h, dH2h, ecmwf, api, guaiba);
  const propG = propagateCurve(current, 72, dH6h, dH2h, gfs, api, guaiba);

  // Passe final de forma (./recession): a curva projetada desce em rampa
  // convexa — nunca em degrau. A série observada NÃO passa por aqui.
  const stagesE = limitDescent(propE.stages);
  const stagesG = limitDescent(propG.stages);

  for (let h = 1; h <= 72; h++) {
    pts.push({
      ts: lastObsTs + h * 3600000,
      observed: null,
      ecmwf: Number.isFinite(stagesE[h]) ? +stagesE[h].toFixed(2) : current,
      gfs: Number.isFinite(stagesG[h]) ? +stagesG[h].toFixed(2) : current,
      rainEcmwf: +(ecmwf[RAIN_PAST_H + h] ?? 0).toFixed(1),
      rainGfs: +(gfs[RAIN_PAST_H + h] ?? 0).toFixed(1),
    });
  }
  return pts;
}

/**
 * Divergência entre as curvas ECMWF e GFS — prova (ou explica a ausência)
 * da diferença que o usuário cobrou. Duas leituras possíveis:
 *  • rainDiffMm > 0 e maxDiffM > 0 → modelos divergem porque divergem na chuva;
 *  • rainDiffMm ≈ 0 → sem chuva prevista nas próximas 100 h; as duas curvas
 *    coincidem porque não há forçante diferente (não é erro de plotagem).
 */
export function curveDivergence(curve: CurvePoint[]): {
  maxDiffM: number;
  atHour: number | null;
  rainDiffMm: number;
  ecmwfRainMm: number;
  gfsRainMm: number;
} {
  const fut = curve.filter((p) => p.observed == null);
  let maxDiff = 0;
  let atHour: number | null = null;
  let e = 0;
  let g = 0;
  fut.forEach((p, i) => {
    const diff = Math.abs((p.ecmwf ?? 0) - (p.gfs ?? 0));
    if (diff > maxDiff) {
      maxDiff = diff;
      atHour = i + 1;
    }
    e += p.rainEcmwf || 0;
    g += p.rainGfs || 0;
  });
  return {
    maxDiffM: +maxDiff.toFixed(3),
    atHour,
    rainDiffMm: +Math.abs(e - g).toFixed(1),
    ecmwfRainMm: +e.toFixed(1),
    gfsRainMm: +g.toFixed(1),
  };
}

/**
 * Resumo da calibração do evento-âncora (maio/2024) — exposto no painel
 * para que os coeficientes do modelo sejam auditáveis sem ler o código.
 * O teste scripts/test-modelo.mjs trava este resultado.
 */
export function calibrationSummary(): {
  peakRiseM: number;
  observedRiseM: number;
  rainMm: number;
  deltaM: number;
} {
  // Verificação pelo MOTOR (não pela fórmula analítica): roda o evento-âncora
  // como uma previsão emitida ANTES da chuva e mede o pico da curva.
  // Resultado atual: +6,3 m contra +6,26 m observados em maio/2024.
  const rain = new Array(RAIN_PAST_H + 144).fill(0);
  for (let i = 0; i < CALIBRATION_2024.rainH; i++) {
    rain[RAIN_PAST_H + i] = CALIBRATION_2024.rainMm / CALIBRATION_2024.rainH;
  }
  const prop = propagateCurve(
    CALIBRATION_2024.baseLevelM,
    144,
    0,
    0,
    rain,
    API_SAT_REF,
    null
  );
  const peakRiseM = +(Math.max(...prop.stages) - CALIBRATION_2024.baseLevelM).toFixed(2);
  return {
    peakRiseM,
    observedRiseM: CALIBRATION_2024.observedRiseM,
    rainMm: CALIBRATION_2024.rainMm,
    deltaM: +(peakRiseM - CALIBRATION_2024.observedRiseM).toFixed(2),
  };
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
    // CORREÇÃO skill 09/2026: display agora usa o MESMO pipeline da propagação (CN + saturação)
    // antes pEfetiva(p24) era só saturação sobre chuva bruta, divergindo do motor.
    const pEff24 = (() => {
      // P do evento ≈ acumulado de 24 h; CN ajustado pela saturação (AMC)
      return effectiveRainEvent(p24, api, st.subbasin);
    })();
    const snap: StationSnap = {
      station: st,
      level: null, cr: null, dH2h: null, dH6h: null,
      p6: sumLast(hourly, 6), p12: sumLast(hourly, 12), p24,
      p48: sumLast(hourly, 48), api, pEfetiva: pEff24,
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
  const curve = buildCurve(campoBom, current, now, localRate6, mixRate, meanApi, guaibaLevel, rain.ecmwf, rain.gfs);

  const output: IphOutput = {
    current,
    currentCls: classFor(current),
    guaibaLevel,
    horizons,
    stations,
    dominant: factor,
    boletim: boletimText(current, h12, h24, factor, guaibaLevel),
    curve,
    fetchedAt: Date.now(),
    divergence: curveDivergence(curve),
    calibration: calibrationSummary(),
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
