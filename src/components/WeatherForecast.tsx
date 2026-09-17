import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Info,
  RefreshCw,
  Sun,
  Umbrella,
  Wind,
} from 'lucide-react';
import {
  fetchWeather,
  formatWeatherDate,
  formatWeatherUpdated,
  weatherCondition,
  WEATHER_MODELS,
  type WeatherCondition,
  type WeatherForecast as WeatherForecastData,
  type WeatherModel,
} from '../lib/weather';

const CARD =
  'rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur';
const REFRESH_MS = 15 * 60 * 1000;
const MODEL_ORDER: WeatherModel[] = ['ecmwf', 'gfs'];

const MODEL_TONE: Record<
  WeatherModel,
  { text: string; active: string; border: string; soft: string; dot: string }
> = {
  ecmwf: {
    text: 'text-indigo-300',
    active: 'bg-indigo-600 text-white shadow-indigo-950/40',
    border: 'border-indigo-400/35',
    soft: 'bg-indigo-500/10',
    dot: 'bg-indigo-400',
  },
  gfs: {
    text: 'text-rose-300',
    active: 'bg-rose-600 text-white shadow-rose-950/40',
    border: 'border-rose-400/35',
    soft: 'bg-rose-500/10',
    dot: 'bg-rose-400',
  },
};

function n0(value: number | null): string {
  return value == null ? '—' : Math.round(value).toString();
}

function n1(value: number | null): string {
  return value == null ? '—' : value.toFixed(1).replace('.', ',');
}

function WeatherIcon({ condition, className = 'h-8 w-8' }: { condition: WeatherCondition; className?: string }) {
  const props = { className, strokeWidth: 1.8 };
  switch (condition.icon) {
    case 'sun':
      return <Sun {...props} />;
    case 'partly-cloudy':
      return <CloudSun {...props} />;
    case 'rain':
      return <CloudRain {...props} />;
    case 'storm':
      return <CloudLightning {...props} />;
    case 'snow':
      return <CloudRain {...props} />;
    case 'fog':
    case 'cloud':
    default:
      return <Cloud {...props} />;
  }
}

function conditionColor(condition: WeatherCondition): string {
  switch (condition.icon) {
    case 'sun':
      return 'text-amber-300';
    case 'partly-cloudy':
      return 'text-amber-200';
    case 'rain':
    case 'storm':
      return 'text-violet-300';
    case 'snow':
      return 'text-cyan-200';
    default:
      return 'text-slate-300';
  }
}

function dateParts(date: string): { weekday: string; day: string } {
  const [weekday = '', day = date] = formatWeatherDate(date).split(', ');
  return {
    weekday: weekday.replace('.', '').toUpperCase(),
    day,
  };
}

function dayTitle(date: string, index: number): string {
  if (index === 0) return 'HOJE';
  if (index === 1) return 'AMANHÃ';
  return dateParts(date).weekday;
}

function totalRain(forecast?: WeatherForecastData): number | null {
  if (!forecast) return null;
  return +forecast.days.reduce((sum, day) => sum + (day.precipitation ?? 0), 0).toFixed(1);
}

