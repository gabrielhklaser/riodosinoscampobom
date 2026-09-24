/**
 * CHUVA → ESCOAMENTO (SCS-CN contínuo) — utilitários puros (sem dependências)
 * =====================================================================
 * Revisão 09/2026 — causa raiz das "curvas ECMWF e GFS sempre iguais":
 *
 *  O motor aplicava o SCS-CN a CADA hora isoladamente:
 *      Q = (P₁ₕ − 0,2·S)² / (P₁ₕ + 0,8·S)
 *  Com CN 65–84, a abstração inicial (0,2·S) vale 27 mm (alto Sinos) a
 *  10 mm (baixo Sinos). Como a chuva prevista por hora raramente passa
 *  disso, o termo de chuva dava EXATAMENTE zero em praticamente todas as
 *  horas — sobravam apenas inércia, remanso e recessão, idênticos para os
 *  dois modelos. Resultado: ECMWF e GFS desenhavam a mesma curva (e o
 *  modelo, na prática, não respondia à chuva).
 *
 *  Correção (como manda a skill hydrologic-modeling-engine / TR-55 e o
 *  SCSMethod da skill stormwater-management): o SCS-CN é aplicado à chuva
 *  ACUMULADA DO EVENTO, e o escoamento de cada hora é o INCREMENTO do
 *  runoff acumulado. Assim chuva de 3–10 mm/h passa a gerar escoamento
 *  progressivo (depois de vencer a abstração inicial), e modelos que
 *  divergem na chuva passam a divergir na curva.
 *
 *  Condição de umidade antecedente (AMC): em vez do multiplicador
 *  duplicado (Q_scs × saturação), usa-se o ajuste canônico CN_I / CN_II /
 *  CN_III (equações da skill stormwater-management), interpolado de forma
 *  CONTÍNUA pela saturação normalizada (API/API_sat) — a interpolação
 *  suave evita degraus na curva quando o solo cruza de faixa.
 *
 *  Este arquivo NÃO importa nada de propósito: testável direto no Node
 *  sem bundler — ver scripts/test-modelo.mjs.
 */

/** CN em condição média (AMC II) por sub-bacia conceitual. */
export const CN_II = { alto: 65, medio: 72, baixo: 84 } as const;

/** Horas consecutivas sem chuva que encerram o evento (TR-55 usa ≥ 6 h; aqui
 *  12 h é mais conservador para uma bacia que responde por vários dias). */
export const DRY_RESET_H = 12;
/** Limiar de "sem chuva" na hora (mm/h). */
export const MIN_RAIN_MM = 0.1;
/** abaixo deste acumulado o estado do evento é zerado (sem degrau: Q≈0 ali) */
export const EVENT_RESET_MM = 6;

/** Retenção potencial (mm) para um CN. S = 25400/CN − 254 (forma métrica). */
export function retentionMm(cn: number): number {
  return 25400 / Math.max(1, cn) - 254;
}

/** CN_I (solo seco) a partir do CN_II — equação da skill stormwater-management. */
export function cnDry(cn2: number): number {
  return cn2 / (2.281 - 0.01281 * cn2);
}

