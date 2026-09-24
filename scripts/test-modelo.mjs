/**
 * TESTES DO MOTOR HIDROLÓGICO (sem bundler, sem internet)
 * =====================================================================
 * Roda com:  npm run test:modelo      (ou: node scripts/test-modelo.mjs)
 *
 * Cobre exatamente os dois pontos revisados a pedido:
 *   A) por que ECMWF e GFS davam a MESMA curva (SCS-CN aplicado por hora);
 *   B) por que a curva caía abrupta no início (inércia com degrau);
 * além da calibração do evento de maio/2024 e da tendência subida/descida
 * usada nos avisos do Telegram (recession.trendOf).
 *
 * Os módulos testados são puros (sem imports), então o Node os executa
 * direto por "type stripping" — não é preciso instalar nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CN_II,
  AREA_FRAC,
  DH_SUB,
  CALIBRATION_2024,
  cnDry,
  cnWet,
  cnForSaturation,
  eventRunoffMm,
  eventCumulative,
  effectiveRunoffSeries,
  referenceEventRise,
} from '../src/lib/rainRunoff.ts';
import {
  robustRateCmH,
  trendOf,
  shapeRateSeries,
  limitDescent,
  descentStats,
} from '../src/lib/recession.ts';

/* ------------------------------------------------------------------ */
/* A) SCS-CN por hora (errado) × por evento acumulado (correto)         */
/* ------------------------------------------------------------------ */

test('SCS-CN por hora zera a chuva real — era a causa das curvas iguais', () => {
  // 12 h de chuva de 3 mm/h = 36 mm: evento moderado de verdade
  const hourly = new Array(12).fill(3);
  const porHora = hourly.map((p) => eventRunoffMm(p, CN_II.baixo));
  assert.equal(porHora.reduce((a, v) => a + v, 0), 0, 'por hora: 3 mm não vence a abstração inicial de ~9,7 mm');

  // Mesma chuva, aplicada ao acumulado do evento
  const acumulado = hourly.reduce((a, v) => a + v, 0);
  const porEvento = eventRunoffMm(acumulado, CN_II.baixo);
  assert.ok(porEvento > 5, `por evento: ${porEvento.toFixed(1)} mm de escoamento (antes: 0)`);
});

test('incrementos do escoamento somam o runoff do evento (sem contar duas vezes)', () => {
  const hourly = new Array(26).fill(4); // 104 mm
  const cn = cnForSaturation(CN_II.baixo, 1);
  const inc = effectiveRunoffSeries(hourly, cn);
  const pMax = Math.max(...eventCumulative(hourly));
  const q = eventRunoffMm(pMax, cn);
  const soma = inc.reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(soma - q) < 0.05, `soma ${soma.toFixed(2)} mm ≈ Q acumulado ${q.toFixed(2)} mm`);
  assert.ok(inc.every((v) => v >= 0), 'nenhum incremento negativo (chuva não derruba o nível)');
  // o evento termina e o estado é resetado → sem escoamento fantasma depois
  const comPausa = effectiveRunoffSeries([...hourly, ...new Array(200).fill(0)], cn);
  assert.equal(comPausa.slice(-1)[0], 0, 'sem chuva por muito tempo → incremento zero');
});

test('CN ajustado pela umidade: seco < médio < saturado e sem degraus', () => {
  const { cn } = { cn: CN_II.medio };
  const seco = cnForSaturation(cn, 0);
  const medio = cnForSaturation(cn, 0.55);
  const saturado = cnForSaturation(cn, 1);
  assert.ok(seco < medio && medio < saturado, `${seco} < ${medio} < ${saturado}`);
  assert.ok(Math.abs(seco - cnDry(cn)) < 0.2 && Math.abs(saturado - cnWet(cn)) < 0.2);
  let maiorSalto = 0;
  for (let s = 0; s < 0.999; s += 0.001) {
    const passo = Math.abs(cnForSaturation(cn, s + 0.001) - cnForSaturation(cn, s));
    // arredonda a 4 casas: o valor bruto é linear por partes (contínuo)
    maiorSalto = Math.max(maiorSalto, Math.round(passo * 1e4) / 1e4);
  }
  assert.ok(maiorSalto < 0.07, `maior salto = ${maiorSalto.toFixed(4)} CN por 0,1 % de saturação (contínuo)`);
  assert.ok(Math.abs(cnForSaturation(cn, 0.7) - cnForSaturation(cn, 0.71)) < 0.5, 'sem degrau nas faixas AMC');
});

