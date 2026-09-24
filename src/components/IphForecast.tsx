import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, AlertTriangle, Clock, CloudRain, FileText, RefreshCw, Ruler, Sparkles, Waves } from 'lucide-react';
import { IPH_CLASS, IPH_LIMITES, IPH_STATIONS, runIphModel, type IphOutput } from '../lib/iphModel';
import type { Reading } from '../lib/ana';

interface Props {
  readings: Reading[];
  level: number | null;
}

const n2 = (v: number) => v.toFixed(2).replace('.', ',');
const n1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Limite de alerta exibido no gráfico (mesmos valores configurados para o
 *  envio pelo Telegram — buscados em /api/limiares; ver useEffect abaixo). */
interface Limiar {
  id: string;
  name: string;
  meters: number;
  preWarningM?: number;
  enabled?: boolean;
}

/** Reserva: se o servidor não responder, usa os limiares operacionais do
 *  boletim (IPH_LIMITES em src/lib/iphModel.ts) — os mesmos do painel. */
const LIMIARES_RESERVA: Limiar[] = [
  { id: 'atencao', name: 'Atenção', meters: IPH_LIMITES.atencao, enabled: true },
  { id: 'alerta', name: 'Alerta', meters: IPH_LIMITES.alerta, enabled: true },
  { id: 'inundacao', name: 'Inundação', meters: IPH_LIMITES.inundacao, enabled: true },
];

const CORES_LIMIAR = ['#facc15', '#fb923c', '#f87171', '#f472b6', '#a78bfa'];

const CARD =
  'rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur';

function ForecastTip({ active, payload, label, rainModel }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const items: { k: string; v: string; c: string }[] = [];
  if (row.observed != null && Number.isFinite(row.observed)) {
    items.push({ k: 'Observado (ANA)', v: `${n2(row.observed)} m`, c: '#2dd4bf' });
  }
  if (row.ecmwf != null && Number.isFinite(row.ecmwf)) {
    items.push({ k: 'Projeção ECMWF', v: `${n2(row.ecmwf)} m`, c: '#818cf8' });
  }
  if (row.gfs != null && Number.isFinite(row.gfs)) {
    items.push({ k: 'Projeção GFS', v: `${n2(row.gfs)} m`, c: '#fb7185' });
  }
  const rainVal = rainModel === 'gfs' ? row.rainGfs : row.rainEcmwf;
  if (rainVal > 0) {
    const rc = '#d8b4fe';
    items.push({ k: `Chuva ${rainModel === 'ecmwf' ? 'ECMWF' : 'GFS'}`, v: `${n1(rainVal)} mm`, c: rc });
  }
  if (!items.length) return null;
  const when = new Date(Number(label || row.ts)).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2.5 shadow-xl">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{when}</p>
      {items.map((it) => (
        <p key={it.k} className="flex items-baseline justify-between gap-4 text-xs">
          <span style={{ color: it.c }}>{it.k}</span>
          <span className="font-bold tabular-nums text-slate-100">{it.v}</span>
        </p>
      ))}
    </div>
  );
}

