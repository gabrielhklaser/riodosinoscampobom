/**
 * MODELO CONCEITUAL ESTATÍSTICO DE ALERTA DE INUNDAÇÃO
 * =====================================================
 * Campo Bom como Ponto Focal Y(t+Δt), classificando o risco por pontuação
 * ponderada a partir das estações a montante na Bacia do Rio dos Sinos.
 *
 * ESTAÇÕES DISPONÍVEIS (validadas no inventário e webservice da ANA):
 *
 *   FLUVIOMÉTRICAS (retornam nível em tempo real):
 *     · 87376000  Foz do Paranhana (Taquara)    35 km montante  Δt ≈ 7 h
 *     · 87380000  Campo Bom (já é o ponto focal — referência)
 *
 *   PLUVIOMÉTRICAS (chuva horária via Open-Meteo):
 *     · 2950119   Caraá                          ~120 km         Δt ≈ 20 h
 *     · 2950098   Alto Rolante                    ~85 km         Δt ≈ 16 h
 *     · 2950122   Rolante Centro                  ~70 km         Δt ≈ 14 h
 *     · 2950123   Rolante (Rio Mascarada)         ~75 km         Δt ≈ 15 h
 *     · 2951040   Sapiranga (Toca)                ~12 km         Δt ≈ 2.5 h
 *
 * Cotas críticas:
 *   · Foz do Paranhana: referência local estimada em 7,20 m para o trecho
 *     (a régua ali não tem cota de inundação publicada no inventário da ANA
 *     como as estações do SACE; usa-se o percentual da cota de Campo Bom
 *     proporcional à área de drenagem: 2380/2900 ≈ 0,82 → ~5,90 m)
 *   · Demais estações: sem régua fluviométrica — avaliam-se apenas por chuva.
 */

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type RiskLevel = 0 | 1 | 2 | 3;

export const RISK_META: Record<
  RiskLevel,
  { label: string; emoji: string; color: string; text: string; bg: string; ring: string }
> = {
  0: { label: 'Normalidade', emoji: '🟢', color: '#34d399', text: 'text-emerald-300', bg: 'bg-emerald-500/10', ring: 'ring-emerald-400/25' },
  1: { label: 'Atenção', emoji: '🟡', color: '#facc15', text: 'text-yellow-300', bg: 'bg-yellow-500/10', ring: 'ring-yellow-400/25' },
  2: { label: 'Alerta', emoji: '🟠', color: '#fb923c', text: 'text-orange-300', bg: 'bg-orange-500/10', ring: 'ring-orange-400/25' },
  3: { label: 'Crítico / Início de Transbordo (≥7,20 m)', emoji: '🔴', color: '#f87171', text: 'text-red-300', bg: 'bg-red-500/10', ring: 'ring-red-400/25' },
};

/* ------------------------------------------------------------------ */
/* Definição das estações a montante                                    */
/* ------------------------------------------------------------------ */

export interface UpstreamStation {
  id: string;
  name: string;
  city: string;
  anaCode: string;
  type: 'fluviometric' | 'rain';
  lat: number;
  lon: number;
  /** distância fluvial estimada até Campo Bom (km) */
  distKm: number;
  /** atraso de propagação da onda de cheia (h) */
  lagH: number;
  /** cota crítica na régua, em metros (0 quando sem régua) */
  criticalStage: number;
  /** peso na pontuação (1–3, Sapiranga e Taquara pesam mais por proximidade) */
  weight: number;
  /** área de drenagem em km² (0 quando sem régua) */
  areaKm2: number;
}

