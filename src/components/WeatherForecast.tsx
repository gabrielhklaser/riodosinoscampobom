import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Info,
  RefreshCw,
  Sun,
  Thermometer,
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

function n0(value: number | null): string {
  return value == null ? '—' : Math.round(value).toString();
}

function n1(value: number | null): string {
  return value == null ? '—' : value.toFixed(1).replace('.', ',');
}

function WeatherIcon({ condition, className = 'h-5 w-5' }: { condition: WeatherCondition; className?: string }) {
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
      return <CloudSnowIcon {...props} />;
    case 'fog':
    case 'cloud':
    default:
      return <Cloud {...props} />;
  }
}

/** Ícone simples para neve, sem depender de um pacote de ícones adicional. */
function CloudSnowIcon({ className, strokeWidth }: { className: string; strokeWidth: number }) {
  return <Cloud className={className} strokeWidth={strokeWidth} />;
}

function ModelUnavailable({ model, message }: { model: WeatherModel; message?: string }) {
  const isEcmwf = model === 'ecmwf';
  return (
    <div className="flex min-h-[265px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-center">
      <AlertTriangle className={`h-6 w-6 ${isEcmwf ? 'text-indigo-400' : 'text-rose-400'}`} />
      <p className="mt-2 text-sm font-semibold text-slate-300">Modelo indisponível no momento</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{message || 'A API não retornou dados para este modelo.'}</p>
    </div>
  );
}

function CurrentBlock({ data, forecast }: { data: WeatherForecastData['current']; forecast: WeatherForecastData }) {
  const condition = weatherCondition(data?.weatherCode ?? null);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Condição atual</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-4xl font-bold tabular-nums text-slate-100">{n0(data?.temperature ?? null)}</span>
            <span className="text-lg text-slate-500">°C</span>
          </div>
          <p className="mt-0.5 text-xs font-medium text-slate-300">{condition.label}</p>
        </div>
        <span className="rounded-xl bg-slate-800/80 p-2.5 text-sky-300 ring-1 ring-white/5">
          <WeatherIcon condition={condition} className="h-8 w-8" />
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-[11px]">
        <WeatherMetric icon={<Thermometer className="h-3.5 w-3.5" />} label="Sensação" value={`${n0(data?.apparentTemperature ?? null)}°`} />
        <WeatherMetric icon={<Droplets className="h-3.5 w-3.5" />} label="Umidade" value={`${n0(data?.humidity ?? null)}%`} />
        <WeatherMetric icon={<Wind className="h-3.5 w-3.5" />} label="Vento" value={`${n0(data?.windSpeed ?? null)} km/h`} />
      </div>
      <p className="mt-2 text-[10px] text-slate-500">
        {data?.precipitation != null ? `Precipitação na hora: ${n1(data.precipitation)} mm` : 'Precipitação atual: —'}
        {data?.time ? ` · leitura ${formatWeatherUpdated(data.time)}` : ''}
      </p>
      {!data && <p className="mt-1 text-[10px] text-amber-300/80">O modelo retornou apenas a previsão diária.</p>}
      <span className="sr-only">{forecast.modelName}</span>
    </div>
  );
}

function WeatherMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-slate-500">{icon}{label}</p>
      <p className="mt-0.5 truncate font-semibold tabular-nums text-slate-200">{value}</p>
    </div>
  );
}

function DayRow({ day, isToday }: { day: WeatherForecastData['days'][number]; isToday: boolean }) {
  const condition = weatherCondition(day.weatherCode);
  return (
    <div className={`grid grid-cols-[minmax(82px,1.1fr)_auto_minmax(80px,0.9fr)] items-center gap-2 border-t border-slate-800/80 py-2.5 ${isToday ? 'bg-white/[0.02]' : ''}`}>
      <div className="min-w-0">
        <p className={`truncate text-xs font-semibold ${isToday ? 'text-slate-100' : 'text-slate-300'}`}>
          {isToday ? 'Hoje' : formatWeatherDate(day.date)}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-slate-500">{condition.label}</p>
      </div>
      <span className="text-slate-400" title={condition.label}>
        <WeatherIcon condition={condition} className="h-5 w-5" />
      </span>
      <div className="text-right text-[11px]">
        <p className="font-semibold tabular-nums text-slate-200">
          {n0(day.temperatureMax)}° <span className="font-normal text-slate-500">/ {n0(day.temperatureMin)}°</span>
        </p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-sky-300">
          <Umbrella className="h-3 w-3" />
          {n0(day.precipitationProbability)}% · {n1(day.precipitation)} mm
        </p>
      </div>
    </div>
  );
}

