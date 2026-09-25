import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatNumber } from "../lib/format";

export interface ChartPoint {
  label: string;
  value: number | null;
}

/**
 * One metric over time (single series, one axis). Used as small multiples so
 * metrics of different scale never share an axis.
 */
export function MetricChart({ title, points, unit }: { title: string; points: ChartPoint[]; unit?: string }) {
  const usable = points.filter((point) => point.value !== null);
  return (
    <figure className="card p-3">
      <figcaption className="mb-1 text-xs font-medium text-slate-600">{title}</figcaption>
      {usable.length < 2 ? (
        <div className="flex h-36 items-center justify-center text-xs text-slate-400">
          {usable.length === 1 ? `One snapshot: ${formatNumber(usable[0]!.value)}${unit ?? ""}` : "No data yet"}
        </div>
      ) : (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
              <YAxis
                width={44}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatCompact(value)}
              />
              <Tooltip
                formatter={(value) => [`${formatNumber(Number(value))}${unit ?? ""}`, title]}
                contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: "#e2e8f0" }}
                itemStyle={{ color: "#0f172a" }}
                cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#1d4ed8"
                strokeWidth={2}
                dot={{ r: 4, fill: "#1d4ed8", stroke: "#fff", strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
