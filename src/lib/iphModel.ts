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
 *
 * Revisão 09/2026-C (relato: "ontem a previsão dizia que o rio ia parar de
 * subir e descer; hoje continuou subindo") — verificado com a telemetria
 * real de 21–24/09/2026 (scripts/fixtures/evento-2026-09.mjs):
 *  ✓ CAUSA 1 — recessão contada em dobro: a taxa observada de Campo Bom já
 *    é líquida (inclui a recessão natural), mas o motor somava por cima
 *    −K·(H−H_base) ≈ −1,8 cm/h a 6,5 m. Com o rio subindo 1,5 cm/h, a
 *    curva virava para baixo. Agora a recessão só age sobre a fração não
 *    observada da taxa (iphEngine.propagateCurve, persist[t]).
 *  ✓ CAUSA 2 — taxa de Taquara sem defasagem: 60 % da taxa ATUAL de
 *    Taquara (já descendo desde 23/09 01h) entrava instantaneamente em
 *    Campo Bom, mas a onda leva > 1 dia pelos banhados. Agora: roteamento
 *    lag + reservatório linear (upstreamRouting.ts) com Araricá (87377500,
 *    antes ignorada, a 10 km de CB) e Taquara.
 *    Resultado em 11 previsões (22/09 03h → 24/09 09h), erro em +24 h:
 *    modelo antigo RMSE 0,49 m / viés −0,48 m → novo RMSE 0,04 m.
 *  ✓ Todas as estações telemétricas da ANA na bacia a montante de CB
 *    (12, exceto UHEs) + 17 pontos CEMADEN/DC dentro do polígono: chuva
 *    média areal por sub-bacia (ANA medido; Open-Meteo onde não há) no
 *    lugar do IDW centrado em Campo Bom; previsão ECMWF/GFS no centróide
 *    de cada sub-bacia; Guaíba e São Leopoldo saíram da chuva a montante.
 *  ✓ Rota /api/ana/serie criada no servidor (o cliente já a chamava, mas
 *    ela não existia — tudo dependia de proxies públicos).
 *  ✗ Testado e NÃO adotado: hidrograma unitário triangular SCS no lugar
 *    do lag puro — piorou o ajuste do evento (RMSE 0,83–0,90 m × 0,77 m).
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
  SUB_AREA_FRAC,
  cnForSub,
  computeApi,
  propagateCurve,
  type PropagateOpts,
} from './iphEngine';
import { ROUTING, guideForCampoBom, type UpstreamInput } from './upstreamRouting';

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

export type Sub = 'alto' | 'medio' | 'baixo';

export interface IphStation {
  id: string;
  name: string;
  city: string;
  /** código telemétrico da ANA; null = ponto sem telemetria (chuva Open-Meteo) */
  anaCode: string | null;
  /** fluvio = tem régua (nível) + pluviômetro; pluvio = só chuva */
  kind: 'fluvio' | 'pluvio';
  lat: number;
  lon: number;
  /** sub-bacia: alto (cabeceiras), medio, baixo */
  subbasin: Sub;
  /** cota crítica local (m, referência da estação); 0 = não definida */
  critical: number;
  /** fonte da chuva: 'ana' (pluviômetro telemétrico) ou 'om' (Open-Meteo no ponto) */
  rainFrom: 'ana' | 'om';
  /** id em ROUTING (upstreamRouting.ts) — nível entra no guia de taxa */
  routeId?: string;
}

/*
 * ESTAÇÕES DO MODELO — revisão 09/2026-C.
 *
 * TODAS as estações telemétricas da ANA dentro da bacia do Sinos a montante
 * de Campo Bom (ListaEstacoesTelemetricas, verificadas transmitindo em
 * 24/09/2026; as 4 estações de UHE do Paranhana foram excluídas — nível de
 * reservatório operado não é sinal de cheia natural), mais os pontos
 * CEMADEN/Defesa Civil dentro do polígono da bacia (basin.ts) sem
 * telemetria pública, usados com a chuva Open-Meteo no ponto.
 *
 * Saíram da conta a montante: Guaíba/Gasômetro (87450020, fica em Porto
 * Alegre, fora da bacia — segue só como condição de contorno de remanso) e
 * São Leopoldo (87382000, a JUSANTE de Campo Bom: a chuva lá não chega a
 * Campo Bom). Corrigido: "Canastra 2950123" era o código Defesa Civil de
 * Rolante — Rio Mascarada, que tem telemetria ANA própria (87337010).
 */
