import { memo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COTAS, fmtDate, fmtDateTime, fmtTime, statusFor, STATUS_META } from '../lib/ana';
import type { ChartPoint } from '../lib/rain';

interface Props {
  data: ChartPoint[];
  /** duração do período exibido, em horas — define o formato do eixo X */
  spanHours: number;
  showRain: boolean;
  /** nº de estações usadas na média pluviométrica */
  rainStations: number;
}

function CustomTooltip({ active, payload, rainStations }: any) {
  if (!active || !payload?.length) return null;
  const r: ChartPoint = payload[0].payload;
  const st = STATUS_META[statusFor(r.level)];
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-2xl ring-1 ring-white/5 backdrop-blur">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{fmtDateTime(r.ts)}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums" style={{ color: st.color }}>
          {r.level.toFixed(2)}
        </span>
        <span className="text-sm text-slate-400">m</span>
        <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
      </p>
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-400">
        {r.flow != null && (
          <p>
            Vazão: <span className="font-medium tabular-nums text-slate-200">{r.flow.toFixed(1)} m³/s</span>
          </p>
        )}
        <p className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-purple-400/80" />
          Chuva (média {rainStations} est.):{' '}
          <span className="font-medium tabular-nums text-purple-300">{(r.rainAvg ?? 0).toFixed(1)} mm</span>
        </p>
        {r.rain != null && (
          <p className="pl-3.5 text-[11px] text-slate-500">Campo Bom (ANA): {r.rain.toFixed(1)} mm</p>
        )}
      </div>
    </div>
  );
}

function RiverChart({ data, spanHours, showRain, rainStations }: Props) {
  if (!data.length) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Sem dados no período.</div>;
  }

  const levels = data.map((d) => d.level);
  const dataMin = Math.min(...levels);
  const dataMax = Math.max(...levels);
  const current = data[data.length - 1];
  const color = STATUS_META[statusFor(current.level)].color;

  const visible = (c: number) => c <= dataMax + 1.5 && c >= dataMin - 1.5;
  const cotasVisiveis = [COTAS.atencao, COTAS.alerta, COTAS.inundacao].filter(visible);

  const yMin = Math.max(0, Math.floor((Math.min(dataMin, ...cotasVisiveis) - 0.3) * 10) / 10);
  const yMax = Math.ceil((Math.max(dataMax, ...cotasVisiveis) + 0.3) * 10) / 10;

  const maxRain = Math.max(0, ...data.map((d) => d.rainAvg || 0));
  const withRain = showRain && maxRain > 0;
  // barras ocupam no máximo ~40% da altura, ficando atrás da curva
  const rainMax = Math.max(2, Math.ceil(maxRain * 2.5 * 10) / 10);

  const tickFmt = (ts: number) => (spanHours <= 48 ? fmtTime(ts) : fmtDate(ts));
  const barSize = spanHours <= 24 ? 7 : spanHours <= 72 ? 5 : 3;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 10, right: withRain ? 6 : 16, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="riverFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c084fc" stopOpacity={0.75} />
            <stop offset="100%" stopColor="#9333ea" stopOpacity={0.25} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />

        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={tickFmt}
          tick={{ fill: '#64748b', fontSize: 11 }}
          axisLine={{ stroke: '#334155' }}
          tickLine={false}
          minTickGap={45}
          dy={6}
        />

        {/* escala em metros na mesma cor da curva do nível (azul claro em
            condição normal; acompanha a cor do status quando o rio sobe) */}
        <YAxis
          yAxisId="level"
          domain={[yMin, yMax]}
          tickFormatter={(v: number) => `${v.toFixed(1)}m`}
          tick={{ fill: color, fontSize: 11, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
          width={58}
        />

        <YAxis
          yAxisId="rain"
          orientation="right"
          domain={[0, rainMax]}
          allowDecimals
          tick={{ fill: '#c084fc', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={withRain ? 40 : 0}
          hide={!withRain}
          tickFormatter={(v: number) => (v > rainMax * 0.45 ? '' : `${v}mm`)}
        />

        <Tooltip
          content={<CustomTooltip rainStations={rainStations} />}
          cursor={{ stroke: '#64748b', strokeDasharray: '4 4' }}
        />

        {/* faixa de inundação */}
        {visible(COTAS.inundacao) && yMax > COTAS.inundacao && (
          <ReferenceArea yAxisId="level" y1={COTAS.inundacao} y2={yMax} fill="#ef4444" fillOpacity={0.09} />
        )}

        {/* ---- CHUVA: desenhada ANTES da curva, portanto ATRÁS dela ---- */}
        {withRain && (
          <Bar
            yAxisId="rain"
            dataKey="rainAvg"
            fill="url(#rainFill)"
            stroke="#c084fc"
            strokeOpacity={0.35}
            strokeWidth={0.5}
            barSize={barSize}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
        )}

        {visible(COTAS.atencao) && (
          <ReferenceLine
            yAxisId="level"
            y={COTAS.atencao}
            stroke="#facc15"
            strokeOpacity={0.7}
            strokeDasharray="5 5"
            label={{ value: `Atenção ${COTAS.atencao.toFixed(2)}m`, position: 'insideTopLeft', fill: '#facc15', fontSize: 10 }}
          />
        )}
        {visible(COTAS.alerta) && (
          <ReferenceLine
            yAxisId="level"
            y={COTAS.alerta}
            stroke="#fb923c"
            strokeOpacity={0.75}
            strokeDasharray="5 5"
            label={{ value: `Alerta ${COTAS.alerta.toFixed(2)}m`, position: 'insideTopLeft', fill: '#fb923c', fontSize: 10 }}
          />
        )}
        {visible(COTAS.inundacao) && (
          <ReferenceLine
            yAxisId="level"
            y={COTAS.inundacao}
            stroke="#f87171"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            label={{
              value: `Inundação ${COTAS.inundacao.toFixed(2)}m`,
              position: 'insideTopLeft',
              fill: '#fca5a5',
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        )}

        {/* ---- NÍVEL: na frente das barras ---- */}
        <Area
          yAxisId="level"
          type="monotone"
          dataKey="level"
          stroke={color}
          strokeWidth={2.5}
          fill="url(#riverFill)"
          dot={false}
          activeDot={{ r: 5, strokeWidth: 2, stroke: '#0f172a', fill: color }}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default memo(RiverChart);
