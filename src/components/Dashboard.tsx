import { useEffect } from "react";
import { usePortfolio } from "../hooks/usePortfolio";
import KPICard from "./KPICard";
import AllocationChart from "./AllocationChart";
import PnLTimeline from "./PnLTimeline";
import BestWorstTrades from "./BestWorstTrades";
import WinRateCard from "./WinRateCard";
import { formatUsd, formatSignedUsd, formatPercent } from "../utils/format";

type Portfolio = ReturnType<typeof usePortfolio>;

interface DashboardProps {
  portfolio: Portfolio;
}

const sign = (v: number): "positive" | "negative" | "neutral" =>
  v > 0 ? "positive" : v < 0 ? "negative" : "neutral";

const Dashboard = ({ portfolio }: DashboardProps) => {
  const {
    summary,
    positions,
    allocation,
    realizedTimeline,
    realizedRounds,
    pricesLoading,
    priceError,
    refreshPrices,
  } = portfolio;

  // Fetch live prices once when holdings load (cached symbols resolve instantly,
  // so reloads within the cache window don't re-hit the network).
  useEffect(() => {
    refreshPrices();
  }, [refreshPrices]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <section className="dashboard">
      <div className="dashboard-head">
        <h2>סקירת תיק</h2>
        <div className="dashboard-head-actions">
          {priceError ? <span className="dashboard-price-note error">{priceError}</span> : null}
          {!priceError && !summary.hasLivePrices ? (
            <span className="dashboard-price-note">שווי לפי עלות — אין מחיר חי</span>
          ) : null}
          <button
            type="button"
            className="ghost"
            onClick={refreshPrices}
            disabled={pricesLoading}
          >
            {pricesLoading ? "מרענן…" : "רענן מחירים"}
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <KPICard
          label="שווי תיק"
          value={formatUsd(summary.totalMarketValue)}
          icon="💼"
          sub={summary.hasLivePrices ? "מחיר חי" : "לפי עלות רכישה"}
        />
        <KPICard label="עלות כוללת" value={formatUsd(summary.totalCostBasis)} icon="🧾" />
        <KPICard
          label="רווח/הפסד לא ממומש"
          value={formatSignedUsd(summary.unrealizedPnL)}
          change={summary.hasLivePrices ? formatPercent(summary.unrealizedPnLPercent) : undefined}
          changeKind={sign(summary.unrealizedPnL)}
          icon="📈"
          sub={summary.hasLivePrices ? undefined : "דורש מחיר חי"}
        />
        <KPICard
          label="רווח ממומש (השנה)"
          value={formatSignedUsd(summary.realizedPnLYTD)}
          changeKind={sign(summary.realizedPnLYTD)}
          icon="✅"
          sub={`כל הזמן: ${formatSignedUsd(summary.realizedPnLAllTime)}`}
        />
        <KPICard label="מספר אחזקות" value={String(summary.holdingsCount)} icon="📦" />
        <KPICard
          label="ביצוע יומי"
          value={formatSignedUsd(summary.dayChange)}
          change={summary.hasLivePrices ? formatPercent(summary.dayChangePercent) : undefined}
          changeKind={sign(summary.dayChange)}
          icon="⚡"
          sub={summary.hasLivePrices ? undefined : "דורש מחיר חי"}
        />
      </div>

      <div className="dashboard-charts">
        <div className="dashboard-card">
          <h3>חלוקת התיק{summary.hasLivePrices ? "" : " (לפי עלות)"}</h3>
          <AllocationChart data={allocation} />
        </div>
        <div className="dashboard-card">
          <h3>רווח/הפסד ממומש לאורך זמן</h3>
          <PnLTimeline data={realizedTimeline} />
        </div>
      </div>

      {realizedRounds.length > 0 && (
        <>
          <div className="dashboard-card">
            <h3>סטטיסטיקות מסחר</h3>
            <WinRateCard rounds={realizedRounds} />
          </div>
          <div className="dashboard-card">
            <h3>עסקאות בולטות</h3>
            <BestWorstTrades rounds={realizedRounds} />
          </div>
        </>
      )}
    </section>
  );
};

export default Dashboard;