export const IPH_STATIONS: IphStation[] = [
  // ---- Alto Sinos / Rolante (ANA, medido) ----
  { id: 'caraa',         name: 'Caraá',                     city: 'Caraá',       anaCode: '87318700', kind: 'fluvio', lat: -29.7692, lon: -50.3572, subbasin: 'alto',  critical: 0,   rainFrom: 'ana' },
  { id: 'arroio-caraa',  name: 'Arroio Caraá',              city: 'Caraá',       anaCode: '87318000', kind: 'fluvio', lat: -29.7908, lon: -50.4217, subbasin: 'alto',  critical: 0,   rainFrom: 'ana' },
  { id: 'faz-taipas',    name: 'Fazenda Taipas',            city: 'Riozinho',    anaCode: '2950108',  kind: 'pluvio', lat: -29.4686, lon: -50.4519, subbasin: 'alto',  critical: 0,   rainFrom: 'ana' },
  { id: 'rol-mascarada', name: 'Rolante — Rio Mascarada',   city: 'Rolante',     anaCode: '87337010', kind: 'fluvio', lat: -29.5825, lon: -50.4697, subbasin: 'alto',  critical: 0,   rainFrom: 'ana' },
  { id: 'alto-rolante',  name: 'Alto Rolante',              city: 'Rolante',     anaCode: '87350000', kind: 'fluvio', lat: -29.645,  lon: -50.5106, subbasin: 'alto',  critical: 0,   rainFrom: 'ana' },
  { id: 'rolante',       name: 'Rolante — Centro',          city: 'Rolante',     anaCode: '87351000', kind: 'fluvio', lat: -29.6653, lon: -50.5819, subbasin: 'alto',  critical: 0,   rainFrom: 'ana' },
  // ---- Alto Sinos (Open-Meteo no ponto, sem telemetria pública) ----
  { id: 'riozinho',      name: 'Riozinho — Centro',         city: 'Riozinho',    anaCode: null, kind: 'pluvio', lat: -29.6406, lon: -50.4597, subbasin: 'alto',  critical: 0, rainFrom: 'om' },
  { id: 'rol-boaesp',    name: 'Boa Esperança',             city: 'Rolante',     anaCode: null, kind: 'pluvio', lat: -29.5586, lon: -50.5025, subbasin: 'alto',  critical: 0, rainFrom: 'om' },
  { id: 'rol-mataolho',  name: 'Mata Olho',                 city: 'Rolante',     anaCode: null, kind: 'pluvio', lat: -29.5803, lon: -50.5561, subbasin: 'alto',  critical: 0, rainFrom: 'om' },
  { id: 'rol-rolantinho',name: 'Alto Rolantinho',           city: 'Rolante',     anaCode: null, kind: 'pluvio', lat: -29.6904, lon: -50.5498, subbasin: 'alto',  critical: 0, rainFrom: 'om' },
  // ---- Médio Sinos / Paranhana (ANA, medido) ----
  { id: 'tres-coroas',   name: 'Três Coroas',               city: 'Três Coroas', anaCode: '87366500', kind: 'fluvio', lat: -29.47,   lon: -50.7594, subbasin: 'medio', critical: 0,   rainFrom: 'ana' },
  { id: 'igrejinha',     name: 'Igrejinha',                 city: 'Igrejinha',   anaCode: '87375500', kind: 'fluvio', lat: -29.5736, lon: -50.7964, subbasin: 'medio', critical: 0,   rainFrom: 'ana' },
  { id: 'taquara',       name: 'Taquara (Foz Paranhana)',   city: 'Taquara',     anaCode: '87376000', kind: 'fluvio', lat: -29.6858, lon: -50.8122, subbasin: 'medio', critical: 5.9, rainFrom: 'ana', routeId: 'taquara' },
  // ---- Médio Sinos (Open-Meteo no ponto) ----
  { id: 'tc-raft',       name: 'Três Coroas — Raft Park',   city: 'Três Coroas', anaCode: null, kind: 'pluvio', lat: -29.4253, lon: -50.7719, subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'tc-ctr',        name: 'Três Coroas — Centro',      city: 'Três Coroas', anaCode: null, kind: 'pluvio', lat: -29.515,  lon: -50.775,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'tc-vp',         name: 'Três Coroas — V. Pinheiros',city: 'Três Coroas', anaCode: null, kind: 'pluvio', lat: -29.5161, lon: -50.8031, subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'ig-fig2',       name: 'Igrejinha — Figueira II',   city: 'Igrejinha',   anaCode: null, kind: 'pluvio', lat: -29.54,   lon: -50.781,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'ig-fig',        name: 'Igrejinha — Figueira',      city: 'Igrejinha',   anaCode: null, kind: 'pluvio', lat: -29.555,  lon: -50.789,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'ig-bp',         name: 'Igrejinha — Bom Pastor',    city: 'Igrejinha',   anaCode: null, kind: 'pluvio', lat: -29.569,  lon: -50.807,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'ig-xv',         name: 'Igrejinha — XV de Novembro',city: 'Igrejinha',   anaCode: null, kind: 'pluvio', lat: -29.589,  lon: -50.804,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'parobe-inv',    name: 'Parobé — Invernada',        city: 'Parobé',      anaCode: null, kind: 'pluvio', lat: -29.601,  lon: -50.821,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  { id: 'parobe-paraiso',name: 'Parobé — Paraíso',          city: 'Parobé',      anaCode: null, kind: 'pluvio', lat: -29.629,  lon: -50.815,  subbasin: 'medio', critical: 0, rainFrom: 'om' },
  // ---- Baixo Sinos até Campo Bom (ANA, medido) ----
  { id: 'nova-hartz',    name: 'Nova Hartz',                city: 'Nova Hartz',  anaCode: '87377400', kind: 'fluvio', lat: -29.5933, lon: -50.9028, subbasin: 'baixo', critical: 0,   rainFrom: 'ana' },
  { id: 'ararica',       name: 'Araricá',                   city: 'Araricá',     anaCode: '87377500', kind: 'fluvio', lat: -29.6908, lon: -50.9417, subbasin: 'baixo', critical: 0,   rainFrom: 'ana', routeId: 'ararica' },
  { id: 'campo-bom',     name: 'Campo Bom',                 city: 'Campo Bom',   anaCode: '87380000', kind: 'pluvio', lat: -29.6917, lon: -51.0461, subbasin: 'baixo', critical: 0,   rainFrom: 'ana' },
  // ---- Baixo Sinos (Open-Meteo no ponto) ----
  { id: 'sapiranga',     name: 'Sapiranga (Toca)',          city: 'Sapiranga',   anaCode: null, kind: 'pluvio', lat: -29.6333, lon: -51.0,    subbasin: 'baixo', critical: 0, rainFrom: 'om' },
  { id: 'cb-quatrocol',  name: 'Campo Bom — Quatro Colônias',city: 'Campo Bom',  anaCode: null, kind: 'pluvio', lat: -29.664,  lon: -51.035,  subbasin: 'baixo', critical: 0, rainFrom: 'om' },
  { id: 'cb-bairrok',    name: 'Campo Bom — Bairro K',      city: 'Campo Bom',   anaCode: null, kind: 'pluvio', lat: -29.683,  lon: -51.047,  subbasin: 'baixo', critical: 0, rainFrom: 'om' },
  { id: 'cb-barrinha',   name: 'Campo Bom — Barrinha',      city: 'Campo Bom',   anaCode: null, kind: 'pluvio', lat: -29.695,  lon: -51.042,  subbasin: 'baixo', critical: 0, rainFrom: 'om' },
];

/** Centróides aproximados das sub-bacias — pontos da previsão ECMWF/GFS. */
export const SUB_CENTROIDS: Record<Sub, { lat: number; lon: number }> = {
  alto: { lat: -29.66, lon: -50.45 },
  medio: { lat: -29.52, lon: -50.78 },
  baixo: { lat: -29.66, lon: -50.95 },
};

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
  /** entrou na média areal da sua sub-bacia */
  inAreal: boolean;
  /** fonte da chuva: 'ANA' (medido), 'Open-Meteo' (modelo) ou 'sem dados' (fonte indisponível) */
  rainSource: 'ANA' | 'Open-Meteo' | 'sem dados';
}