test('calibração do evento de maio/2024 reproduz +6,26 m', () => {
  const gains = ['alto', 'medio', 'baixo'].map((id) => ({
    id,
    dh: DH_SUB[id],
    areaFrac: AREA_FRAC[id],
  }));
  const r = referenceEventRise(gains, CALIBRATION_2024.rainMm, CALIBRATION_2024.saturation, CALIBRATION_2024.recessionM);
  const erro = Math.abs(r.netM - CALIBRATION_2024.observedRiseM);
  assert.ok(
    erro <= CALIBRATION_2024.toleranceM,
    `ΔH líquido ${r.netM} m vs observado ${CALIBRATION_2024.observedRiseM} m (erro ${erro.toFixed(2)} m)`
  );
  // coerência interna: solo saturado escoa mais que solo seco
  const seco = referenceEventRise(gains, CALIBRATION_2024.rainMm, 0, 0);
  assert.ok(seco.grossM < r.grossM, 'com solo seco o mesmo evento eleva menos o rio');
});

/* ------------------------------------------------------------------ */
/* B) Suavização da descida — "pode dar guinada para cima, nunca para baixo" */
/* ------------------------------------------------------------------ */

test('shapeRateSeries: subida intacta, descida suave e com o mesmo total', () => {
  // rio caindo 9 cm/h, 8 cm/h, 7 cm/h... (o degrau que aparecia no início)
  const raw = [-0.09, -0.08, -0.07, -0.06, -0.05, -0.04, -0.03, -0.02];
  const out = shapeRateSeries(raw, { tauFallH: 3, maxDropPerHourM: 0.12 });
  assert.ok(-out[0] < 0.05, `1ª hora cai ${(-out[0] * 100).toFixed(1)} cm (antes: 9,0 cm)`);
  const somaRaw = raw.reduce((a, v) => a + v, 0);
  const somaOut = out.reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(somaRaw - somaOut) < 0.01, `total preservado: ${somaOut.toFixed(3)} vs ${somaRaw.toFixed(3)} m`);
  // subida passa sem alteração
  const subida = shapeRateSeries([0.05, 0.12, 0.2]);
  assert.deepEqual(subida, [0.05, 0.12, 0.2]);
  // pico de subida seguido de queda: só a queda é suavizada
  const misto = shapeRateSeries([0.3, -0.1, -0.05], { tauFallH: 3 });
  assert.equal(misto[0], 0.3);
  assert.ok(-misto[1] < 0.1);
});

test('limitDescent: queda nunca acelera em degrau e respeita o teto', () => {
  // curva bruta com mergulho imediato de 12 cm na 1ª hora
  const stages = [5.0, 4.88, 4.82, 4.78, 4.75, 4.73, 4.72, 4.715];
  const out = limitDescent(stages, { startDropM: 0.03, accelMPerH2: 0.015, maxDropPerHourM: 0.12 });
  const st = descentStats(out);
  const envelope = 0.03 + 0.015 * (stages.length - 1); // startDrop + accel·n
  assert.ok(
    st.maxDropM <= envelope + 1e-9,
    `maior queda horária ${(st.maxDropM * 100).toFixed(1)} cm ≤ envelope ${(envelope * 100).toFixed(1)} cm (bruto: 12,0 cm)`
  );
  assert.ok(
    st.maxDropM < 0.06,
    `nada parecido com o degrau bruto de 12 cm/h (máx. ${(st.maxDropM * 100).toFixed(1)} cm/h)`
  );
  assert.ok(out[0] - out[1] <= 0.0301, `1ª hora cai só ${((out[0] - out[1]) * 100).toFixed(1)} cm (bruto: 12,0 cm)`);
  assert.ok(st.accelerations >= 0 && st.maxAccelM <= 0.0151, `aceleração máx. ${(st.maxAccelM * 100).toFixed(2)} cm/h²`);
  assert.ok(out.every((v, i) => i === 0 || v <= out[i - 1] + 1e-9), 'segue descendente, sem serrilhado');
  // subida passa intacta
  const sobe = [2.0, 2.1, 2.35, 2.4];
  assert.deepEqual(limitDescent(sobe), sobe);
  // depois de uma subida, a descida recomeça suave
  const sobeDesce = [2.0, 2.2, 2.1, 1.9, 1.7];
  const sd = limitDescent(sobeDesce);
  assert.equal(sd[1], 2.2);
  assert.ok(sd[1] - sd[2] <= 0.0301, 'recomeço da descida suave após a subida');
});

