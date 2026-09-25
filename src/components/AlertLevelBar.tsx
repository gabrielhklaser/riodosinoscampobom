import { Waves } from 'lucide-react';
import { COTAS, STATUS_META, statusFor, type Status } from '../lib/ana';

interface Props {
  level: number | null;
  trend?: number | null; // cm/h
}

const fmt = (v: number) => v.toFixed(2).replace('.', ',');

/**
 * Faixas da barra. Cada faixa ocupa espaço proporcional à sua amplitude em
 * metros; a escala vai de "piso" (2 m — nível de estiagem típico) até o
 * recorde histórico de 2024 (8,56 m).
 */
const FLOOR = 2.0;
const CEIL = COTAS.recordeHistorico;
const SPAN = CEIL - FLOOR;

const BANDS: { status: Status; from: number; to: number; range: string; hint: string }[] = [
  { status: 'normal', from: FLOOR, to: COTAS.atencao, range: `< ${fmt(COTAS.atencao)} m`, hint: 'Rio dentro da calha' },
  { status: 'atencao', from: COTAS.atencao, to: COTAS.alerta, range: `${fmt(COTAS.atencao)} – ${fmt(COTAS.alerta)} m`, hint: 'Acompanhar evolução' },
  { status: 'alerta', from: COTAS.alerta, to: COTAS.inundacao, range: `${fmt(COTAS.alerta)} – ${fmt(COTAS.inundacao)} m`, hint: 'Preparar remoção' },
  { status: 'inundacao', from: COTAS.inundacao, to: CEIL, range: `≥ ${fmt(COTAS.inundacao)} m`, hint: 'Transbordamento' },
];

const SOLID: Record<Status, string> = {
  normal: 'from-sky-500/80 to-sky-400/80',
  atencao: 'from-yellow-500/80 to-yellow-400/80',
  alerta: 'from-orange-500/85 to-orange-400/85',
  inundacao: 'from-red-600/85 to-red-500/85',
};

const clampPct = (v: number) => Math.min(100, Math.max(0, ((v - FLOOR) / SPAN) * 100));

export default function AlertLevelBar({ level, trend }: Props) {
  const status: Status | null = level != null ? statusFor(level) : null;
  const pct = level != null ? clampPct(level) : null;
  const rising = trend != null && trend > 0.3;
  const falling = trend != null && trend < -0.3;

  return (
    <section
      aria-label="Níveis de alerta do Rio dos Sinos em Campo Bom"
      className="overflow-hidden rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 backdrop-blur"
    >
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <Waves className="h-4 w-4 text-sky-400" />
          Níveis de alerta · cotas oficiais (SGB/ANA)
        </div>
        {level != null && status && (
          <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${STATUS_META[status].bg} ${STATUS_META[status].ring} ${STATUS_META[status].text}`}>
            <span className={`h-2 w-2 rounded-full ${STATUS_META[status].dot} ${status !== 'normal' ? 'animate-pulse' : ''}`} />
            Agora: {fmt(level)} m — {STATUS_META[status].label}
            {rising && <span className="text-slate-300/80">· subindo</span>}
            {falling && <span className="text-slate-300/80">· baixando</span>}
          </div>
        )}
      </div>

      <div className="px-4 pb-3 pt-4 sm:px-5">
        {/* Barra segmentada */}
        <div className="relative">
          <div className="flex h-9 w-full overflow-hidden rounded-lg ring-1 ring-white/10 sm:h-10">
            {BANDS.map((b) => {
              const width = ((b.to - b.from) / SPAN) * 100;
              const active = status === b.status;
              return (
                <div
                  key={b.status}
                  style={{ width: `${width}%` }}
                  className={`relative flex items-center justify-center bg-gradient-to-r ${SOLID[b.status]} transition-opacity ${
                    status && !active ? 'opacity-45' : 'opacity-100'
                  }`}
                >
                  <span className="truncate px-2 text-[11px] font-bold uppercase tracking-wide text-slate-950 drop-shadow-sm sm:text-xs">
                    {STATUS_META[b.status].label}
                  </span>
                  {active && <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/70" />}
                </div>
              );
            })}
          </div>

          {/* Marcador do nível atual */}
          {pct != null && status && (
            <div
              className="pointer-events-none absolute -top-2 -bottom-2 z-10 -translate-x-1/2 transition-[left] duration-700"
              style={{ left: `${pct}%` }}
              title={`Nível atual: ${fmt(level!)} m`}
            >
              <div className="h-full w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
              <div className="absolute -top-1.5 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-white" />
            </div>
          )}
        </div>

        {/* Ticks das cotas */}
        <div className="relative mt-1.5 h-8 text-[10px] tabular-nums text-slate-400 sm:text-[11px]">
          {[COTAS.atencao, COTAS.alerta, COTAS.inundacao].map((c) => (
            <div key={c} className="absolute -translate-x-1/2 text-center" style={{ left: `${clampPct(c)}%` }}>
              <div className="mx-auto h-1.5 w-px bg-slate-500" />
              <div className="font-semibold text-slate-300">{fmt(c)} m</div>
            </div>
          ))}
          <div className="absolute right-0 text-right">
            <div className="ml-auto h-1.5 w-px bg-slate-500" />
            <div className="text-slate-400">
              <span className="font-semibold text-red-300">{fmt(CEIL)} m</span>
              <span className="hidden sm:inline"> · recorde 2024</span>
            </div>
          </div>
        </div>

        {/* Legenda */}
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          {BANDS.map((b) => {
            const m = STATUS_META[b.status];
            const active = status === b.status;
            return (
              <div
                key={b.status}
                className={`flex items-start gap-2 rounded-lg px-2 py-1 ${active ? `${m.bg} ring-1 ${m.ring}` : ''}`}
              >
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${m.dot}`} />
                <div className="min-w-0 leading-tight">
                  <div className={`text-xs font-semibold ${m.text}`}>
                    {m.label} <span className="font-normal text-slate-400">{b.range}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">{b.hint}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
