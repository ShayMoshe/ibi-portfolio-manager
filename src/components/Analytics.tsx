import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import SortableTable, { Column } from "../SortableTable";
import { usePortfolio } from "../hooks/usePortfolio";
import { CAPITAL_GAINS_TAX_RATE } from "../types";
import { formatUsd, formatSignedUsd, formatNumber } from "../utils/format";
import { exportToExcel } from "../utils/exportExcel";
import FeeAnalysis from "./FeeAnalysis";
import HoldingDistribution from "./HoldingDistribution";

type Portfolio = ReturnType<typeof usePortfolio>;

interface AnalyticsProps {
  portfolio: Portfolio;
}

const YEAR_COLORS = ["#4f8ef7", "#16a34a", "#f5a623", "#8b5cf6", "#ef4444"];

interface PerfRow extends Record<string, unknown> {
  symbol: string;
  rounds: number;
  costBasis: number;
  proceeds: number;
  fees: number;
  netFromTrading: number;
  capitalGainsTax: number;
  dividendsNet: number;
  finalPnL: number;
  returnPercent: number;
  isOpen: boolean;
}

const signedCell = (value: unknown) => {
  const n = Number(value) || 0;
  return <span className={`mono ${n >= 0 ? "val-positive" : "val-negative"}`}>{formatSignedUsd(n)}</span>;
};