/** CN_III (solo saturado) a partir do CN_II. */
export function cnWet(cn2: number): number {
  return cn2 / (0.427 + 0.00573 * cn2);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * CN ajustado à umidade antecedente, de forma contínua.
 *
 * `saturation` = API / API_sat (0 = muito seco, 1 = saturado).
 * Faixas (equivalente contínuo das classes AMC do SCS):
 *   s ≤ 0,25 → CN_I          (condição seca)
 *   s ≈ 0,55 → CN_II         (condição média — baseline)
 *   s ≥ 0,95 → CN_III        (condição úmida/saturada — pior caso)
 */
export function cnForSaturation(cn2: number, saturation: number): number {
  const s = clamp(saturation, 0, 1);
  const t1 = clamp((s - 0.25) / 0.3, 0, 1); // CN_I → CN_II
  const t2 = clamp((s - 0.65) / 0.3, 0, 1); // CN_II → CN_III
  const cnI = cnDry(cn2);
  const cnIII = cnWet(cn2);
  // sem arredondar aqui: o arredondamento criava micro-degraus na curva
  // (a função é linear por partes e o retorno bruto é estritamente contínuo)
  return cnI + (cn2 - cnI) * t1 + (cnIII - cn2) * t2;
}

/**
 * SCS-CN (mm) sobre a chuva ACUMULADA do evento.
 * Q = (P − 0,2·S)² / (P + 0,8·S), Q = 0 quando P ≤ 0,2·S.
 */
export function eventRunoffMm(pCumMm: number, cn: number): number {
  if (!(pCumMm > 0)) return 0;
  const S = retentionMm(cn);
  const Ia = 0.2 * S;
  if (pCumMm <= Ia) return 0;
  return ((pCumMm - Ia) ** 2) / (pCumMm - Ia + S);
}

/**
 * Acumulado de chuva do EVENTO (definição TR-55/SWMM): as horas de chuva
 * somam; o contador zera depois de DRY_RESET_H horas consecutivas sem chuva.
 *
 * Por que não um acumulado com decaimento exponencial (tentativa anterior):
 * com τ = 30 h uma chuva de 48 h nunca acumulava o total do evento — 102,5 mm
 * de chuva viravam ~52 mm de "evento", e o modelo respondia com uma fração
 * do runoff real. O contador com reset entrega o total do evento e mantém a
 * memória enquanto chove, que é o comportamento do SCS-CN contínuo.
 */
export function eventCumulative(hourly: number[], dryResetH = DRY_RESET_H): number[] {
  const out: number[] = [];
  let acc = 0;
  let dry = 0;
  for (const raw of hourly) {
    const p = Math.max(0, Number(raw) || 0);
    if (p >= MIN_RAIN_MM) {
      acc += p;
      dry = 0;
    } else {
      dry += 1;
      if (dry >= dryResetH) acc = 0; // evento encerrado — sem degrau, pois Q≈0 aqui
    }
    out.push(+acc.toFixed(3));
  }
  return out;
}

/**
 * Série horária de escoamento efetivo INCREMENTAL (mm/h).
 *
 * Regras:
 *  • Q é calculado sobre o acumulado do evento (acima), não sobre a hora;
 *  • incremento = Q(t) − Q(t−1), nunca negativo (chuva só empurra o nível
 *    para cima — a descida é responsabilidade da recessão);
 *  • dentro do evento vale a marca d'água de Q (não conta a mesma chuva
 *    duas vezes quando a chuva para e volta);
 *  • quando o acumulado cai abaixo de EVENT_RESET_MM o evento é encerrado
 *    (Q → 0, sem degrau, porque Q ali já é ~0).
 */
export function effectiveRunoffSeries(hourly: number[], cn: number, dryResetH = DRY_RESET_H): number[] {
  const pCum = eventCumulative(hourly, dryResetH);
  const out: number[] = [];
  let prevQ = 0;
  for (const p of pCum) {
    if (p < EVENT_RESET_MM) prevQ = 0;
    const q = eventRunoffMm(p, cn);
    const inc = q - prevQ;
    out.push(inc > 0 ? +inc.toFixed(4) : 0);
    if (q > prevQ) prevQ = q;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Calibração — EVENTO DE REFERÊNCIA maio/2024                          */
/* ------------------------------------------------------------------ */

/** Fração de área de cada sub-bacia conceitual (soma = 1). */
export const AREA_FRAC: Record<string, number> = { alto: 0.30, medio: 0.45, baixo: 0.25 };

/**
 * Ganho de cota em Campo Bom por mm de chuva efetiva (m/mm) — DH_SUB.
 *
 * Derivação (revisão 09/2026):
 *   Com o SCS-CN aplicado ao acumulado do evento (acima), a cheia de
 *   maio/2024 (102,5 mm/48 h, solo em AMC III) gera
 *     alto 55,3 mm · medio 65,1 mm · baixo 81,4 mm
 *   de chuva efetiva. Com os ganhos abaixo e as frações de área, o ΔH
 *   bruto é ≈ +7,2 m; descontada a recessão natural do período (≈ 0,9 m),
 *   o modelo reproduz os +6,26 m observados (2,30 m → 8,56 m) — que é o
 *   mesmo evento-âncora já documentado em `EVENT_2024`.
 *
 *   Antes da correção estes coeficientes valiam 0,010/0,013/0,022: como o
 *   termo de chuva dava zero na conta por hora, a calibração nunca era
 *   exercida de fato (a curva era inércia + recessão). Ver scripts/test-modelo.mjs.
 */
export const DH_SUB: Record<string, number> = { alto: 0.072, medio: 0.094, baixo: 0.158 };

/** Parâmetros do evento-âncora (usados pelo teste de calibração). */
export const CALIBRATION_2024 = {
  rainMm: 102.5,
  /** duração da chuva do evento (h) */
  rainH: 48,
  saturation: 1,
  /** cota no início (27/04/2024) e pico observado (04/05/2024), em m */
  baseLevelM: 2.30,
  peakLevelM: 8.56,
  observedRiseM: 6.26,
  /** tolerância do teste automatizado (m) */
  toleranceM: 0.7,
  /** recessão aproximada do período, usada só no cálculo analítico */
  recessionM: 0.9,
};

/** Ganho de cota por mm de chuva efetiva em uma sub-bacia (m/mm). */
export interface SubBasinGain {
  id: keyof typeof CN_II | string;
  /** DH_SUB (m/mm) — conversão chuva efetiva → cota em Campo Bom */
  dh: number;
  /** fração de área da sub-bacia (0–1) */
  areaFrac: number;
}

/**
 * Verificação de calibração — EVENTO DE REFERÊNCIA (cheia de maio/2024).
 *
 * Entrada documentada no modelo: 102,5 mm em 48 h com solo saturado
 * (antecedente 122,1 mm) elevaram a régua de 2,30 m → 8,56 m (Δ = 6,26 m).
 *
 * Calcula o ΔH bruto (soma do runoff efetivo × ganho) e devolve também o
 * líquido, descontando a recessão natural no período (`recessionM`), para
 * que a calibração seja VERIFICÁVEL em código — se alguém mexer num
 * coeficiente, o teste scripts/test-modelo.mjs acusa.
 */
export function referenceEventRise(
  gains: SubBasinGain[],
  totalRainMm = 102.5,
  saturation = 1,
  recessionM = 0
): { grossM: number; netM: number; perSub: Record<string, { cn: number; qTotalMm: number; riseM: number }> } {
  const perSub: Record<string, { cn: number; qTotalMm: number; riseM: number }> = {};
  let gross = 0;
  for (const g of gains) {
    const cn2 = CN_II[g.id as keyof typeof CN_II];
    const cn = cnForSaturation(cn2, saturation);
    const q = eventRunoffMm(totalRainMm, cn);
    const rise = q * g.dh * g.areaFrac;
    perSub[g.id] = { cn: +cn.toFixed(1), qTotalMm: +q.toFixed(1), riseM: +rise.toFixed(3) };
    gross += rise;
  }
  return { grossM: +gross.toFixed(3), netM: +(gross - recessionM).toFixed(3), perSub };
}
