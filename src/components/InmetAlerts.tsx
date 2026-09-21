import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, CloudLightning, Info } from 'lucide-react';
import {
  fetchInmetAlerts,
  fmtInmetHora,
  type InmetAviso,
  type InmetResult,
  type InmetSeveridade,
} from '../lib/inmet';

/**
 * Banner de avisos meteorológicos do INMET — topo do painel.
 *
 * Cores na convenção oficial INMET/Defesa Civil:
 *   amarelo  #F59E0B — Perigo Potencial
 *   laranja  #EA580C — Perigo
 *   vermelho #DC2626 — Grande Perigo
 *
 * Sem avisos → badge neutro discreto. INMET fora do ar → a lista vem do
 * último estado válido (flag `fallback`), com aviso de que não foi possível
 * atualizar — o painel nunca quebra por causa da INMET.
 */
const META: Record<
  InmetSeveridade,
  { label: string; card: string; acento: string; badge: string }
> = {
  amarelo: {
    label: 'Perigo Potencial',
    card: 'border-[#F59E0B]/30 bg-[#F59E0B]/[0.07]',
    acento: 'border-l-[#F59E0B]',
    badge: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/40',
  },
  laranja: {
    label: 'Perigo',
    card: 'border-[#EA580C]/40 bg-[#EA580C]/[0.08]',
    acento: 'border-l-[#EA580C]',
    badge: 'bg-[#EA580C]/15 text-[#EA580C] border-[#EA580C]/40',
  },
  vermelho: {
    label: 'Grande Perigo',
    card: 'border-[#DC2626]/50 bg-[#DC2626]/[0.10]',
    acento: 'border-l-[#DC2626]',
    badge: 'bg-[#DC2626]/20 text-[#DC2626] border-[#DC2626]/50',
  },
};

const POLL_MS = 10 * 60 * 1000; // alinhado ao cache de 12 min do backend

function CardAviso({ a }: { a: InmetAviso }) {
  const [aberto, setAberto] = useState(false);
  const m = META[a.severidade];
  const temMais = a.riscos.length > 1 || a.instrucoes.length > 0;
  return (
    <article className={`rounded-xl border border-l-4 p-4 ${m.card} ${m.acento}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <CloudLightning className="h-4 w-4 text-slate-400" aria-hidden />
        <span className={`rounded border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${m.badge}`}>
          {m.label}
        </span>
        <span className="text-sm font-semibold text-slate-100">{a.tipo}</span>
        {a.periodo === 'futuro' && (
          <span className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
            inicia depois
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-slate-400">
          Início: {fmtInmetHora(a.inicio)} | Fim: {fmtInmetHora(a.fim)}
        </span>
      </div>

      {a.riscos.length > 0 && (
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          {aberto ? a.riscos.join(' ') : `${a.riscos[0]}${a.riscos.length > 1 ? ' …' : ''}`}
        </p>
      )}

      {aberto && a.instrucoes.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Recomendações
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
            {a.instrucoes.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {temMais && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-200"
        >
          {aberto ? 'Recolher' : 'Ver detalhes'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberto ? 'rotate-180' : ''}`} />
        </button>
      )}
    </article>
  );
}

export default function InmetAlerts() {
  const [data, setData] = useState<InmetResult | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setData(await fetchInmetAlerts());
      setFalhou(false);
    } catch {
      // o backend sempre responde 200 (fallback interno); se ele mesmo
      // cair, o banner simplesmente fica neutro — o painel segue de pé
      setFalhou(true);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const id = setInterval(() => void carregar(), POLL_MS);
    return () => clearInterval(id);
  }, [carregar]);

  if (falhou && !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" aria-hidden />
        Avisos meteorológicos indisponíveis no momento.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-600">
        Consultando avisos meteorológicos (INMET)…
      </div>
    );
  }

  return (
    <section aria-label="Avisos meteorológicos INMET" className="space-y-2">
      {data.fallback && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-1.5 text-[11px] text-slate-400">
          <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Não foi possível atualizar o INMET agora — exibindo a última consulta válida
          {data.atualizadoEm ? ` (às ${fmtInmetHora(new Date(data.atualizadoEm).toISOString())})` : ''}.
        </div>
      )}

      {data.avisos.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" aria-hidden />
          Nenhum aviso meteorológico vigente para Campo Bom no momento.
        </div>
      ) : (
        data.avisos.map((a) => <CardAviso key={a.id} a={a} />)
      )}

      {!data.fallback && data.atualizadoEm && (
        <p className="px-1 text-[10px] text-slate-600">
          Fonte: {data.fonte} · atualizado às{' '}
          {fmtInmetHora(new Date(data.atualizadoEm).toISOString())}
        </p>
      )}
    </section>
  );
}
