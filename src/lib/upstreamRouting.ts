/**
 * PROPAGAÇÃO PELAS ESTAÇÕES FLUVIOMÉTRICAS A MONTANTE — módulo puro
 * =====================================================================
 * Revisão 09/2026-C (relato do usuário: "ontem a previsão dizia que o rio
 * ia descer, hoje ele continua subindo").
 *
 * CAUSA RAIZ (verificada com a telemetria real da ANA, 21–24/09/2026):
 *   Taquara (87376000) atingiu o pico em 23/09 ~01h e passou a descer;
 *   Campo Bom seguiu subindo ~1,5 cm/h por mais de 30 h. O motor antigo
 *   misturava 60 % da taxa ATUAL de Taquara na taxa de Campo Bom, como se
 *   a onda chegasse instantaneamente — mas entre Taquara e Campo Bom há
 *   ~35 km de rio com banhados (várzea de armazenamento) e a onda leva
 *   ~1 dia para atravessar. A estação intermediária Araricá/Sapiranga/
 *   Taquara (87377500, ~10 km a montante de Campo Bom) nem era lida.
 *
 * O QUE ESTE MÓDULO FAZ — roteamento "lag + reservatório linear" (a forma
 * discreta mais simples do reservoir routing / Nash da skill hydrologic-
 * modeling-engine), aplicado à TAXA de variação do nível:
 *   1. reamostra cada série de nível em passo horário;
 *   2. calcula a taxa de variação (cm/h) em janela móvel de 3 h;
 *   3. passa a taxa da estação por um reservatório linear de constante K
 *      (amortece a enxurrada — os banhados entre Taquara e Campo Bom
 *      achatam uma subida de 37 cm/h em Taquara para ~2 cm/h em CB);
 *   4. dH_CB(t) ≈ k · R_K[dH_s](t − L). A taxa futura de Campo Bom na hora
 *      t é CONHECIDA enquanto t ≤ L: vem do que a estação JÁ mediu.
 *
 * CALIBRAÇÃO (scripts/fixtures/evento-2026-09.mjs, 11 previsões emitidas a
 * cada 3 h entre 22/09 03h e 24/09 09h, erro em +24 h):
 *   modelo antigo ............................ RMSE 0,49 m, viés −0,48 m
 *   só corrigir recessão contada em dobro .... RMSE 0,25 m
 *   + Araricá (L 3, K 0, k 0,45)
 *   + Taquara (L 26, K 18, k 0,15) ........... RMSE 0,04 m, viés −0,01 m
 * Região estável: L 22–30, K 12–24, k 0,15 → RMSE ≤ 0,07 m; foi escolhido o
 * CENTRO da região (não o ótimo exato) para não sobreajustar um único evento.
 *
 * POR QUE NÃO AJUSTAR ONLINE: testado. Num único evento a mesma chuva faz
 * todos os postos subirem juntos (forçante comum) e a correlação escolhe
 * defasagens espúrias (Taquara→Araricá 8 h, quando pico-a-pico foram 29 h;
 * Taquara→CB ganho 0,92). A correlação online fica só como DIAGNÓSTICO.
 *
 * Estações sem calibração medida (Nova Hartz, Paranhana, Rolante, Caraá)
 * NÃO entram no guia de taxa — ganho/defasagem seriam chute. Entram como
 * monitoramento (nível e tendência no painel) e pela CHUVA medida.
 * Estação sem leitura recente simplesmente não entra: nunca inventa sinal.
 *
 * Arquivo sem dependências: roda no Node por type stripping (testes).
 */

export interface LevelPoint {
  ts: number;
  h: number;
}

const HOUR = 3600000;

/**
 * Reamostra para passo horário: média das leituras de cada hora cheia
 * (ancorada em `endTs`), com interpolação linear de lacunas de até
 * `maxGapH` horas. Índice n−1 = hora de `endTs`.
 */
