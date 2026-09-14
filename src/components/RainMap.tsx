import { useMemo } from 'react';
import {
  Circle,
  CircleMarker,
  GeoJSON,
  LayerGroup,
  LayersControl,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CENTER,
  distanceKm,
  RAIN_SCALE,
  rainColor,
  rainLabel,
  sumRain,
  type StationRain,
} from '../lib/rain';
import { BASIN_BOUNDS, BASIN_GEOJSON, BASIN_META } from '../lib/basin';
import { type FloodSet } from '../lib/flood';
import type { AddressPoint } from './AddressRisk';

interface Props {
  stations: StationRain[];
  /** janela temporal exibida (mesma do gráfico) */
  from: number;
  to: number;
  periodLabel: string;
  /** mancha de inundação de 2024 */
  flood: FloodSet | null;
  /** endereço consultado pelo usuário */
  address: AddressPoint | null;
  /** true quando o rio está na zona de alerta */
  alertActive: boolean;
}

const n1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Botões de enquadramento rápido, dentro do mapa. */
function ZoomButtons({
  floodBounds,
  address,
}: {
  floodBounds: FloodSet['bounds'];
  address: AddressPoint | null;
}) {
  const map = useMap();
  return (
    <div className="leaflet-top leaflet-left" style={{ marginTop: 70 }}>
      <div className="leaflet-control leaflet-bar" style={{ border: 'none', boxShadow: 'none' }}>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => map.fitBounds(BASIN_BOUNDS, { padding: [18, 18] })}
            className="rounded-md border border-slate-600 bg-slate-800/95 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 shadow-lg hover:bg-slate-700"
            title="Enquadrar toda a bacia"
          >
            Bacia
          </button>
          {floodBounds && (
            <button
              onClick={() => map.fitBounds(floodBounds, { padding: [26, 26] })}
              className="rounded-md border border-red-500/50 bg-red-950/90 px-2.5 py-1.5 text-[11px] font-semibold text-red-200 shadow-lg hover:bg-red-900"
              title="Aproximar na mancha de inundação de Campo Bom"
            >
              Inundação
            </button>
          )}
          {address && (
            <button
              onClick={() => map.flyTo([address.lat, address.lon], 16, { duration: 0.8 })}
              className="rounded-md border border-sky-500/50 bg-sky-950/90 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 shadow-lg hover:bg-sky-900"
              title="Centralizar no endereço consultado"
            >
              Endereço
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RainMap({ stations, from, to, periodLabel, flood, address, alertActive }: Props) {
  const danger = !!address?.inFlood && alertActive;
  const addrColor = danger ? '#dc2626' : address?.inFlood ? '#0ea5e9' : '#059669';
  const addrRing = danger ? '#f87171' : address?.inFlood ? '#38bdf8' : '#34d399';

  const points = useMemo(() => {
    return stations
      .map((s) => {
        const mm = s.ok ? sumRain(s.hourly, from, to) : null;
        return {
          station: s.station,
          mm,
          dist: distanceKm(CENTER.lat, CENTER.lon, s.station.lat, s.station.lon),
        };
      })
      .sort((a, b) => (b.mm ?? -1) - (a.mm ?? -1));
  }, [stations, from, to]);

  const withData = points.filter((p) => p.mm != null) as { station: any; mm: number; dist: number }[];
  const maxMm = withData.length ? Math.max(...withData.map((p) => p.mm)) : 0;
  const avgMm = withData.length ? withData.reduce((a, p) => a + p.mm, 0) / withData.length : 0;

  /** raio do marcador proporcional à chuva (px) — escala compacta p/ evitar sobreposição */
  const radiusFor = (mm: number) => {
    if (maxMm <= 0) return 2;
    return 2 + Math.sqrt(mm / maxMm) * 4;
  };

  return (
    <div className="relative isolate">
      <div className="h-[440px] w-full overflow-hidden rounded-xl border border-slate-700/70 sm:h-[520px]">
        <MapContainer
          bounds={BASIN_BOUNDS}
          boundsOptions={{ padding: [18, 18] }}
          scrollWheelZoom={false}
          style={{ height: '100%', width: '100%', background: '#0f172a' }}
        >
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Google Streets">
              <TileLayer
                url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
                attribution="&copy; Google Maps"
                maxZoom={20}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Google Híbrido (satélite)">
              <TileLayer
                url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                attribution="&copy; Google Maps"
                maxZoom={20}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Google Relevo">
              <TileLayer
                url="https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}"
                attribution="&copy; Google Maps"
                maxZoom={20}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="OpenStreetMap">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>

            {/* ---- Camadas de dados (extensível no futuro) ---- */}
            <LayersControl.Overlay checked name="Limite da Bacia do Rio dos Sinos">
              <GeoJSON
                data={BASIN_GEOJSON as any}
                style={{
                  color: '#38bdf8',
                  weight: 2.5,
                  opacity: 0.95,
                  fillColor: '#0ea5e9',
                  fillOpacity: 0.07,
                  dashArray: '7 5',
                }}
              />
            </LayersControl.Overlay>

            {/* Manchas de inundação — Campo Bom (KML/KMZ da Prefeitura) */}
            {flood?.layers.map((fl) => (
              <LayersControl.Overlay key={fl.meta.key} checked name={`🌊 ${fl.meta.short}`}>
                <GeoJSON
                  data={fl.geojson as any}
                  style={(feat) => {
                    const c = (feat?.properties as any)?.color || fl.meta.color;
                    return { color: c, weight: 1.6, opacity: 0.95, fillColor: c, fillOpacity: 0.32 };
                  }}
                  onEachFeature={(feat, layer) => {
                    const p = (feat.properties || {}) as any;
                    const nome = p.name || fl.meta.title;
                    const desc = (p.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    layer.bindPopup(
                      `<div style="min-width:190px">
                         <p style="font-weight:700;color:#0f172a;margin:0 0 2px">${nome}</p>
                         <p style="color:#b91c1c;font-weight:600;margin:0 0 4px;font-size:11px">
                           Área atingida — ${fl.meta.short}
                         </p>
                         ${desc ? `<p style="color:#475569;margin:0;font-size:11px">${desc.slice(0, 220)}</p>` : ''}
                         <p style="color:#94a3b8;margin:6px 0 0;font-size:10px">Fonte: ${fl.meta.source}</p>
                       </div>`
                    );
                    layer.bindTooltip(nome || fl.meta.short, { sticky: true });
                  }}
                />
              </LayersControl.Overlay>
            ))}

            {/* Endereço consultado */}
            {address && (
              <LayersControl.Overlay checked name="📍 Endereço consultado">
                <LayerGroup>
                  {danger && (
                    <Circle
                      center={[address.lat, address.lon]}
                      radius={140}
                      pathOptions={{
                        color: addrRing,
                        weight: 1.5,
                        dashArray: '5 5',
                        fillColor: addrColor,
                        fillOpacity: 0.18,
                      }}
                    />
                  )}
                  <CircleMarker
                    center={[address.lat, address.lon]}
                    radius={9}
                    pathOptions={{ color: '#ffffff', weight: 3, fillColor: addrColor, fillOpacity: 1 }}
                  >
                    <Tooltip direction="top" offset={[0, -10]} opacity={1} permanent>
                      <span className="text-[10px] font-bold">
                        {danger
                          ? '⚠ Endereço em área de risco'
                          : address.inFlood
                            ? 'Na mancha de 2024 (sem alerta)'
                            : '✓ Fora da mancha de 2024'}
                      </span>
                    </Tooltip>
                    <Popup>
                      <div className="min-w-[225px] text-[12px] leading-relaxed">
                        <p className="text-[13px] font-bold text-slate-900">Endereço consultado</p>
                        <p className="mt-0.5 text-slate-600">{address.short}</p>
                        <p
                          className="mt-1.5 rounded px-2 py-1 text-[11px] font-bold"
                          style={{
                            background: danger ? '#fee2e2' : address.inFlood ? '#e0f2fe' : '#d1fae5',
                            color: danger ? '#991b1b' : address.inFlood ? '#075985' : '#065f46',
                          }}
                        >
                          {danger
                            ? 'CUIDADO — rio em alerta e endereço na mancha de 2024'
                            : address.inFlood
                              ? 'Dentro da mancha de 2024 · rio abaixo da cota de alerta'
                              : 'Fora da mancha da inundação de 2024'}
                        </p>
                        {!address.inFlood && address.distanceM != null && (
                          <p className="mt-1.5 text-slate-700">
                            Borda da mancha: <strong>{Math.round(address.distanceM)} m</strong>
                          </p>
                        )}
                        <hr className="my-1.5 border-slate-200" />
                        <p className="text-slate-500">
                          {address.lat.toFixed(6)}, {address.lon.toFixed(6)}
                        </p>
                      </div>
                    </Popup>
                  </CircleMarker>
                </LayerGroup>
              </LayersControl.Overlay>
            )}
          </LayersControl>

          {/* halos de intensidade (leitura espacial da chuva) */}
          {withData.map((p) => (
            <Circle
              key={`halo-${p.station.id}`}
              center={[p.station.lat, p.station.lon]}
              radius={1200}
              pathOptions={{
                color: 'transparent',
                fillColor: rainColor(p.mm),
                fillOpacity: p.mm > 0 ? 0.16 + Math.min(0.3, (p.mm / Math.max(maxMm, 1)) * 0.3) : 0.05,
              }}
            />
          ))}

          {/* estações */}
          {points.map((p) => {
            const mm = p.mm ?? 0;
            const color = p.mm == null ? '#64748b' : rainColor(mm);
            return (
              <CircleMarker
                key={p.station.id}
                center={[p.station.lat, p.station.lon]}
                radius={p.mm == null ? 1.5 : radiusFor(mm)}
                pathOptions={{
                  color: '#0f172a',
                  weight: 0.75,
                  fillColor: color,
                  fillOpacity: 0.95,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                  <span className="text-[11px] font-semibold">
                    {p.station.name}: {p.mm != null ? `${n1(mm)} mm` : 'sem dado'}
                  </span>
                </Tooltip>
                <Popup>
                  <div className="min-w-[190px] text-[12px] leading-relaxed">
                    <p className="text-[13px] font-bold text-slate-900">{p.station.name}</p>
                    <p className="text-slate-600">
                      {p.station.city}/RS · {p.dist.toFixed(1)} km de Campo Bom
                    </p>
                    <hr className="my-1.5 border-slate-200" />
                    <p>
                      <strong>Chuva ({periodLabel}):</strong>{' '}
                      <span style={{ color: rainColor(mm), fontWeight: 700 }}>
                        {p.mm != null ? `${n1(mm)} mm` : '—'}
                      </span>
                      {p.mm != null && <span className="text-slate-500"> · {rainLabel(mm)}</span>}
                    </p>
                    <p className="text-slate-600">
                      <strong>Código ANA:</strong> {p.station.anaCode}
                    </p>
                    <p className="text-slate-600">
                      <strong>Operador:</strong> {p.station.operator}
                    </p>
                    <p className="text-slate-500">
                      {p.station.lat.toFixed(4)}, {p.station.lon.toFixed(4)}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          <ZoomButtons floodBounds={flood?.bounds ?? null} address={address} />

          {/* marcador da estação fluviométrica de referência */}
          <CircleMarker
            center={[CENTER.lat, CENTER.lon]}
            radius={5}
            pathOptions={{ color: '#f8fafc', weight: 2, fillColor: '#1d4ed8', fillOpacity: 1 }}
          >
            <Tooltip direction="bottom" offset={[0, 6]} opacity={1} permanent>
              <span className="text-[10px] font-bold">Régua 87380000</span>
            </Tooltip>
          </CircleMarker>
        </MapContainer>
      </div>

      {/* legenda */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-300">Chuva acumulada ({periodLabel}):</span>
        {RAIN_SCALE.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full ring-1 ring-slate-900" style={{ background: s.color }} />
            {i === 0 ? '0 mm' : `≥ ${s.min} mm`} <span className="text-slate-500">({s.label})</span>
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-500">
        <span>
          Estações na bacia: <strong className="text-slate-300">{points.length}</strong>
          <span className="text-slate-600"> / {BASIN_META.areaKm2.toLocaleString('pt-BR')} km²</span>
        </span>
        <span>
          Média regional: <strong className="text-sky-300">{n1(avgMm)} mm</strong>
        </span>
        <span>
          Máximo: <strong className="text-sky-300">{n1(maxMm)} mm</strong>
          {withData[0] && <span className="text-slate-500"> ({withData[0].station.name})</span>}
        </span>
        {flood?.layers.map((fl) => (
          <span key={fl.meta.key} className="inline-flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm border"
              style={{ borderColor: fl.meta.color, background: `${fl.meta.color}66` }}
            />
            {fl.meta.short}
            <span className="text-slate-600">
              ({fl.polygonCount} polígono{fl.polygonCount === 1 ? '' : 's'}
              {fl.origin ? ` · ${fl.origin}` : ''})
            </span>
          </span>
        ))}
        {address && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: addrColor }} />
            Endereço consultado
            <span className="font-semibold" style={{ color: addrRing }}>
              ({danger ? 'em área de risco' : address.inFlood ? 'na mancha, sem alerta' : 'fora da mancha'})
            </span>
          </span>
        )}
        <span className="text-slate-600">
          Tamanho do círculo proporcional ao acumulado · contorno tracejado = divisor de águas da bacia.
        </span>
      </div>
    </div>
  );
}
