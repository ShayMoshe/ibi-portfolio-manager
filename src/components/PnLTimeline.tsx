import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { TimelineBucket } from "../utils/calculations";
import { formatSignedUsd } from "../utils/format";

interface PnLTimelineProps {
  data: TimelineBucket[];
}

const GREEN = "#16a34a";
const RED = "#ef4444";

const PnLTimeline = ({ data }: PnLTimelineProps) => {
  if (data.length === 0) {
    return <div className="dashboard-card-empty">אין רווח/הפסד ממומש להצגה.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
        <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickFormatter={(v) => `${Number(v) < 0 ? "-" : ""}$${Math.abs(Number(v)).toLocaleString("en-US")}`}
          axisLine={false}
          tickLine={false}
          width={70}
        />
        <ReferenceLine y={0} stroke="#94a3b8" />
        <Tooltip
          cursor={{ fill: "rgba(15,23,42,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const bucket = payload[0].payload as TimelineBucket;
            return (
              <div className="account-chart-tooltip">
                <div className="account-chart-tooltip-title">{bucket.monthLabel}</div>
                <div className="account-chart-tooltip-row">
                  <span>רווח/הפסד בחודש</span>
                  <span className={`mono ${bucket.pnl >= 0 ? "val-positive" : "val-negative"}`}>
                    {formatSignedUsd(bucket.pnl)}
                  </span>
                </div>
                <div className="account-chart-tooltip-row">
                  <span>מצטבר</span>
                  <span className={`mono ${bucket.cumulative >= 0 ? "val-positive" : "val-negative"}`}>
                    {formatSignedUsd(bucket.cumulative)}
                  </span>
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((bucket) => (
            <Cell key={bucket.monthKey} fill={bucket.pnl >= 0 ? GREEN : RED} />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#4f8ef7"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#4f8ef7", strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export default PnLTimeline;