function ModelCard({ model, forecast, error }: { model: WeatherModel; forecast?: WeatherForecastData; error?: string }) {
  const isEcmwf = model === 'ecmwf';
  const tone = isEcmwf
    ? {
        text: 'text-indigo-300',
        bg: 'bg-indigo-500/10',
        border: 'border-indigo-400/30',
        dot: 'bg-indigo-400',
        top: 'from-indigo-500/20',
      }
    : {
        text: 'text-rose-300',
        bg: 'bg-rose-500/10',
        border: 'border-rose-400/30',
        dot: 'bg-rose-400',
        top: 'from-rose-500/20',
      };
  const modelInfo = WEATHER_MODELS[model];

  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/35">
      <div className={`border-b border-slate-800 bg-gradient-to-r ${tone.top} to-transparent px-4 py-3`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
            <h3 className="text-sm font-bold text-white">{modelInfo.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.bg} ${tone.text} ring-1 ${tone.border}`}>
              modelo numérico
            </span>
          </div>
          {forecast && <span className="text-[10px] text-slate-500">Atualizado {formatWeatherUpdated(forecast.fetchedAt)}</span>}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {isEcmwf ? 'Centro Europeu · IFS 0,25°' : 'NOAA · Global Forecast System'}
        </p>
      </div>

      <div className="p-4">
        {forecast ? (
          <>
            <CurrentBlock data={forecast.current} forecast={forecast} />
            <div className="mt-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" /> Próximos {forecast.days.length} dias
              </p>
              <div>
                {forecast.days.map((day, index) => (
                  <DayRow key={`${model}-${day.date}`} day={day} isToday={index === 0} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <ModelUnavailable model={model} message={error} />
        )}
      </div>
    </article>
  );
}

export default function WeatherForecast() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof fetchWeather>> | null>(null);
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

  return (
    <section id="previsao-tempo" className={`p-5 sm:p-6 ${CARD}`}>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-white">
            <CloudSun className="h-5 w-5 text-sky-400" />
            Previsão do tempo em Campo Bom
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-300 ring-1 ring-sky-400/30">
              5 dias
            </span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
            Comparação dos modelos meteorológicos <strong className="text-indigo-300">ECMWF IFS</strong> e{' '}
            <strong className="text-rose-300">GFS</strong> para o município de Campo Bom/RS. Temperatura, chuva,
            probabilidade de precipitação e vento, atualizados automaticamente.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar previsão
        </button>
      </div>

      {loading && !result && (
        <div className="flex min-h-[265px] flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-950/35 text-slate-400">
          <RefreshCw className="h-7 w-7 animate-spin text-sky-400" />
          <p className="text-sm">Consultando ECMWF e GFS…</p>
        </div>
      )}

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
              <p>Não foi possível atualizar os modelos. Exibindo a última previsão válida: {error}</p>
            </div>
          )}
          {Object.keys(result.errors).length > 0 && (
            <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p>Um dos modelos não respondeu. Os dados do outro modelo continuam disponíveis abaixo.</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {MODEL_ORDER.map((model) => (
              <ModelCard
                key={model}
                model={model}
                forecast={forecastByModel.get(model)}
                error={result.errors[model]}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-4 text-[11px] leading-relaxed text-slate-500 sm:flex-row sm:items-start sm:justify-between">
            <p className="flex items-start gap-1.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
              Previsão pontual para as coordenadas do município ({Math.abs(-29.6917).toFixed(4).replace('.', ',')}°S,{' '}
              {Math.abs(-51.0461).toFixed(4).replace('.', ',')}°O). Modelos podem divergir; chuva e temperatura são
              estimativas e não substituem avisos oficiais.
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