/* ------------------------------------------------------------------ */
/* Tendência subida/descida — usada nos avisos do Telegram             */
/* ------------------------------------------------------------------ */

test('trendOf identifica subida, descida, estabilidade e ignora outlier', () => {
  const t0 = Date.UTC(2026, 8, 23, 12, 0, 0);
  const mk = (hs, stepMin = 15) => hs.map((h, i) => ({ ts: t0 + i * stepMin * 60000, h }));

  const subindo = trendOf(mk([3.0, 3.05, 3.11, 3.18, 3.26]));
  assert.equal(subindo.dir, 'subida');
  assert.ok((subindo.rateCmH ?? 0) > 3);

  const descendo = trendOf(mk([5.2, 5.15, 5.09, 5.02, 4.96]));
  assert.equal(descendo.dir, 'descida');
  assert.ok((descendo.rateCmH ?? 0) < -3);

  const estavel = trendOf(mk([4.0, 4.005, 4.0, 3.998, 4.001]));
  assert.equal(estavel.dir, 'estavel');

  // telemetria com um pico espúrio de 1 amostra não inverte a leitura
  const comOutlier = trendOf(mk([4.5, 4.48, 4.9, 4.44, 4.41]));
  assert.equal(comOutlier.dir, 'descida', 'pico isolado não vira "subida"');

  assert.equal(trendOf([{ ts: t0, h: 4 }]).dir, 'indefinida');
  assert.equal(robustRateCmH([], 3), null);
});

test('robustRateCmH: Theil–Sen resiste a ruído (base do cálculo da taxa)', () => {
  const t0 = Date.UTC(2026, 8, 23, 12, 0, 0);
  // subindo 0,5 cm por leitura de 15 min ≈ 2 cm/h, com ruído alternado
  const pts = Array.from({ length: 13 }, (_, i) => ({
    ts: t0 + i * 15 * 60000,
    h: 3 + i * 0.005 + (i % 2 ? 0.004 : -0.004),
  }));
  const rate = robustRateCmH(pts, 3) ?? 0;
  assert.ok(Math.abs(rate - 2) < 0.8, `taxa ${rate.toFixed(2)} cm/h ≈ 2 cm/h`);
});

/* ------------------------------------------------------------------ */
/* MOTOR COMPLETO (src/lib/iphEngine.ts) — o código que desenha a curva */
/* ------------------------------------------------------------------ */

import {
  propagateCurve,
  RAIN_PAST_H,
  SUB_AREA_FRAC,
  SUB_DH,
  API_SAT_REF,
} from '../src/lib/iphEngine.ts';

const API_SATURADO = API_SAT_REF; // solo saturado (AMC III)

/** hyetograma de 102,5 mm em 48 h posicionado `offsetH` do "agora" */
function hyetograph2024(offsetH) {
  const rain = new Array(RAIN_PAST_H + 200).fill(0);
  const total = CALIBRATION_2024.rainMm;
  const horas = CALIBRATION_2024.rainH;
  for (let i = 0; i < horas; i++) {
    const idx = RAIN_PAST_H + offsetH + i;
    if (idx >= 0 && idx < rain.length) rain[idx] += total / horas;
  }
  return rain;
}

test('motor: evento de maio/2024 reproduz o pico observado (+6,26 m)', () => {
  // previsão emitida ANTES da chuva (cenário operacional: chuva no futuro)
  const prop = propagateCurve(CALIBRATION_2024.baseLevelM, 144, 0, 0, hyetograph2024(0), API_SATURADO, null);
  const pico = Math.max(...prop.stages) - CALIBRATION_2024.baseLevelM;
  assert.ok(
    Math.abs(pico - CALIBRATION_2024.observedRiseM) <= CALIBRATION_2024.toleranceM,
    `pico previsto +${pico.toFixed(2)} m vs observado +${CALIBRATION_2024.observedRiseM} m`
  );
  // a subida é permitida (enxurrada pode dar guinada para cima), mas com trava
  const maxSubida = Math.max(...prop.stages.slice(1).map((v, i) => v - prop.stages[i]));
  assert.ok(maxSubida <= 0.25 + 1e-9, `subida máx/h ${(maxSubida * 100).toFixed(1)} cm ≤ trava de 25 cm/h`);
});

