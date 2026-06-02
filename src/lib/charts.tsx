"use client";
// Gráficas reutilizables (Recharts). Reciben datos ya agregados desde el servidor.
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

export const COLORS = {
  blue: "#2563eb", green: "#16a34a", amber: "#d97706", red: "#dc2626",
  slate: "#64748b", violet: "#7c3aed", cyan: "#0891b2",
};
const PALETTE = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.violet, COLORS.cyan, COLORS.red, COLORS.slate];

export function Donut({ data }: { data: { name: string; value: number; color?: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

type Serie = { key: string; label: string; color: string };

// Barras agrupadas: varias series por categoría (ej. total vs asignado).
export function GroupedBars({ data, xKey, series, height = 280 }: {
  data: Record<string, unknown>[]; xKey: string; series: Serie[]; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Legend />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Barras horizontales simples (ej. ranking).
export function HBars({ data, labelKey, valueKey, color = COLORS.blue, height = 320 }: {
  data: Record<string, unknown>[]; labelKey: string; valueKey: string; color?: string; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey={labelKey} tick={{ fontSize: 11 }} width={180} interval={0} />
        <Tooltip />
        <Bar dataKey={valueKey} fill={color} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Barras verticales simples con color por celda (ej. alertas por tipo).
export function CBars({ data, xKey, valueKey, height = 280 }: {
  data: { color?: string }[] & Record<string, unknown>[]; xKey: string; valueKey: string; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} interval={0} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey={valueKey} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