/** Estação fluviométrica a montante — nível, tendência e papel no guia. */
export interface UpstreamSnap {
  id: string;
  name: string;
  subbasin: Sub;
  level: number | null;
  /** taxa atual (cm/h, média das últimas 3 h) */
  rateCmH: number | null;
  /** hora da última leitura */
  lastTs: number | null;
  /** entra no guia de taxa (roteamento calibrado) */
  inGuide: boolean;
  lagH: number | null;
  kH: number | null;
  gain: number | null;
  /** motivo quando não entra no guia */
  note: string;
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
  /** Estações fluviométricas a montante (monitoramento + guia de taxa). */
  upstream: UpstreamSnap[];
  /** Guia de taxa: até que hora a previsão é "já medida" a montante. */
  guide: { horizonH: number; sources: string[] };
  /** Chuva média areal por sub-bacia (fonte e estações usadas). */
  subRain: SubRain[];
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
  /** chuva por hora cheia (chave = ts da hora, ms) — só horas com registro */
  rainByHour: Map<number, number>;
}

const EMPTY_SERIES = (): AnaSeries => ({ levels: [], rainByHour: new Map() });

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
  if (doc.getElementsByTagName('parsererror').length) return EMPTY_SERIES();

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

  const rainByHour = new Map<number, number>();
  for (const r of recs) {
    if (r.chuvaMm == null || r.chuvaMm < 0) continue;
    const k = Math.floor(r.ts / 3600000) * 3600000;
    rainByHour.set(k, (rainByHour.get(k) ?? 0) + r.chuvaMm);
  }

  return { levels, rainByHour };
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
 * Busca telemetria da ANA (nível + chuva) em UM único fetch por estação.
 * 1) backend próprio `/api/ana/serie` (sem CORS, cache de 10 min, reserva
 *    stale, lista fechada de códigos da bacia);
 * 2) contingência: proxies públicos + parser XML.
 */
