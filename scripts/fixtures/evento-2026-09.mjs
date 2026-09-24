/**
 * EVENTO REAL — cheia de 21 a 24/09/2026 no Rio dos Sinos.
 * =====================================================================
 * Série horária transcrita da telemetria oficial da ANA
 * (telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos),
 * consultada em 24/09/2026 ~09h40. Usada pelo teste de replay em
 * scripts/test-modelo.mjs: reproduz a previsão emitida "ontem"
 * (23/09 09h) e compara com o que o rio de fato fez.
 *
 *  • 87380000 CAMPO BOM (SGB-CPRM) ........ nível em m (régua oficial)
 *  • 87377500 ARARICÁ/SAPIRANGA/TAQUARA (DCRS) — Rio dos Sinos, ~10 km a
 *    montante de Campo Bom; referência de nível própria da DCRS (m)
 *  • 87376000 FOZ DO PARANHANA / Taquara (SEMA-RS) — Rio dos Sinos, m
 *
 * Horário local (America/Sao_Paulo), leitura cheia de cada hora.
 * `null` = hora sem transmissão (a própria ANA retornou vazio/0).
 */

/** 21/09/2026 00:00 local (UTC−3) em ms. */
export const T0 = Date.UTC(2026, 8, 21, 3, 0, 0);
export const H = 3600000;

/** hora relativa a T0 → ts */
export const at = (day, hour) => T0 + ((day - 21) * 24 + hour) * H;

// ---- Campo Bom 87380000 (m) — 21/09 03h → 24/09 09h -------------------
const CB = {
  21: { 3: 4.29, 4: 4.33, 5: 4.48, 6: 4.57, 7: 4.66, 8: 4.76, 9: 4.84, 10: 4.92, 11: 5.0, 12: 5.09, 13: 5.18, 14: 5.27, 15: 5.35, 16: 5.41, 17: 5.48, 18: 5.56, 19: 5.64, 20: 5.7, 21: 5.76, 22: 5.8, 23: 5.85 },
  22: { 0: 5.89, 1: 5.92, 2: 5.94, 3: 5.98, 4: 6.0, 5: 6.02, 6: 6.04, 7: 6.06, 8: 6.08, 9: 6.1, 10: 6.12, 11: 6.14, 12: 6.16, 13: 6.17, 14: 6.18, 15: 6.2, 16: 6.21, 17: 6.24, 18: 6.25, 19: 6.27, 20: 6.28, 21: 6.3, 22: 6.32, 23: 6.33 },
  23: { 0: 6.35, 1: 6.36, 2: 6.38, 3: 6.4, 4: 6.41, 5: 6.43, 6: 6.44, 7: 6.46, 8: 6.48, 9: 6.49, 10: 6.52, 11: 6.53, 12: 6.55, 13: 6.56, 14: 6.58, 15: 6.59, 16: 6.61, 17: 6.62, 18: 6.64, 19: 6.65, 20: 6.67, 21: 6.67, 22: 6.69, 23: 6.7 },
  24: { 0: 6.71, 1: 6.72, 2: 6.74, 3: 6.75, 4: 6.75, 5: 6.77, 6: 6.77, 7: 6.78, 8: 6.79, 9: 6.79 },
};

// ---- Araricá 87377500 (m, referência DCRS) — 21/09 13h → 24/09 09h -----
const ARA = {
  21: { 13: 8.54, 14: 8.75, 15: 8.94, 16: 9.09, 17: 9.23, 18: 9.37, 19: 9.48, 20: 9.58, 21: 9.66, 22: 9.72, 23: 9.77 },
  22: { 0: 9.81, 1: 9.84, 2: 9.87, 3: 9.9, 4: 9.93, 5: 9.95, 6: 9.97, 7: 9.99, 8: 10.01, 9: 10.03, 10: 10.05, 11: 10.08, 12: 10.1, 13: 10.13, 14: 10.15, 15: 10.18, 16: 10.2, 17: 10.23, 18: 10.26, 19: 10.29, 20: 10.31, 21: 10.34, 22: 10.36, 23: 10.39 },
  23: { 0: 10.41, 1: 10.44, 2: 10.46, 3: 10.49, 4: 10.51, 5: 10.53, 6: 10.55, 7: 10.57, 8: 10.59, 9: 10.61, 10: 10.63, 11: 10.65, 12: 10.67, 13: 10.68, 14: 10.7, 15: 10.71, 16: 10.72, 17: 10.74, 18: 10.75, 19: 10.76, 20: 10.77, 21: 10.78, 22: 10.78, 23: 10.79 },
  24: { 0: 10.8, 1: 10.81, 2: 10.81, 3: 10.81, 4: 10.82, 5: 10.82, 6: 10.82, 7: 10.82, 8: 10.82, 9: 10.82 },
};

