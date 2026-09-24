/**
 * RECESSÃO E TENDÊNCIA — utilitários puros (sem dependências)
 * =====================================================================
 * Revisão 09/2026 (solicitação do usuário):
 *  • A curva de previsão caía de forma abrupta logo após o ponto atual.
 *    Causa: a persistência inercial aplicava ~85 % da taxa de 2 h já na
 *    PRIMEIRA hora, criando um "degrau" no início da curva — o rio real
 *    não muda de declividade instantaneamente.
 *  • Correção: resposta ASSIMÉTRICA. Subida (enchente/enxurrada) continua
 *    respondendo de imediato — pode dar guinada para cima. Descida entra
 *    por rampa suave (1 − e^(−t/τ)) e a queda é redistribuída de modo a
 *    PRESERVAR o impulso negativo total, ou seja, o rio desce suave e
 *    chega ao mesmo lugar — só não desce em degrau.
 *  • Rede de segurança final (`limitDescent`): nenhuma hora da projeção
 *    pode cair mais que o "envelope de recessão" da hora anterior + uma
 *    aceleração máxima. Queda nunca acelera bruscamente; subida passa
 *    intacta.
 *
 * Fundamentação (skills do projeto):
 *  • hydrologic-modeling-engine (CIV-SK-022) — recessão de escoamento de
 *    base exponencial: dH/dt = −k·(H − H_base). A curva de depleção é
 *    convexa: cada hora cai menos que a anterior, nunca em degrau.
 *  • risk-metrics-calculation — taxa estimada por regressão robusta
 *    (Theil–Sen) em vez de diferença de dois pontos (o estimador de dois
 *    pontos amplifica ruído de telemetria e foi a segunda fonte do
 *    "mergulho" no início da curva).
 *
 * Este arquivo NÃO importa nada de propósito: é testável diretamente pelo
 * Node (`node --test`/script) sem bundler — ver scripts/test-modelo.mjs.
 */

export interface LevelPoint {
  ts: number;
  h: number;
}

export interface TrendResult {
  /** direção da tendência observada */
  dir: 'subida' | 'descida' | 'estavel' | 'indefinida';
  /** taxa robusta (Theil–Sen) em cm/h — null quando há menos de 2 pontos */
  rateCmH: number | null;
  /** variação vs. leitura imediatamente anterior, em metros (robusta a ts iguais) */
  deltaM: number | null;
  /** amplitude da janela analisada, em minutos */
  spanMin: number | null;
  /** nº de leituras usadas */
  n: number;
}

/** remove leituras repetidas no mesmo instante e ordena por tempo */
function clean(pts: LevelPoint[]): LevelPoint[] {
  const sorted = [...pts].filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.h)).sort((a, b) => a.ts - b.ts);
  const out: LevelPoint[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && last.ts === p.ts) out[out.length - 1] = p; // mantém a leitura mais recente do mesmo carimbo
    else out.push(p);
  }
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Taxa de variação (cm/h) por regressão de Theil–Sen (mediana das
 * inclinações entre todos os pares de pontos da janela).
 *
 * Por que não (último − primeiro)/Δt: com telemetria de 15 min, um único
 * valor espúrio (falha de sensor, leitura repetida, pico de 1 amostra)
 * muda o resultado inteiro. A mediana das inclinações ignora outliers
 * (breakdown point ≈ 29 %), que é o comportamento desejado aqui.
 */