async function fetchAnaData(code: string, days: number): Promise<AnaSeries> {
  try {
    const json = await fetchJson(`/api/ana/serie?codEstacao=${code}&days=${days}`);
    const levels: { ts: number; h: number }[] = [];
    for (const r of (json?.readings ?? []) as { ts: number; level: number }[]) {
      if (Number.isFinite(r.ts) && Number.isFinite(r.level) && r.level > 0) levels.push({ ts: r.ts, h: r.level });
    }
    const rainByHour = new Map<number, number>();
    for (const r of (json?.rain ?? []) as { ts: number; mm: number }[]) {
      if (!Number.isFinite(r.ts) || !Number.isFinite(r.mm) || r.mm < 0) continue;
      const k = Math.floor(r.ts / 3600000) * 3600000;
      rainByHour.set(k, (rainByHour.get(k) ?? 0) + r.mm);
    }
    if (levels.length || rainByHour.size) return { levels, rainByHour };
  } catch { /* segue para os proxies */ }

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
      if (s.levels.length || s.rainByHour.size) return s;
    } catch { /* tenta o próximo proxy */ }
  }
  return EMPTY_SERIES();
}

function parseOmHour(iso: string): number {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}


/**
 * Arrays contínuos passado+futuro: RAIN_PAST_H horas de passado +
 * RAIN_FUT_H de futuro. Índice RAIN_PAST_H = agora (t=0).
 */
const RAIN_FUT_H = 100;
const RAIN_TL_LEN = RAIN_PAST_H + RAIN_FUT_H;
/** horas de histórico de chuva (API usa 14 dias) */
const RAIN_HIST_H = 14 * 24;
/** estação ANA "válida" para a média se tiver registro nas últimas N horas */
const ANA_FRESH_H = 6;

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

/** Série horária de RAIN_HIST_H horas terminando na hora de `now` (último índice). */
function hourlyFromMap(m: Map<number, number>, now: number): number[] {
  const endH = Math.floor(now / 3600000) * 3600000;
  const out = new Array(RAIN_HIST_H).fill(0);
  for (let i = 0; i < RAIN_HIST_H; i++) out[i] = +(m.get(endH - (RAIN_HIST_H - 1 - i) * 3600000) ?? 0).toFixed(2);
  return out;
}

function hourlyFromOm(block: any, now: number): number[] | null {
  const times = (block?.hourly?.time as string[]) ?? [];
  const vals = (block?.hourly?.precipitation as number[]) ?? [];
  if (!times.length) return null;
  const m = new Map<number, number>();
  for (let i = 0; i < times.length; i++) {
    const ts = parseOmHour(times[i]);
    if (Number.isFinite(ts) && ts <= now) m.set(Math.floor(ts / 3600000) * 3600000, Number(vals[i]) || 0);
  }
  return m.size ? hourlyFromMap(m, now) : null;
}

export interface SubRain {
  sub: Sub;
  /** fonte da média areal: 'ANA' (pluviômetros medidos) | 'Open-Meteo' | 'sem dados' */
  source: 'ANA' | 'Open-Meteo' | 'sem dados';
  /** ids das estações que entraram na média */
  stations: string[];
  p24: number;
  p48: number;
  api: number;
}

