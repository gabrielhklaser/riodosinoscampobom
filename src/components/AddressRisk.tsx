import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, MapPinned, Phone, Search, ShieldAlert, X } from 'lucide-react';
import { search, type GeoHit } from '../lib/geocode';
import { classifyRisk, type FloodSet } from '../lib/flood';
import { COTAS } from '../lib/ana';
import { DEFESA_CIVIL } from './FloodAlertModal';

export interface AddressPoint extends GeoHit {
  /** dentro da mancha de 2024 */
  inFlood: boolean;
  /** distância até a borda, em metros */
  distanceM: number | null;
}

interface Props {
  flood: FloodSet | null;
  /** nível atual do rio em Campo Bom (m) */
  level: number | null;
  onSelect: (p: AddressPoint | null) => void;
  selected: AddressPoint | null;
  /** reabre o pop-up de alerta */
  onShowAlert?: () => void;
}

const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const n2 = (v: number) => v.toFixed(2).replace('.', ',');

const PRECISION_LABEL: Record<GeoHit['precision'], string> = {
  exata: 'endereço exato',
  via: 'via/rua (ponto médio)',
  aproximada: 'aproximado',
};

export default function AddressRisk({ flood, level, onSelect, selected, onShowAlert }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<number | null>(null);

  /** o alerta de risco só é emitido com o rio na zona de alerta */
  const alertActive = level != null && level >= COTAS.alerta;

  const run = useCallback(
    async (text: string) => {
      if (text.trim().length < 3) {
        setHits([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const r = await search(text);
        setHits(r);
        setOpen(true);
        if (!r.length) setErr('Nenhum endereço encontrado. Tente incluir o número e o bairro.');
      } catch {
        setErr('Não foi possível consultar o serviço de endereços agora.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // busca com debounce
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (q.trim().length < 3) {
      setHits([]);
      setOpen(false);
      return;
    }
    debounce.current = window.setTimeout(() => run(q), 550);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [q, run]);

  // fecha a lista ao clicar fora
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (h: GeoHit) => {
    const v = classifyRisk(h.lat, h.lon, 0, flood);
    onSelect({
      ...h,
      inFlood: v.level === 'dentro',
      distanceM: v.distanceM,
    });
    setQ(h.short);
    setOpen(false);
    setHits([]);
  };

  const clear = () => {
    onSelect(null);
    setQ('');
    setHits([]);
    setErr(null);
  };

  /* ---------------- veredito ---------------- */

  const inFlood = selected?.inFlood ?? false;
  const danger = inFlood && alertActive;

  const tone = danger
    ? { border: 'border-red-500/40', bg: 'bg-red-500/10', icon: 'bg-red-500/15 text-red-300' }
    : inFlood
      ? { border: 'border-sky-500/30', bg: 'bg-sky-500/10', icon: 'bg-sky-500/15 text-sky-300' }
      : selected
        ? { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', icon: 'bg-emerald-500/15 text-emerald-300' }
        : { border: 'border-slate-700', bg: 'bg-slate-900/60', icon: 'bg-slate-800 text-slate-400' };

  return (
    <div className={`mb-4 rounded-xl border p-4 ${tone.border} ${tone.bg}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {/* -------- busca -------- */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`mt-0.5 shrink-0 rounded-lg p-2 ${tone.icon}`}>
            {danger ? <ShieldAlert className="h-5 w-5" /> : <MapPinned className="h-5 w-5" />}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-100">
              Consulte um endereço para saber se você se encontra em área de risco de alagamentos,
              segundo a mancha da última grande enchente de 2024.
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Digite rua e número (ou CEP) para verificar a classificação de risco do local.
            </p>

            <div ref={boxRef} className="relative mt-3 max-w-xl">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => hits.length && setOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') run(q);
                    if (e.key === 'Escape') setOpen(false);
                  }}
                  placeholder="Ex.: Av. Independência, 800 — Campo Bom  ·  ou 93700-000"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/70 py-2.5 pl-9 pr-20 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  {loading && <Loader2 className="h-4 w-4 animate-spin text-sky-400" />}
                  {(q || selected) && !loading && (
                    <button
                      onClick={clear}
                      className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
                      title="Limpar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => run(q)}
                    disabled={q.trim().length < 3 || loading}
                    className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
                  >
                    Buscar
                  </button>
                </div>
              </div>

              {/* sugestões */}
              {open && hits.length > 0 && (
                <ul className="absolute z-[1000] mt-1.5 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        onClick={() => choose(h)}
                        className="flex w-full items-start gap-2.5 border-b border-slate-800 px-3 py-2.5 text-left transition last:border-0 hover:bg-slate-800"
                      >
                        <MapPinned className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-slate-200">{h.short}</span>
                          <span className="block truncate text-[10px] text-slate-500">
                            {h.city ? `${h.city} · ` : ''}
                            {PRECISION_LABEL[h.precision]}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {err && !loading && <p className="mt-1.5 text-[11px] text-amber-300">{err}</p>}
            </div>
          </div>
        </div>

        {/* -------- veredito -------- */}
        {selected && (
          <div className="w-full shrink-0 lg:w-[335px]">
            <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3">
              <p className="truncate text-[11px] text-slate-400" title={selected.label}>
                {selected.label || selected.short}
              </p>

              {danger ? (
                <>
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-red-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Cuidado: endereço em área de risco
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-red-200/90">
                    O Rio dos Sinos está em <strong>{n2(level!)} m</strong>, acima da cota de alerta de{' '}
                    {n2(COTAS.alerta)} m, e este endereço está{' '}
                    <strong>dentro da mancha da grande inundação de 2024</strong>. Procure abrigo seguro.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a
                      href={`tel:${DEFESA_CIVIL.tel}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-500"
                    >
                      <Phone className="h-3 w-3" />
                      Defesa Civil {DEFESA_CIVIL.telefone}
                    </a>
                    {onShowAlert && (
                      <button
                        onClick={onShowAlert}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 px-2.5 py-1.5 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/15"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Ver alerta
                      </button>
                    )}
                  </div>
                </>
              ) : inFlood ? (
                <>
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-sky-300">
                    <Check className="h-4 w-4 shrink-0" />
                    Sem alerta no momento
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-sky-200/90">
                    Este endereço fica dentro da mancha de 2024, mas o rio está em{' '}
                    <strong>{level != null ? `${n2(level)} m` : '—'}</strong>, abaixo da cota de alerta de{' '}
                    {n2(COTAS.alerta)} m. Nenhuma ação é necessária agora — o alerta aparece
                    automaticamente se o nível subir.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-emerald-300">
                    <Check className="h-4 w-4 shrink-0" />
                    Fora da mancha de 2024
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-200/90">
                    {selected.distanceM != null
                      ? `A borda da área atingida está a ${
                          selected.distanceM >= 1000
                            ? `${n1(selected.distanceM / 1000)} km`
                            : `${Math.round(selected.distanceM)} m`
                        } deste ponto.`
                      : 'Este ponto não está na área atingida em 2024.'}{' '}
                    Cheias futuras podem superar o registro histórico.
                  </p>
                </>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
                <span>{PRECISION_LABEL[selected.precision]}</span>
                <span className="text-slate-700">•</span>
                <span>
                  {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
