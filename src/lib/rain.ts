/**
 * Camada de dados pluviométricos — bacia do Rio dos Sinos.
 *
 * Estações levantadas no Inventário Telemétrico da ANA
 * (serviço HidroInventario, sub-bacia 87 — Guaíba / Rio dos Sinos).
 *
 * Campo Bom (87380000) transmite o pluviômetro junto com o nível pelo
 * webservice de telemetria da ANA — é leitura instrumental direta.
 *
 * As estações a montante (Sapiranga, Araricá/Nova Hartz, Parobé, Taquara,
 * Rolante) estão cadastradas no inventário da ANA, porém são operadas por
 * CEMADEN / Defesa Civil-RS / SEMA-RS e NÃO são servidas pelo webservice
 * público de telemetria da ANA (retornam "sem dados"). Para essas, a
 * precipitação horária é obtida no Open-Meteo exatamente nas coordenadas
 * cadastradas da estação — a origem de cada série é declarada na tabela
 * de fontes exibida abaixo do gráfico.
 */

import { parseAnaXml, type Reading } from './ana';
import { isInsideBasin } from './basin';

export type RainProvider = 'ANA' | 'Open-Meteo';

export interface RainStation {
  id: string;
  name: string;
  city: string;
  anaCode: string;
  operator: string;
  lat: number;
  lon: number;
  /** posição em relação a Campo Bom */
  position: 'local' | 'montante';
  /** distância aproximada ao longo do rio, em km, a montante de Campo Bom */
  upstreamKm: number;
  provider: RainProvider;
}

/**
 * Campo Bom + 5 estações a montante, cobrindo a bacia contribuinte
 * (Sapiranga → Araricá/Nova Hartz → Parobé → Taquara → Rolante).
 */
/**
 * Estações principais do painel pluviométrico.
 * Estações com provider='ANA' buscam chuva medida diretamente pelo
 * webservice de telemetria da ANA (testado e confirmado).
 * As demais usam Open-Meteo como fallback.
 */
export const RAIN_STATIONS: RainStation[] = [
  {
    id: 'campobom',
    name: 'Campo Bom',
    city: 'Campo Bom',
    anaCode: '87380000',
    operator: 'ANA / SGB-CPRM',
    lat: -29.6917,
    lon: -51.0461,
    position: 'local',
    upstreamKm: 0,
    provider: 'ANA',
  },
  {
    id: 'sao-leopoldo',
    name: 'São Leopoldo (Pte. 25 Julho)',
    city: 'São Leopoldo',
    anaCode: '87382000',
    operator: 'ANA / SGB-CPRM',
    lat: -29.7589,
    lon: -51.1483,
    position: 'local',
    upstreamKm: 0,
    provider: 'ANA',
  },
  {
    id: 'sapiranga',
    name: 'Sapiranga (Toca)',
    city: 'Sapiranga',
    anaCode: '2951040',
    operator: 'ANA',
    lat: -29.6333,
    lon: -51.0,
    position: 'montante',
    upstreamKm: 12,
    provider: 'Open-Meteo',
  },
  {
    id: 'novahartz',
    name: 'Nova Hartz / Araricá',
    city: 'Nova Hartz',
    anaCode: '2950125',
    operator: 'Defesa Civil-RS',
    lat: -29.5933,
    lon: -50.9028,
    position: 'montante',
    upstreamKm: 24,
    provider: 'Open-Meteo',
  },
  {
    id: 'parobe',
    name: 'Parobé (Laranjeiras)',
    city: 'Parobé',
    anaCode: '2950085',
    operator: 'CEMADEN',
    lat: -29.634,
    lon: -50.846,
    position: 'montante',
    upstreamKm: 33,
    provider: 'Open-Meteo',
  },
  {
    id: 'taquara',
    name: 'Taquara Montante',
    city: 'Taquara',
    anaCode: '2950068',
    operator: 'ANA / SGB-CPRM',
    lat: -29.7208,
    lon: -50.735,
    position: 'montante',
    upstreamKm: 48,
    provider: 'Open-Meteo',
  },
  {
    id: 'rolante',
    name: 'Rolante Centro',
    city: 'Rolante',
    anaCode: '2950122',
    operator: 'Defesa Civil-RS',
    lat: -29.6653,
    lon: -50.5819,
    position: 'montante',
    upstreamKm: 70,
    provider: 'Open-Meteo',
  },
  {
    id: 'caraa-ana',
    name: 'Caraá (nascentes)',
    city: 'Caraá',
    anaCode: '87318700',
    operator: 'ANA / Defesa Civil-RS',
    lat: -29.7692,
    lon: -50.3572,
    position: 'montante',
    upstreamKm: 120,
    provider: 'ANA',
  },
];