export const UPSTREAM_STATIONS: UpstreamStation[] = [
  {
    id: 'caraa',
    name: 'Caraá',
    city: 'Caraá',
    anaCode: '2950119',
    type: 'rain',
    lat: -29.7692,
    lon: -50.3572,
    distKm: 120,
    lagH: 20,
    criticalStage: 0,
    weight: 1,
    areaKm2: 0,
  },
  {
    id: 'alto-rolante',
    name: 'Alto Rolante',
    city: 'Rolante',
    anaCode: '2950098',
    type: 'rain',
    lat: -29.645,
    lon: -50.5106,
    distKm: 85,
    lagH: 16,
    criticalStage: 0,
    weight: 1,
    areaKm2: 0,
  },
  {
    id: 'rolante',
    name: 'Rolante',
    city: 'Rolante',
    anaCode: '2950122',
    type: 'rain',
    lat: -29.6653,
    lon: -50.5819,
    distKm: 70,
    lagH: 14,
    criticalStage: 0,
    weight: 1,
    areaKm2: 0,
  },
  {
    id: 'canastra',
    name: 'Canastra (Mascarada)',
    city: 'Rolante',
    anaCode: '2950123',
    type: 'rain',
    lat: -29.5825,
    lon: -50.4697,
    distKm: 75,
    lagH: 15,
    criticalStage: 0,
    weight: 1,
    areaKm2: 0,
  },
  {
    id: 'taquara',
    name: 'Foz do Paranhana',
    city: 'Taquara',
    anaCode: '87376000',
    type: 'fluviometric',
    lat: -29.6858,
    lon: -50.8122,
    distKm: 35,
    lagH: 7,
    /** proporcional a Campo Bom: ~82% da cota de inundação de 7,20 m */
    criticalStage: 5.90,
    weight: 2,
    areaKm2: 2380,
  },
  {
    id: 'sapiranga',
    name: 'Sapiranga',
    city: 'Sapiranga',
    anaCode: '2951040',
    type: 'rain',
    lat: -29.6333,
    lon: -51.0,
    distKm: 12,
    lagH: 2.5,
    criticalStage: 0,
    weight: 3,
    areaKm2: 0,
  },
];

/* ------------------------------------------------------------------ */
/* Dados de uma estação no instante t                                   */
/* ------------------------------------------------------------------ */

export interface StationData {
  station: UpstreamStation;
  /** nível atual (m) — só para fluviométricas */
  level: number | null;
  /** cota relativa (m), level − criticalStage */
  relativeLevel: number | null;
  /** taxa de subida (cm/h) na última janela de 2 h */
  risingRate: number | null;
  /** precipitação acumulada em 6 h, 12 h, 24 h, 48 h (mm) */
  rain: { h6: number; h12: number; h24: number; h48: number };
  /** chuva dos 7 dias anteriores (mm) — proxy de saturação do solo */
  api7d: number;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  stations: StationData[];
  /** limiares usados na classificação */
  thresholds: { atencao: number; alerta: number; critico: number };
}

/* ------------------------------------------------------------------ */
/* Aquisição de dados                                                  */
/* ------------------------------------------------------------------ */

const ANA_BASE = 'https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos';
const OM_BASE = 'https://api.open-meteo.com/v1/forecast';

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function brDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Busca a série fluviométrica dos últimos `days` dias para uma estação
 * da ANA e extrai o nível mais recente e a taxa de subida.
 */