export default function IphForecast({ readings }: Props) {
  const [out, setOut] = useState<IphOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rainModel, setRainModel] = useState<'ecmwf' | 'gfs'>('ecmwf');
  // Limiares do gráfico = MESMOS valores configurados para envio pelo Telegram
  // (endpoint público /api/limiares). Se o servidor não responder, cai nos
  // limiares operacionais do boletim — nunca em números soltos no JSX.
  const [limiares, setLimiares] = useState<Limiar[]>(LIMIARES_RESERVA);
  const [mostrarLimiares, setMostrarLimiares] = useState(true);

  useEffect(() => {
    let vivo = true;
    fetch('/api/limiares')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const lista = Array.isArray(d?.limiares) ? (d.limiares as Limiar[]) : [];
        const ativos = lista.filter((l) => l && Number.isFinite(l.meters) && l.enabled !== false);
        if (vivo && ativos.length) setLimiares(ativos);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!readings.length) return;
    setLoading(true);
    setErr(null);
    try {
      const series = readings.map((r) => ({ ts: r.ts, h: r.level }));
      setOut(await runIphModel(series));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'falha no motor de previsão');
    } finally {
      setLoading(false);
    }
  }, [readings]);

  useEffect(() => {
    if (readings.length) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings.length > 0]);



  return (
    <section className={`p-5 sm:p-6 ${CARD}`}>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-white">
            <Sparkles className="h-4 w-4 text-teal-400" />
            Modelo de previsão estatístico simplificado da curva do nível do rio para Campo Bom
            <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-300 ring-1 ring-teal-400/30">
              Experimental
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            3 sub-bacias com CN diferenciado · interpolação IDW · escoamento de base ·
            condição de contorno Guaíba · projeções 6 h, 12 h e 24 h · curvas GFS e ECMWF (72 h)
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading || !readings.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Recalcular
        </button>
      </div>

      <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-100">
          <strong className="font-bold">Módulo experimental.</strong> Modelo estatístico simplificado de
          acumulação hora a hora por sub-bacias — não é um modelo hidrodinâmico e não substitui modelos
          operacionais nem os boletins da Defesa Civil. As linhas pontilhadas do gráfico são os{' '}
          <strong className="text-amber-200">limiares configurados para envio pelo Telegram</strong>{' '}
          ({limiares.map((l) => n2(l.meters)).join(' / ')} m), os mesmos exibidos no painel do bot — distintos
          das cotas oficiais do SGB usadas no restante do painel.
        </p>
      </div>

      {loading && !out && (
        <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
          <RefreshCw className="h-7 w-7 animate-spin text-teal-400" />
          <p className="text-sm">Coletando montante, API e previsões GFS/ECMWF…</p>
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{err}</div>
      )}

      {out && (
        <>
          <div className="mb-4 flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5">
              Chuva ECMWF 12 h: <strong className="text-indigo-300">{n1(out.rainFc.ecmwf12)} mm</strong>
              {' · '}24 h: <strong className="text-indigo-300">{n1(out.rainFc.ecmwf24)} mm</strong>
            </span>
            <span className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5">
              Chuva GFS 12 h: <strong className="text-rose-300">{n1(out.rainFc.gfs12)} mm</strong>
              {' · '}24 h: <strong className="text-rose-300">{n1(out.rainFc.gfs24)} mm</strong>
            </span>
            {out.guaibaLevel != null && (
              <span className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5">
                Guaíba (87450020): <strong className="text-teal-300">{n2(out.guaibaLevel)} m</strong>
                {out.horizons[2]?.remanso > 0.01 && (
                  <span className="text-amber-300"> · remanso +{n2(out.horizons[2].remanso)} m</span>
                )}
              </span>
            )}
            {out.backtest.length > 0 && (() => {
              const ecm24 = out.backtest.find((b) => b.model === 'ecmwf' && b.horizon === 24);
              const gfs24 = out.backtest.find((b) => b.model === 'gfs' && b.horizon === 24);
              const ecmN = ecm24?.n ?? 0;
              const gfsN = gfs24?.n ?? 0;
              return (
                <span className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5">
                  Acerto 24 h (ECMWF):{' '}
                  <strong className="text-indigo-300">{ecm24 ? `${ecm24.accuracy.toFixed(0)}%` : '—'}</strong>
                  {' · (GFS): '}
                  <strong className="text-rose-300">{gfs24 ? `${gfs24.accuracy.toFixed(0)}%` : '—'}</strong>
                  <span className="text-slate-500"> ({Math.max(ecmN, gfsN)} pontos)</span>
                </span>
              );
            })()}
          </div>

          {/* horizontes */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HorizonCard title="Agora" stage={out.current} cls={out.currentCls} hint="medido · ANA 87380000" now />
            {out.horizons.map((h) => (
              <HorizonCard
                key={h.hours}
                title={`+${h.hours} h`}
                stage={h.stage}
                cls={h.cls}
                hint={`inercial ${h.inertial >= 0 ? '+' : ''}${n2(h.inertial)} · chuva +${n2(h.rain)}${h.remanso > 0.01 ? ` · remanso +${n2(h.remanso)}` : ''} m`}
              />
            ))}
          </div>

          {/* boletim */}
          <div className="mb-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <FileText className="h-3.5 w-3.5" /> Boletim
            </p>
            <p className="text-sm leading-relaxed text-slate-300">{out.boletim}</p>
            <p className="mt-3 rounded-lg bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
              <strong className="text-slate-300">Fator dominante:</strong> {out.dominant}
            </p>
          </div>

          {/* gráfico observado + GFS + ECMWF */}
          <div className="mb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <Waves className="h-4 w-4 text-teal-400" />
                Curva observada (24 h) e projeções GFS / ECMWF (72 h)
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setMostrarLimiares((v) => !v)}
                  title="Mostrar/esconder as linhas dos limiares de envio do Telegram (o eixo é expandido para que fiquem visíveis)"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
                    mostrarLimiares
                      ? 'bg-amber-500/15 text-amber-200 ring-amber-400/30'
                      : 'bg-slate-800/80 text-slate-400 ring-white/5 hover:text-slate-200'
                  }`}
                >
                  <Ruler className="h-3.5 w-3.5" />
                  Limiares do Telegram
                </button>
                <span className="text-[11px] text-slate-500">Chuva prevista:</span>
                <div className="inline-flex rounded-lg bg-slate-800/80 p-0.5 ring-1 ring-white/5">
                  <button
                    onClick={() => setRainModel('ecmwf')}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                      rainModel === 'ecmwf' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ECMWF IFS
                  </button>
                  <button
                    onClick={() => setRainModel('gfs')}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                      rainModel === 'gfs' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    GFS
                  </button>
                </div>
              </div>
            </div>
            <div className="h-[340px] w-full sm:h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={out.curve} margin={{ top: 8, right: 40, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rainBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c084fc" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#9333ea" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(t: number) =>
                      new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit' })
                    }
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                    minTickGap={36}
                  />
                  <YAxis
                    yAxisId="level"
                    domain={[
                      (d: number) => Math.max(0, Math.floor((d - 0.3) * 10) / 10),
                      (d: number) => {
                        const base = Math.ceil((d + 0.4) * 10) / 10;
                        if (!mostrarLimiares || !limiares.length) return base;
                        // o topo do eixo acompanha o maior limiar para que as
                        // linhas pontilhadas não fiquem fora da área plotada
                        const topo = Math.max(...limiares.map((l) => l.meters));
                        return Math.max(base, Math.ceil((topo + 0.3) * 10) / 10);
                      },
                    ]}
                    tickFormatter={(v: number) => `${v.toFixed(1)}m`}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <YAxis
                    yAxisId="rain"
                    orientation="right"
                    domain={[0, (d: number) => Math.max(4, Math.ceil(d * 2.5))]}
                    tickFormatter={(v: number) => `${v}mm`}
                    tick={{ fill: '#c084fc', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={38}
                  />
                  <Tooltip content={<ForecastTip rainModel={rainModel} />} />
                  {mostrarLimiares &&
                    limiares.map((l, i) => {
                      const cor = CORES_LIMIAR[i % CORES_LIMIAR.length];
                      return (
                        <ReferenceLine
                          key={l.id}
                          yAxisId="level"
                          y={l.meters}
                          stroke={cor}
                          strokeDasharray="4 4"
                          strokeOpacity={0.8}
                          label={{
                            value: `${l.name} ${n2(l.meters)} m`,
                            position: 'insideBottomRight',
                            fill: cor,
                            fontSize: 10,
                          }}
                        />
                      );
                    })}
                  {/* barras de chuva — atrás das curvas */}
                  <Bar
                    yAxisId="rain"
                    dataKey={rainModel === 'ecmwf' ? 'rainEcmwf' : 'rainGfs'}
                    fill="url(#rainBarFill)"
                    barSize={5}
                    radius={[2, 2, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="level"
                    type="monotone"
                    dataKey="observed"
                    stroke="#2dd4bf"
                    strokeWidth={2.4}
                    fill="#2dd4bf"
                    fillOpacity={0.12}
                    connectNulls={false}
                    isAnimationActive={false}
                    name="observed"
                  />
                  <Line
                    yAxisId="level"
                    type="monotone"
                    dataKey="ecmwf"
                    stroke="#818cf8"
                    strokeWidth={2.4}
                    strokeDasharray="7 4"
                    dot={{ r: 2.5, fill: '#818cf8', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                    name="ecmwf"
                  />
                  <Line
                    yAxisId="level"
                    type="monotone"
                    dataKey="gfs"
                    stroke="#fb7185"
                    strokeWidth={2.4}
                    strokeDasharray="3 4"
                    dot={{ r: 2.5, fill: '#fb7185', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    isAnimationActive={false}
                    name="gfs"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-teal-400" /> Observado (ANA)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-dashed border-indigo-400" /> ECMWF IFS
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-dotted border-rose-400" /> GFS
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: '#c084fc', opacity: 0.6 }}
                />
                Chuva {rainModel === 'ecmwf' ? 'ECMWF' : 'GFS'} (mm)
              </span>
              {out.divergence && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                    out.divergence.maxDiffM > 0.05
                      ? 'bg-indigo-500/10 text-indigo-200 ring-indigo-400/25'
                      : 'bg-slate-800/70 text-slate-400 ring-white/5'
                  }`}
                  title="Diferença máxima entre as duas curvas projetadas (ECMWF × GFS)"
                >
                  {out.divergence.maxDiffM > 0.005
                    ? `ECMWF × GFS: até ${n2(out.divergence.maxDiffM)} m${out.divergence.atHour ? ` em +${out.divergence.atHour} h` : ''}`
                    : `ECMWF e GFS coincidem — chuva prevista praticamente igual (${n1(
                        out.divergence.ecmwfRainMm
                      )} mm × ${n1(out.divergence.gfsRainMm)} mm)`}
                </span>
              )}
              {mostrarLimiares &&
                limiares.map((l, i) => (
                  <span key={`leg-${l.id}`} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-0 w-4 border-t border-dashed"
                      style={{ borderColor: CORES_LIMIAR[i % CORES_LIMIAR.length] }}
                    />
                    {l.name} {n2(l.meters)} m
                    {l.preWarningM ? (
                      <span className="text-slate-600">(pré-aviso {n2(Math.max(0, l.meters - l.preWarningM))} m)</span>
                    ) : null}
                  </span>
                ))}
            </div>
          </div>

          {/* validação retrospectiva */}
          {out.backtest.length > 0 && (
            <div className="mb-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                <Activity className="h-3.5 w-3.5 text-teal-400" /> Validação retrospectiva — últimas 72 h
              </p>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
                O motor simulou as previsões que teria emitido a cada 3 h nas últimas 72 h — usando
                apenas os dados disponíveis em cada origem (chuva analisada alinhada ao instante da
                previsão, sem consultar o futuro) — e comparou com o nível realmente observado pela
                ANA. O <strong className="text-slate-300">% de acerto</strong> indica a fração de
                previsões dentro da tolerância. A <strong className="text-slate-300">persistência</strong>{' '}
                ("o nível fica onde está") é a linha de base de controle: o modelo só demonstra
                habilidade quando o MAE fica abaixo dela.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {out.backtest.map((bt) => {
                  const good = bt.accuracy >= 70;
                  const ok = bt.accuracy >= 40;
                  const semDados = bt.n === 0;
                  void 0;
                  const tlLabel = bt.trafficLight === 'green' ? 'verde' : bt.trafficLight === 'yellow' ? 'amarelo' : 'vermelho';
                  return (
                    <div
                      key={`${bt.model}-${bt.horizon}`}
                      className={`rounded-lg border p-3 ${
                        semDados
                          ? 'border-slate-800 bg-slate-900/40'
                          : good
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : ok
                              ? 'border-amber-500/30 bg-amber-500/5'
                              : 'border-red-500/30 bg-red-500/5'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">
                          {bt.model === 'ecmwf' ? 'ECMWF' : 'GFS'} · +{bt.horizon} h
                          {!semDados && <span className={`ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${bt.trafficLight==='green'?'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30':bt.trafficLight==='yellow'?'bg-amber-500/15 text-amber-300 ring-amber-400/30':'bg-red-500/15 text-red-300 ring-red-400/30'}`}>{tlLabel} · {bt.exceptions} exc.</span>}
                        </span>
                        <span
                          className={`text-lg font-bold tabular-nums ${
                            semDados
                              ? 'text-slate-500'
                              : good
                                ? 'text-emerald-300'
                                : ok
                                  ? 'text-amber-300'
                                  : 'text-red-300'
                          }`}
                        >
                          {semDados ? '—' : `${bt.accuracy.toFixed(0)}%`}
                        </span>
                      </div>
                      {semDados ? (
                        <p className="mt-2 text-[10px] text-slate-500">
                          Sem dados suficientes na janela (série observada ou chuva analisada indisponível).
                        </p>
                      ) : (
                        <>
                          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full transition-all ${
                                good ? 'bg-emerald-500' : ok ? 'bg-amber-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${Math.min(100, bt.accuracy)}%` }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
                            <span>MAE: <strong className="text-slate-300">{n2(bt.mae)} m</strong></span>
                            <span>RMSE: <strong className="text-slate-300">{n2(bt.rmse)} m</strong></span>
                            <span>
                              NSE:{' '}
                              <strong
                                className={
                                  bt.nse == null
                                    ? 'text-slate-400'
                                    : bt.nse >= 0.7
                                      ? 'text-emerald-300'
                                      : bt.nse >= 0.4
                                        ? 'text-amber-300'
                                        : 'text-red-300'
                                }
                              >
                                {bt.nse == null ? 'n/d' : bt.nse.toFixed(2)}
                              </strong>
                            </span>
                            <span>±{n2(bt.tolerance)} m</span>
                            <span>{bt.n} pts</span>
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-800/60 pt-1.5 text-[10px] text-slate-500">
                            <span>
                              Persistência (MAE):{' '}
                              <strong className="text-slate-300">
                                {bt.persistMae != null ? `${n2(bt.persistMae)} m` : '—'}
                              </strong>
                            </span>
                            {bt.skillVsPersist != null && (
                              <span>
                                Skill vs. persist.:{' '}
                                <strong
                                  className={
                                    bt.skillVsPersist > 0
                                      ? 'text-emerald-300'
                                      : bt.skillVsPersist === 0
                                        ? 'text-amber-300'
                                        : 'text-red-300'
                                  }
                                >
                                  {bt.skillVsPersist > 0 ? '+' : ''}
                                  {n1(bt.skillVsPersist)}%
                                </strong>
                              </span>
                            )}
                            <span>VaR<sub>95</sub>: <strong className="text-slate-300">{bt.var95 != null ? n2(bt.var95)+' m' : '—'}</strong></span>
                            <span>CVaR<sub>95</sub>: <strong className="text-slate-300">{bt.cvar95 != null ? n2(bt.cvar95)+' m' : '—'}</strong></span>
                            <span>VaR<sub>99</sub>: <strong className="text-slate-300">{bt.var99 != null ? n2(bt.var99)+' m' : '—'}</strong></span>
                            <span>MaxDD: <strong className="text-slate-300">{bt.maxDrawdown != null ? n2(bt.maxDrawdown)+' m' : '—'}</strong></span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* estações */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {out.stations.map((s) => {
              const warn = (s.cr != null && s.cr > 0) || s.p24 > 40;
              return (
                <div
                  key={s.station.id}
                  className={`rounded-xl border p-3.5 ${
                    warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    {s.station.kind === 'fluvio' ? (
                      <Waves className="h-3 w-3 text-teal-400" />
                    ) : (
                      <CloudRain className="h-3 w-3 text-sky-400" />
                    )}
                    {s.station.name}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {s.station.city} · lag {s.station.lagH} h · w={s.station.weight}
                    {' · '}
                    <span
                      className={
                        s.rainSource === 'ANA'
                          ? 'text-blue-300'
                          : s.rainSource === 'sem dados'
                            ? 'text-red-300'
                            : 'text-violet-300'
                      }
                    >
                      {s.rainSource === 'ANA' ? '📡 ANA medido' : s.rainSource === 'sem dados' ? '⚠️ sem dados' : '🌐 Open-Meteo'}
                    </span>
                  </p>
                  <dl className="mt-2 space-y-1 text-[11px]">
                    {s.level != null && (
                      <Row k="Nível / CR" v={`${n2(s.level)} m · ${s.cr != null ? (s.cr > 0 ? '+' : '') + n2(s.cr) : '—'} m`} />
                    )}
                    {s.dH2h != null && (
                      <Row k="dH/dt 2 h" v={`${s.dH2h > 0 ? '+' : ''}${n1(s.dH2h)} cm/h`} />
                    )}
                    <Row k="P 24 h / efetiva" v={`${n1(s.p24)} / ${n1(s.pEfetiva)} mm`} />
                    <Row k="API (saturação)" v={`${n1(s.api)} mm`} />
                  </dl>
                </div>
              );
            })}
          </div>

          <p className="mt-4 border-t border-slate-800 pt-4 text-[10px] leading-relaxed text-slate-500">
            <strong className="text-slate-400">Arquitetura:</strong> propagação hora a hora acumulativa.
            H<sub>CB</sub>(t+1) = H<sub>CB</sub>(t) + inércia(dH/dt) + Σ<sub>sub</sub> chuva_efetiva(t−lag)×coef. +
            escoam. base + remanso(Guaíba) − recessão K·(H−H_base).
            3 sub-bacias: alto (CN 65, lag 18 h) · médio (CN 72, lag 10 h) · baixo (CN 84, lag 4 h).
            Chuva passada (48 h) + futura (100 h) com defasagem por sub-bacia.
            Interpolação IDW. API diário (γ=0,87) com ajuste contínuo de umidade antecedente (AMC I/II/III,
            stormwater-management SK-004). <strong className="text-slate-400">SCS-CN aplicado ao acumulado do
            evento</strong> (S=25400/CN−254, hydrologic-modeling-engine CIV-SK-022) — a versão anterior aplicava o
            CN hora a hora e a abstração inicial zerava a chuva prevista, o que fazia ECMWF e GFS desenharem a
            mesma curva. Subida responde na hora; descida entra por rampa de recessão (nunca em degrau).
            Condição de contorno: nível do Guaíba (87450020, remanso k=0,15 acima de 1,50 m).
            Recessão: decaimento exponencial para H_base = 2,00 m (K = 0,004 h⁻¹).
            Validação: MAE, RMSE, NSE, <strong className="text-emerald-300">VaR<sub>95</sub>/CVaR<sub>95</sub>, MaxDD e traffic-light de backtest</strong> (risk-metrics-calculation wshobson) + linha de base de persistência (origens a cada 3 h nas últimas 72 h, chuva analisada alinhada à origem — sem look-ahead).
            Digest: IDF sintética regional avisa design storm T&gt;25 anos (stormwater-management).
            Calibração verificada por teste (npm run test:modelo): evento de maio/2024 (102,5 mm/48 h, solo
            saturado) eleva <strong className="text-emerald-300">{n2(out.calibration.peakRiseM)} m</strong> no pico
            contra <strong className="text-slate-300">+{n2(out.calibration.observedRiseM)} m observados</strong>.
            Estações: {IPH_STATIONS.map((s) => s.name).join(', ')}.
          </p>
        </>
      )}
    </section>
  );
}

function HorizonCard({
  title,
  stage,
  cls,
  hint,
  now,
}: {
  title: string;
  stage: number;
  cls: keyof typeof IPH_CLASS;
  hint: string;
  now?: boolean;
}) {
  const m = IPH_CLASS[cls];
  return (
    <div className={`rounded-xl border border-slate-800 p-3.5 ${m.bg}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {now ? <Waves className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
        {title}
      </p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums" style={{ color: m.hex }}>
          {n2(stage)}
        </span>
        <span className="text-xs text-slate-500">m</span>
      </p>
      <p className={`mt-1 text-[11px] font-semibold ${m.text}`}>{m.label}</p>
      <p className="mt-0.5 truncate text-[10px] text-slate-500">{hint}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-300">{v}</dd>
    </div>
  );
}