interface RainPack {
  /** chuva horária por estação (RAIN_HIST_H h, último índice = agora); ausente = sem dados */
  past: Record<string, number[]>;
  /** fonte efetiva por estação */
  srcOf: Record<string, 'ANA' | 'Open-Meteo'>;
  /** média areal por sub-bacia (RAIN_HIST_H h) — null = sem dados */
  subPast: Record<Sub, number[] | null>;
  subInfo: SubRain[];
  /** previsão por sub-bacia (centróide), passado recente + futuro */
  ecmwfBySub: Record<Sub, number[]>;
  gfsBySub: Record<Sub, number[]>;
  /** média da bacia ponderada por área (compatibilidade: curva/backtest/painel) */
  ecmwf: number[];
  gfs: number[];
  /** níveis das estações fluviométricas (id → série) */
  levels: Record<string, { ts: number; h: number }[]>;
}

const SUBS: Sub[] = ['alto', 'medio', 'baixo'];

function areaMean(bySub: Record<Sub, number[] | null>, len: number): number[] | null {
  let wsum = 0;
  const out = new Array(len).fill(0);
  for (const sub of SUBS) {
    const arr = bySub[sub];
    if (!arr) continue;
    wsum += SUB_AREA_FRAC[sub];
    for (let i = 0; i < len; i++) out[i] += (arr[i] ?? 0) * SUB_AREA_FRAC[sub];
  }
  return wsum > 0 ? out.map((v) => +(v / wsum).toFixed(2)) : null;
}

/**
 * Busca a chuva de TODAS as estações da bacia + nível das fluviométricas +
 * previsão ECMWF/GFS nos centróides das 3 sub-bacias.
 *
 * Média areal por sub-bacia (hydrologic-modeling-engine: precipitação média
 * da bacia): se a sub-bacia tem ≥ 1 pluviômetro ANA transmitindo, usa a
 * média dos pluviômetros ANA (medido); senão, a média dos pontos Open-Meteo
 * da sub-bacia (modelo). A antiga ponderação IDW centrada em Campo Bom dava
 * peso ~0 às cabeceiras — justamente onde nasce a cheia.
 */
