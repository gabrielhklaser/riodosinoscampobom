/**
 * MOTOR DE PROPAGAÇÃO HORA A HORA — módulo puro e testável
 * =====================================================================
 * Extraído de `iphModel.ts` na revisão de 09/2026 para que o código que
 * REALMENTE desenha a curva seja coberto por teste automatizado sem
 * bundler (ver scripts/test-modelo.mjs).
 *
 *   H(t+1) = H(t) + inércia(t) + chuva_efetiva(t) + escoamento_base
 *                 + remanso(t) − recessão·(H − H_base)
 *
 * Decisões de modelagem revisadas (relato do usuário, 09/2026-B):
 *  1. INÉRCIA ASSIMÉTRICA — a curva caía "abrupta demais" no início porque
 *     a 1ª hora já aplicava ~85 % da taxa observada de 2 h. Agora a SÉRIE de
 *     taxas passa por `shapeRateSeries` (./recession): subida entra intacta
 *     (enxurrada pode dar guinada para cima), descida entra por rampa com
 *     impulso negativo preservado e queda limitada a MAX_DROP_H.
 *  2. CHUVA DO EVENTO — o SCS-CN era aplicado hora a hora e a abstração
 *     inicial (10–27 mm) zerava a chuva prevista, fazendo ECMWF e GFS
 *     desenharem a MESMA curva. Agora o termo de chuva é o incremento do
 *     runoff acumulado do evento (./rainRunoff), com CN ajustado por AMC.
 *  3. REMANSO DISTRIBUÍDO — o efeito do Guaíba entrava inteiro na 1ª hora
 *     (até +0,5 m de degrau). Agora é distribuído em REMANSO_SPREAD_H horas.
 *
 * Este arquivo é lido tanto pelo Vite quanto pelo Node (type stripping);
 * por isso os imports trazem a extensão `.ts` explícita (o Node exige) e o
 * tsconfig do projeto habilita `allowImportingTsExtensions`.
 */
import { AREA_FRAC, CN_II, DH_SUB, cnForSaturation, effectiveRunoffSeries } from './rainRunoff.ts';
import { shapeRateSeries } from './recession.ts';

/** CN por sub-bacia sob condição média (AMC II). */
export const CN_BY_SUB: Record<string, number> = { ...CN_II };

/** Lag do hidrógrafo por sub-bacia (h) — tempo até o pico em Campo Bom. */
export const LAG: Record<string, number> = { alto: 18, medio: 10, baixo: 4 };

/** Área relativa de cada sub-bacia (soma = 1). */
export const SUB_AREA_FRAC: Record<string, number> = { ...AREA_FRAC };

/** Ganho de cota por mm de chuva efetiva (m/mm) — ver ./rainRunoff. */
export const SUB_DH: Record<string, number> = { ...DH_SUB };

/** API de saturação de referência da bacia (mm) — escala do ajuste AMC. */
export const API_SAT_REF = 140;

/** Constante do escoamento de base (h⁻¹). */
export const K_BAS = 0.004;

/**
 * K_RECESSAO — constante de recessão do escoamento de base (h⁻¹).
 * Decaimento exponencial H(t) → H_BASE. Meia-vida ≈ 7 dias, coerente com a
 * recessão observada após o pico de maio/2024 (pico 04/05 → ~6 m em ~7 dias).
 */
export const K_RECESSAO = 0.004;

/** H_BASE — cota de base assintótica da seção (m); piso físico da projeção. */
export const H_BASE = 2.0;

/** Teto de queda horária da curva projetada (m/h) — 12 cm/h.
 *  Trava de plausibilidade: acima disso não é recessão, é ruído de sensor. */
export const MAX_DROP_H = 0.12;

/** Teto de subida por chuva em uma hora (m/h) — 25 cm/h.
 *  Enxurrada pode dar guinada para cima, mas não um salto de 1 m/h. */
export const MAX_RAIN_STEP_H = 0.25;

/** Nível de referência do Guaíba para início do efeito de remanso (m). */
export const GUAIBA_REF = 1.5;