export function toHourly(series: LevelPoint[], endTs: number, hours: number, maxGapH = 3): (number | null)[] {
  const out: (number | null)[] = new Array(hours).fill(null);
  const sums = new Array(hours).fill(0);
  const counts = new Array(hours).fill(0);
  const endHour = Math.floor(endTs / HOUR);
  for (const p of series) {
    if (!Number.isFinite(p.h)) continue;
    const idx = hours - 1 - (endHour - Math.floor(p.ts / HOUR));
    if (idx < 0 || idx >= hours) continue;
    sums[idx] += p.h;
    counts[idx] += 1;
  }
  for (let i = 0; i < hours; i++) if (counts[i]) out[i] = sums[i] / counts[i];
  // interpola lacunas curtas (telemetria da ANA falha horas isoladas)
  let last = -1;
  for (let i = 0; i < hours; i++) {
    if (out[i] == null) continue;
    if (last >= 0 && i - last > 1 && i - last - 1 <= maxGapH) {
      const a = out[last] as number;
      const b = out[i] as number;
      for (let k = last + 1; k < i; k++) out[k] = a + ((b - a) * (k - last)) / (i - last);
    }
    last = i;
  }
  return out;
}

/** Taxa horária (cm/h) em janela de `winH` horas: (h[i] − h[i−win]) / win. */
export function rateSeries(hourly: (number | null)[], winH = 3): (number | null)[] {
  return hourly.map((v, i) => {
    const prev = hourly[i - winH];
    if (v == null || prev == null) return null;
    return ((v - prev) * 100) / winH;
  });
}

/** Parâmetros de roteamento até Campo Bom. */
export interface RoutingParams {
  /** defasagem pura (h) */
  lag: number;
  /** constante do reservatório linear (h); 0 = sem amortecimento */
  k: number;
  /** ganho: cm/h em Campo Bom por cm/h (amortecido) na estação */
  gain: number;
  /** entra no guia de taxa (calibração medida em evento real) */
  inGuide: boolean;
}

/**
 * Calibrados no evento de 21–24/09/2026 (ver cabeçalho). Só as estações no
 * eixo principal com série medida no evento entram no guia.
 */
export const ROUTING: Record<string, RoutingParams> = {
  ararica: { lag: 3, k: 0, gain: 0.45, inGuide: true },
  taquara: { lag: 26, k: 18, gain: 0.15, inGuide: true },
};

/** Reservatório linear discreto: S(t) = S(t−1) + (x(t) − S(t−1))/K. */
export function linearReservoir(x: (number | null)[], k: number): (number | null)[] {
  if (k <= 0) return x.slice();
  const out: (number | null)[] = [];
  let s: number | null = null;
  for (const v of x) {
    if (v != null) s = s == null ? v : s + (v - s) / k;
    out.push(s);
  }
  return out;
}

/** Correlação de Pearson entre down(t) e up(t − lag) — diagnóstico. */
export function laggedCorrelation(
  up: (number | null)[],
  down: (number | null)[],
  lag: number,
  minN = 24
): { r: number; n: number } | null {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = lag; i < down.length; i++) {
    const x = up[i - lag];
    const y = down[i];
    if (x == null || y == null) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (n < minN) return null;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  // desvio-padrão < 0,5 cm/h = ruído de régua (período seco): sem sentido
  if (vx / n < 0.25 || vy / n < 0.25) return null;
  return { r: +((sxy - (sx * sy) / n) / Math.sqrt(vx * vy)).toFixed(3), n };
}

export interface RoutedStation {
  id: string;
  name: string;
  params: RoutingParams;
  /** taxa amortecida (cm/h), índice n−1 = hora atual */
  routed: (number | null)[];
  /** taxa atual medida na estação (média das últimas 3 h, cm/h) */
  rateNow: number | null;
  /** nível mais recente (m, referência da própria estação) */
  levelNow: number | null;
  /** correlação atual com Campo Bom nos parâmetros calibrados (diagnóstico) */
  r: number | null;
}

/** Nº de horas de histórico usadas no roteamento. */
export const ROUTING_WINDOW_H = 240;

/**
 * Prepara uma estação para o guia. Retorna null se não houver parâmetros,
 * dados, ou se a última leitura tiver mais de 6 h (sem sinal atual).
 */