function RainSummary({ model, forecast }: { model: WeatherModel; forecast?: WeatherForecastData }) {
  const tone = MODEL_TONE[model];
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${tone.soft} ${tone.border}`}>
      <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
      <span className="text-[11px] text-slate-300">{WEATHER_MODELS[model].name} — chuva acumulada 5 d:</span>
      <strong className={`text-xs tabular-nums ${tone.text}`}>{n1(totalRain(forecast))} mm</strong>
    </div>
  );
}

function ComparisonFooter({
  model,
  primary,
  comparison,
}: {
  model: WeatherModel;
  primary: WeatherForecastData['days'][number];
  comparison?: WeatherForecastData['days'][number];
}) {
  const comparisonModel: WeatherModel = model === 'ecmwf' ? 'gfs' : 'ecmwf';
  const tone = MODEL_TONE[comparisonModel];
  return (
    <div className="mt-auto border-t border-slate-800/90 pt-2.5 text-[10px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-500">{WEATHER_MODELS[comparisonModel].name}:</span>
        {comparison ? (
          <span className={`font-semibold tabular-nums ${tone.text}`}>
            {n1(comparison.precipitation)} mm · {n0(comparison.temperatureMax)}°/{n0(comparison.temperatureMin)}°
          </span>
        ) : (
          <span className="text-slate-600">indisponível</span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-slate-600">
        <span>{WEATHER_MODELS[model].name}:</span>
        <span className="tabular-nums">
          {n1(primary.precipitation)} mm · {n0(primary.temperatureMax)}°/{n0(primary.temperatureMin)}°
        </span>
      </div>
    </div>
  );
}

function DayCard({
  day,
  comparison,
  index,
  model,
}: {
  day: WeatherForecastData['days'][number];
  comparison?: WeatherForecastData['days'][number];
  index: number;
  model: WeatherModel;
}) {
  const condition = weatherCondition(day.weatherCode);
  const { day: date } = dateParts(day.date);
  const tone = MODEL_TONE[model];

  return (
    <article className={`flex min-h-[255px] flex-col overflow-hidden rounded-xl border ${tone.border} bg-slate-950/45`}>
      <div className={`border-b border-slate-800 bg-gradient-to-r ${tone.soft} to-transparent px-3.5 py-3`}>
        <p className="text-[11px] font-bold tracking-[0.1em] text-slate-100">{dayTitle(day.date, index)}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{date}</p>
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex flex-col items-center text-center">
          <span className={conditionColor(condition)} title={condition.label}>
            <WeatherIcon condition={condition} className="h-10 w-10" />
          </span>
          <p className="mt-2 min-h-7 text-[10px] font-medium leading-tight text-slate-300">{condition.label}</p>
        </div>

        <div className="mt-3 flex items-baseline justify-center gap-1.5">
          <span className="text-xl font-bold tabular-nums text-slate-100">{n0(day.temperatureMax)}°</span>
          <span className="text-xs tabular-nums text-slate-500">/ {n0(day.temperatureMin)}°</span>
        </div>

        <div className="mt-3 space-y-2 text-[10px]">
          <div className="flex items-center justify-between gap-2 text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Droplets className="h-3 w-3 text-sky-400" /> Chuva</span>
            <strong className="tabular-nums text-sky-300">{n1(day.precipitation)} mm</strong>
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Umbrella className="h-3 w-3 text-blue-400" /> Probabilidade</span>
            <strong className="tabular-nums text-slate-200">{n0(day.precipitationProbability)}%</strong>
          </div>
          <div className="flex items-center justify-between gap-2 text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Wind className="h-3 w-3 text-slate-500" /> Vento</span>
            <strong className="tabular-nums text-slate-300">{n0(day.windSpeedMax)} km/h</strong>
          </div>
        </div>

        <ComparisonFooter model={model} primary={day} comparison={comparison} />
      </div>
    </article>
  );
}

function ModelUnavailable({ model, message }: { model: WeatherModel; message?: string }) {
  const tone = MODEL_TONE[model];
  return (
    <div className="flex min-h-[255px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-center">
      <AlertTriangle className={`h-6 w-6 ${tone.text}`} />
      <p className="mt-2 text-sm font-semibold text-slate-300">Modelo indisponível no momento</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{message || 'A API não retornou dados para este modelo.'}</p>
    </div>
  );
}

function ForecastSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-[255px] animate-pulse rounded-xl border border-slate-800 bg-slate-950/50" />
      ))}
    </div>
  );
}

export default function WeatherForecast() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof fetchWeather>> | null>(null);
  const [selectedModel, setSelectedModel] = useState<WeatherModel>('ecmwf');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await fetchWeather());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao consultar a previsão do tempo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const forecastByModel = useMemo(() => {
    const map = new Map<WeatherModel, WeatherForecastData>();
    result?.forecasts.forEach((forecast) => map.set(forecast.model, forecast));
    return map;
  }, [result]);

  const activeModel = forecastByModel.has(selectedModel)
    ? selectedModel
    : MODEL_ORDER.find((model) => forecastByModel.has(model)) ?? selectedModel;
  const activeForecast = forecastByModel.get(activeModel);
  const comparisonForecast = forecastByModel.get(activeModel === 'ecmwf' ? 'gfs' : 'ecmwf');
  const divergence = Math.abs((totalRain(forecastByModel.get('ecmwf')) ?? 0) - (totalRain(forecastByModel.get('gfs')) ?? 0));

  return (
    <section id="previsao-tempo" className={`p-5 sm:p-6 ${CARD}`}>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-white">
            <Sun className="h-5 w-5 text-amber-300" />
            Previsão do tempo — Campo Bom / RS
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
            Próximos 5 dias · modelos <strong className="text-indigo-300">ECMWF IFS</strong> (europeu) e{' '}
            <strong className="text-rose-300">GFS</strong> (NOAA) comparados lado a lado.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-800/80 p-1 ring-1 ring-white/5">
            {MODEL_ORDER.map((model) => {
              const tone = MODEL_TONE[model];
              const available = !result || forecastByModel.has(model);
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => setSelectedModel(model)}
                  disabled={!available}
                  aria-pressed={activeModel === model}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    activeModel === model ? tone.active : 'text-slate-400 hover:text-slate-200'
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {model === 'ecmwf' ? 'ECMWF IFS' : 'GFS'}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {loading && !result && <ForecastSkeleton />}

      {error && !result && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="font-semibold">Previsão indisponível</p>
            <p className="mt-0.5 text-xs text-red-200/80">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <>
          {error && (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>Não foi possível atualizar a previsão. Exibindo a última consulta válida: {error}</p>
            </div>
          )}
          {Object.keys(result.errors).length > 0 && (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>Um dos modelos não respondeu. O outro continua disponível e pode ser selecionado acima.</p>
            </div>
          )}

          {activeForecast ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <RainSummary model="ecmwf" forecast={forecastByModel.get('ecmwf')} />
                <RainSummary model="gfs" forecast={forecastByModel.get('gfs')} />
                {forecastByModel.has('ecmwf') && forecastByModel.has('gfs') && (
                  <span className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400">
                    Divergência entre modelos: <strong className="ml-1 text-slate-200">{n1(divergence)} mm</strong>
                  </span>
                )}
              </div>

              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500">
                  Exibindo <strong className={MODEL_TONE[activeModel].text}>{WEATHER_MODELS[activeModel].name}</strong> · selecione outro modelo para alternar os valores principais.
                </p>
                {loading && <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500"><RefreshCw className="h-3 w-3 animate-spin" /> atualizando</span>}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {activeForecast.days.map((day, index) => (
                  <DayCard
                    key={`${activeModel}-${day.date}`}
                    day={day}
                    comparison={comparisonForecast?.days.find((candidate) => candidate.date === day.date)}
                    index={index}
                    model={activeModel}
                  />
                ))}
              </div>
            </>
          ) : (
            <ModelUnavailable model={activeModel} message={result.errors[activeModel]} />
          )}

          <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-4 text-[11px] leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between">
            <p className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
              Previsão pontual para as coordenadas do município (29,6917°S, 51,0461°O). Os modelos podem divergir;
              chuva e temperatura são estimativas e não substituem avisos oficiais.
            </p>
            <p className="shrink-0 text-left sm:text-right">
              Atualizado em {formatWeatherUpdated(result.fetchedAt)} ·{' '}
              <a className="text-sky-400 hover:underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                fonte: Open-Meteo
              </a>
            </p>
          </div>
        </>
      )}
    </section>
  );
}
