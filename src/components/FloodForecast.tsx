import { useEffect, useMemo, useState } from 'react';
import {
  GeoJSON,
  LayerGroup,
  LayersControl,
  MapContainer,
  Rectangle,
  TileLayer,
  Tooltip,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  Beaker,
  CloudRain,
  Droplets,
  Layers as LayersIcon,
  Mountain,
  RefreshCw,
  TrendingUp,
  Waves,
} from 'lucide-react';
import {
  buildScenario,
  calibrate,
  DEM_PREFERRED,
  DEM_SOURCES,
  type DemQuality,
  DEPTH_SCALE,
  depthColor,
  fitRating,
  HYDRO,
  loadTerrain,
  simulate,
  T_BASE_H,
  validate2024,
  EVENT_2024,
  type Datum,
  type TerrainGrid,
} from '../lib/floodModel';
import { COTAS, type Reading } from '../lib/ana';
import { BASIN_GEOJSON } from '../lib/basin';
import type { FloodSet } from '../lib/flood';

interface Props {
  readings: Reading[];
  level: number | null;
  /** chuva média observada da bacia nas últimas 24 h */
  basinRain24: number | null;
  /** chuva média das estações a montante — 24 h, 48 h e 5 dias antecedentes */
  modelRain: { r24: number; r48: number; antecedent: number; stations: number } | null;
  flood: FloodSet | null;
}

const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const n2 = (v: number) => v.toFixed(2).replace('.', ',');
const n0 = (v: number) => Math.round(v).toLocaleString('pt-BR');

const PRESETS = [
  { label: 'Observado 24 h', key: 'obs' },
  { label: '50 mm', key: '50', mm: 50 },
  { label: '100 mm', key: '100', mm: 100 },
  { label: '150 mm', key: '150', mm: 150 },
  { label: '250 mm (maio/24)', key: '250', mm: 250 },
];