// ---- Taquara / Foz do Paranhana 87376000 (m) — 20/09 00h → 24/09 08h ---
const TAQ = {
  20: { 0: 1.24, 1: 1.33, 2: 1.42, 3: 1.51, 4: 1.59, 6: 1.67, 7: 1.71, 8: 1.72, 9: 1.72, 10: 1.75, 11: 1.77, 13: 1.82, 14: 1.86, 15: 1.89, 16: 1.92, 18: 1.94, 19: 1.93, 20: 1.94, 21: 1.94, 22: 1.93, 23: 1.92 },
  21: { 0: 1.91, 1: 1.91, 3: 1.91, 4: 2.1, 5: 2.33, 6: 2.69, 7: 3.1, 8: 3.45, 9: 3.78, 11: 4.28, 12: 4.5, 13: 4.66, 14: 4.79, 16: 5.08, 17: 5.2, 18: 5.31, 19: 5.4, 20: 5.5, 21: 5.59, 22: 5.67, 23: 5.73 },
  22: { 0: 5.79, 1: 5.83, 2: 5.88, 3: 5.93, 5: 6.02, 6: 6.06, 7: 6.11, 8: 6.16, 9: 6.21, 11: 6.33, 12: 6.38, 13: 6.41, 14: 6.45, 15: 6.49, 16: 6.52, 18: 6.56, 19: 6.58, 20: 6.59, 21: 6.6, 22: 6.61 },
  23: { 0: 6.61, 1: 6.61, 2: 6.61, 3: 6.61, 6: 6.6, 7: 6.6, 8: 6.58, 9: 6.58, 11: 6.56, 12: 6.55, 13: 6.55, 15: 6.52, 17: 6.49, 18: 6.47, 19: 6.46, 20: 6.45, 21: 6.43, 22: 6.42 },
  24: { 0: 6.38, 1: 6.36, 2: 6.34, 4: 6.31, 5: 6.28, 6: 6.26, 7: 6.24, 8: 6.21 },
};

// ---- Chuva medida em Campo Bom 87380000 (mm/h) — 21/09 -----------------
const CB_RAIN = {
  21: { 3: 12.0, 4: 18.4, 5: 3.6, 6: 4.6, 7: 4.6, 8: 5.6, 9: 5.8, 10: 5.8, 11: 3.6, 12: 5.0, 13: 3.0, 14: 4.8, 15: 0.2, 16: 1.8, 17: 0.6, 18: 0.2, 19: 0.4, 20: 0, 21: 0.6 },
};

function toSeries(table) {
  const out = [];
  for (const [d, hours] of Object.entries(table)) {
    for (const [h, v] of Object.entries(hours)) {
      if (v == null) continue;
      out.push({ ts: at(+d, +h), h: v });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export const campoBom = toSeries(CB);
export const ararica = toSeries(ARA);
export const taquara = toSeries(TAQ);
export const campoBomRain = toSeries(CB_RAIN).map((p) => ({ ts: p.ts, mm: p.h }));

/** Série até (inclusive) o instante `ts` — simula "o que se sabia" naquela hora. */
export const until = (series, ts) => series.filter((p) => p.ts <= ts);

/** Valor observado na hora `ts` (ou null). */
export const obsAt = (series, ts) => series.find((p) => p.ts === ts)?.h ?? null;