async function fetchFluviometric(
  code: string,
  days: number
): Promise<{ level: number | null; rate: number | null; campoBomLevel?: number | null }> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const end = new Date(now.getTime() + 86400000);

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(
      `${ANA_BASE}?codEstacao=${code}&dataInicio=${brDate(start)}&dataFim=${brDate(end)}`
    )}`,
    `https://corsproxy.io/?url=${encodeURIComponent(
      `${ANA_BASE}?codEstacao=${code}&dataInicio=${brDate(start)}&dataFim=${brDate(end)}`
    )}`,
  ];

  for (const url of proxies) {
    try {
      const xml = await fetchText(url);
      const levels: { ts: number; h: number }[] = [];
      const re = new RegExp(`${code}\\s+(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+[0-9.]+\\s+([0-9.]+)`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const d = new Date(m[1].replace(' ', 'T') + '-03:00');
        const h = Number(m[2]) / 100;
        if (!isNaN(d.getTime()) && Number.isFinite(h) && h > 0) {
          levels.push({ ts: d.getTime(), h });
        }
      }
      if (levels.length < 2) continue;
      const last = levels[levels.length - 1];
      // taxa de subida: janela de 2 h
      let rate: number | null = null;
      const cutoff = last.ts - 2 * 3600000;
      const win = levels.filter((l) => l.ts >= cutoff);
      if (win.length >= 2) {
        const dt = (last.ts - win[0].ts) / 3600000;
        rate = dt > 0 ? ((last.h - win[0].h) * 100) / dt : null;
      }
      return { level: last.h, rate };
    } catch {
      /* tenta o próximo proxy */
    }
  }
  return { level: null, rate: null };
}

/**
 * Busca a precipitação horária para várias coordenadas de uma só vez.
 */
async function fetchRain(
  stations: UpstreamStation[],
  days: number
): Promise<Record<string, number[]>> {
  const lats = stations.map((s) => s.lat).join(',');
  const lons = stations.map((s) => s.lon).join(',');
  const pastDays = Math.min(92, Math.max(3, Math.ceil(days)));

  const url = `${OM_BASE}?latitude=${lats}&longitude=${lons}&hourly=precipitation&past_days=${pastDays}&forecast_days=1&timezone=America%2FSao_Paulo`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];

  const out: Record<string, number[]> = {};
  list.forEach((block: any, i: number) => {
    const vals = block?.hourly?.precipitation as number[] | undefined;
    if (vals) out[stations[i].id] = vals;
  });
  return out;
}

function sumRange(vals: number[], hours: number): number {
  if (!vals?.length) return 0;
  const n = Math.min(hours, vals.length);
  return +(vals.slice(-n).reduce((a, v) => a + (v || 0), 0)).toFixed(1);
}

function sumBeforeLast(vals: number[], hours: number): number {
  if (!vals?.length || vals.length <= hours) return 0;
  const end = vals.length - hours;
  const start = Math.max(0, end - 168); // 7 dias antes da janela
  return +vals.slice(start, end).reduce((a, v) => a + (v || 0), 0).toFixed(1);
}

/* ------------------------------------------------------------------ */
/* Pontuação                                                           */
/* ------------------------------------------------------------------ */

const LIMIARES = {
  atencao: 6.0,
  alerta: 6.5,
  critico: 7.2,
};

/**
 * Peso por proximidade: já está embutido em `station.weight`.
 * Sapiranga (3) e Taquara (2) têm mais peso que as estações de cabeceira (1).
 */

export async function computeRisk(days = 5): Promise<RiskResult> {
  // 1. Buscar dados fluviométricos
  const [taquaraFlu, campoBomFlu, rainRaw] = await Promise.all([
    fetchFluviometric('87376000', days),
    fetchFluviometric('87380000', days),
    fetchRain(UPSTREAM_STATIONS, days + 7),
  ]);
  // Anexar nível de Campo Bom ao resultado de Taquara para uso na pontuação
  (taquaraFlu as any).campoBomLevel = campoBomFlu.level;

  // 2. Montar os dados de cada estação
  const data: StationData[] = UPSTREAM_STATIONS.map((st) => {
    const rainVals = rainRaw[st.id] ?? [];
    const h6 = sumRange(rainVals, 6);
    const h12 = sumRange(rainVals, 12);
    const h24 = sumRange(rainVals, 24);
    const h48 = sumRange(rainVals, 48);
    const api7d = sumBeforeLast(rainVals, 24); // 7 dias antes das últimas 24 h

    if (st.type === 'fluviometric' && st.id === 'taquara') {
      const level = taquaraFlu.level;
      const cr = level != null && st.criticalStage > 0 ? level - st.criticalStage : null;
      return {
        station: st,
        level,
        relativeLevel: cr,
        risingRate: taquaraFlu.rate,
        rain: { h6, h12, h24, h48 },
        api7d,
      };
    }

    return {
      station: st,
      level: null,
      relativeLevel: null,
      risingRate: null,
      rain: { h6, h12, h24, h48 },
      api7d,
    };
  });

  // 3. Calcular a pontuação
  //
  // O nível de Campo Bom é o melhor preditor direto quando disponível.
  // A pontuação combina o nível atual com os sinais a montante, numa
  // escala que converge para os limiares de inundação do Rio dos Sinos.
  //
  // Base: nível atual de Campo Bom (se disponível via leituras recentes)
  const cbLevel = taquaraFlu.campoBomLevel;
  let score = cbLevel ?? 0;

  // contribuição das estações a montante (sinais antecipados)
  let upstreamSignal = 0;

  for (const d of data) {
    const st = d.station;
    const w = st.weight;

    // -- Nível do rio a montante (Taquara) --
    if (d.relativeLevel != null) {
      if (d.relativeLevel > 0) {
        upstreamSignal += d.relativeLevel * w * 0.6;
      } else if (d.relativeLevel > -0.5 && (d.risingRate ?? 0) > 0.2) {
        upstreamSignal += 0.15 * w;
      }
    }

    // -- Pluviometria --
    if (d.rain.h24 > 80) upstreamSignal += 0.25 * w;
    else if (d.rain.h24 > 40) upstreamSignal += 0.12 * w;

    if (d.rain.h48 > 140) upstreamSignal += 0.2 * w;
    if (d.rain.h6 > 20) upstreamSignal += 0.1 * w;
    if (d.api7d > 100) upstreamSignal += 0.08 * w;
  }

  // pontuação final = nível atual + sinal de montante
  score = +(score + upstreamSignal).toFixed(2);

  let level: RiskLevel;
  if (score >= LIMIARES.critico) level = 3;
  else if (score >= LIMIARES.alerta) level = 2;
  else if (score >= LIMIARES.atencao) level = 1;
  else level = 0;

  return { score, level, stations: data, thresholds: LIMIARES };
}