export default function FloodForecast({ readings, level, basinRain24, modelRain, flood }: Props) {
  const [windowH, setWindowH] = useState<24 | 48>(48);
  /** chuva observada na janela escolhida */
  const refRain = modelRain ? (windowH === 24 ? modelRain.r24 : modelRain.r48) : basinRain24;
  const antecedent = modelRain?.antecedent ?? 0;

  const [terrain, setTerrain] = useState<TerrainGrid | null>(null);
  const [datum, setDatum] = useState<Datum | null>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rain, setRain] = useState<number>(100);
  const [started, setStarted] = useState(false);
  const [quality, setQuality] = useState<DemQuality>('detalhado');

  // curva-chave ajustada com os dados reais da ANA
  const rating = useMemo(() => fitRating(readings), [readings]);

  const start = (q: DemQuality = quality) => {
    if (loading) return;
    setQuality(q);
    setStarted(true);
    setLoading(true);
    setErr(null);
    setProgress(0);
    loadTerrain(q, setProgress)
      .then((g) => {
        setTerrain(g);
        setDatum(calibrate(g));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'falha ao carregar o terreno'))
      .finally(() => setLoading(false));
  };

  // usa a chuva observada como valor inicial, se houver
  useEffect(() => {
    if (refRain != null && refRain > 0 && !started) setRain(Math.max(20, Math.round(refRain)));
  }, [refRain, started]);

  const scenario = useMemo(() => {
    if (!rating || level == null) return null;
    const flow = readings.length ? readings[readings.length - 1].flow : null;
    return buildScenario(rain, windowH, antecedent, level, flow, rating);
  }, [rain, windowH, antecedent, level, readings, rating]);

  /** conferência: o modelo reproduz o pico observado de 2024? */
  const check = useMemo(() => (rating ? validate2024(rating) : null), [rating]);

  const sim = useMemo(() => {
    if (!terrain || !datum || !scenario) return null;
    return simulate(terrain, scenario.stage, datum);
  }, [terrain, datum, scenario]);

  /** células alagadas → retângulos para o Leaflet */
  const cells = useMemo(() => {
    if (!sim || !terrain) return [];
    const out: { b: [[number, number], [number, number]]; d: number }[] = [];
    for (let r = 0; r < sim.rows; r++) {
      for (let c = 0; c < sim.cols; c++) {
        const d = sim.depth[r * sim.cols + c];
        if (d <= 0.05) continue;
        const lat = terrain.lat0 + r * terrain.dLat;
        const lon = terrain.lon0 + c * terrain.dLon;
        out.push({
          b: [
            [lat - terrain.dLat / 2, lon - terrain.dLon / 2],
            [lat + terrain.dLat / 2, lon + terrain.dLon / 2],
          ],
          d,
        });
      }
    }
    return out;
  }, [sim, terrain]);

  const exceeds = scenario && scenario.stage >= COTAS.inundacao;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/20 ring-1 ring-white/5 backdrop-blur">
      {/* cabeçalho */}
      <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-white">
            <Waves className="h-4 w-4 text-violet-400" />
            Modelagem de cenário de alagamento
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300 ring-1 ring-violet-400/30">
              <Beaker className="h-3 w-3" /> Experimental
            </span>
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Converte a chuva de <strong className="text-slate-300">Campo Bom e Sapiranga</strong> em vazão, cota e
            mancha simulada — restrita ao município de Campo Bom
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-slate-800/80 px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10">
          <Mountain className="h-3.5 w-3.5 text-emerald-400" />
          MDE ativo: {terrain ? `${terrain.source} · ${terrain.resolution} m` : 'aguardando carga'}
        </span>
      </div>

      {/* aviso */}
      <div className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 sm:mx-6">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-100">
          <strong className="font-bold">Solução provisória, de cunho de teste.</strong> Esta modelagem usa um
          método simplificado (SCS-CN + curva-chave + comparação com o relevo). Não substitui modelagem
          hidrodinâmica (HEC-RAS/MGB-IPH) nem os alertas oficiais da Defesa Civil. Os resultados servem apenas
          para avaliação técnica preliminar e podem divergir significativamente da realidade.
        </p>
      </div>

      <div className="px-5 py-5 sm:px-6">
        {!started ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-5 py-9 text-center">
            <Mountain className="h-8 w-8 text-slate-600" />
            <p className="max-w-lg text-sm text-slate-400">
              A simulação amostra o terreno do <strong className="text-slate-300">município de Campo Bom</strong>.
              O download é feito uma única vez e fica em cache no navegador.
            </p>

            <div className="grid w-full max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                onClick={() => start('detalhado')}
                className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-3.5 text-left transition hover:bg-violet-500/20"
              >
                <p className="flex items-center gap-1.5 text-sm font-bold text-violet-200">
                  <Mountain className="h-4 w-4" /> Detalhado
                  <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[9px] uppercase">recomendado</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  SRTM 30 m · 4.704 pontos · célula ~92 m
                  <br />
                  <span className="text-slate-500">leva cerca de 1 minuto</span>
                </p>
              </button>

              <button
                onClick={() => start('rapido')}
                className="rounded-xl border border-slate-700 bg-slate-900/60 p-3.5 text-left transition hover:bg-slate-800"
              >
                <p className="flex items-center gap-1.5 text-sm font-bold text-slate-200">
                  <RefreshCw className="h-4 w-4" /> Rápido
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Copernicus 90 m · 1.380 pontos · célula ~193 m
                  <br />
                  <span className="text-slate-500">poucos segundos</span>
                </p>
              </button>
            </div>

            <p className="max-w-lg text-[10px] leading-relaxed text-slate-500">
              A base <strong className="text-slate-400">preferencial</strong> seria o{' '}
              <strong className="text-slate-400">MDT Multiescalas do RS</strong> ({DEM_PREFERRED.provider}). Foi
              testado: o arquivo publicado é o <span className="font-mono">dem_me_rs_20m.tif</span>, reamostrado a{' '}
              <strong className="text-slate-400">20 m</strong> — a componente RF1 de 2,5 m não é distribuída
              isoladamente. É um raster estadual da ordem de gigabytes, em Albers, sem serviço de consulta pontual e
              com o servidor recusando acesso externo. Como 20 m e 30 m são resoluções próximas, o SRTM entrega
              precisão equivalente com carga instantânea. A malha fica em cache e só é baixada uma vez.
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <RefreshCw className="h-7 w-7 animate-spin text-violet-400" />
            <p className="text-sm text-slate-400">
              Amostrando o {quality === 'detalhado' ? 'SRTM 30 m' : 'Copernicus 90 m'}…
            </p>
            <div className="h-1.5 w-64 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-violet-500 transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              {Math.round(progress * 100)}%
              {quality === 'detalhado' && progress < 1 && (
                <span className="ml-1 text-slate-600">
                  · ~{Math.max(1, Math.ceil((1 - progress) * 50))} s restantes
                </span>
              )}
            </p>
          </div>
        ) : err ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-200">Não foi possível montar a malha de elevação: {err}</p>
            <button
              onClick={() => {
                setErr(null);
                setStarted(false);
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-red-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </button>
          </div>
        ) : (
          <>
            {/* controles */}
            {/* validação contra o evento de 2024 */}
            {check && (
              <div
                className={`mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3.5 py-2.5 text-[11px] ${
                  Math.abs(check.errorM) <= 0.15
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                }`}
              >
                <span className="font-bold">
                  {Math.abs(check.errorM) <= 0.15 ? '✓ Calibrado' : '⚠ Aferição'} — cheia de {EVENT_2024.date}
                </span>
                <span>
                  observado <strong>{n2(check.observedStage)} m</strong> ({n0(check.observedQ)} m³/s)
                </span>
                <span>
                  simulado <strong>{n2(check.simulatedStage)} m</strong> ({n0(check.simulatedQ)} m³/s)
                </span>
                <span className="opacity-80">
                  erro {check.errorM >= 0 ? '+' : ''}
                  {n2(check.errorM)} m
                </span>
              </div>
            )}

            {/* janela de acumulação */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Janela de acumulação
              </span>
              <div className="inline-flex rounded-lg bg-slate-800/80 p-1 ring-1 ring-white/5">
                {([24, 48] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => {
                      setWindowH(w);
                      const v = modelRain ? (w === 24 ? modelRain.r24 : modelRain.r48) : null;
                      if (v != null) setRain(Math.max(0, Math.round(v)));
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      windowH === w ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {w} horas
                  </button>
                ))}
              </div>
              {modelRain && (
                <span className="text-[11px] text-slate-500">
                  observado: <strong className="text-sky-300">{n1(modelRain.r24)} mm</strong> em 24 h ·{' '}
                  <strong className="text-sky-300">{n1(modelRain.r48)} mm</strong> em 48 h ·{' '}
                  {modelRain.stations} estações
                </span>
              )}
            </div>

            <div className="mb-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Chuva de projeto em {windowH} h — estações a montante
                </label>
                <span className="text-2xl font-bold tabular-nums text-sky-300">{n0(rain)} mm</span>
              </div>
              <input
                type="range"
                min={0}
                max={300}
                step={5}
                value={rain}
                onChange={(e) => setRain(+e.target.value)}
                className="mt-2 w-full accent-violet-500"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const v = p.key === 'obs' ? Math.round(refRain ?? 0) : p.mm!;
                  return (
                    <button
                      key={p.key}
                      onClick={() => setRain(v)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                        rain === v
                          ? 'bg-violet-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                      {p.key === 'obs' && refRain != null && ` (${n1(refRain)} mm)`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* cadeia de cálculo */}
            {scenario && (
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Step
                  icon={<CloudRain className="h-4 w-4" />}
                  label="Escoamento (SCS-CN)"
                  value={n1(scenario.runoffMm)}
                  unit="mm"
                  hint={`CN ${HYDRO.curveNumber} · ${n0(HYDRO.areaKm2)} km²`}
                  tint="text-sky-300 bg-sky-500/10 ring-sky-400/20"
                />
                <Step
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Vazão de pico"
                  value={n0(scenario.totalQ)}
                  unit="m³/s"
                  hint={`base ${n0(scenario.baseQ)} + ${n0(scenario.peakQ)}`}
                  tint="text-cyan-300 bg-cyan-500/10 ring-cyan-400/20"
                />
                <Step
                  icon={<Waves className="h-4 w-4" />}
                  label="Cota prevista"
                  value={n2(scenario.stage)}
                  unit="m"
                  hint={`atual ${n2(scenario.currentStage)} m · pico em ~${Math.round(scenario.etaHours)} h`}
                  tint={
                    exceeds
                      ? 'text-red-300 bg-red-500/10 ring-red-400/20'
                      : 'text-amber-300 bg-amber-500/10 ring-amber-400/20'
                  }
                />
                <Step
                  icon={<Droplets className="h-4 w-4" />}
                  label="Área alagada"
                  value={sim ? n1(sim.areaKm2) : '—'}
                  unit="km²"
                  hint={sim ? `lâmina máx. ${n1(sim.maxDepth)} m` : undefined}
                  tint="text-violet-300 bg-violet-500/10 ring-violet-400/20"
                />
              </div>
            )}

            {exceeds && (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  O cenário simulado ultrapassa a cota de inundação ({n2(COTAS.inundacao)} m) em{' '}
                  <strong>{n2(scenario!.stage - COTAS.inundacao)} m</strong>.
                </span>
              </div>
            )}

            {/* mapa */}
            <div className="h-[400px] w-full overflow-hidden rounded-xl border border-slate-700/70 sm:h-[480px]">
              {terrain && (
                <MapContainer
                  bounds={[
                    [terrain.lat0, terrain.lon0],
                    [terrain.lat0 + terrain.dLat * terrain.rows, terrain.lon0 + terrain.dLon * terrain.cols],
                  ]}
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%', background: '#0f172a' }}
                >
                  <LayersControl position="topright">
                    <LayersControl.BaseLayer checked name="Google Streets">
                      <TileLayer url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}" maxZoom={20} attribution="&copy; Google" />
                    </LayersControl.BaseLayer>
                    <LayersControl.BaseLayer name="Google Híbrido">
                      <TileLayer url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}" maxZoom={20} attribution="&copy; Google" />
                    </LayersControl.BaseLayer>

                    <LayersControl.Overlay checked name="🌊 Mancha simulada">
                      <LayerGroup>
                        {cells.map((c, i) => (
                          <Rectangle
                            key={i}
                            bounds={c.b}
                            pathOptions={{
                              color: depthColor(c.d),
                              weight: 0,
                              fillColor: depthColor(c.d),
                              fillOpacity: 0.62,
                            }}
                          >
                            <Tooltip sticky>
                              <span className="text-[11px] font-semibold">Lâmina ~{n1(c.d)} m</span>
                            </Tooltip>
                          </Rectangle>
                        ))}
                      </LayerGroup>
                    </LayersControl.Overlay>

                    {flood?.layers.map((fl) => (
                      <LayersControl.Overlay key={fl.meta.key} name={`Referência: ${fl.meta.short}`}>
                        <GeoJSON
                          data={fl.geojson as any}
                          style={{ color: '#f97316', weight: 2, fillOpacity: 0.05, dashArray: '5 4' }}
                        />
                      </LayersControl.Overlay>
                    ))}

                    <LayersControl.Overlay name="Limite da bacia">
                      <GeoJSON
                        data={BASIN_GEOJSON as any}
                        style={{ color: '#38bdf8', weight: 1.5, fillOpacity: 0.03, dashArray: '6 5' }}
                      />
                    </LayersControl.Overlay>
                  </LayersControl>
                </MapContainer>
              )}
            </div>

            {/* legenda */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
              <span className="font-semibold text-slate-300">Lâmina d'água simulada:</span>
              {DEPTH_SCALE.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-5 border-t-2 border-dashed border-orange-500" />
                Mancha observada 2024 (referência)
              </span>
            </div>

            {/* ficha técnica */}
            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-800 pt-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <Mountain className="h-3.5 w-3.5" /> Base topográfica
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-[11px]">
                    <thead className="text-left uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="pb-1.5 font-semibold">Fonte</th>
                        <th className="pb-1.5 text-right font-semibold">Horiz.</th>
                        <th className="pb-1.5 text-right font-semibold">Vert.</th>
                        <th className="pb-1.5 text-right font-semibold">Uso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {DEM_SOURCES.map((d) => {
                        const inUse = terrain?.source === d.name;
                        const preferred = d.priority === 1;
                        return (
                          <tr
                            key={d.id}
                            className={
                              inUse ? 'text-emerald-300' : preferred ? 'text-violet-300' : 'text-slate-400'
                            }
                          >
                            <td className="py-1.5 pr-2">
                              <span className="mr-1 text-slate-600">{d.priority}.</span>
                              {d.name}
                              <span className="block text-[10px] text-slate-600">{d.provider}</span>
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{d.resolution} m</td>
                            <td className="py-1.5 text-right tabular-nums">{d.vertical}</td>
                            <td className="py-1.5 text-right">
                              {inUse ? (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold">
                                  em uso
                                </span>
                              ) : preferred ? (
                                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-semibold">
                                  preferencial
                                </span>
                              ) : d.live ? (
                                <span className="text-slate-500">disponível</span>
                              ) : (
                                <span className="text-slate-600">indisponível</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  Malha ativa: {terrain?.cols}×{terrain?.rows} células de ~{terrain?.cellM} m, amostradas do{' '}
                  <strong className="text-slate-400">{terrain?.source}</strong> e{' '}
                  <strong className="text-emerald-300">gravadas em cache no navegador</strong> — o download ocorre
                  uma única vez por dispositivo.
                  <br />
                  <span className="mt-1 block">
                    Sobre o{' '}
                    <a
                      href={DEM_PREFERRED.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      MDT Multiescalas do RS
                    </a>
                    : a hipótese de baixar o GeoTIFF e pré-extrair a tabela de elevações foi{' '}
                    <strong className="text-slate-400">testada e descartada</strong> — o arquivo publicado é
                    estadual, tem 20 m (e não os 2,5 m da componente RF1, que não é distribuída à parte), ocupa
                    gigabytes e o servidor do SNIRH recusa acesso externo (HTTP 403). O ganho sobre o SRTM de 30 m
                    seria marginal. A hierarquia de fontes permanece pronta: havendo um recorte municipal em
                    GeoTIFF ou um WCS, basta registrá-lo no topo que o modelo passa a usá-lo.
                  </span>
                </p>
                {quality === 'rapido' && (
                  <button
                    onClick={() => {
                      setTerrain(null);
                      setDatum(null);
                      start('detalhado');
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-violet-400/30 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300 transition hover:bg-violet-500/20"
                  >
                    <Mountain className="h-3 w-3" />
                    Refinar para SRTM 30 m
                  </button>
                )}
              </div>

              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <LayersIcon className="h-3.5 w-3.5" /> Parâmetros e calibração
                </p>
                <dl className="space-y-1.5 text-[11px]">
                  <Row k="Área de drenagem (ANA)" v={`${n0(HYDRO.areaKm2)} km²`} />
                  <Row
                    k="Curve Number (SCS)"
                    v={scenario ? `${scenario.cnUsed.toFixed(0)} (AMC ${scenario.amc})` : `${HYDRO.curveNumber}`}
                  />
                  <Row k="Chuva antecedente 5 d" v={`${n1(antecedent)} mm`} />
                  <Row k="Tempo de base calibrado" v={`${Math.round(T_BASE_H)} h`} />
                  <Row
                    k="Curva-chave Q = a·(H−h₀)^b"
                    v={rating ? `a=${rating.a.toFixed(1)} b=${rating.b.toFixed(2)} h₀=${n2(rating.h0)}` : '—'}
                  />
                  <Row k="Pares (H,Q) no ajuste" v={rating ? `${rating.n} leituras da ANA` : '—'} />
                  <Row
                    k="Datum calibrado (2024)"
                    v={datum && Number.isFinite(datum.wse2024) ? `${n1(datum.wse2024)} m ≙ régua ${n2(HYDRO.peak2024)} m` : '—'}
                  />
                  <Row k="Células da malha" v={`${terrain ? terrain.cols * terrain.rows : 0} (${terrain?.cellM} m)`} />
                </dl>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                  <strong className="text-slate-400">Calibração:</strong> toda a cadeia é ancorada na cheia de{' '}
                  {EVENT_2024.date}, cujos valores reais vêm da telemetria da ANA — pico de{' '}
                  {n2(EVENT_2024.peakStage)} m com {n0(EVENT_2024.peakQ)} m³/s, sobre base de{' '}
                  {n0(EVENT_2024.baseQ)} m³/s. A curva-chave usa os pares (H,Q) observados entre 5,85 m e o pico,
                  faixa que a série ao vivo não alcança. O coeficiente de pico foi obtido do próprio evento, o
                  que corrige a superestimativa do hidrograma triangular clássico: para uma bacia de 2.900 km²
                  com 190 km de curso e forte amortecimento de planície, o tempo de base real é de{' '}
                  {Math.round(T_BASE_H)} h — e não as ~22 h que a fórmula original assumia. O datum do MDE é
                  amarrado à borda da mancha observada de 2024.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Step({
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
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-lg p-1.5 ring-1 ${tint}`}>{icon}</span>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      </div>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="text-xl font-bold tabular-nums text-slate-100">{value}</span>
        <span className="text-[11px] text-slate-500">{unit}</span>
      </p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-slate-800 pb-1 last:border-0">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-300">{v}</dd>
    </div>
  );
}