export function robustRateCmH(pts: LevelPoint[], windowH = 3): number | null {
  const series = clean(pts);
  if (series.length < 2) return null;
  const end = series[series.length - 1].ts;
  const win = series.filter((p) => p.ts >= end - windowH * 3600000);
  if (win.length < 2) return null;
  const slopes: number[] = [];
  for (let i = 0; i < win.length; i++) {
    for (let j = i + 1; j < win.length; j++) {
      const dtH = (win[j].ts - win[i].ts) / 3600000;
      if (dtH < 1 / 60) continue; // menos de 1 min: ignora
      slopes.push(((win[j].h - win[i].h) * 100) / dtH); // cm/h
    }
  }
  const m = median(slopes);
  return m == null ? null : +m.toFixed(2);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Tendência da leitura — "aquele disparo provém de subida ou de descida?".
 *
 * Combina dois sinais (como pedido: "faça a leitura anterior para saber"):
 *   • variação vs. leitura anterior (peso 0,4) — resposta imediata;
 *   • taxa robusta dos últimos 3 h (peso 0,6) — fase da curva, imune a ruído.
 * Escore > 0,2 ⇒ subida; < −0,2 ⇒ descida; caso contrário, estável.
 */
export function trendOf(pts: LevelPoint[], windowH = 3): TrendResult {
  const series = clean(pts);
  if (series.length < 2) {
    return { dir: 'indefinida', rateCmH: null, deltaM: null, spanMin: null, n: series.length };
  }
  const end = series[series.length - 1].ts;
  const win = series.filter((p) => p.ts >= end - windowH * 3600000);
  const rate = robustRateCmH(series, windowH);
  const prev = series[series.length - 2];
  const last = series[series.length - 1];
  const deltaM = +(last.h - prev.h).toFixed(3);
  const spanMin = +((last.ts - win[0].ts) / 60000).toFixed(0);

  const score =
    (rate != null ? clamp(rate / 2, -1, 1) * 0.6 : 0) + clamp(deltaM / 0.03, -1, 1) * 0.4;

  let dir: TrendResult['dir'];
  if (score > 0.2) dir = 'subida';
  else if (score < -0.2) dir = 'descida';
  else dir = 'estavel';
  return { dir, rateCmH: rate, deltaM, spanMin, n: win.length };
}

export interface ShapeOpts {
  /** constante de tempo da rampa de entrada da descida (h) — 5 h ≈ início suave */
  tauFallH?: number;
  /** constante de decaimento do perfil de recessão (h) — 20 h */
  decayH?: number;
  /** queda máxima admitida em uma hora (m) — trava de plausibilidade */
  maxDropPerHourM?: number;
}

/**
 * Remodela a série de incrementos horários da persistência inercial.
 *
 *  • incremento POSITIVO (subida) → passa intacto. Enxurrada pode dar
 *    guinada para cima; a resposta rápida é desejada.
 *  • incremento NEGATIVO (descida) → troca de PERFIL: em vez do decaimento
 *    exponencial duplo (que aplica quase toda a taxa na 1ª hora), a descida
 *    segue (1 − e^(−t/τr))·e^(−t/τd) — rampa de entrada suave + cauda de
 *    recessão. O perfil é escalado para que a SOMA das quedas seja igual à
 *    massa negativa original: a curva desce suave e chega ao MESMO lugar.
 *
 * Duas armadilhas já testadas e evitadas aqui:
 *  1. escala calculada contra o total do kernel (Σraw/Σperfil) explodia
 *     quando o perfil descartava muito impulso no início — num caso de
 *     −1,5 cm/h a queda saía 4× maior que a bruta. Agora a escala vem da
 *     MASSA NEGATIVA (soma dos incrementos negativos), não do total.
 *  2. nada de renormalizar para cima: cada valor do perfil é ≤ o máximo do
 *     perfil original, então a curva nunca cai mais rápido que o observado
 *     no primeiro trecho — proibido por requisito ("para baixo nunca").
 */
export function shapeRateSeries(rates: number[], opts: ShapeOpts = {}): number[] {
  const tauFall = opts.tauFallH ?? 5;
  const decay = opts.decayH ?? 20;
  const cap = opts.maxDropPerHourM ?? 0.12;

  const negMass = rates.reduce((s, r) => s + Math.min(0, r), 0); // ≤ 0
  if (negMass >= 0) return [...rates];

  const profile = rates.map((_, i) => {
    const t = i + 1;
    return (1 - Math.exp(-t / tauFall)) * Math.exp(-t / decay);
  });
  const profMass = profile.reduce((s, v) => s + v, 0);
  const scale = profMass > 0 ? -negMass / profMass : 0;

  return rates.map((r, i) => {
    if (r >= 0) return r;
    return -Math.min(profile[i] * scale, cap);
  });
}

export interface DescentOpts {
  /** queda admitida na primeira hora de um trecho de descida (m) */
  startDropM?: number;
  /** quanto a queda pode acelerar por hora (m/h²) */
  accelMPerH2?: number;
  /** teto absoluto de queda horária (m) */
  maxDropPerHourM?: number;
}

/**
 * Rede de segurança aplicada à curva JÁ propagada.
 *
 * Garante o comportamento pedido: "para enxurradas a curva pode dar uma
 * guinada para cima, mas para baixo nunca". A queda entra por um degrau
 * pequeno (startDropM) e só acelera accelMPerH2 por hora até o teto —
 * desenha a convexidade de uma recessão real. Qualquer subida zera o
 * envelope (a próxima descida recomeça suave).
 *
 * Só a parte projetada passa por aqui: a série observada é dado medido e
 * permanece intacta.
 */
export function limitDescent(stages: number[], opts: DescentOpts = {}): number[] {
  const start = opts.startDropM ?? 0.03;
  const accel = opts.accelMPerH2 ?? 0.015;
  const maxDrop = opts.maxDropPerHourM ?? 0.12;
  if (stages.length < 2) return [...stages];

  const out: number[] = [stages[0]];
  let allow = 0; // envelope de queda da hora corrente (m)
  for (let t = 1; t < stages.length; t++) {
    const d = stages[t] - stages[t - 1];
    if (d >= 0) {
      out.push(out[t - 1] + d);
      allow = 0;
      continue;
    }
    allow = allow === 0 ? start : Math.min(maxDrop, allow + accel);
    out.push(out[t - 1] - Math.min(-d, allow));
  }
  return out;
}

/**
 * Diagnóstico do formato da curva: maior queda horária, hora em que ela
 * ocorre e quantas vezes a queda ACELEROU em relação à hora anterior.
 * Usado pelo teste automatizado e pelo rodapé do painel.
 */
export function descentStats(stages: number[]): {
  maxDropM: number;
  atHour: number;
  accelerations: number;
  maxAccelM: number;
} {
  let maxDrop = 0;
  let atHour = 0;
  let accelerations = 0;
  let maxAccel = 0;
  for (let t = 1; t < stages.length; t++) {
    const d = stages[t] - stages[t - 1];
    if (d < 0) {
      const drop = -d;
      if (drop > maxDrop) {
        maxDrop = drop;
        atHour = t;
      }
    }
    if (t >= 2) {
      const prev = stages[t - 1] - stages[t - 2];
      const cur = d;
      if (cur < 0 && prev < 0 && -cur > -prev + 1e-9) {
        accelerations += 1;
        maxAccel = Math.max(maxAccel, -cur - -prev);
      }
    }
  }
  return { maxDropM: +maxDrop.toFixed(4), atHour, accelerations, maxAccelM: +maxAccel.toFixed(4) };
}
