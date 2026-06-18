import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { RealizedRound } from "../types";

interface HoldingDistributionProps {
  rounds: RealizedRound[];
}

const BUCKETS = [
  { label: "יום", max: 1 },
  { label: "שבוע", max: 7 },
  { label: "חודש", max: 30 },
  { label: "3 חודשים", max: 90 },
  { label: "שנה", max: 365 },
  { label: "שנה+", max: Infinity },
];

const HoldingDistribution = ({ rounds }: HoldingDistributionProps) => {
  if (rounds.length === 0) return null;

  const data = BUCKETS.map((bucket, i) => {
    const min = i === 0 ? 0 : BUCKETS[i - 1].max;
    const inBucket = rounds.filter((r) => r.durationDays > min && r.durationDays <= bucket.max);
    const profitCount = inBucket.filter((r) => r.finalPnL > 0).length;
    return {
      label: bucket.label,
      count: inBucket.length,
      winRate: inBucket.length > 0 ? (profitCount / inBucket.length) * 100 : 0,
    };
  }).filter((d) => d.count > 0);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--text-secondary)" }} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: "rgba(15,23,42,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { label: string; count: number; winRate: number };
            return (
              <div className="account-chart-tooltip">
                <div className="account-chart-tooltip-title">{d.label}</div>
                <div className="account-chart-tooltip-row">
                  <span>עסקאות</span>
                  <span className="mono">{d.count}</span>
                </div>
                <div className="account-chart-tooltip-row">
                  <span>אחוז הצלחה</span>
                  <span className={`mono ${d.winRate >= 50 ? "val-positive" : "val-negative"}`}>
                    {d.winRate.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={52}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.winRate >= 50 ? "var(--accent-green)" : "var(--accent-red)"}
              opacity={0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default HoldingDistribution;
