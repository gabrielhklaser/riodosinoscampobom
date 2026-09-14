import { useEffect, useRef } from 'react';
import { AlertTriangle, Phone, ShieldAlert, X } from 'lucide-react';
import { COTAS } from '../lib/ana';

export const DEFESA_CIVIL = {
  nome: 'Defesa Civil de Campo Bom',
  telefone: '(51) 3597-3683',
  tel: '+555135973683',
};

interface Props {
  open: boolean;
  /** endereço consultado */
  address: string;
  /** nível atual do rio (m) */
  level: number;
  /** tendência em cm/h, se conhecida */
  trend: number | null;
  onClose: () => void;
}

const n2 = (v: number) => v.toFixed(2).replace('.', ',');
const n1 = (v: number) => v.toFixed(1).replace('.', ',');

export default function FloodAlertModal({ open, address, level, trend, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // trava o scroll do fundo, foca o modal e fecha no ESC
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const rising = trend != null && trend > 0.3;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alerta-titulo"
      aria-describedby="alerta-texto"
    >
      {/* fundo */}
      <div
        className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* card */}
      <div className="animate-[alertIn_.22s_ease-out] relative w-full max-w-lg overflow-hidden rounded-2xl border border-red-500/40 bg-slate-900 shadow-2xl shadow-red-950/50 ring-1 ring-red-500/20">
        {/* faixa pulsante */}
        <div className="h-1.5 w-full animate-pulse bg-gradient-to-r from-red-600 via-red-400 to-red-600" />

        <button
          ref={closeRef}
          onClick={onClose}
          className="absolute right-3 top-4 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          aria-label="Fechar alerta"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-6 pt-5">
          {/* cabeçalho */}
          <div className="flex items-start gap-3.5">
            <span className="relative flex shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-40" />
              <span className="relative rounded-full bg-red-500/15 p-3 ring-1 ring-red-500/40">
                <ShieldAlert className="h-7 w-7 text-red-400" />
              </span>
            </span>
            <div className="min-w-0 pr-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-red-400">
                Alerta de área de risco
              </p>
              <h2 id="alerta-titulo" className="mt-0.5 text-xl font-bold leading-tight text-white">
                Você está em uma área propensa a alagamentos
              </h2>
            </div>
          </div>

          {/* corpo */}
          <div id="alerta-texto" className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
            <p>
              Segundo a <strong className="text-white">mancha da grande inundação de 2024</strong>, o endereço
              consultado está dentro da área atingida — e, <strong className="text-white">neste momento</strong>, o
              Rio dos Sinos em Campo Bom encontra-se na zona de alerta.
            </p>

            {/* leitura atual */}
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3.5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-red-300/70">Nível atual</p>
                  <p className="text-2xl font-bold tabular-nums text-red-300">{n2(level)} m</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-red-300/70">Cota de alerta</p>
                  <p className="text-2xl font-bold tabular-nums text-red-200/70">{n2(COTAS.alerta)} m</p>
                </div>
                {trend != null && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-red-300/70">Tendência</p>
                    <p className={`text-2xl font-bold tabular-nums ${rising ? 'text-red-300' : 'text-amber-300'}`}>
                      {trend > 0 ? '+' : ''}
                      {n1(trend)} cm/h
                    </p>
                  </div>
                )}
              </div>
              {address && (
                <p className="mt-2.5 border-t border-red-500/20 pt-2.5 text-xs text-red-200/80">
                  <span className="font-semibold">Endereço:</span> {address}
                </p>
              )}
            </div>

            {/* orientação */}
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-100">
                <strong className="font-bold">Procure um abrigo seguro.</strong> Desloque-se para um local elevado,
                afaste-se da margem do rio e retire documentos e itens essenciais das áreas baixas.
              </p>
            </div>

            {/* contato */}
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3.5">
              <p className="text-xs text-slate-400">Em caso de dúvida, ligue para a {DEFESA_CIVIL.nome}:</p>
              <a
                href={`tel:${DEFESA_CIVIL.tel}`}
                className="mt-2 flex items-center justify-center gap-2.5 rounded-lg bg-emerald-600 px-4 py-3 text-lg font-bold text-white shadow-lg transition hover:bg-emerald-500"
              >
                <Phone className="h-5 w-5" />
                {DEFESA_CIVIL.telefone}
              </a>
            </div>
          </div>

          {/* ações */}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg bg-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-600"
            >
              Entendi
            </button>
            <a
              href="https://www.defesacivil.rs.gov.br/areas-de-risco-no-rs/"
              target="_blank"
              rel="noreferrer"
              className="flex-1 rounded-lg border border-slate-600 px-4 py-2.5 text-center text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
            >
              Orientações oficiais
            </a>
          </div>

          <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-500">
            Alerta gerado pelo cruzamento da telemetria da ANA (estação 87380000) com a mancha de inundação de 2024.
            Não substitui os comunicados oficiais da Defesa Civil. Emergência: 199 · Bombeiros: 193.
          </p>
        </div>
      </div>
    </div>
  );
}