/** Fator de remanso (m em Campo Bom por m de excesso no Guaíba). */
export const REMANSO_K = 0.15;

/** Nº de horas em que o remanso do Guaíba é distribuído (12 h). */
export const REMANSO_SPREAD_H = 12;

/** Nº de horas de passado no array de chuva (índice RAIN_PAST_H = agora). */
export const RAIN_PAST_H = 48;

/** Saturação normalizada da bacia (0 = muito seco, 1 = saturado). */
export function saturationFromApi(api: number): number {
  return Math.min(1, Math.max(0, (Number(api) || 0) / API_SAT_REF));
}

/** γ — decaimento diário de umidade do solo (Antecedent Precipitation Index). */
export const GAMMA = 0.87;

/**
 * API (Antecedent Precipitation Index) a partir de série horária (mm).
 * API_d = P_d + γ · API_{d-1}
 * Acumula o índice dia a dia com decaimento diário de umidade.
 */
export function computeApi(hourly: number[]): number {
  if (!hourly || !hourly.length) return 0;
  const days = Math.ceil(hourly.length / 24);
  let api = 0;
  for (let d = 0; d < days; d++) {
    const p = hourly.slice(d * 24, d * 24 + 24).reduce((s, v) => s + (v || 0), 0);
    api = p + GAMMA * api;
  }
  return +api.toFixed(1);
}

/**
 * CN efetivo da sub-bacia já ajustado à umidade antecedente (AMC).
 * Substitui a dupla conversão CN→Q→saturação da revisão anterior: o ajuste
 * de AMC é o mecanismo canônico (skill stormwater-management) e é contínuo.
 */
export function cnForSub(sub: string, api: number): number {
  return cnForSaturation(CN_BY_SUB[sub] ?? 72, saturationFromApi(api));
}

/**
 * Série horária de escoamento efetivo (mm/h) por sub-bacia, a partir da
 * linha de chuva (passado+futuro) e da saturação atual.
 *
 * AQUI estava a causa raiz das curvas ECMWF ≡ GFS: o SCS-CN era aplicado a
 * cada hora isolada e, com Ia = 0,2·S (10 a 27 mm), chuvas horárias usuais
 * davam exatamente zero — o termo de chuva desaparecia e sobravam apenas
 * inércia/remanso/recessão, idênticos para os dois modelos de previsão.
 * Agora o SCS-CN é aplicado ao ACUMULADO do evento (TR-55) e o que entra
 * hora a hora é o incremento do runoff acumulado — ver src/lib/rainRunoff.ts.
 */
export function runoffSeriesBySub(rainTimeline: number[], api: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const sub of ['alto', 'medio', 'baixo'] as const) {
    out[sub] = effectiveRunoffSeries(rainTimeline, cnForSub(sub, api));
  }
  return out;
}

/** Efeito de remanso do Guaíba (m) — total no horizonte. */
export function remanso(guaibaLevel: number | null): number {
  if (guaibaLevel == null || guaibaLevel <= GUAIBA_REF) return 0;
  return +(REMANSO_K * (guaibaLevel - GUAIBA_REF)).toFixed(3);
}

/**
 * PROPAGAÇÃO HORA A HORA — resolve o problema da curva achatada.
 *
 * Em vez de projetar cada horizonte independentemente a partir do nível
 * atual (o que ignora o acúmulo), propaga o nível hora a hora:
 *
 *   H(t+1) = H(t)
 *     + persistência_inercial(1 h)
 *     + Σ_sub[ chuva_efetiva(t − lag_sub) × DH_SUB[sub] × frac_area ]
 *     + escoamento_base(1 h)
 *     + remanso(Guaíba)  [distribuído nas primeiras 12 h]
 *     − recessão de escoamento de base K_RECESSAO × (H − H_BASE)
 *
 * `rainTimeline` é o array contínuo passado+futuro onde
 * índice 0 = 48 h atrás de agora, índice RAIN_PAST_H = agora e o
 * restante é o futuro. A chuva da hora T chega a Campo Bom na hora
 * T + lag_sub — assim a chuva das últimas horas a montante (que ainda
 * está "em trânsito") entra na projeção, o que corrige o achatamento
 * da curva após 24 h.
 *
 * @param dH6h — taxa nas últimas 6 h (cm/h) — momentum estável
 * @param dH2h — taxa nas últimas 2 h (cm/h) — responsividade imediata
 */