/**
 * Estações candidatas para o MAPA DA BACIA.
 * Todas constam do Inventário Telemétrico da ANA (sub-bacia 87 — Guaíba).
 * A lista cobre desde as nascentes (Caraá / Serra Geral) até a foz
 * (Delta do Jacuí) e é filtrada pelo polígono oficial da bacia.
 */
export const BASIN_CANDIDATES: RainStation[] = [
  // --- Alto Sinos / nascentes ---
  { id: 'caraa',          name: 'Caraá (DCRS)',                  city: 'Caraá',           anaCode: '2950119', operator: 'Defesa Civil-RS', lat: -29.7692, lon: -50.3572, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'caraa-arroio',   name: 'Arroio Caraá',                 city: 'Caraá',           anaCode: '2950071', operator: 'SEMA-RS',         lat: -29.7908, lon: -50.4217, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'riozinho',       name: 'Riozinho — Centro',            city: 'Riozinho',        anaCode: '2950087', operator: 'CEMADEN',         lat: -29.6406, lon: -50.4597, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  // --- Rio Rolante ---
  { id: 'rol-mascarada',  name: 'Rolante — Rio Mascarada',      city: 'Rolante',         anaCode: '2950123', operator: 'Defesa Civil-RS', lat: -29.5825, lon: -50.4697, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'rol-boaesp',     name: 'Boa Esperança',                city: 'Rolante',         anaCode: '2950107', operator: 'SEMA-RS',         lat: -29.5586, lon: -50.5025, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'rol-alto',       name: 'Alto Rolante',                 city: 'Rolante',         anaCode: '2950098', operator: 'SEMA-RS',         lat: -29.645,  lon: -50.5106, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'rol-mataolho',   name: 'Mata Olho',                    city: 'Rolante',         anaCode: '2950114', operator: 'SEMA-RS',         lat: -29.5803, lon: -50.5561, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'rol-rolantinho', name: 'Alto Rolantinho',              city: 'Rolante',         anaCode: '2950088', operator: 'CEMADEN',         lat: -29.6904, lon: -50.5498, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  // --- Rio Paranhana ---
  { id: 'trescoroas-raft', name: 'Três Coroas — Raft Park',     city: 'Três Coroas',     anaCode: '2950090', operator: 'CEMADEN',         lat: -29.4253, lon: -50.7719, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'trescoroas-dc',  name: 'Três Coroas',                  city: 'Três Coroas',     anaCode: '2950126', operator: 'Defesa Civil-RS', lat: -29.47,   lon: -50.7594, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'trescoroas-ctr', name: 'Três Coroas — Centro',         city: 'Três Coroas',     anaCode: '2950092', operator: 'CEMADEN',         lat: -29.515,  lon: -50.775,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'trescoroas-vp',  name: 'Três Coroas — V. Pinheiros',   city: 'Três Coroas',     anaCode: '2950091', operator: 'CEMADEN',         lat: -29.5161, lon: -50.8031, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'igrejinha-fig2', name: 'Igrejinha — Figueira II',      city: 'Igrejinha',       anaCode: '2950078', operator: 'CEMADEN',         lat: -29.54,   lon: -50.781,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'igrejinha-fig',  name: 'Igrejinha — Figueira',         city: 'Igrejinha',       anaCode: '2950077', operator: 'CEMADEN',         lat: -29.555,  lon: -50.789,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'igrejinha-dc',   name: 'Igrejinha',                    city: 'Igrejinha',       anaCode: '2950124', operator: 'Defesa Civil-RS', lat: -29.5736, lon: -50.7964, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'igrejinha-bp',   name: 'Igrejinha — Bom Pastor',       city: 'Igrejinha',       anaCode: '2950079', operator: 'CEMADEN',         lat: -29.569,  lon: -50.807,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'igrejinha-xv',   name: 'Igrejinha — XV de Novembro',   city: 'Igrejinha',       anaCode: '2950081', operator: 'CEMADEN',         lat: -29.589,  lon: -50.804,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  // --- Médio Sinos ---
  { id: 'parobe-inv',     name: 'Parobé — Invernada',           city: 'Parobé',          anaCode: '2950080', operator: 'CEMADEN',         lat: -29.601,  lon: -50.821,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'parobe-paraiso', name: 'Parobé — Paraíso',             city: 'Parobé',          anaCode: '2950086', operator: 'CEMADEN',         lat: -29.629,  lon: -50.815,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'pz-parobe',      name: 'Parobé — PZ Parobé',           city: 'Parobé',          anaCode: '2950118', operator: 'SGB-CPRM',        lat: -29.6681, lon: -50.8231, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'foz-paranhana',  name: 'Foz do Paranhana',             city: 'Taquara',         anaCode: '87376000', operator: 'SEMA-RS',        lat: -29.6858, lon: -50.8122, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'novahartz-dc',   name: 'Nova Hartz',                   city: 'Nova Hartz',      anaCode: '2950125', operator: 'Defesa Civil-RS', lat: -29.5933, lon: -50.9028, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  // --- Baixo Sinos ---
  { id: 'cb-quatrocol',   name: 'Campo Bom — Quatro Colônias',  city: 'Campo Bom',       anaCode: '2951098', operator: 'CEMADEN',         lat: -29.664,  lon: -51.035,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'cb-imigrante',   name: 'Campo Bom — Imigrante',        city: 'Campo Bom',       anaCode: '2951099', operator: 'CEMADEN',         lat: -29.671,  lon: -51.088,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'cb-bairrok',     name: 'Campo Bom — Bairro K',         city: 'Campo Bom',       anaCode: '2951101', operator: 'CEMADEN',         lat: -29.683,  lon: -51.047,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'cb-barrinha',    name: 'Campo Bom — Barrinha',         city: 'Campo Bom',       anaCode: '2951100', operator: 'CEMADEN',         lat: -29.695,  lon: -51.042,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'doisirmaos',     name: 'Dois Irmãos',                  city: 'Dois Irmãos',     anaCode: '2951167', operator: 'Defesa Civil-RS', lat: -29.5969, lon: -51.0894, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'ivoti',          name: 'Ivoti — Picada 48',            city: 'Ivoti',           anaCode: '2951153', operator: 'ANA/ANEEL',       lat: -29.5844, lon: -51.1253, position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'nh-obras',       name: 'Novo Hamburgo — Sub. Obras',   city: 'Novo Hamburgo',   anaCode: '2951123', operator: 'CEMADEN',         lat: -29.6772, lon: -51.155,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'nh-canudos',     name: 'Novo Hamburgo — Canudos',      city: 'Novo Hamburgo',   anaCode: '2951122', operator: 'CEMADEN',         lat: -29.704,  lon: -51.093,  position: 'montante', upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sl-manteiga',    name: 'São Leopoldo — A. Manteiga',   city: 'São Leopoldo',    anaCode: '2951126', operator: 'CEMADEN',         lat: -29.73,   lon: -51.1789, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sl-feitoria',    name: 'São Leopoldo — Feitoria',      city: 'São Leopoldo',    anaCode: '2951127', operator: 'CEMADEN',         lat: -29.7481, lon: -51.0969, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sl-ana',         name: 'São Leopoldo (Pte. 25 Julho)', city: 'São Leopoldo',    anaCode: '87382000', operator: 'ANA / SGB-CPRM', lat: -29.7589, lon: -51.1483, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sl-vicentina',   name: 'São Leopoldo — Vicentina',     city: 'São Leopoldo',    anaCode: '2951128', operator: 'CEMADEN',         lat: -29.7731, lon: -51.16,   position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sl-santateresa', name: 'São Leopoldo — Sta. Teresa',   city: 'São Leopoldo',    anaCode: '2951129', operator: 'CEMADEN',         lat: -29.79,   lon: -51.1319, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sapucaia-col',   name: 'Sapucaia do Sul — Colonial',   city: 'Sapucaia do Sul', anaCode: '2951133', operator: 'CEMADEN',         lat: -29.81,   lon: -51.169,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'sapucaia-vargas',name: 'Sapucaia do Sul — Vargas',     city: 'Sapucaia do Sul', anaCode: '2951131', operator: 'CEMADEN',         lat: -29.823,  lon: -51.136,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'esteio',         name: 'Esteio',                       city: 'Esteio',          anaCode: '2951175', operator: 'Defesa Civil-RS', lat: -29.8328, lon: -51.1811, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'novasantarita',  name: 'Nova Santa Rita',              city: 'Nova Santa Rita', anaCode: '2951121', operator: 'CEMADEN',         lat: -29.857,  lon: -51.276,  position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'canoas-sl',      name: 'Canoas — São Luís',            city: 'Canoas',          anaCode: '2951105', operator: 'CEMADEN',         lat: -29.8771, lon: -51.1435, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'canoas-mv',      name: 'Canoas — Mathias Velho',       city: 'Canoas',          anaCode: '2951103', operator: 'CEMADEN',         lat: -29.8977, lon: -51.1999, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'canoas-estvelha',name: 'Canoas — Estância Velha',      city: 'Canoas',          anaCode: '2951104', operator: 'CEMADEN',         lat: -29.9268, lon: -51.1361, position: 'local',    upstreamKm: 0, provider: 'Open-Meteo' },
  { id: 'nsr-canoas',     name: 'Nova Santa Rita / Canoas',     city: 'Canoas',          anaCode: '87385041', operator: 'Defesa Civil-RS', lat: -29.8764, lon: -51.2431, position: 'local',   upstreamKm: 0, provider: 'Open-Meteo' },
];

/** Distância em km entre dois pontos (Haversine). */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const CENTER = { lat: -29.6917, lon: -51.0461 };

/**
 * Estações do mapa = todas as candidatas que caem DENTRO do polígono oficial
 * da Bacia Hidrográfica do Rio dos Sinos (teste ponto-em-polígono).
 */
export const MAP_STATIONS: RainStation[] = (() => {
  const all = [...RAIN_STATIONS, ...BASIN_CANDIDATES];
  const seen = new Set<string>();
  return all.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return isInsideBasin(s.lat, s.lon);
  });
})();

/** Candidatas que ficaram FORA do limite da bacia (auditoria/transparência). */
export const OUTSIDE_BASIN: RainStation[] = [...RAIN_STATIONS, ...BASIN_CANDIDATES].filter(
  (s) => !isInsideBasin(s.lat, s.lon)
);

export interface StationRain {
  station: RainStation;
  /** chave = timestamp da hora cheia; valor = mm acumulados naquela hora */
  hourly: Record<number, number>;
  ok: boolean;
}

export interface RainResult {
  stations: StationRain[];
  /** média da bacia, por hora cheia */
  meanHourly: { ts: number; mm: number }[];
  /** estações do mapa regional (raio de 25 km) */
  mapStations: StationRain[];
  fetchedAt: number;
}

/** Arredonda um timestamp para a hora cheia local. */
export function hourKey(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/** Agrega as leituras de 15 min da ANA (Campo Bom) em totais horários. */
function anaHourly(readings: Reading[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of readings) {
    if (r.rain == null) continue;
    const k = hourKey(r.ts);
    out[k] = (out[k] || 0) + r.rain;
  }
  return out;
}

const OM_BASE = 'https://api.open-meteo.com/v1/forecast';

async function fetchOpenMeteo(stations: RainStation[], days: number) {
  const lat = stations.map((s) => s.lat).join(',');
  const lon = stations.map((s) => s.lon).join(',');
  const pastDays = Math.min(92, Math.max(2, Math.ceil(days)));

  const url =
    `${OM_BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation&past_days=${pastDays}&forecast_days=1` +
    `&timezone=America%2FSao_Paulo`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];

  return stations.map((station, i) => {
    const block = list[i];
    const hourly: Record<number, number> = {};
    let ok = false;
    const times: string[] | undefined = block?.hourly?.time;
    const values: number[] | undefined = block?.hourly?.precipitation;
    if (times && values) {
      ok = true;
      for (let k = 0; k < times.length; k++) {
        const m = times[k].match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (!m) continue;
        const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
        hourly[ts] = values[k] ?? 0;
      }
    }
    return { station, hourly, ok };
  });
}

/**
 * Busca chuva da ANA para uma estação (15 min → horário).
 *
 * Caminho primário: o próprio backend (`/api/ana/serie`) — sem CORS e com o
 * parser XML oficial compartilhado com a série principal (a versão anterior
 * tentava regex sobre texto e não batia com o XML diffgram que a ANA
 * devolve). Contingência: proxies públicos + o mesmo parser XML.
 */
async function fetchAnaRain(code: string, days: number): Promise<Record<number, number>> {
  // 1) backend próprio
  try {
    const res = await fetch(`/api/ana/serie?codEstacao=${code}&days=${days}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const json = (await res.json()) as { readings?: Reading[] };
      return anaHourly(json.readings ?? []);
    }
  } catch {
    /* tenta os proxies públicos */
  }

  // 2) contingência: proxies públicos + parser XML (não regex)
  const ANA_BASE = 'https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos';
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const end = new Date(now.getTime() + 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const brDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const raw = `${ANA_BASE}?codEstacao=${code}&dataInicio=${brDate(start)}&dataFim=${brDate(end)}`;

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(raw)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(raw)}`,
  ];

  for (const url of proxies) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 18000);
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) continue;
      const xml = await res.text();
      const hourly = anaHourly(parseAnaXml(xml));
      if (Object.keys(hourly).length > 0) return hourly;
    } catch {
      continue;
    }
  }
  return {};
}