const Analytics = ({ portfolio }: AnalyticsProps) => {
  const { realizedRounds, stockPerformance, yearlySummary, quarterlyComparison } = portfolio;

  const years = yearlySummary.map((y) => y.year);
  const [taxScope, setTaxScope] = useState<"all" | number>("all");
  const [cpiPercent, setCpiPercent] = useState<string>("");

  // Totals for the tax calculator over the selected scope. Annual filing nets
  // gains against losses, so taxable = max(0, net trading P&L).
  const taxTotals = useMemo(() => {
    const scoped = realizedRounds.filter((r) =>
      taxScope === "all" ? true : new Date(r.lastTimestamp).getFullYear() === taxScope
    );
    const gains = scoped.filter((r) => r.netFromTrading >= 0).reduce((s, r) => s + r.netFromTrading, 0);
    const losses = scoped.filter((r) => r.netFromTrading < 0).reduce((s, r) => s + r.netFromTrading, 0);
    const net = gains + losses;
    const costBasis = scoped.reduce((s, r) => s + r.costBasis, 0);
    const taxable = Math.max(0, net);
    const tax = taxable * CAPITAL_GAINS_TAX_RATE;

    const cpi = parseFloat(cpiPercent);
    const hasCpi = Number.isFinite(cpi) && cpi > 0;
    const realTaxable = hasCpi ? Math.max(0, net - (costBasis * cpi) / 100) : taxable;
    const realTax = realTaxable * CAPITAL_GAINS_TAX_RATE;

    return { gains, losses, net, costBasis, taxable, tax, hasCpi, realTaxable, realTax };
  }, [realizedRounds, taxScope, cpiPercent]);

  const perfRows: PerfRow[] = useMemo(
    () =>
      stockPerformance.map((s) => ({
        symbol: s.symbol,
        rounds: s.rounds,
        costBasis: s.costBasis,
        proceeds: s.proceeds,
        fees: s.fees,
        netFromTrading: s.netFromTrading,
        capitalGainsTax: s.capitalGainsTax,
        dividendsNet: s.dividendsNet,
        finalPnL: s.finalPnL,
        returnPercent: s.returnPercent,
        isOpen: s.isOpen,
      })),
    [stockPerformance]
  );

  const perfColumns: Column<PerfRow>[] = useMemo(
    () => [
      {
        key: "symbol",
        label: "מניה",
        filterable: true,
        render: (value, row) => (
          <span className="perf-symbol">
            {String(value)}
            {row.isOpen ? <span className="perf-open-tag">פתוח</span> : null}
          </span>
        ),
      },
      { key: "rounds", label: "עסקאות" },
      { key: "costBasis", label: "עלות", render: (v) => <span className="mono">{formatUsd(Number(v) || 0)}</span> },
      { key: "proceeds", label: "תמורה", render: (v) => <span className="mono">{formatUsd(Number(v) || 0)}</span> },
      {
        key: "fees",
        label: "עמלות",
        render: (v) => <span className="mono val-negative">-{formatUsd(Number(v) || 0)}</span>,
      },
      { key: "netFromTrading", label: "רווח לפני מס", render: signedCell },
      {
        key: "capitalGainsTax",
        label: "מס (25%)",
        render: (v) => {
          const n = Number(v) || 0;
          return <span className="mono">{n > 0 ? `-${formatUsd(n)}` : "-"}</span>;
        },
      },
      {
        key: "dividendsNet",
        label: "דיבידנד נטו",
        render: (v) => {
          const n = Number(v) || 0;
          return n !== 0 ? signedCell(v) : <span className="mono">-</span>;
        },
      },
      { key: "finalPnL", label: "רווח נטו", render: signedCell },
      {
        key: "returnPercent",
        label: "תשואה",
        render: (v) => {
          const n = Number(v) || 0;
          return <span className={`mono ${n >= 0 ? "val-positive" : "val-negative"}`}>{`${n >= 0 ? "+" : ""}${n.toFixed(1)}%`}</span>;
        },
      },
    ],
    []
  );

  return (
    <div className="analytics-panel">
      {/* Year comparison */}
      <div className="analytics-card">
        <h3>השוואת רווח/הפסד ממומש לפי רבעון</h3>
        {quarterlyComparison.years.length === 0 ? (
          <div className="dashboard-card-empty">אין נתונים ממומשים להשוואה.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={quarterlyComparison.data} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
              <XAxis dataKey="quarter" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} />
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
                formatter={(value, name) => [formatSignedUsd(Number(value) || 0), String(name)]}
              />
              <Legend />
              {quarterlyComparison.years.map((year, i) => (
                <Bar
                  key={year}
                  dataKey={String(year)}
                  name={String(year)}
                  fill={YEAR_COLORS[i % YEAR_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}

        {yearlySummary.length > 0 && (
          <div className="table-wrap analytics-year-table">
            <table>
              <thead>
                <tr>
                  <th>שנה</th>
                  <th>עסקאות</th>
                  <th>רווחים</th>
                  <th>הפסדים</th>
                  <th>נטו לפני מס</th>
                  <th>מס משוער</th>
                  <th>דיבידנד נטו</th>
                  <th>רווח נטו סופי</th>
                </tr>
              </thead>
              <tbody>
                {yearlySummary.map((y) => (
                  <tr key={y.year}>
                    <td className="mono">{y.year}</td>
                    <td className="mono">{y.trades}</td>
                    <td className="mono val-positive">{formatUsd(y.gains)}</td>
                    <td className="mono val-negative">{formatUsd(y.losses)}</td>
                    <td className={`mono ${y.netFromTrading >= 0 ? "val-positive" : "val-negative"}`}>
                      {formatSignedUsd(y.netFromTrading)}
                    </td>
                    <td className="mono">{y.capitalGainsTax > 0 ? `-${formatUsd(y.capitalGainsTax)}` : "-"}</td>
                    <td className="mono">{y.dividendsNet !== 0 ? formatSignedUsd(y.dividendsNet) : "-"}</td>
                    <td className={`mono ${y.finalPnL >= 0 ? "val-positive" : "val-negative"}`}>
                      {formatSignedUsd(y.finalPnL)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tax calculator */}
      <div className="analytics-card">
        <div className="analytics-card-head">
          <h3>מחשבון מס רווחי הון (25%)</h3>
          <div className="analytics-tax-controls">
            <label>
              תקופה:
              <select
                value={String(taxScope)}
                onChange={(e) => setTaxScope(e.target.value === "all" ? "all" : Number(e.target.value))}
              >
                <option value="all">כל הזמן</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label>
              מדד/אינפלציה %:
              <input
                type="text"
                inputMode="decimal"
                value={cpiPercent}
                onChange={(e) => setCpiPercent(e.target.value)}
                placeholder="0"
                className="analytics-cpi-input"
              />
            </label>
          </div>
        </div>

        <div className="analytics-tax-grid">
          <div className="analytics-tax-item">
            <span className="analytics-tax-label">רווחים</span>
            <span className="mono val-positive">{formatUsd(taxTotals.gains)}</span>
          </div>
          <div className="analytics-tax-item">
            <span className="analytics-tax-label">הפסדים</span>
            <span className="mono val-negative">{formatUsd(taxTotals.losses)}</span>
          </div>
          <div className="analytics-tax-item">
            <span className="analytics-tax-label">נטו (קיזוז)</span>
            <span className={`mono ${taxTotals.net >= 0 ? "val-positive" : "val-negative"}`}>
              {formatSignedUsd(taxTotals.net)}
            </span>
          </div>
          <div className="analytics-tax-item">
            <span className="analytics-tax-label">בסיס חייב במס</span>
            <span className="mono">{formatUsd(taxTotals.taxable)}</span>
          </div>
          <div className="analytics-tax-item highlight">
            <span className="analytics-tax-label">מס משוער (25%)</span>
            <span className="mono val-negative">{formatUsd(taxTotals.tax)}</span>
          </div>
          {taxTotals.hasCpi && (
            <div className="analytics-tax-item highlight">
              <span className="analytics-tax-label">מס ריאלי משוער</span>
              <span className="mono val-negative">{formatUsd(taxTotals.realTax)}</span>
            </div>
          )}
        </div>
        <p className="analytics-tax-note">
          אומדן בלבד. חישוב שנתי מקזז רווחים מול הפסדים; המס מחושב על הרווח הריאלי בלבד.
          {taxTotals.hasCpi
            ? ` הבסיס הריאלי מתחשב באינפלציה של ${formatNumber(parseFloat(cpiPercent))}% על עלות הרכישה.`
            : ""}
        </p>
      </div>

      {/* Fee analysis */}
      <div className="analytics-card">
        <h3>ניתוח עמלות</h3>
        <FeeAnalysis stockPerformance={stockPerformance} />
      </div>

      {/* Holding period distribution */}
      <div className="analytics-card">
        <h3>התפלגות זמני אחזקה</h3>
        <p className="analytics-tax-note">צבע: ירוק = אחוז הצלחה מעל 50%, אדום = מתחת.</p>
        <HoldingDistribution rounds={realizedRounds} />
      </div>

      {/* Per-stock performance */}
      <div className="analytics-card">
        <h3>ביצועים לפי מניה</h3>
        {perfRows.length === 0 ? (
          <div className="dashboard-card-empty">אין נתוני מניות להצגה.</div>
        ) : (
          <SortableTable
            columns={perfColumns}
            data={perfRows}
            getRowKey={(row) => row.symbol}
            emptyMessage="אין נתוני מניות להצגה."
            toolbarSlot={
              <button
                type="button"
                className="export-btn"
                onClick={() =>
                  exportToExcel(
                    stockPerformance.map((s) => ({
                      מניה: s.symbol,
                      עסקאות: s.rounds,
                      "עלות ($)": s.costBasis,
                      "תמורה ($)": s.proceeds,
                      "עמלות ($)": s.fees,
                      "רווח לפני מס ($)": s.netFromTrading,
                      "מס ($)": s.capitalGainsTax,
                      "דיבידנד נטו ($)": s.dividendsNet,
                      "רווח נטו ($)": s.finalPnL,
                      "תשואה (%)": Number(s.returnPercent.toFixed(2)),
                      פתוח: s.isOpen ? "כן" : "לא",
                    })),
                    "ibi_performance",
                    "ביצועים"
                  )
                }
              >
                ⬇ ייצוא לאקסל
              </button>
            }
          />
        )}
      </div>
    </div>
  );
};

export default Analytics;