export function routeStation(
  id: string,
  name: string,
  upstream: LevelPoint[],
  campoBom: LevelPoint[],
  endTs: number,
  windowH = ROUTING_WINDOW_H
): RoutedStation | null {
  const params = ROUTING[id];
  if (!params || !upstream.length) return null;
  const upH = toHourly(upstream, endTs, windowH);
  let lastIdx = -1;
  for (let i = upH.length - 1; i >= 0; i--) if (upH[i] != null) { lastIdx = i; break; }
  if (lastIdx < windowH - 1 - 6) return null;
  const upR = rateSeries(upH);
  const routed = linearReservoir(upR, params.k);
  const cbR = rateSeries(toHourly(campoBom, endTs, windowH));
  const corr = laggedCorrelation(routed, cbR, params.lag);
  const recent = upR.slice(-3).filter((v): v is number => v != null);
  return {
    id,
    name,
    params,
    routed,
    rateNow: recent.length ? +(recent.reduce((a, v) => a + v, 0) / recent.length).toFixed(2) : null,
    levelNow: lastIdx >= 0 ? +(upH[lastIdx] as number).toFixed(2) : null,
    r: corr?.r ?? null,
  };
}

export interface RateGuide {
  /** taxa prevista para Campo Bom (cm/h) na hora t (índice t−1); null = sem informação */
  rates: (number | null)[];
  /** estação que dominou cada hora (diagnóstico) */
  source: (string | null)[];
  /** última hora coberta por informação observada a montante */
  horizonH: number;
}

/**
 * Taxa futura de Campo Bom a partir do que as estações a montante JÁ mediram.
 * Para a hora t, cada estação com lag ≥ t contribui com
 *     k_s · R_K[dH_s](agora + t − L_s)       (valor observado, não previsto)
 * ponderada pela proximidade e^(−(L_s − t)/12): a onda que chega "agora"
 * pesa mais que uma que ainda levará um dia — suaviza a troca de estação.
 */
export function routedRateGuide(stations: RoutedStation[], maxH: number): RateGuide {
  const rates: (number | null)[] = [];
  const source: (string | null)[] = [];
  let horizonH = 0;
  const guideSt = stations.filter((s) => s.params.inGuide);
  for (let t = 1; t <= maxH; t++) {
    let wsum = 0, vsum = 0, bestW = 0;
    let best: string | null = null;
    for (const s of guideSt) {
      const L = s.params.lag;
      if (L < t) continue;
      const x = s.routed[s.routed.length - 1 + t - L];
      if (x == null) continue;
      const w = Math.exp(-(L - t) / 12);
      wsum += w;
      vsum += w * s.params.gain * x;
      if (w > bestW) { bestW = w; best = s.id; }
    }
    if (wsum > 0) {
      rates.push(+(vsum / wsum).toFixed(3));
      source.push(best);
      horizonH = t;
    } else {
      rates.push(null);
      source.push(null);
    }
  }
  return { rates, source, horizonH };
}

/**
 * Combina a persistência local (taxa recente de Campo Bom) com o guia:
 *   rate(t) = a(t)·local + (1 − a(t))·guia(t),   a(t) = e^(−t/4)
 */
export function blendWithLocal(guide: RateGuide, localRateCmH: number | null): (number | null)[] {
  return guide.rates.map((g, i) => {
    const t = i + 1;
    if (g == null) return null;
    if (localRateCmH == null) return g;
    const a = Math.exp(-t / 4);
    return +(a * localRateCmH + (1 - a) * g).toFixed(3);
  });
}

export interface UpstreamInput {
  id: string;
  name: string;
  levels: LevelPoint[];
}

/**
 * Guia completo para Campo Bom emitido em `endTs` — usado pelo painel, pelo
 * backtest e pelos testes (mesmo código). Só usa leituras com ts ≤ endTs.
 */
export function guideForCampoBom(
  upstream: UpstreamInput[],
  campoBom: LevelPoint[],
  endTs: number,
  localRateCmH: number | null,
  maxH: number
): { rates: (number | null)[] | null; routed: RoutedStation[]; guide: RateGuide } {
  const cb = campoBom.filter((p) => p.ts <= endTs);
  const routed: RoutedStation[] = [];
  for (const u of upstream) {
    if (!ROUTING[u.id]) continue;
    const r = routeStation(u.id, u.name, u.levels.filter((p) => p.ts <= endTs), cb, endTs);
    if (r) routed.push(r);
  }
  const guide = routedRateGuide(routed, maxH);
  return { rates: guide.horizonH > 0 ? blendWithLocal(guide, localRateCmH) : null, routed, guide };
}
