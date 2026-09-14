import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Brain,
  Clock,
  CloudRain,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { computeRisk, RISK_META, UPSTREAM_STATIONS, type RiskResult } from '../lib/upstreamModel';

const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const n2 = (v: number) => v.toFixed(2).replace('.', ',');

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur';

export default function UpstreamRisk() {
  const [result, setResult] = useState<RiskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setResult(await computeRisk());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'falha ao avaliar o risco');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const meta = result ? RISK_META[result.level] : null;

  const taquara = result?.stations.find((s) => s.station.id === 'taquara');

  return (
    <section className={`p-5 sm:p-6 ${CARD}`}>
      {/* cabeçalho */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <Brain className="h-4 w-4 text-cyan-400" />
            Modelo estatístico de risco a montante
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Pontuação ponderada das estações a montante do Rio dos Sinos para classificar
            o risco de transbordo em <strong className="text-slate-300">Campo Bom</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* estado vazio */}
      {!loading && !result && !err && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 py-8 text-center">
          <Brain className="h-7 w-7 text-slate-600" />
          <p className="text-sm text-slate-400">Modelo iniciado. Clique em Atualizar para avaliar.</p>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3 py-8">
          <RefreshCw className="h-7 w-7 animate-spin text-cyan-400" />
          <p className="text-sm text-slate-400">Coletando dados das estações a montante…</p>
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{err}</div>
      )}

      {result && (
        <>
          {/* ---- veredito principal ---- */}
          <div
            className={`mb-5 flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between ${meta!.ring} ${meta!.bg} border-slate-700/40`}
          >
            <div className="flex items-center gap-4">
              <span className="text-4xl">{meta!.emoji}</span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                  Classificação para Campo Bom
                </p>
                <p className={`text-2xl font-bold ${meta!.text}`}>{meta!.label}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Pontuação: <strong className="text-slate-200">{result.score.toFixed(1)}</strong>{' '}
                  de {result.thresholds.critico}+
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <ProgressBadge
                label="Atenção"
                color="bg-yellow-500"
                active={result.score >= result.thresholds.atencao}
              />
              <div className="h-5 w-px bg-slate-700" />
              <ProgressBadge
                label="Alerta"
                color="bg-orange-500"
                active={result.score >= result.thresholds.alerta}
              />
              <div className="h-5 w-px bg-slate-700" />
              <ProgressBadge label="Crítico" color="bg-red-500" active={result.score >= result.thresholds.critico} />
            </div>
          </div>

          {/* ---- cards das estações ---- */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.stations.map((d) => {
              const st = d.station;
              const hasLevel = d.level != null;
              const cr = d.relativeLevel;
              const crDanger = cr != null && cr > 0;
              const crWarn = cr != null && cr > -0.5 && (d.risingRate ?? 0) > 0.2;
              const rainAlert = d.rain.h24 > 80;
              const rainWarn = d.rain.h24 > 40;

              return (
                <div
                  key={st.id}
                  className={`rounded-xl border p-3.5 transition ${
                    crDanger || rainAlert
                      ? 'border-red-500/30 bg-red-500/7'
                      : crWarn || rainWarn
                        ? 'border-amber-500/30 bg-amber-500/7'
                        : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                        {st.type === 'fluviometric' ? <Waves className="h-3 w-3 text-cyan-400" /> : <CloudRain className="h-3 w-3 text-blue-400" />}
                        {st.name}
                      </p>
                      <p className="truncate text-[10px] text-slate-500">
                        {st.city} · ~{st.distKm} km · Δt ≈ {st.lagH} h
                      </p>
                    </div>
                    {crDanger && <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />}
                    {crWarn && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
                  </div>

                  <div className="mt-2.5 space-y-1.5 text-[11px]">
                    {/* Nível — só fluviométricas */}
                    {hasLevel && (
                      <>
                        <Row
                          label="Nível"
                          value={`${n2(d.level!)} m`}
                          color={crDanger ? 'text-red-300' : crWarn ? 'text-amber-300' : 'text-slate-300'}
                        />
                        {cr != null && (
                          <Row
                            label="Cota relativa"
                            value={cr > 0 ? `+${n1(cr)} m` : n2(cr)}
                            color={crDanger ? 'text-red-300' : crWarn ? 'text-amber-300' : 'text-slate-400'}
                          />
                        )}
                        {d.risingRate != null && (
                          <Row
                            label="Subida (2 h)"
                            value={
                              <span className="inline-flex items-center gap-1">
                                {d.risingRate > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
                                {d.risingRate > 0 ? '+' : ''}
                                {n1(d.risingRate)} cm/h
                              </span>
                            }
                            color={d.risingRate > 0.3 ? 'text-amber-300' : 'text-slate-400'}
                          />
                        )}
                      </>
                    )}

                    {/* Chuva — todas */}
                    <Row
                      label="Chuva 24 h"
                      value={`${n1(d.rain.h24)} mm`}
                      color={rainAlert ? 'text-red-300' : rainWarn ? 'text-amber-300' : 'text-slate-400'}
                    />
                    {d.rain.h48 > 0 && (
                      <Row label="Chuva 48 h" value={`${n1(d.rain.h48)} mm`} color="text-slate-500" />
                    )}

                    {/* Contribuição à pontuação */}
                    <div className="border-t border-slate-800 pt-1.5">
                      <span className="text-[10px] text-slate-500">
                        Peso {st.weight} ·{' '}
                        {hasLevel && crDanger ? 'transbordando' : hasLevel && crWarn ? 'próximo da cota' : ''}
                        {hasLevel && crDanger ? ' · ' : ''}
                        {hasLevel && crWarn && !crDanger ? ' · ' : ''}
                        {rainAlert
                          ? 'chuva intensa'
                          : rainWarn
                            ? 'chuva moderada'
                            : d.rain.h24 > 5
                              ? 'chuva fraca'
                              : 'sem chuva significativa'}
                        {d.api7d > 100 ? ' · solo saturado' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- tabela de propagação ---- */}
          {expanded && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                <Clock className="h-3.5 w-3.5" /> Matriz de tempos de propagação (Δt_lag)
              </p>
              <table className="w-full min-w-[400px] text-[11px]">
                <thead className="text-left uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-2 font-semibold">Estação</th>
                    <th className="pb-2 text-right font-semibold">Dist. fluvial</th>
                    <th className="pb-2 text-right font-semibold">Δt estimado</th>
                    <th className="pb-2 text-right font-semibold">Tipo</th>
                    <th className="pb-2 text-right font-semibold">Cota crítica</th>
                    <th className="pb-2 text-right font-semibold">Peso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {UPSTREAM_STATIONS.map((st) => (
                    <tr key={st.id} className="text-slate-400">
                      <td className="py-1.5 font-medium text-slate-200">{st.name}</td>
                      <td className="py-1.5 text-right tabular-nums">~{st.distKm} km</td>
                      <td className="py-1.5 text-right tabular-nums">≈ {st.lagH} h</td>
                      <td className="py-1.5 text-right">
                        {st.type === 'fluviometric' ? (
                          <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">régua</span>
                        ) : (
                          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-300">chuva</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {st.criticalStage > 0 ? `${n2(st.criticalStage)} m` : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{st.weight}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                <strong className="text-slate-400">Tempos estimados</strong> considerando
                velocidade média de propagação de cheia de ~5–7 km/h no trecho superior
                (alta declividade) e ~3–4 km/h no trecho médio/inferior (planície).{' '}
                <strong className="text-slate-400">Cota crítica de Taquara</strong> estimada
                proporcionalmente à de Campo Bom pela razão das áreas de drenagem
                (2.380 / 2.900 ≈ 0,82).
              </p>
            </div>
          )}

          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 transition hover:text-slate-300"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {expanded ? 'Recolher' : 'Ver matriz de propagação e parâmetros'}
          </button>
        </>
      )}

      {/* nota metodológica */}
      <p className="mt-4 border-t border-slate-800 pt-4 text-[10px] leading-relaxed text-slate-500">
        <strong className="text-slate-400">Modelo conceitual estatístico:</strong> classificação
        ordinal por pontuação ponderada — regras condicionais como definido no documento de
        arquitetura. Apenas a estação de{' '}
        <strong className="text-slate-400">Taquara (87376000 — Foz do Paranhana)</strong> tem
        régua fluviométrica ativa no webservice da ANA (nível confirmado em tempo real;
        às {taquara?.level ? `${n2(taquara.level)} m` : '—'}). As demais estações da bacia são avaliadas
        exclusivamente por pluviometria. Cotas críticas estimadas e sem caráter oficial.
        Produto experimental — não substitui os alertas da Defesa Civil.
      </p>
    </section>
  );
}

function Row({
  label,
  value,
  color = 'text-slate-300',
}: {
  label: string;
  value: string | React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function ProgressBadge({ label, color, active }: { label: string; color: string; active: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`h-2.5 w-2.5 rounded-full ${active ? color : 'bg-slate-700'}`}
        style={active ? { boxShadow: `0 0 10px currentColor` } : undefined}
      />
      <span className={`text-[10px] font-semibold ${active ? 'text-slate-200' : 'text-slate-600'}`}>{label}</span>
    </div>
  );
}
