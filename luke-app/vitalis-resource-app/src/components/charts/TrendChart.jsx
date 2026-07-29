import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

/**
 * TrendChart — a Vitalis-styled Recharts line chart (cobalt + cool-steel + cooled-green series on
 * a platinum grid). data = [{ [xKey], ...series }]; series = [{ key, label, color? }]. Honest empty
 * state when there is not enough data to chart. Series/grid/axis read from app theme vars so the
 * chart follows any re-skin.
 */
const COBALT = 'hsl(var(--chart-1))';
const STEEL = 'hsl(var(--chart-2))';
const GREEN = 'hsl(var(--chart-3))';
const LINE = 'hsl(var(--chart-grid))';
const FAINT = 'hsl(var(--chart-axis))';
const INK = 'hsl(var(--foreground))';
const PALETTE = [COBALT, STEEL, GREEN];

export function TrendChart({ data = [], series = [], xKey = 'label', height = 200, legend = false }) {
  if (!data || data.length < 2 || !series.length) {
    return <div className="flex items-center justify-center rounded-md border border-dashed border-border-soft text-xs text-faint" style={{ height: Math.min(height, 160) }}>Not enough data to chart yet.</div>;
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
          <CartesianGrid stroke={LINE} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: FAINT }} tickLine={false} axisLine={{ stroke: LINE }} />
          <YAxis tick={{ fontSize: 10, fill: FAINT }} tickLine={false} axisLine={false} width={34} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: INK, boxShadow: '0 4px 12px -4px rgba(0,0,0,0.12)' }} />
          {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label || s.key} stroke={s.color || PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default TrendChart;
