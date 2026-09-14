import { COTAS, statusFor, STATUS_META } from '../lib/ana';

interface Props {
  level: number;
  scaleMax?: number;
}

export default function LevelGauge({ level, scaleMax = 9 }: Props) {
  const st = STATUS_META[statusFor(level)];
  const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));

  const marks = [
    { v: COTAS.atencao, label: 'Atenção', color: '#facc15' },
    { v: COTAS.alerta, label: 'Alerta', color: '#fb923c' },
    { v: COTAS.inundacao, label: 'Inundação', color: '#f87171' },
    { v: COTAS.recordeHistorico, label: 'Recorde 2024', color: '#a78bfa' },
  ];

  return (
    <div className="flex h-full gap-2.5">
      {/* valor flutuante — à ESQUERDA da régua, para não cobrir a legenda.
          `border-y border-transparent` iguala a caixa interna à da régua (que tem borda de 1px),
          e `translate-y-1/2` centra o rótulo exatamente na linha d'água. */}
      <div className="relative w-[74px] shrink-0 border-y border-transparent">
        <div
          className="absolute right-0 flex translate-y-1/2 items-center transition-all duration-1000"
          style={{ bottom: `${pct(level)}%` }}
        >
          <span
            className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-bold tabular-nums text-slate-950 shadow-lg"
            style={{ background: st.color, boxShadow: `0 0 16px ${st.color}66` }}
          >
            {level.toFixed(2)} m
          </span>
          {/* seta apontando para a régua */}
          <span
            className="ml-[-1px] h-0 w-0 border-y-[5px] border-l-[6px] border-y-transparent"
            style={{ borderLeftColor: st.color }}
          />
        </div>
      </div>

      {/* régua */}
      <div className="relative w-14 shrink-0 overflow-hidden rounded-xl border border-slate-700/70 bg-gradient-to-b from-slate-900 to-slate-800 shadow-inner">
        {/* água */}
        <div
          className="absolute inset-x-0 bottom-0 transition-all duration-1000 ease-out"
          style={{
            height: `${pct(level)}%`,
            background: `linear-gradient(180deg, ${st.color}dd 0%, ${st.color}44 100%)`,
            boxShadow: `0 0 24px ${st.color}55`,
          }}
        >
          <div className="absolute inset-x-0 top-0 h-1.5 animate-pulse" style={{ background: st.color }} />
        </div>

        {/* graduação a cada 1 m */}
        {Array.from({ length: scaleMax }, (_, i) => i + 1).map((m) => (
          <div key={m} className="absolute inset-x-0 flex items-center" style={{ bottom: `${pct(m)}%` }}>
            <div className="h-px w-2.5 bg-slate-500/70" />
            <span className="ml-1 text-[9px] font-medium tabular-nums text-slate-500">{m}</span>
          </div>
        ))}

        {/* cotas */}
        {marks.map((mk) => (
          <div
            key={mk.label}
            className="absolute inset-x-0 border-t border-dashed opacity-80"
            style={{ bottom: `${pct(mk.v)}%`, borderColor: mk.color }}
          />
        ))}
      </div>

      {/* legenda das cotas — livre, sem sobreposição */}
      <div className="relative min-w-0 flex-1 border-y border-transparent">
        {marks.map((mk) => (
          <div
            key={mk.label}
            className="absolute left-0 flex w-full translate-y-1/2 items-center gap-1.5"
            style={{ bottom: `${pct(mk.v)}%` }}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: mk.color }} />
            <span className="truncate text-[11px] font-medium text-slate-400">{mk.label}</span>
            <span className="ml-auto shrink-0 text-[11px] font-semibold tabular-nums text-slate-500">
              {mk.v.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
