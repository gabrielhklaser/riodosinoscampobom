/**
 * Camada de dados — Telemetria oficial da ANA (Agência Nacional de Águas e Saneamento Básico)
 * Estação: 87380000 — CAMPO BOM (Rio dos Sinos / RS) — operada pelo SGB-CPRM
 *
 * Web service público:
 *   https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos
 *   ?codEstacao=87380000&dataInicio=dd/MM/aaaa&dataFim=dd/MM/aaaa
 *
 * O retorno é XML com registros contendo:
 *   EstacaoCodigo | DataHora | Vazao (m³/s) | Nivel (cm) | Chuva (mm)
 */

export const STATION = {
  code: '87380000',
  name: 'Campo Bom',
  river: 'Rio dos Sinos',
  city: 'Campo Bom',
  state: 'RS',
  operator: 'SGB-CPRM',
  owner: 'ANA',
  basin: 'Bacia do Guaíba — Sub-bacia 87',
};

/**
 * Cotas de referência.
 * Inundação = 7,20 m (valor oficial divulgado pelo SGB para Campo Bom).
 * Atenção/Alerta seguem a convenção do sistema de alerta (-1,00 m e -0,50 m da cota de inundação).
 */
export const COTAS = {
  atencao: 6.2,
  alerta: 6.7,
  inundacao: 7.2,
  recordeHistorico: 8.56, // 04/05/2024 — enchente histórica do RS
};

export interface Reading {
  ts: number;        // timestamp (hora local de Brasília, conforme publicado pela ANA)
  level: number;     // nível em metros
  flow: number | null;   // vazão m³/s
  rain: number | null;   // chuva mm no intervalo
}

export type Status = 'normal' | 'atencao' | 'alerta' | 'inundacao';

/** Paleta calibrada para fundo escuro (tema dark). */
export const STATUS_META: Record<Status, { label: string; color: string; text: string; bg: string; ring: string; dot: string }> = {
  normal:    { label: 'Normal',    color: '#38bdf8', text: 'text-sky-300',    bg: 'bg-sky-500/10',    ring: 'ring-sky-400/30',    dot: 'bg-sky-400' },
  atencao:   { label: 'Atenção',   color: '#facc15', text: 'text-yellow-300', bg: 'bg-yellow-500/10', ring: 'ring-yellow-400/30', dot: 'bg-yellow-400' },
  alerta:    { label: 'Alerta',    color: '#fb923c', text: 'text-orange-300', bg: 'bg-orange-500/10', ring: 'ring-orange-400/30', dot: 'bg-orange-400' },
  inundacao: { label: 'Inundação', color: '#f87171', text: 'text-red-300',    bg: 'bg-red-500/10',    ring: 'ring-red-400/30',    dot: 'bg-red-400' },
};