/**
 * Busca a precipitação de todas as estações e calcula a média da bacia.
 * Estações com provider='ANA' buscam dados medidos diretamente da telemetria.
 * `anaReadings` são as leituras já obtidas da estação 87380000 (Campo Bom).
 */
export async function fetchRain(days: number, anaReadings: Reading[]): Promise<RainResult> {
  const anaStations = RAIN_STATIONS.filter((s) => s.provider === 'ANA');
  const omStations = RAIN_STATIONS.filter((s) => s.provider !== 'ANA');

  // Campo Bom: usa as leituras que já temos (evita requisição duplicada)
  const cbHourly = anaHourly(anaReadings);

  // Buscar chuva ANA para as demais estações ANA (São Leopoldo, Caraá)
  const anaOthers = anaStations.filter((s) => s.anaCode !== '87380000');
  const anaResults = await Promise.all(
    anaOthers.map((s) => fetchAnaRain(s.anaCode, days).catch(() => ({} as Record<number, number>)))
  );

  // Montar as entradas ANA
  const anaEntries: StationRain[] = anaStations.map((station) => {
    if (station.anaCode === '87380000') {
      return { station, hourly: cbHourly, ok: Object.keys(cbHourly).length > 0 };
    }
    const idx = anaOthers.findIndex((s) => s.id === station.id);
    const hourly = idx >= 0 ? anaResults[idx] : {};
    return { station, hourly, ok: Object.keys(hourly).length > 0 };
  });

  // estações que aparecem só no mapa da bacia (não entram na média do gráfico)
  const extras = MAP_STATIONS.filter((m) => !RAIN_STATIONS.some((r) => r.id === m.id));
  const toFetch = [...omStations, ...extras];

  let fetched: StationRain[] = [];
  try {
    fetched = await fetchOpenMeteo(toFetch, days);
  } catch {
    fetched = toFetch.map((station) => ({ station, hourly: {}, ok: false }));
  }

  const omEntries = fetched.filter((f) => omStations.some((r) => r.id === f.station.id));
  const extraEntries = fetched.filter((f) => extras.some((e) => e.id === f.station.id));

  const stations = [...anaEntries, ...omEntries].sort(
    (a, b) => a.station.upstreamKm - b.station.upstreamKm
  );

  // mapa: estações da bacia dentro do raio + vizinhas
  const mapStations = [...stations, ...extraEntries]
    .filter((s) => MAP_STATIONS.some((m) => m.id === s.station.id))
    .sort(
      (a, b) =>
        distanceKm(CENTER.lat, CENTER.lon, a.station.lat, a.station.lon) -
        distanceKm(CENTER.lat, CENTER.lon, b.station.lat, b.station.lon)
    );

  // média entre as estações que responderam
  const active = stations.filter((s) => s.ok);
  const allHours = new Set<number>();
  for (const s of active) for (const k of Object.keys(s.hourly)) allHours.add(+k);

  const meanHourly = Array.from(allHours)
    .sort((a, b) => a - b)
    .map((ts) => {
      let sum = 0;
      let n = 0;
      for (const s of active) {
        const v = s.hourly[ts];
        if (v != null) {
          sum += v;
          n++;
        }
      }
      return { ts, mm: n ? +(sum / n).toFixed(2) : 0 };
    });

  return { stations, meanHourly, mapStations, fetchedAt: Date.now() };
}

