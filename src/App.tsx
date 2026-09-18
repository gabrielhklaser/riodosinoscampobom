import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CloudRain,
  Droplets,
  Gauge,
  LayoutDashboard,
  Layers,
  Map as MapIcon,
  MapPin,
  RadioTower,
  RefreshCw,
  Timer,
  TrendingUp,
  Waves,
} from 'lucide-react';
import RiverChart from './components/RiverChart';
import WeatherForecast from './components/WeatherForecast';
import LevelGauge from './components/LevelGauge';
import Brasao from './components/Brasao';
import RainMap from './components/RainMap';
import BotSettings from './components/BotSettings';
import TelegramBridge from './components/TelegramBridge';
import TelegramSubscribe from './components/TelegramSubscribe';
import {
  attachBasinRain,
  fetchRain,
  lastRain,
  RAIN_STATIONS,
  sumRain,
  type RainResult,
} from './lib/rain';
import { BASIN_META } from './lib/basin';
import { FLOOD_META, loadFloodSetSync, type FloodSet } from './lib/flood';
import AddressRisk, { type AddressPoint } from './components/AddressRisk';
import FloodAlertModal from './components/FloodAlertModal';
import IphForecast from './components/IphForecast';
import { clearBotToken, loginBot, reportRiverReading } from './lib/botApi';
// import UpstreamRisk from './components/UpstreamRisk'; // desativado temporariamente
import {
  COTAS,
  downsample,
  fetchSeries,
  fmtAgo,
  fmtDateTime,
  fmtTime,
  hoursToCota,
  rainAccumulated,
  STATION,
  STATUS_META,
  statusFor,
  trendCmPerHour,
  variationSince,
  type Reading,
} from './lib/ana';

const REFRESH_MS = 5 * 60 * 1000; // telemetria da ANA publica a cada 15 min

