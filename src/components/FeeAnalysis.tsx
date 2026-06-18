import { StockPerformance } from "../types";
import { formatUsd } from "../utils/format";

interface FeeAnalysisProps {
  stockPerformance: StockPerformance[];
}

const FeeAnalysis = ({ stockPerformance }: FeeAnalysisProps) => {
  const closed = stockPerformance.filter((s) => s.rounds > 0);
  if (closed.length === 0) return null;

  const totalFees = closed.reduce((s, p) => s + p.fees, 0);
  const totalVolume = closed.reduce((s, p) => s + p.costBasis + p.proceeds, 0);
  const totalProfit = closed.reduce((s, p) => s + p.netFromTrading, 0);
  const feeAsVolume = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;
  const feeAsProfit = totalProfit > 0 ? (totalFees / totalProfit) * 100 : null;

  const topFeeStocks = [...closed].sort((a, b) => b.fees - a.fees).slice(0, 3);
  const maxFee = topFeeStocks[0]?.fees || 1;

  return (
    <div className="fee-analysis">
      <div className="fee-kpis">
        <div className="analytics-tax-item">
          <span className="analytics-tax-label">סה"כ עמלות</span>
          <span className="mono val-negative">-{formatUsd(totalFees)}</span>
        </div>
        <div className="analytics-tax-item">
          <span className="analytics-tax-label">% ממחזור</span>
          <span className="mono">{feeAsVolume.toFixed(3)}%</span>
        </div>
        {feeAsProfit !== null && (
          <div className={`analytics-tax-item ${feeAsProfit > 20 ? "highlight" : ""}`}>
            <span className="analytics-tax-label">% מרווח</span>
            <span className={`mono ${feeAsProfit > 20 ? "val-negative" : ""}`}>
              {feeAsProfit.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      <div className="fee-top-stocks">
        <h5 className="fee-top-title">עמלות גבוהות ביותר לפי מניה</h5>
        {topFeeStocks.map((s) => {
          const feeImpact = s.netFromTrading !== 0 ? (s.fees / Math.abs(s.netFromTrading)) * 100 : 0;
          return (
            <div key={s.symbol} className="fee-stock-row">
              <span className="fee-stock-symbol">{s.symbol}</span>
              <div className="fee-stock-bar-wrap">
                <div className="fee-stock-bar" style={{ width: `${Math.min((s.fees / maxFee) * 100, 100)}%` }} />
              </div>
              <span className="mono fee-stock-amount">-{formatUsd(s.fees)}</span>
              <span className={`mono fee-stock-impact ${feeImpact > 30 ? "val-negative" : "val-muted"}`}>
                ({feeImpact.toFixed(0)}% מרווח)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FeeAnalysis;