/* ------------------------------------------------------------------ */
/* Escala de cores da chuva (mm acumulados)                            */
/* ------------------------------------------------------------------ */

export const RAIN_SCALE = [
  { min: 0,   label: 'sem chuva',  color: '#475569' },
  { min: 0.2, label: 'fraca',      color: '#38bdf8' },
  { min: 5,   label: 'moderada',   color: '#22c55e' },
  { min: 15,  label: 'forte',      color: '#facc15' },
  { min: 30,  label: 'muito forte',color: '#fb923c' },
  { min: 50,  label: 'extrema',    color: '#ef4444' },
];

export function rainColor(mm: number): string {
  let c = RAIN_SCALE[0].color;
  for (const s of RAIN_SCALE) if (mm >= s.min) c = s.color;
  return c;
}

export function rainLabel(mm: number): string {
  let l = RAIN_SCALE[0].label;
  for (const s of RAIN_SCALE) if (mm >= s.min) l = s.label;
  return l;
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Soma a chuva de uma estação dentro de um intervalo. */
export function sumRain(hourly: Record<number, number>, from: number, to: number): number {
  let total = 0;
  for (const [k, v] of Object.entries(hourly)) {
    const ts = +k;
    if (ts >= from && ts <= to) total += v;
  }
  return +total.toFixed(1);
}

/** Último valor horário registrado até `to`. */
export function lastRain(hourly: Record<number, number>, to: number): number | null {
  const keys = Object.keys(hourly)
    .map(Number)
    .filter((ts) => ts <= to)
    .sort((a, b) => a - b);
  if (!keys.length) return null;
  return hourly[keys[keys.length - 1]];
}

export interface ChartPoint extends Reading {
  /** chuva média da bacia atribuída a este ponto do gráfico (mm) */
  rainAvg: number;
}

/**
 * Distribui a série horária de chuva média entre os pontos do gráfico,
 * somando cada hora no intervalo (ponto anterior, ponto atual].
 * Assim o total exibido no gráfico é igual ao total acumulado real.
 */
export function attachBasinRain(
  points: Reading[],
  meanHourly: { ts: number; mm: number }[]
): ChartPoint[] {
  if (!points.length) return [];
  if (!meanHourly.length) return points.map((p) => ({ ...p, rainAvg: 0 }));

  const sorted = [...meanHourly].sort((a, b) => a.ts - b.ts);
  let cursor = 0;
  const step = points.length > 1 ? points[1].ts - points[0].ts : 3600000;

  return points.map((p, i) => {
    const from = i === 0 ? p.ts - step : points[i - 1].ts;
    let mm = 0;
    while (cursor < sorted.length && sorted[cursor].ts <= from) cursor++;
    let scan = cursor;
    while (scan < sorted.length && sorted[scan].ts <= p.ts) {
      mm += sorted[scan].mm;
      scan++;
    }
    cursor = scan;
    return { ...p, rainAvg: +mm.toFixed(2) };
  });
}