const PERIODS = [
  { key: '24h', label: '24 horas', hours: 24, fetchDays: 3 },
  { key: '3d', label: '3 dias', hours: 72, fetchDays: 5 },
  { key: '7d', label: '7 dias', hours: 168, fetchDays: 9 },
  { key: '30d', label: '30 dias', hours: 720, fetchDays: 32 },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

const n2 = (v: number) => v.toFixed(2).replace('.', ',');
const n1 = (v: number) => v.toFixed(1).replace('.', ',');

/* card base do tema escuro */
const CARD = 'rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur';

export default function App() {
  const [period, setPeriod] = useState<PeriodKey>('24h');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [nextIn, setNextIn] = useState(REFRESH_MS / 1000);
  const [showRain, setShowRain] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [rain, setRain] = useState<RainResult | null>(null);
  // camadas disponíveis já na 1ª renderização (cache local ou cópia embarcada)
  const [flood] = useState<FloodSet | null>(() => loadFloodSetSync());
  const [floodError, setFloodError] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressPoint | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const alertedFor = useRef<string | null>(null);
  const [rainWindow, setRainWindow] = useState<24 | 72 | 168 | 720>(168);
  const [showAllStations, setShowAllStations] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('cb-admin') === '1');
  const [showLogin, setShowLogin] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [tab, setTab] = useState<'painel' | 'bot'>('painel');

  const cfg = useMemo(() => PERIODS.find((p) => p.key === period)!, [period]);
  const inFlight = useRef(false);

  const load = useCallback(async (days: number, silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetchSeries(days);
      setReadings(res.readings);
      setSource(res.source);
      setFetchedAt(res.fetchedAt);
      setError(null);
      const latest = res.readings[res.readings.length - 1];
      if (latest) {
        reportRiverReading({
          level: latest.level,
          ts: latest.ts,
          flow: latest.flow,
          rain: latest.rain,
        });
      }
      // chuva da bacia (não bloqueia o painel de nível se falhar)
      fetchRain(days, res.readings)
        .then(setRain)
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao consultar a telemetria da ANA.');
    } finally {
      setNextIn(REFRESH_MS / 1000);
      setLoading(false);
      setRefreshing(false);
      inFlight.current = false;
    }
  }, []);

  // carga inicial + troca de período
  useEffect(() => {
    load(cfg.fetchDays, readings.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.fetchDays]);

  // atualização automática
  useEffect(() => {
    const id = setInterval(() => load(cfg.fetchDays, true), REFRESH_MS);
    return () => clearInterval(id);
  }, [cfg.fetchDays, load]);

  // a mancha de 2024 é embarcada no bundle: nada a buscar na rede
  useEffect(() => {
    if (!flood) setFloodError('geometria da mancha indisponível');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // contador regressivo + relógio
  useEffect(() => {
    const id = setInterval(() => {
      setNextIn((s) => (s <= 1 ? REFRESH_MS / 1000 : s - 1));
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // revalida ao voltar para a aba
  useEffect(() => {
    const onFocus = () => {
      if (fetchedAt && Date.now() - fetchedAt > 2 * 60 * 1000) load(cfg.fetchDays, true);
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchedAt, cfg.fetchDays, load]);

  useEffect(() => {
    if (!isAdmin) setTab('painel');
  }, [isAdmin]);

  /* ---------------- derivados ---------------- */

  const windowed = useMemo(() => {
    if (!readings.length) return [];
    const end = readings[readings.length - 1].ts;
    const from = Math.min(end, Date.now()) - cfg.hours * 3600000;
    return readings.filter((r) => r.ts >= from);
  }, [readings, cfg.hours]);

  const chartData = useMemo(
    () => attachBasinRain(downsample(windowed), rain?.meanHourly ?? []),
    [windowed, rain]
  );

  /** janela temporal exibida, usada nos totais da tabela de fontes */
  const winRange = useMemo(() => {
    if (!windowed.length) return null;
    return { from: windowed[0].ts, to: windowed[windowed.length - 1].ts };
  }, [windowed]);

  const rainWindowLabel = rainWindow === 24 ? '24 horas' : rainWindow === 72 ? '3 dias' : rainWindow === 168 ? '7 dias' : '30 dias';

  /** chuva média da bacia acumulada na janela selecionada */
  const basinRainTotal = useMemo(() => {
    if (!rain) return 0;
    const to = readings.length ? readings[readings.length - 1].ts : Date.now();
    const fromTs = to - rainWindow * 3600000;
    const all = rain.mapStations.filter((s) => s.ok);
    if (!all.length) {
      return +rain.meanHourly
        .filter((h) => h.ts >= fromTs && h.ts <= to)
        .reduce((a, h) => a + h.mm, 0)
        .toFixed(1);
    }
    const total = all.reduce((acc, s) => {
      let sum = 0;
      for (const [k, v] of Object.entries(s.hourly)) {
        const ts = +k;
        if (ts >= fromTs && ts <= to) sum += v;
      }
      return acc + sum;
    }, 0);
    return +(total / all.length).toFixed(1);
  }, [rain, winRange]);

  /** linhas da tabela para as 6 estações principais */
  const rainRows = useMemo(() => {
    if (!rain) return [];
    const to = readings.length ? readings[readings.length - 1].ts : Date.now();
    const fromTs = to - rainWindow * 3600000;
    return rain.stations.map((s) => ({
      ...s,
      total: sumRain(s.hourly, fromTs, to),
      last: lastRain(s.hourly, to),
    }));
  }, [rain, winRange]);

  const activeRainStations = rain ? rain.stations.filter((s) => s.ok).length : 0;


  /** chuva média da bacia nas últimas 24 h */
  const basinRain24 = useMemo(() => {
    if (!rain) return null;
    const to = readings.length ? readings[readings.length - 1].ts : Date.now();
    return +rain.meanHourly
      .filter((h) => h.ts >= to - 24 * 3600000 && h.ts <= to)
      .reduce((a, h) => a + h.mm, 0)
      .toFixed(1);
  }, [rain, readings, rainWindow]);

  /** linhas extras: todas as estações da bacia que não são as 6 principais */
  const extraRainRows = useMemo(() => {
    if (!rain) return [];
    const to = readings.length ? readings[readings.length - 1].ts : Date.now();
    const fromTs = to - rainWindow * 3600000;
    const mainIds = new Set(rain.stations.map((s) => s.station.id));
    return rain.mapStations
      .filter((s) => !mainIds.has(s.station.id))
      .map((s) => ({
        ...s,
        total: sumRain(s.hourly, fromTs, to),
        last: lastRain(s.hourly, to),
      }));
  }, [rain, readings, rainWindow]);

  const last = readings.length ? readings[readings.length - 1] : null;
  const level = last?.level ?? null;
  const status = level != null ? statusFor(level) : 'normal';
  const meta = STATUS_META[status];

  const trend = useMemo(() => trendCmPerHour(readings, 180), [readings]);
  const var1h = useMemo(() => variationSince(readings, 1), [readings]);
  const var24h = useMemo(() => variationSince(readings, 24), [readings]);
  const rain24 = useMemo(() => rainAccumulated(readings, 24), [readings]);

  const winStats = useMemo(() => {
    if (!windowed.length) return null;
    const levels = windowed.map((r) => r.level);
    const max = Math.max(...levels);
    const min = Math.min(...levels);
    const peak = windowed.find((r) => r.level === max)!;
    return { max, min, peak };
  }, [windowed]);

  /** o alerta ao morador só vale com o rio na cota de alerta (6,70 m) */
  const alertActive = level != null && level >= COTAS.alerta;

  /** as duas condições simultâneas: endereço na mancha + rio em alerta */
  const inDanger = !!address?.inFlood && alertActive;

  /**
   * Abre o pop-up sempre que a condição de risco se estabelecer.
   * A chave evita reabrir a cada refresh; se o usuário fechar e depois
   * consultar outro endereço (ou o rio recuar e voltar a subir), abre de novo.
   */
  useEffect(() => {
    if (!inDanger || !address) {
      if (!inDanger) alertedFor.current = null;
      return;
    }
    const key = `${address.id}`;
    if (alertedFor.current === key) return;
    alertedFor.current = key;
    setAlertOpen(true);
  }, [inDanger, address]);

  const rising = trend != null && trend > 0.3;
  const falling = trend != null && trend < -0.3;
  const eta = level != null ? hoursToCota(level, trend, COTAS.inundacao) : null;
  const stale = last ? now - last.ts > 45 * 60 * 1000 : false;

  const mm = String(Math.floor(nextIn / 60)).padStart(2, '0');
  const ss = String(Math.floor(nextIn % 60)).padStart(2, '0');

  /* ---------------- UI ---------------- */

  return (
    <div className="relative min-h-screen bg-slate-950 font-sans text-slate-200">
      {/* brilho ambiente de fundo */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(900px 500px at 15% -10%, rgba(37,99,235,0.20), transparent 60%), radial-gradient(700px 400px at 90% 0%, rgba(14,165,233,0.12), transparent 55%)',
        }}
      />

      <div className="relative">
        {/* ---------- Header ---------- */}
        <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div className="flex items-center gap-3.5">
              {/* Brasão oficial da Prefeitura */}
              <div className="flex shrink-0 items-center gap-3.5">
                <div className="overflow-hidden rounded-xl bg-white p-1 shadow-lg shadow-black/40 ring-1 ring-white/20">
                  <Brasao className="h-11 w-11 rounded-lg" />
                </div>
                <div className="hidden h-11 w-px bg-slate-700/70 sm:block" />
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-400/80">
                  Prefeitura Municipal de Campo Bom · RS
                </p>
                <h1 className="flex items-center gap-2 text-base font-bold leading-tight tracking-tight text-white sm:text-lg">
                  <Waves className="h-4 w-4 shrink-0 text-blue-400" />
                  Nível do {STATION.river} — {STATION.city}/{STATION.state}
                </h1>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <RadioTower className="h-3 w-3" /> Estação ANA {STATION.code}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {STATION.basin}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${
                  error ? 'bg-red-500/10 text-red-300 ring-red-400/30' : 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30'
                }`}
              >
                <span className="relative flex h-2 w-2">
                  {!error && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${error ? 'bg-red-400' : 'bg-emerald-400'}`} />
                </span>
                {error ? 'Offline' : 'Ao vivo'}
              </span>

              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-white/10">
                <Timer className="h-3.5 w-3.5 text-blue-400" />
                Atualiza em {mm}:{ss}
              </span>

              <button
                onClick={() => load(cfg.fetchDays, true)}
                disabled={loading || refreshing}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-blue-950/50 transition hover:bg-blue-500 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
          </div>

          {isAdmin && (
            <nav className="mx-auto flex max-w-7xl gap-1 px-4 pb-2 sm:px-6 lg:px-8" aria-label="Painel administrativo">
              <button
                type="button"
                onClick={() => setTab('painel')}
                className={`inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition ${
                  tab === 'painel'
                    ? 'bg-slate-900/80 text-white ring-1 ring-white/10'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Painel
              </button>
              <button
                type="button"
                onClick={() => setTab('bot')}
                className={`inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition ${
                  tab === 'bot'
                    ? 'bg-slate-900/80 text-white ring-1 ring-white/10'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                Configurações do Bot
              </button>
            </nav>
          )}
        </header>

        <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          {isAdmin && tab === 'bot' ? (
            <BotSettings />
          ) : (
          <>
          {/* ---------- Avisos ---------- */}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
              <div className="text-sm text-red-200">
                <p className="font-semibold">Não foi possível ler a telemetria da ANA agora.</p>
                <p className="mt-0.5 text-red-300/80">{error} — nova tentativa automática em {mm}:{ss}.</p>
              </div>
            </div>
          )}

          {!error && stale && last && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-200">
                <span className="font-semibold">Sensor sem transmitir desde {fmtDateTime(last.ts)}.</span>{' '}
                O valor exibido é a última leitura válida recebida pela estação {STATION.code}.
              </p>
            </div>
          )}

          {!error && (status === 'alerta' || status === 'inundacao') && level != null && (
            <div
              className={`flex items-start gap-3 rounded-xl border p-4 ${
                status === 'inundacao' ? 'border-red-500/30 bg-red-500/10' : 'border-orange-500/30 bg-orange-500/10'
              }`}
            >
              <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${status === 'inundacao' ? 'text-red-400' : 'text-orange-400'}`} />
              <div className={`text-sm ${status === 'inundacao' ? 'text-red-200' : 'text-orange-200'}`}>
                <p className="font-semibold">
                  {status === 'inundacao'
                    ? `Rio acima da cota de inundação (${n2(COTAS.inundacao)} m).`
                    : `Rio na cota de alerta (${n2(COTAS.alerta)} m).`}
                </p>
                <p className="mt-0.5 opacity-90">
                  Nível atual de {n2(level)} m, {rising ? 'em elevação' : falling ? 'em recuo' : 'estabilizado'}
                  {eta != null && rising ? ` — mantida a tendência, atinge a cota de inundação em ~${Math.round(eta)}h.` : '.'}{' '}
                  Acompanhe os comunicados oficiais da Defesa Civil.
                </p>
              </div>
            </div>
          )}

          <TelegramSubscribe />

          {/* ---------- KPIs ---------- */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* nível atual */}
            <div className={`relative overflow-hidden p-6 lg:col-span-5 ${CARD}`}>
              <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: meta.color, boxShadow: `0 0 20px ${meta.color}` }} />
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Nível atual do rio</p>
                  <div className="mt-2 flex items-end gap-2">
                    {loading && level == null ? (
                      <div className="h-14 w-40 animate-pulse rounded-lg bg-slate-800" />
                    ) : (
                      <>
                        <span
                          className="text-6xl font-bold leading-none tabular-nums"
                          style={{ color: meta.color, textShadow: `0 0 32px ${meta.color}55` }}
                        >
                          {level != null ? n2(level) : '--'}
                        </span>
                        <span className="mb-1 text-xl font-medium text-slate-500">m</span>
                      </>
                    )}
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${meta.bg} ${meta.text} ${meta.ring}`}>
                  {meta.label}
                </span>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <span
                  className={`inline-flex items-center gap-1.5 font-semibold ${
                    rising ? 'text-red-400' : falling ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                >
                  {rising ? <ArrowUpRight className="h-4 w-4" /> : falling ? <ArrowDownRight className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                  {trend != null ? `${trend > 0 ? '+' : ''}${n1(trend)} cm/h` : '—'}
                  <span className="font-normal text-slate-500">({rising ? 'subindo' : falling ? 'descendo' : 'estável'})</span>
                </span>
                {last && (
                  <span className="text-slate-400">
                    Leitura de <span className="font-medium text-slate-200">{fmtTime(last.ts)}</span>{' '}
                    <span className="text-slate-500">({fmtAgo(last.ts, now)})</span>
                  </span>
                )}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-800 pt-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">1 hora</p>
                  <p className={`text-base font-bold tabular-nums ${(var1h ?? 0) > 0 ? 'text-red-400' : (var1h ?? 0) < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {var1h != null ? `${var1h > 0 ? '+' : ''}${n1(var1h)} cm` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">24 horas</p>
                  <p className={`text-base font-bold tabular-nums ${(var24h ?? 0) > 0 ? 'text-red-400' : (var24h ?? 0) < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {var24h != null ? `${var24h > 0 ? '+' : ''}${n1(var24h)} cm` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">P/ inundação</p>
                  <p className="text-base font-bold tabular-nums text-slate-200">
                    {level != null ? `${level >= COTAS.inundacao ? '+' : ''}${n2(Math.abs(level - COTAS.inundacao))} m` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* régua */}
            <div className={`p-6 lg:col-span-3 ${CARD}`}>
              <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Gauge className="h-4 w-4" /> Régua da estação
              </p>
              <div className="h-56">
                <LevelGauge level={level ?? 0} />
              </div>
            </div>

            {/* mini cards */}
            <div className="grid grid-cols-2 gap-4 lg:col-span-4">
              <MiniCard icon={<TrendingUp className="h-4 w-4" />} label="Vazão estimada" value={last?.flow != null ? n1(last.flow) : '—'} unit="m³/s" tint="text-cyan-300 bg-cyan-500/10 ring-cyan-400/20" />
              <MiniCard
                icon={<CloudRain className="h-4 w-4" />}
                label="Chuva bacia 24h"
                value={basinRain24 != null ? n1(basinRain24) : n1(rain24)}
                unit="mm"
                hint={activeRainStations ? `média de ${activeRainStations} estações` : undefined}
                tint="text-sky-300 bg-sky-500/10 ring-sky-400/20"
              />
              <MiniCard icon={<Activity className="h-4 w-4" />} label={`Máx. ${cfg.label}`} value={winStats ? n2(winStats.max) : '—'} unit="m" hint={winStats ? `às ${fmtTime(winStats.peak.ts)}` : undefined} tint="text-rose-300 bg-rose-500/10 ring-rose-400/20" />
              <MiniCard icon={<Droplets className="h-4 w-4" />} label={`Mín. ${cfg.label}`} value={winStats ? n2(winStats.min) : '—'} unit="m" tint="text-emerald-300 bg-emerald-500/10 ring-emerald-400/20" />
            </div>
          </section>

          {/* ---------- Gráfico ---------- */}
          <section className={`p-5 sm:p-6 ${CARD}`}>
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Curva de elevação do {STATION.river}</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  Leituras telemétricas a cada 15 minutos · estação {STATION.name} ({STATION.code})
                  {windowed.length > 0 && <span className="text-slate-500"> · {windowed.length} medições</span>}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg bg-slate-800/80 p-1 ring-1 ring-white/5">
                  {PERIODS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setPeriod(p.key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                        period === p.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowRain((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    showRain ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'
                  }`}
                >
                  <CloudRain className="h-3.5 w-3.5" /> Chuva
                </button>
              </div>
            </div>

            <div className="h-[380px] w-full sm:h-[440px]">
              {loading && !windowed.length ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
                  <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
                  <p className="text-sm">Consultando a telemetria da ANA…</p>
                </div>
              ) : (
                <RiverChart
                  data={chartData}
                  spanHours={cfg.hours}
                  showRain={showRain}
                  rainStations={activeRainStations}
                />
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-800 pt-4 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-6 rounded" style={{ background: meta.color }} /> Nível do rio (m)</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-6 rounded bg-sky-400/70" /> Chuva — média de {activeRainStations} estações (mm)</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-6 border-t-2 border-dashed border-yellow-400" /> Atenção {n2(COTAS.atencao)} m</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-6 border-t-2 border-dashed border-orange-400" /> Alerta {n2(COTAS.alerta)} m</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0 w-6 border-t-2 border-dashed border-red-400" /> Inundação {n2(COTAS.inundacao)} m</span>
            </div>
          </section>

          {/* ---------- Previsão meteorológica ---------- */}
          <WeatherForecast />

          {/* ---------- Fontes pluviométricas ---------- */}
          <section className={`overflow-hidden ${CARD}`}>
            <div className="flex flex-col gap-3 border-b border-slate-800 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-white">
                  <CloudRain className="h-4 w-4 text-sky-400" />
                  Estações pluviométricas da bacia do {STATION.river}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  As barras azuis do gráfico são a <strong className="font-semibold text-slate-300">média aritmética</strong>{' '}
                  destas estações · Campo Bom + {RAIN_STATIONS.length - 1} a montante
                  {extraRainRows.length > 0 && (
                    <span className="text-slate-500"> · +{extraRainRows.length} estações na bacia</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* seletor de período */}
                <div className="inline-flex rounded-lg bg-slate-800/80 p-0.5 ring-1 ring-white/5">
                  {([24, 72, 168, 720] as const).map((w) => {
                    const lbl = w === 24 ? '24h' : w === 72 ? '3d' : w === 168 ? '7d' : '30d';
                    return (
                      <button
                        key={w}
                        onClick={() => setRainWindow(w)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                          rainWindow === w ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-right ring-1 ring-sky-400/20">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">Média da bacia · {rainWindowLabel}</p>
                  <p className="text-xl font-bold tabular-nums text-sky-300">{n1(basinRainTotal)} mm</p>
                  <p className="text-[10px] text-slate-500">
                    {rain ? rain.mapStations.filter((s) => s.ok).length : 0} estações
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-900/60 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-2.5 font-semibold">Estação</th>
                    <th className="px-3 py-2.5 font-semibold">Município</th>
                    <th className="px-3 py-2.5 font-semibold">Código ANA</th>
                    <th className="px-3 py-2.5 font-semibold">Operador</th>
                    <th className="px-3 py-2.5 font-semibold">Posição</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Acum. {rainWindowLabel}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Última hora</th>
                    <th className="px-6 py-2.5 font-semibold">Origem do dado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {rainRows.map((row) => (
                    <StationRow key={row.station.id} row={row} />
                  ))}

                  {/* estações extras da bacia */}
                  {showAllStations && extraRainRows.map((row) => (
                    <StationRow key={row.station.id} row={row} extra />
                  ))}

                  {!rainRows.length && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-sm text-slate-500">
                        Carregando dados pluviométricos…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {extraRainRows.length > 0 && (
              <div className="border-t border-slate-800 px-6 py-3">
                <button
                  onClick={() => setShowAllStations((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 transition hover:text-sky-300"
                >
                  {showAllStations
                    ? `▲ Recolher (${extraRainRows.length} estações extras)`
                    : `▼ Ver mais ${extraRainRows.length} estações da bacia`}
                </button>
              </div>
            )}

            <p className="border-t border-slate-800 px-6 py-4 text-[11px] leading-relaxed text-slate-500">
              <strong className="text-slate-400">Metodologia e transparência das fontes:</strong> todas as estações acima
              constam do Inventário Telemétrico da ANA (sub-bacia 87 — Guaíba/Rio dos Sinos). A estação{' '}
              <strong className="text-slate-400">Campo Bom (87380000)</strong> transmite o pluviômetro junto com o nível
              pelo webservice de telemetria da ANA, sendo leitura instrumental direta. As estações a montante são
              operadas por CEMADEN, Defesa Civil-RS e SEMA-RS e <em>não</em> são servidas pelo webservice público da ANA;
              para elas a precipitação horária é obtida no Open-Meteo exatamente nas coordenadas cadastradas de cada
              estação. A média é aritmética simples entre as estações que responderam no período.
            </p>
          </section>

          {/* ---------- Mapa regional de pluviosidade ---------- */}
          <section className={`p-5 sm:p-6 ${CARD}`}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <MapIcon className="h-4 w-4 text-sky-400" />
                  Pluviosidade na {BASIN_META.shortName}
                </h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  Precipitação acumulada nas estações situadas <strong className="font-semibold text-slate-300">dentro
                  do limite oficial da bacia</strong> ({BASIN_META.areaKm2.toLocaleString('pt-BR')} km²) · período: {cfg.label}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-800/80 px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10">
                  <Layers className="h-3.5 w-3.5 text-sky-400" />
                  Base: Google Streets · Híbrido · Relevo · OSM
                </span>
                {flood ? (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-300 ring-1 ring-red-400/25">
                    <Waves className="h-3.5 w-3.5" />
                    {flood.layers.length} mancha{flood.layers.length === 1 ? '' : 's'} de inundação
                  </span>
                ) : floodError ? (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300 ring-1 ring-amber-400/25">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Camada de inundação indisponível
                  </span>
                ) : (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-800/80 px-3 py-1.5 text-[11px] text-slate-400 ring-1 ring-white/10">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Carregando mancha de inundação…
                  </span>
                )}
              </div>
            </div>

            {/* ---- Consulta de endereço × mancha de 2024 ---- */}
            <AddressRisk
              flood={flood}
              level={level}
              selected={address}
              onSelect={setAddress}
              onShowAlert={() => setAlertOpen(true)}
            />

            {rain && winRange ? (
              <RainMap
                stations={rain.mapStations}
                from={winRange.from}
                to={winRange.to}
                periodLabel={cfg.label}
                flood={flood}
                address={address}
                alertActive={alertActive}
              />
            ) : (
              <div className="flex h-[440px] items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900/50 text-sm text-slate-500 sm:h-[520px]">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin text-sky-500" />
                Carregando mapa de precipitação…
              </div>
            )}

            <p className="mt-4 border-t border-slate-800 pt-4 text-[11px] leading-relaxed text-slate-500">
              <strong className="text-slate-400">Limite da bacia:</strong> polígono oficial da{' '}
              <a
                href={BASIN_META.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline"
              >
                {BASIN_META.source}
              </a>{' '}
              — feição <span className="font-mono">DMI_CD {BASIN_META.anaCode}</span> ("Sinos"), área de{' '}
              {BASIN_META.areaKm2.toLocaleString('pt-BR')} km², em EPSG:4326. Cada estação do inventário telemétrico da
              ANA é submetida a um teste <em>ponto-em-polígono</em> contra esse limite: só entram no mapa as que estão
              efetivamente dentro da bacia — das nascentes em Caraá, na Serra Geral, até a foz no Delta do Jacuí.
              Mapa em <strong className="text-slate-400">Leaflet</strong>, com o <em>LayersControl</em> pronto para
              receber novos <em>overlays</em> (radar, isoietas, áreas de risco). Clique num círculo para ver os
              detalhes da estação.
            </p>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              <strong className="text-orange-300">Camada de inundação:</strong> mancha vetorial da{' '}
              <strong className="text-slate-400">{FLOOD_META.title}</strong>, fornecida pela{' '}
              {FLOOD_META.source}. A geometria está{' '}
              <strong className="text-slate-400">embarcada no próprio painel</strong> — carrega instantaneamente e
              continua disponível mesmo sem internet, sem depender de arquivos externos. Pode ser ligada e desligada
              pelo controle de camadas no canto superior direito do mapa.
            </p>

            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              <strong className="text-emerald-300">Consulta de endereço:</strong> o endereço digitado é convertido em
              coordenada pelo <a className="text-blue-400 hover:underline" href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim/OpenStreetMap</a>{' '}
              (também aceita CEP e coordenadas), e o ponto passa por um teste <em>ponto-em-polígono</em> contra a
              mancha de 2024. O <strong className="text-red-300">alerta de risco só é emitido</strong> quando as duas
              condições ocorrem ao mesmo tempo: o endereço está dentro da mancha{' '}
              <strong>e</strong> o Rio dos Sinos em Campo Bom está igual ou acima da cota de alerta de{' '}
              <strong className="text-slate-400">{n2(COTAS.alerta)} m</strong>. Abaixo desse nível o painel apenas
              informa a situação do endereço, sem alarme. Nenhum endereço consultado é armazenado ou compartilhado.
            </p>
          </section>

          {/* ---------- Modelo de previsão (acesso restrito) ---------- */}
          {isAdmin && <IphForecast readings={readings} level={level} />}

          {/* Modelo estatístico de risco a montante — desativado temporariamente */}
          {/* <UpstreamRisk /> */}

          {/* ---------- Tabela + estação ---------- */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={`overflow-hidden lg:col-span-2 ${CARD}`}>
              <div className="border-b border-slate-800 px-6 py-4">
                <h2 className="text-base font-bold text-white">Últimas medições recebidas</h2>
                <p className="text-xs text-slate-400">Dados brutos da telemetria — estação {STATION.code}</p>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900/95 text-left text-[11px] uppercase tracking-wide text-slate-500 backdrop-blur">
                    <tr>
                      <th className="px-6 py-2.5 font-semibold">Data / hora</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Nível</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Variação</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Vazão</th>
                      <th className="px-6 py-2.5 text-right font-semibold">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {[...readings].slice(-24).reverse().map((r, i, arr) => {
                      const prev = arr[i + 1];
                      const diff = prev ? (r.level - prev.level) * 100 : 0;
                      const st = STATUS_META[statusFor(r.level)];
                      return (
                        <tr key={r.ts} className="transition hover:bg-slate-800/40">
                          <td className="whitespace-nowrap px-6 py-2.5 text-slate-400">{fmtDateTime(r.ts)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-100">{n2(r.level)} m</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${diff > 0 ? 'text-red-400' : diff < 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {prev ? `${diff > 0 ? '+' : ''}${diff.toFixed(0)} cm` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">{r.flow != null ? n1(r.flow) : '—'}</td>
                          <td className="px-6 py-2.5 text-right">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.bg} ${st.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> {st.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {!readings.length && (
                      <tr>
                        <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                          {loading ? 'Carregando medições…' : 'Nenhuma medição disponível.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Info da estação */}
            <div className={`p-6 ${CARD}`}>
              <h2 className="text-base font-bold text-white">Sobre a estação</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <Row label="Código ANA" value={STATION.code} />
                <Row label="Estação" value={`${STATION.name} / ${STATION.state}`} />
                <Row label="Rio" value={STATION.river} />
                <Row label="Responsável" value={`${STATION.owner} · operação ${STATION.operator}`} />
                <Row label="Cota de inundação" value={`${n2(COTAS.inundacao)} m`} />
                <Row label="Recorde histórico" value={`${n2(COTAS.recordeHistorico)} m (04/05/2024)`} />
                <Row label="Intervalo de leitura" value="15 minutos" />
                <Row label="Última consulta" value={fetchedAt ? fmtTime(fetchedAt) : '—'} />
                <Row label="Conexão" value={error ? 'indisponível' : source === 'direto' ? 'direta (ANA)' : `proxy ${source || '—'}`} />
              </dl>
              <p className="mt-5 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px] leading-relaxed text-slate-400">
                Cotas de atenção e alerta são referências operacionais derivadas da cota de inundação oficial
                (−1,00 m e −0,50 m). Projeções são estimativas lineares de curto prazo e não substituem os
                boletins oficiais da Defesa Civil e do SGB/CPRM.
              </p>
            </div>
          </section>
          </>
          )}
        </main>

        <footer className="border-t border-slate-800 bg-slate-950">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="overflow-hidden rounded-lg bg-white p-0.5 ring-1 ring-white/15">
                  <Brasao className="h-9 w-9 rounded-md" />
                </div>
                <div className="text-xs leading-relaxed text-slate-400">
                  <p className="font-semibold text-slate-300">Prefeitura Municipal de Campo Bom — RS</p>
                  <p>Defesa Civil Municipal · Av. Independência, 800 · (51) 3598-8600</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">Atualização automática a cada 5 min · leituras publicadas a cada 15 min.</p>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-800/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-slate-500">
                Fonte oficial dos dados:{' '}
                <a className="font-medium text-blue-400 hover:underline" href="https://www.snirh.gov.br/hidrotelemetria/" target="_blank" rel="noreferrer">
                  ANA — Sistema de Telemetria Hidrometeorológica
                </a>{' '}
                · estação {STATION.code} ({STATION.name}/{STATION.state}), operada pelo SGB-CPRM. Em caso de emergência, ligue 199 (Defesa Civil) ou 193 (Bombeiros).
              </p>
              {isAdmin ? (
                <button
                  onClick={() => {
                    sessionStorage.removeItem('cb-admin');
                    clearBotToken();
                    setIsAdmin(false);
                    setTab('painel');
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
                >
                  🔓 Sair do painel técnico
                </button>
              ) : (
                <button
                  onClick={() => {
                    setShowLogin(true);
                    setLoginError(false);
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-800 px-3 py-1.5 text-[11px] text-slate-600 transition hover:border-slate-700 hover:text-slate-400"
                >
                  🔒 Acesso restrito
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>

      {/* ---------- Pop-up de alerta de área de risco ---------- */}
      <FloodAlertModal
        open={alertOpen && inDanger}
        address={address?.short ?? ''}
        level={level ?? 0}
        trend={trend}
        onClose={() => setAlertOpen(false)}
      />

      {/* ---------- Modal de login (acesso restrito) ---------- */}
      {showLogin && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={() => setShowLogin(false)} />
          <form
            className="relative w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const user = (form.elements.namedItem('user') as HTMLInputElement).value;
              const pass = (form.elements.namedItem('pass') as HTMLInputElement).value;
              if (user === 'admin' && pass === 'CBdefesacivil2026') {
                sessionStorage.setItem('cb-admin', '1');
                try {
                  await loginBot(user, pass);
                } catch {
                  /* o painel abre mesmo se a API estiver indisponível */
                }
                setIsAdmin(true);
                setTab('bot');
                setShowLogin(false);
                setLoginError(false);
              } else {
                setLoginError(true);
              }
            }}
          >
            <h3 className="text-base font-bold text-white">🔒 Acesso restrito</h3>
            <p className="mt-1 text-xs text-slate-400">
              Painel técnico, modelo de previsão e configurações do bot Telegram. Acesso exclusivo para equipe autorizada.
            </p>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Usuário
            </label>
            <input
              name="user"
              type="text"
              autoComplete="username"
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Usuário"
            />

            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Senha
            </label>
            <input
              name="pass"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Senha"
            />

            {loginError && (
              <p className="mt-2 text-xs font-semibold text-red-400">Usuário ou senha incorretos.</p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500"
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => setShowLogin(false)}
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-slate-800"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/* ---------------- componentes auxiliares ---------------- */

function MiniCard({
  icon,
  label,
  value,
  unit,
  hint,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  hint?: string;
  tint: string;
}) {
  return (
    <div className={`p-4 ${CARD}`}>
      <div className="flex items-center gap-2">
        <span className={`rounded-lg p-1.5 ring-1 ${tint}`}>{icon}</span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums text-slate-100">{value}</span>
        <span className="text-xs font-medium text-slate-500">{unit}</span>
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-slate-800 pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-200">{value}</dd>
    </div>
  );
}

const n1s = (v: number) => v.toFixed(1).replace('.', ',');

function StationRow({ row, extra }: { row: any; extra?: boolean }) {
  return (
    <tr className={`transition hover:bg-slate-800/40 ${extra ? 'bg-slate-950/30' : ''}`}>
      <td className="whitespace-nowrap px-6 py-2.5 font-medium text-slate-200">
        {row.station.name}
        {extra && <span className="ml-1.5 rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] text-slate-400">bacia</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">{row.station.city}</td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-400">{row.station.anaCode}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">{row.station.operator}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {row.station.position === 'local' ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">Local</span>
        ) : (
          <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
            {row.station.upstreamKm > 0 ? `~${row.station.upstreamKm} km` : 'bacia'}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-sky-300">
        {row.ok ? `${n1s(row.total)} mm` : '—'}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-400">
        {row.ok && row.last != null ? `${n1s(row.last)} mm` : '—'}
      </td>
      <td className="whitespace-nowrap px-6 py-2.5">
        {row.station.provider === 'ANA' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300 ring-1 ring-blue-400/20">
            ANA (medido)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 ring-1 ring-violet-400/20">
            Open-Meteo
          </span>
        )}
      </td>
    </tr>
  );
}
