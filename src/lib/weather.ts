/**
 * Previsão meteorológica para Campo Bom/RS.
 *
 * Os dois modelos são consultados separadamente no Open-Meteo para que uma
 * indisponibilidade do ECMWF não esconda o GFS (e vice-versa). A API não
 * exige chave para este uso e os valores são mantidos na unidade apresentada
 * ao usuário: °C, mm, km/h e porcentagem.
 */

export const CAMPO_BOM_WEATHER = {
  latitude: -29.6917,
  longitude: -51.0461,
  label: 'Campo Bom/RS',
};

export type WeatherModel = 'ecmwf' | 'gfs';

export interface CurrentWeather {
  time: number;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  weatherCode: number | null;
}

export interface DailyWeather {
  date: string;
  weatherCode: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitation: number | null;
  precipitationProbability: number | null;
  windSpeedMax: number | null;
}

export interface WeatherForecast {
  model: WeatherModel;
  modelName: string;
  current: CurrentWeather | null;
  days: DailyWeather[];
  fetchedAt: number;
  sourceUrl: string;
}

export interface WeatherResult {
  forecasts: WeatherForecast[];
  errors: Partial<Record<WeatherModel, string>>;
  fetchedAt: number;
}

export const WEATHER_MODELS: Record<
  WeatherModel,
  { name: string; apiModel: string; color: string; softColor: string }
> = {
  ecmwf: {
    name: 'ECMWF IFS',
    apiModel: 'ecmwf_ifs025',
    color: '#818cf8',
    softColor: 'indigo',
  },
  gfs: {
    name: 'GFS',
    apiModel: 'gfs_seamless',
    color: '#fb7185',
    softColor: 'rose',
  },
};

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const TIMEZONE = 'America/Sao_Paulo';
const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
].join(',');
const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
].join(',');

function buildUrl(model: WeatherModel): string {
  const params = new URLSearchParams({
    latitude: String(CAMPO_BOM_WEATHER.latitude),
    longitude: String(CAMPO_BOM_WEATHER.longitude),
    current: CURRENT_FIELDS,
    daily: DAILY_FIELDS,
    forecast_days: '5',
    models: WEATHER_MODELS[model].apiModel,
    timezone: TIMEZONE,
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${API_BASE}?${params.toString()}`;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') throw new Error('resposta inválida');
    const data = body as Record<string, unknown>;
    if (data.error === true) {
      throw new Error(typeof data.reason === 'string' ? data.reason : 'API recusou a consulta');
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('tempo limite excedido');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A API retorna o horário sem offset; interpreta-o no fuso de Campo Bom. */
function parseLocalDateTime(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function parseDaily(data: Record<string, unknown>): DailyWeather[] {
  const daily = data.daily;
  if (!daily || typeof daily !== 'object') return [];
  const values = daily as Record<string, unknown>;
  const dates = Array.isArray(values.time) ? values.time : [];
  const codes = Array.isArray(values.weather_code) ? values.weather_code : [];
  const max = Array.isArray(values.temperature_2m_max) ? values.temperature_2m_max : [];
  const min = Array.isArray(values.temperature_2m_min) ? values.temperature_2m_min : [];
  const rain = Array.isArray(values.precipitation_sum) ? values.precipitation_sum : [];
  const probability = Array.isArray(values.precipitation_probability_max)
    ? values.precipitation_probability_max
    : [];
  const wind = Array.isArray(values.wind_speed_10m_max) ? values.wind_speed_10m_max : [];

  return dates.slice(0, 5).flatMap((date, index) => {
    if (typeof date !== 'string') return [];
    return [
      {
        date,
        weatherCode: numberOrNull(codes[index]),
        temperatureMax: numberOrNull(max[index]),
        temperatureMin: numberOrNull(min[index]),
        precipitation: numberOrNull(rain[index]),
        precipitationProbability: numberOrNull(probability[index]),
        windSpeedMax: numberOrNull(wind[index]),
      },
    ];
  });
}

function parseCurrent(data: Record<string, unknown>): CurrentWeather | null {
  const current = data.current;
  if (!current || typeof current !== 'object') return null;
  const values = current as Record<string, unknown>;
  const time = parseLocalDateTime(values.time);
  if (time == null) return null;
  return {
    time,
    temperature: numberOrNull(values.temperature_2m),
    apparentTemperature: numberOrNull(values.apparent_temperature),
    humidity: numberOrNull(values.relative_humidity_2m),
    precipitation: numberOrNull(values.precipitation),
    windSpeed: numberOrNull(values.wind_speed_10m),
    weatherCode: numberOrNull(values.weather_code),
  };
}

async function fetchModel(model: WeatherModel): Promise<WeatherForecast> {
  const sourceUrl = buildUrl(model);
  const data = await fetchJson(sourceUrl);
  const days = parseDaily(data);
  if (!days.length) throw new Error('a API não retornou a previsão diária');
  return {
    model,
    modelName: WEATHER_MODELS[model].name,
    current: parseCurrent(data),
    days,
    fetchedAt: Date.now(),
    sourceUrl,
  };
}

/** Busca ECMWF e GFS em paralelo; um modelo indisponível não derruba o outro. */
export async function fetchWeather(): Promise<WeatherResult> {
  const entries = await Promise.all(
    (Object.keys(WEATHER_MODELS) as WeatherModel[]).map(async (model) => {
      try {
        return { model, forecast: await fetchModel(model) } as const;
      } catch (error) {
        return {
          model,
          error: error instanceof Error ? error.message : 'falha de rede',
        } as const;
      }
    })
  );

  const forecasts = entries.flatMap((entry) => ('forecast' in entry && entry.forecast ? [entry.forecast] : []));
  const errors = entries.reduce<Partial<Record<WeatherModel, string>>>((result, entry) => {
    if ('error' in entry) result[entry.model] = entry.error;
    return result;
  }, {});

  if (!forecasts.length) {
    throw new Error('ECMWF e GFS não responderam. Tente atualizar novamente em instantes.');
  }

  return { forecasts, errors, fetchedAt: Date.now() };
}

export interface WeatherCondition {
  label: string;
  icon: 'sun' | 'partly-cloudy' | 'cloud' | 'fog' | 'rain' | 'storm' | 'snow';
}

/** Códigos WMO usados pelo Open-Meteo, traduzidos para o painel. */
export function weatherCondition(code: number | null): WeatherCondition {
  if (code == null) return { label: 'Sem descrição', icon: 'cloud' };
  if (code === 0) return { label: 'Céu limpo', icon: 'sun' };
  if (code === 1) return { label: 'Predominantemente limpo', icon: 'partly-cloudy' };
  if (code === 2) return { label: 'Parcialmente nublado', icon: 'partly-cloudy' };
  if (code === 3) return { label: 'Nublado', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Neblina', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Garoa', icon: 'rain' };
  if (code >= 61 && code <= 67) return { label: 'Chuva', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Neve', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Pancadas de chuva', icon: 'rain' };
  if (code === 85 || code === 86) return { label: 'Pancadas de neve', icon: 'snow' };
  if (code >= 95) return { label: 'Trovoada', icon: 'storm' };
  return { label: 'Condição variável', icon: 'cloud' };
}

export function formatWeatherDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return value.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function formatWeatherUpdated(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