async function fetchRainPack(now: number): Promise<RainPack> {
  const omStations = IPH_STATIONS.filter((s) => s.rainFrom === 'om');
  const anaStations = IPH_STATIONS.filter((s) => s.anaCode);
  const om = (model: string, fallback: string) => {
    const lats = SUBS.map((k) => SUB_CENTROIDS[k].lat).join(',');
    const lons = SUBS.map((k) => SUB_CENTROIDS[k].lon).join(',');
    const u = (m: string) =>
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation&models=${m}&past_days=3&forecast_days=5&timezone=America%2FSao_Paulo`;
    return fetchJson(u(model)).catch(() => fetchJson(u(fallback))).catch(() => null);
  };

  const [hist, ecm, gfs, ...anaResults] = await Promise.all([
    omStations.length
      ? fetchJson(
          `https://api.open-meteo.com/v1/forecast?latitude=${omStations.map((s) => s.lat).join(',')}&longitude=${omStations.map((s) => s.lon).join(',')}&hourly=precipitation&past_days=14&forecast_days=1&timezone=America%2FSao_Paulo`
        ).catch(() => null)
      : null,
    om('ecmwf_ifs025', 'best_match'),
    om('gfs_global', 'gfs_seamless'),
    ...anaStations.map((s) => fetchAnaData(s.anaCode as string, 14).catch(EMPTY_SERIES)),
  ]);

  const past: Record<string, number[]> = {};
  const srcOf: Record<string, 'ANA' | 'Open-Meteo'> = {};
  const levels: Record<string, { ts: number; h: number }[]> = {};
  if (hist) {
    const list = Array.isArray(hist) ? hist : [hist];
    list.forEach((blk: any, i: number) => {
      const st = omStations[i];
      const arr = st ? hourlyFromOm(blk, now) : null;
      if (st && arr) { past[st.id] = arr; srcOf[st.id] = 'Open-Meteo'; }
    });
  }
  const freshAna = new Set<string>();
  anaResults.forEach((data: AnaSeries, i: number) => {
    const st = anaStations[i];
    if (!st) return;
    if (data.levels.length) levels[st.id] = data.levels;
    if (st.rainFrom === 'ana' && data.rainByHour.size) {
      past[st.id] = hourlyFromMap(data.rainByHour, now);
      srcOf[st.id] = 'ANA';
      const lastRec = Math.max(...data.rainByHour.keys());
      if (now - lastRec <= ANA_FRESH_H * 3600000) freshAna.add(st.id);
    }
  });

  const subPast = { alto: null, medio: null, baixo: null } as Record<Sub, number[] | null>;
  const subInfo: SubRain[] = [];
  for (const sub of SUBS) {
    const inSub = IPH_STATIONS.filter((s) => s.subbasin === sub);
    let used = inSub.filter((s) => srcOf[s.id] === 'ANA' && freshAna.has(s.id));
    let source: SubRain['source'] = 'ANA';
    if (!used.length) { used = inSub.filter((s) => srcOf[s.id] === 'Open-Meteo'); source = 'Open-Meteo'; }
    if (!used.length) { subInfo.push({ sub, source: 'sem dados', stations: [], p24: 0, p48: 0, api: 0 }); continue; }
    const mean = new Array(RAIN_HIST_H).fill(0);
    for (const s of used) past[s.id].forEach((v, i) => { mean[i] += v / used.length; });
    subPast[sub] = mean.map((v) => +v.toFixed(2));
    subInfo.push({ sub, source, stations: used.map((s) => s.id), p24: sumLast(mean, 24), p48: sumLast(mean, 48), api: computeApi(mean) });
  }

  const fcBlock = (j: any, i: number) => {
    const list = Array.isArray(j) ? j : j ? [j] : [];
    const b = list[i] ?? list[0];
    return buildRainTimeline((b?.hourly?.time as string[]) ?? [], (b?.hourly?.precipitation as number[]) ?? [], now);
  };
  const ecmwfBySub = {} as Record<Sub, number[]>;
  const gfsBySub = {} as Record<Sub, number[]>;
  SUBS.forEach((sub, i) => {
    const e = fcBlock(ecm, i);
    const g = fcBlock(gfs, i);
    // passado (índices < RAIN_PAST_H): chuva MEDIDA da sub-bacia quando há —
    // a "previsão" do passado é só a análise do modelo
    const sp = subPast[sub];
    if (sp) for (let k = 0; k < RAIN_PAST_H; k++) { const v = sp[RAIN_HIST_H - RAIN_PAST_H + k]; e[k] = v; g[k] = v; }
    ecmwfBySub[sub] = e;
    gfsBySub[sub] = g;
  });

  return {
    past, srcOf, subPast, subInfo, ecmwfBySub, gfsBySub, levels,
    ecmwf: areaMean(ecmwfBySub, RAIN_TL_LEN) ?? new Array(RAIN_TL_LEN).fill(0),
    gfs: areaMean(gfsBySub, RAIN_TL_LEN) ?? new Array(RAIN_TL_LEN).fill(0),
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
  upstream: UpstreamInput[] = []
): BacktestResult[] {
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

      // Mesmo caminho da previsão real: taxa local 2 h/6 h até a origem +
      // guia das estações a montante com leituras ATÉ a origem (sem futuro).
      // Aproximação mantida: API/Guaíba atuais para as origens históricas.
      const cbUntil = campoBom.filter((p) => p.ts <= tOrigin);
      const rate2 = dH(cbUntil, tOrigin, 2);
      const rate6 = dH(cbUntil, tOrigin, 6);
      const g = guideForCampoBom(upstream, campoBom, tOrigin, rate2, horizonH);

      // fatia alinhada: índice RAIN_PAST_H == tOrigin; o motor lê a chuva
      // em RAIN_PAST_H + t − lag (t = 1..horizonte), ou seja, só usa chuva
      // da janela [tOrigin − lag_max, tOrigin + horizonte] — sem futuro.
      const tOriginHour = Math.floor(tOrigin / 3600000) * 3600000;
      const rainSlice: number[] = new Array(RAIN_PAST_H + horizonH + 1).fill(0);
      for (let k = 0; k < rainSlice.length; k++) {
        rainSlice[k] = rainByHour.get(tOriginHour + (k - RAIN_PAST_H) * 3600000) ?? 0;
      }

      const prop = propagateCurve(hOrigin, horizonH, rate6, rate2, rainSlice, meanApi, guaiba, {
        rateGuideCmH: g.rates ?? undefined,
      });
      const predicted = limitDescent(prop.stages)[horizonH] ?? hOrigin;
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

function dominantFactor(
  upstream: UpstreamSnap[],
  guideH: number,
  meanApi: number,
  inertial: number,
  rain: number,
  rem: number
): string {
  if (rem > 0.05) return `Efeito de remanso do Guaíba (nível elevado a jusante impedindo o escoamento).`;
  const tq = upstream.find((u) => u.id === 'taquara');
  const ar = upstream.find((u) => u.id === 'ararica');
  if (guideH > 0 && Math.abs(inertial) >= Math.abs(rain)) {
    const parts: string[] = [];
    if (ar?.rateCmH != null) parts.push(`Araricá ${ar.rateCmH > 0 ? '+' : ''}${ar.rateCmH.toFixed(1).replace('.', ',')} cm/h`);
    if (tq?.rateCmH != null) parts.push(`Taquara ${tq.rateCmH > 0 ? '+' : ''}${tq.rateCmH.toFixed(1).replace('.', ',')} cm/h`);
    const dir = inertial > 0.02 ? 'subida' : inertial < -0.02 ? 'descida' : 'estabilização';
    return `Onda já medida a montante (${parts.join(', ')}) propagada até Campo Bom — ${dir} nas próximas ${guideH} h.`;
  }
  if (rain > Math.abs(inertial) && rain > 0.08) return 'Chuva efetiva na bacia (solo convertendo precipitação em escoamento).';
  if (meanApi > 100) return 'Saturação do solo (API elevado) — chuva adicional vira vazão rapidamente.';
  if (inertial > 0.05) return 'Tendência de subida observada em Campo Bom.';
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
  gfs: number[],
  optsE: PropagateOpts = {},
  optsG: PropagateOpts = {}
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
  const propE = propagateCurve(current, 72, dH6h, dH2h, ecmwf, api, guaiba, optsE);
  const propG = propagateCurve(current, 72, dH6h, dH2h, gfs, api, guaiba, optsG);

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
  const localRate6 = dH(campoBom, now, 6);

  // cada estação falha de forma independente: estação fora do ar degrada o
  // modelo (sai do guia / da média areal), mas não derruba a curva
  const [guaibaData, rain] = await Promise.all([
    fetchAnaData('87450020', 3).catch(EMPTY_SERIES),
    fetchRainPack(now),
  ]);
  const guaibaRaw = guaibaData.levels;
  if (!guaibaRaw.length) console.warn('[iph] Guaíba (87450020): sem níveis — efeito de remanso desativado nesta projeção.');
  const guaibaLevel = guaibaRaw.length ? guaibaRaw[guaibaRaw.length - 1].h : null;

  // ---- estações a montante: nível, tendência e guia de taxa ----
  const fluvio = IPH_STATIONS.filter((s) => s.kind === 'fluvio');
  const upstreamInput: UpstreamInput[] = fluvio
    .filter((s) => s.routeId && rain.levels[s.id]?.length)
    .map((s) => ({ id: s.routeId as string, name: s.name, levels: rain.levels[s.id] }));
  const g = guideForCampoBom(upstreamInput, campoBom, now, localRate, 72);
  const upstream: UpstreamSnap[] = fluvio.map((s) => {
    const lv = rain.levels[s.id] ?? [];
    const last = lv.length ? lv[lv.length - 1] : null;
    const r = s.routeId ? g.routed.find((x) => x.id === s.routeId) : undefined;
    const p = s.routeId ? ROUTING[s.routeId] : undefined;
    const stale = last != null && now - last.ts > 6 * 3600000;
    const note = r
      ? 'no guia'
      : p
        ? !last ? 'sem leituras' : stale ? 'leitura com mais de 6 h' : 'sem dados suficientes'
        : !last ? 'sem leituras' : 'monitoramento (sem calibração de propagação)';
    return {
      id: s.id,
      name: s.name,
      subbasin: s.subbasin,
      level: last?.h ?? null,
      rateCmH: lv.length ? dH(lv, last!.ts, 3) : null,
      lastTs: last?.ts ?? null,
      inGuide: !!r,
      lagH: p?.lag ?? null,
      kH: p?.k ?? null,
      gain: p?.gain ?? null,
      note,
    };
  });
  for (const u of upstream) if (u.lastTs == null) console.warn(`[iph] ${u.name}: sem leituras de nível.`);

  // ---- chuva: estações e média areal por sub-bacia ----
  const stations: StationSnap[] = IPH_STATIONS.map((st) => {
    const hourly = rain.past[st.id] ?? [];
    const api = computeApi(hourly);
    const p24 = sumLast(hourly, 24);
    const lv = rain.levels[st.id] ?? [];
    const level = st.kind === 'fluvio' && lv.length ? lv[lv.length - 1].h : null;
    return {
      station: st,
      level,
      cr: level != null && st.critical > 0 ? +(level - st.critical).toFixed(2) : null,
      dH2h: st.kind === 'fluvio' && lv.length ? dH(lv, lv[lv.length - 1].ts, 2) : null,
      dH6h: st.kind === 'fluvio' && lv.length ? dH(lv, lv[lv.length - 1].ts, 6) : null,
      p6: sumLast(hourly, 6), p12: sumLast(hourly, 12), p24,
      p48: sumLast(hourly, 48), api,
      pEfetiva: effectiveRainEvent(p24, api, st.subbasin),
      inAreal: rain.subInfo.some((x) => x.stations.includes(st.id)),
      rainSource: rain.srcOf[st.id] ?? 'sem dados',
    };
  });
  for (const s of stations) {
    if (s.station.rainFrom === 'ana' && s.rainSource === 'sem dados') {
      console.warn(`[iph] ${s.station.name}: chuva ANA indisponível — fora da média areal.`);
    }
  }

  // API da bacia = média ponderada por área das sub-bacias com dados
  const withApi = rain.subInfo.filter((x) => x.source !== 'sem dados');
  const wApi = withApi.reduce((a, x) => a + SUB_AREA_FRAC[x.sub], 0);
  const meanApi = wApi > 0 ? +(withApi.reduce((a, x) => a + x.api * SUB_AREA_FRAC[x.sub], 0) / wApi).toFixed(1) : 0;

  const optsE: PropagateOpts = { rateGuideCmH: g.rates ?? undefined, rainBySub: rain.ecmwfBySub };
  const optsG: PropagateOpts = { rateGuideCmH: g.rates ?? undefined, rainBySub: rain.gfsBySub };

  // curva ECMWF de referência para os horizontes — mesmo passe final de forma
  // da curva do gráfico (antes os cartões usavam a curva crua)
  const propRef = propagateCurve(current, 24, localRate6, localRate, rain.ecmwf, meanApi, guaibaLevel, optsE);
  const refStages = limitDescent(propRef.stages);

  const horizons: HorizonForecast[] = ([6, 12, 24] as const).map((hours) => {
    const stage = +refStages[hours].toFixed(2);
    const inerSum = propRef.inertials.slice(1, hours + 1).reduce((a, v) => a + v, 0);
    const rainSum = propRef.rains.slice(1, hours + 1).reduce((a, v) => a + v, 0);
    const remSum = propRef.rems.slice(1, hours + 1).reduce((a, v) => a + v, 0);
    return { hours, stage, cls: classFor(stage), inertial: +inerSum.toFixed(3), rain: +rainSum.toFixed(3), remanso: +remSum.toFixed(3) };
  });

  const h12 = horizons[1];
  const h24 = horizons[2];
  const factor = dominantFactor(upstream, g.guide.horizonH, meanApi, h24.inertial, h24.rain, h24.remanso);

  const sumH = (arr: number[], n: number) => arr.slice(RAIN_PAST_H, RAIN_PAST_H + n).reduce((s, v) => s + (v || 0), 0);
  const curve = buildCurve(campoBom, current, now, localRate6, localRate, meanApi, guaibaLevel, rain.ecmwf, rain.gfs, optsE, optsG);

  const output: IphOutput = {
    current,
    currentCls: classFor(current),
    guaibaLevel,
    horizons,
    stations,
    upstream,
    guide: {
      horizonH: g.guide.horizonH,
      sources: [...new Set(g.guide.source.filter((x): x is string => !!x))],
    },
    subRain: rain.subInfo,
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
      ...runBacktest(campoBom, pastE, pastG, now, meanApi, guaibaLevel, 6, 0.15, upstreamInput),
      ...runBacktest(campoBom, pastE, pastG, now, meanApi, guaibaLevel, 12, 0.25, upstreamInput),
      ...runBacktest(campoBom, pastE, pastG, now, meanApi, guaibaLevel, 24, 0.40, upstreamInput),
    ];
  } catch (err) {
    console.warn('[iph] validação retrospectiva indisponível:', err instanceof Error ? err.message : err);
  }

  return output;
}