test('motor: ECMWF e GFS só coincidem quando a chuva é a mesma (causa raiz corrigida)', () => {
  const seco = new Array(RAIN_PAST_H + 100).fill(0);
  const a = propagateCurve(3.0, 72, 0, 0, seco, 90, null);
  const b = propagateCurve(3.0, 72, 0, 0, [...seco], 90, null);
  const diffSemChuva = Math.max(...a.stages.map((v, i) => Math.abs(v - b.stages[i])));
  assert.equal(diffSemChuva, 0, 'sem chuva prevista as duas curvas coincidem (esperado e documentado)');

  // ECMWF prevê 40 mm a mais que o GFS: as curvas PRECISAM divergir
  const chuvoso = new Array(RAIN_PAST_H + 100).fill(0);
  for (let i = 0; i < 24; i++) chuvoso[RAIN_PAST_H + i] = 1.0; // 24 mm
  const fraco = new Array(RAIN_PAST_H + 100).fill(0);
  for (let i = 0; i < 24; i++) fraco[RAIN_PAST_H + i] = 0.4; // 9,6 mm
  const cE = propagateCurve(3.0, 72, 0, 0, chuvoso, API_SATURADO, null);
  const cG = propagateCurve(3.0, 72, 0, 0, fraco, API_SATURADO, null);
  const diffComChuva = Math.max(...cE.stages.map((v, i) => Math.abs(v - cG.stages[i])));
  assert.ok(diffComChuva > 0.3, `24 mm × 9,6 mm divergem ${(diffComChuva * 100).toFixed(0)} cm na curva`);
  assert.ok(Math.max(...cE.stages) > 3.0, 'com chuva forte o nível projetado sobe');
});

test('motor: rio em recessão não mergulha no início da curva', () => {
  const seco = new Array(RAIN_PAST_H + 100).fill(0);
  // rio a 5,4 m caindo 10 cm/h (recessão forte) — o caso relatado
  const prop = propagateCurve(5.4, 72, -8, -10, seco, 90, null);
  const primeiraHora = (prop.stages[0] - prop.stages[1]) * 100;
  assert.ok(primeiraHora <= 5, `motor: 1ª hora cai ${primeiraHora.toFixed(1)} cm (antes do ajuste caía ~8,5 cm)`);
  // a curva que vai para o gráfico passa ainda pelo passe final de forma
  const plot = limitDescent(prop.stages);
  const primeiraPlot = (plot[0] - plot[1]) * 100;
  assert.ok(primeiraPlot <= 3.1, `curva plotada: 1ª hora cai só ${primeiraPlot.toFixed(1)} cm`);
  const st = descentStats(plot);
  assert.ok(st.maxDropM <= 0.0301 + 0.015 * 71 + 1e-9, `queda máx/h ${(st.maxDropM * 100).toFixed(1)} cm respeita o envelope`);
  // nenhuma hora cai mais que o degrau inicial + aceleração permitida
  const saltos = prop.stages.slice(1).map((v, i) => prop.stages[i] - v);
  const maiorSalto = Math.max(...saltos);
  const saltoSeguinte = saltos.slice(1).map((v, i) => v - saltos[i]);
  assert.ok(Math.max(...saltoSeguinte) <= 0.0151, 'a queda nunca acelera mais que 1,5 cm/h por hora');
  assert.ok(maiorSalto < 0.12, 'queda horária dentro do teto de 12 cm/h');
  // e o total ainda desce (suavizar não é congelar a curva)
  assert.ok(prop.stages[72] < prop.stages[0] - 0.5, `recessão preservada: caiu ${((prop.stages[0] - prop.stages[72]) * 100).toFixed(0)} cm em 72 h`);
  // remanso do Guaíba: sem degrau na 1ª hora (era +0,5 m de uma vez)
  const comGuaiba = propagateCurve(4.0, 24, 0, 0, seco, 90, 5.5);
  const saltoRemanso = comGuaiba.stages[1] - comGuaiba.stages[0];
  assert.ok(saltoRemanso <= 0.05, `remanso entra em ${(saltoRemanso * 100).toFixed(1)} cm na 1ª hora`);
});

test('motor: ganhos da calibração são os mesmos usados no painel', () => {
  const soma = ['alto', 'medio', 'baixo'].reduce((a, k) => a + SUB_AREA_FRAC[k], 0);
  assert.ok(Math.abs(soma - 1) < 1e-9, 'frações de área somam 1');
  assert.ok(SUB_DH.baixo > SUB_DH.alto, 'baixo Sinos (urbano) responde mais que a serra');
});