export function statusFor(level: number): Status {
  if (level >= COTAS.inundacao) return 'inundacao';
  if (level >= COTAS.alerta) return 'alerta';
  if (level >= COTAS.atencao) return 'atencao';
  return 'normal';
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

const BASE = 'https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos';

/**
 * Caminho primário: o PRÓPRIO backend do painel (`/api/ana/serie`) chama a
 * ANA do lado do servidor — sem CORS, com cache de 10 min e fallback para a
 * última série válida. É o caminho confiável.
 *
 * Caminho de contingência (abaixo): o serviço da ANA não envia cabeçalhos
 * CORS, então chamadas diretas do navegador dependem de proxies públicos —
 * instáveis, e por isso são apenas o último recurso.
 */
const PROXIES: { name: string; build: (url: string) => string; json?: boolean }[] = [
  { name: 'direto', build: (u) => u },
  { name: 'allorigins-raw', build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: 'allorigins', build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, json: true },
  { name: 'corsproxy', build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { name: 'codetabs', build: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function brDate(d: Date) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
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

/** "2026-08-02 16:00:00" -> timestamp (interpretado como hora local, igual aos portais oficiais) */
function parseAnaDate(raw: string): number | null {
  const m = raw.trim().match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = v.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function childText(el: Element, tag: string): string | null {
  const found = el.getElementsByTagName(tag);
  if (found.length) return found[0].textContent;
  // fallback: namespaces / capitalização diferente
  for (const child of Array.from(el.children)) {
    const local = child.tagName.replace(/^.*:/, '').toLowerCase();
    if (local === tag.toLowerCase()) return child.textContent;
  }
  return null;
}

export function parseAnaXml(xml: string): Reading[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];

  // Cada registro é o elemento-pai de uma tag <DataHora>
  const stamps = Array.from(doc.getElementsByTagName('DataHora'));
  const out: Reading[] = [];

  for (const stamp of stamps) {
    const rec = stamp.parentElement;
    if (!rec) continue;
    const ts = parseAnaDate(stamp.textContent || '');
    if (ts == null) continue;

    const nivelCm = num(childText(rec, 'Nivel'));
    if (nivelCm == null || nivelCm <= 0) continue; // registros só de chuva / sem leitura

    out.push({
      ts,
      level: +(nivelCm / 100).toFixed(2), // ANA publica em centímetros
      flow: num(childText(rec, 'Vazao')),
      rain: num(childText(rec, 'Chuva')),
    });
  }

  // ordena crescente e remove duplicatas
  out.sort((a, b) => a.ts - b.ts);
  return out.filter((r, i) => i === 0 || r.ts !== out[i - 1].ts);
}

export interface FetchResult {
  readings: Reading[];
  source: string;
  fetchedAt: number;
}

/** Busca a série telemétrica dos últimos `days` dias. */
export async function fetchSeries(days: number): Promise<FetchResult> {
  // 1) backend próprio (mesmo domínio, sem CORS, cache + fallback no servidor)
  try {
    const res = await fetch(`/api/ana/serie?codEstacao=${STATION.code}&days=${days}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        readings?: Reading[];
        stale?: boolean;
        fetchedAt?: number | null;
      };
      if (Array.isArray(json.readings) && json.readings.length) {
        return {
          readings: json.readings,
          source: 'servidor',
          fetchedAt: json.fetchedAt ?? Date.now(),
        };
      }
    }
  } catch {
    /* segue para os proxies públicos */
  }

  // 2) contingência: proxies públicos (herdados — instáveis)
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  // +1 dia no fim garante que o fuso do servidor não corte as leituras mais recentes
  const end = new Date(now.getTime() + 86400000);

  const url = `${BASE}?codEstacao=${STATION.code}&dataInicio=${brDate(start)}&dataFim=${brDate(end)}`;

  let lastErr: unknown = null;
  for (const proxy of PROXIES) {
    try {
      const body = await fetchText(proxy.build(url));
      const xml = proxy.json ? (JSON.parse(body).contents as string) : body;
      if (!xml) throw new Error('resposta vazia');
      const readings = parseAnaXml(xml);
      if (readings.length) {
        return { readings, source: proxy.name, fetchedAt: Date.now() };
      }
      throw new Error('nenhum registro válido');
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Não foi possível obter os dados da ANA (${lastErr instanceof Error ? lastErr.message : 'falha de rede'})`
  );
}

/* ------------------------------------------------------------------ */
/* Análises                                                            */
/* ------------------------------------------------------------------ */

/** Variação em cm/h calculada por regressão linear na janela indicada (minutos). */
export function trendCmPerHour(readings: Reading[], windowMin = 180): number | null {
  if (readings.length < 2) return null;
  const last = readings[readings.length - 1];
  const win = readings.filter((r) => r.ts >= last.ts - windowMin * 60000);
  if (win.length < 2) return null;

  const t0 = win[0].ts;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const r of win) {
    const x = (r.ts - t0) / 3600000; // horas
    const y = r.level * 100;         // cm
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const n = win.length;
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  return (n * sxy - sx * sy) / den;
}

export function variationSince(readings: Reading[], hours: number): number | null {
  if (!readings.length) return null;
  const last = readings[readings.length - 1];
  const target = last.ts - hours * 3600000;
  let ref: Reading | null = null;
  for (const r of readings) {
    if (r.ts <= target) ref = r;
    else break;
  }
  if (!ref) ref = readings[0];
  return +((last.level - ref.level) * 100).toFixed(1); // cm
}

export function rainAccumulated(readings: Reading[], hours: number): number {
  if (!readings.length) return 0;
  const last = readings[readings.length - 1];
  return readings
    .filter((r) => r.ts >= last.ts - hours * 3600000)
    .reduce((acc, r) => acc + (r.rain || 0), 0);
}

/** Estimativa simples de horas até atingir uma cota, mantida a tendência atual. */
export function hoursToCota(current: number, cmPerHour: number | null, cota: number): number | null {
  if (cmPerHour == null || Math.abs(cmPerHour) < 0.3) return null;
  const diffCm = (cota - current) * 100;
  const h = diffCm / cmPerHour;
  if (h <= 0 || h > 96) return null;
  return h;
}

/**
 * Reduz a quantidade de pontos preservando os picos (máximo de cada bucket),
 * evitando que o gráfico "achate" a curva de subida em períodos longos.
 */
export function downsample(readings: Reading[], maxPoints = 420): Reading[] {
  if (readings.length <= maxPoints) return readings;
  const bucket = Math.ceil(readings.length / maxPoints);
  const out: Reading[] = [];
  for (let i = 0; i < readings.length; i += bucket) {
    const slice = readings.slice(i, i + bucket);
    let peak = slice[0];
    let rain = 0;
    for (const r of slice) {
      if (r.level > peak.level) peak = r;
      rain += r.rain || 0;
    }
    out.push({ ...peak, rain });
  }
  const last = readings[readings.length - 1];
  if (out[out.length - 1].ts !== last.ts) out.push(last);
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

export const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export const fmtDateTime = (ts: number) =>
  `${new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às ${fmtTime(ts)}`;

export const fmtAgo = (ts: number, now = Date.now()) => {
  const min = Math.max(0, Math.round((now - ts) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return `há ${h}h${rest ? ` ${rest}min` : ''}`;
  return `há ${Math.floor(h / 24)} dia(s)`;
};
