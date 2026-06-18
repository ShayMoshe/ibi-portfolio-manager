import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { AllocationSlice } from "../utils/calculations";
import { formatUsd } from "../utils/format";

// A calm, light-theme-friendly categorical palette (cycled for many holdings).
const COLORS = [
  "#4f8ef7",
  "#16a34a",
  "#f5a623",
  "#8b5cf6",
  "#0ea5e9",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#22c55e",
  "#ec4899",
  "#eab308",
];

interface AllocationChartProps {
  data: AllocationSlice[];
}

const AllocationChart = ({ data }: AllocationChartProps) => {
  if (data.length === 0) {
    return <div className="dashboard-card-empty">אין אחזקות להצגה.</div>;
  }

  return (
    <div className="allocation-chart">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="symbol"
            cx="50%"
            cy="50%"
            innerRadius={62}
            outerRadius={104}
            paddingAngle={1.5}
            stroke="var(--bg-surface)"
            strokeWidth={2}
          >
            {data.map((slice, i) => (
              <Cell key={slice.symbol} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const slice = payload[0].payload as AllocationSlice;
              return (
                <div className="account-chart-tooltip">
                  <div className="account-chart-tooltip-title">{slice.symbol}</div>
                  <div className="account-chart-tooltip-row">
                    <span>שווי</span>
                    <span className="mono">{formatUsd(slice.value)}</span>
                  </div>
                  <div className="account-chart-tooltip-row">
                    <span>משקל</span>
                    <span className="mono">{slice.percent.toFixed(2)}%</span>
                  </div>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <ul className={`allocation-legend ${data.length > 6 ? "allocation-legend-col" : ""}`}>
        {data.map((slice, i) => (
          <li key={slice.symbol} className="allocation-legend-item">
            <span
              className="allocation-legend-dot"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            <span className="allocation-legend-symbol">{slice.symbol}</span>
            <span className="allocation-legend-percent mono">{slice.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AllocationChart;