export function propagateCurve(
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
  // O remanso do Guaíba entrava INTEIRO na 1ª hora (até +0,5 m de uma vez,
  // um degrau artificial na curva, ainda que para cima). Agora ele é
  // distribuído nas primeiras REMANSO_SPREAD_H horas — mesmo total, sem salto.
  const remByHour = (t: number) =>
    rem <= 0 ? 0 : t <= REMANSO_SPREAD_H ? +(rem / REMANSO_SPREAD_H).toFixed(4) : 0;
  const subbasins = ['alto', 'medio', 'baixo'] as const;

  const r2 = dH2h ?? 0;
  const r6 = dH6h ?? r2;

  // 1. Persistência inercial — SÉRIE, não hora isolada.
  //    A taxa base continua a mistura das janelas de 2 h (reativa) e 6 h
  //    (estável), mas o perfil horário passa por shapeRateSeries:
  //      • subida → entra intacta (enxurrada pode dar guinada para cima);
  //      • descida → rampa de entrada (1 − e^(−t/5 h)) e queda limitada a
  //        12 cm/h (MAX_DROP_H), PRESERVANDO o impulso negativo total.
  const rawRates: number[] = [];
  for (let t = 1; t <= maxH; t++) {
    const w2 = Math.exp(-t / 6);
    const w6 = Math.exp(-t / 20);
    const blendRate = w2 * r2 + (1 - w2) * r6 * w6;
    rawRates.push(Math.abs(blendRate) > 0.02 ? blendRate / 100 : 0);
  }
  const inertialRates = shapeRateSeries(rawRates, { tauFallH: 5, maxDropPerHourM: MAX_DROP_H });

  // 2. Chuva do evento: runoff acumulado (SCS-CN + AMC) por sub-bacia,
  //    consumido como incremento horário e defasado pelo lag da sub-bacia.
  const runoff = runoffSeriesBySub(rainTimeline, meanApi);

  let h = current;

  for (let t = 1; t <= maxH; t++) {
    const iner = inertialRates[t - 1] ?? 0;

    // 2b. Chuva — incremento do runoff do evento, com trava de plausibilidade
    let rainContrib = 0;
    for (const sub of subbasins) {
      const lag = LAG[sub];
      const tlIdx = RAIN_PAST_H + t - lag;
      if (tlIdx >= 0 && tlIdx < rainTimeline.length) {
        const pEff = runoff[sub]?.[tlIdx] ?? 0;
        if (pEff > 0) {
          rainContrib += pEff * (SUB_DH[sub] ?? 0.094) * (SUB_AREA_FRAC[sub] ?? 0.33);
        }
      }
    }
    if (rainContrib > MAX_RAIN_STEP_H) rainContrib = MAX_RAIN_STEP_H;

    // 3. Escoamento de base
    const bf = K_BAS * (meanApi / API_SAT_REF) * 0.001;

    // 4. Recessão natural — decaimento exponencial em direção à vazão de
    //    base (curva de recessão): quanto mais alto sobre a base, mais
    //    rápido o rio recede. Sempre ativa: em cheia age como amortecimento
    //    leve do armazenamento; em período seco desenha a recessão real
    //    em vez de congelar o nível.
    const recession = -K_RECESSAO * (h - H_BASE);

    // 5. Acumula
    const remT = remByHour(t);
    h = h + iner + rainContrib + bf + recession + remT;
    h = Math.max(h, H_BASE);
    h = +h.toFixed(3);

    stages.push(h);
    inertials.push(+iner.toFixed(4));
    rains.push(+(rainContrib + bf).toFixed(4));
    rems.push(remT);
  }

  return { stages, inertials, rains, rems };
}
