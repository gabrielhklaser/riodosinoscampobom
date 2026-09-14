/**
 * Geocodificação de endereços (endereço digitado → coordenada).
 *
 * Fonte: Nominatim / OpenStreetMap, restrito ao Brasil e enviesado para a
 * região do Vale do Sinos, com prioridade para Campo Bom.
 * Complementarmente aceita CEP (via BrasilAPI) e coordenadas coladas.
 */

export interface GeoHit {
  id: string;
  label: string;
  short: string;
  city: string;
  lat: number;
  lon: number;
  /** qualidade da correspondência devolvida pelo geocodificador */
  precision: 'exata' | 'via' | 'aproximada';
  kind: string;
}

/** Caixa de busca preferencial: Vale do Sinos. */
const VIEWBOX = '-51.35,-29.45,-50.85,-29.95'; // oeste,norte,leste,sul

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

function classify(o: any): GeoHit['precision'] {
  const t = o.addresstype || o.type;
  if (o.address?.house_number || t === 'building' || t === 'house') return 'exata';
  if (t === 'road' || o.category === 'highway') return 'via';
  return 'aproximada';
}

function shorten(display: string): string {
  const parts = String(display).split(',').map((s) => s.trim());
  return parts.slice(0, 3).join(', ');
}

async function getJson(url: string, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Detecta "lat, lon" digitado diretamente. */
function parseLatLon(q: string): GeoHit | null {
  const m = q.trim().match(/^(-?\d{1,2}[.,]\d{3,})\s*[,; ]\s*(-?\d{1,3}[.,]\d{3,})$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    id: `coord-${lat}-${lon}`,
    label: `Coordenada ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    short: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    city: '',
    lat,
    lon,
    precision: 'exata',
    kind: 'coordenada',
  };
}

const CEP_RE = /^\s*(\d{5})-?(\d{3})\s*$/;

/** Consulta CEP na BrasilAPI (que já devolve lat/lon quando disponível). */
async function byCep(q: string): Promise<GeoHit[]> {
  const m = q.match(CEP_RE);
  if (!m) return [];
  const cep = `${m[1]}${m[2]}`;
  try {
    const j = await getJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    const lat = Number(j?.location?.coordinates?.latitude);
    const lon = Number(j?.location?.coordinates?.longitude);
    const label = [j.street, j.neighborhood, j.city, j.state].filter(Boolean).join(', ');
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return [
        {
          id: `cep-${cep}`,
          label: `${label} — CEP ${m[1]}-${m[2]}`,
          short: label || `CEP ${m[1]}-${m[2]}`,
          city: j.city ?? '',
          lat,
          lon,
          precision: 'aproximada',
          kind: 'CEP',
        },
      ];
    }
    // sem coordenada: repassa o endereço textual ao Nominatim
    if (label) return search(label, true);
  } catch {
    /* ignora */
  }
  return [];
}

/**
 * Busca endereços. Faz duas passadas: primeiro priorizando a região do
 * Vale do Sinos, depois abrindo para o Brasil inteiro se não houver acerto.
 */
export async function search(query: string, skipCep = false): Promise<GeoHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const coord = parseLatLon(q);
  if (coord) return [coord];

  if (!skipCep && CEP_RE.test(q)) {
    const hits = await byCep(q);
    if (hits.length) return hits;
  }

  // se o usuário não citou cidade/UF, assumimos a região
  const mentionsCity = /campo bom|novo hamburgo|s[aã]o leopoldo|sapiranga|est[aâ]ncia velha|rs\b|rio grande do sul/i.test(q);
  const biased = mentionsCity ? q : `${q}, Campo Bom, RS`;

  const common = 'format=jsonv2&addressdetails=1&countrycodes=br&limit=6&accept-language=pt-BR';

  const tries = [
    `${NOMINATIM}?q=${encodeURIComponent(biased)}&${common}&viewbox=${VIEWBOX}&bounded=1`,
    `${NOMINATIM}?q=${encodeURIComponent(mentionsCity ? q : `${q}, RS`)}&${common}&viewbox=${VIEWBOX}&bounded=0`,
  ];

  const seen = new Set<string>();
  const out: GeoHit[] = [];

  for (const url of tries) {
    try {
      const arr = await getJson(url);
      if (!Array.isArray(arr)) continue;
      for (const o of arr) {
        const lat = Number(o.lat);
        const lon = Number(o.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = o.address ?? {};
        out.push({
          id: `${o.osm_type ?? 'n'}-${o.osm_id ?? key}`,
          label: o.display_name ?? '',
          short: shorten(o.display_name ?? ''),
          city: a.town ?? a.city ?? a.municipality ?? a.village ?? a.district ?? '',
          lat,
          lon,
          precision: classify(o),
          kind: o.addresstype ?? o.type ?? 'local',
        });
      }
      if (out.length) break;
    } catch {
      /* tenta a próxima estratégia */
    }
  }

  return out.slice(0, 6);
}

/** Coordenada → endereço legível. */
export async function reverse(lat: number, lon: number): Promise<string | null> {
  try {
    const j = await getJson(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&addressdetails=1&accept-language=pt-BR`
    );
    return j?.display_name ?? null;
  } catch {
    return null;
  }
}
