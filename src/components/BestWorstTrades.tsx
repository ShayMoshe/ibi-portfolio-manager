import { RealizedRound } from "../types";
import { formatSignedUsd, formatPercent } from "../utils/format";
import { formatDuration } from "../utils/dates";

interface BestWorstTradesProps {
  rounds: RealizedRound[];
}

const TradeCard = ({ round, rank }: { round: RealizedRound; rank: number }) => {
  const isProfit = round.finalPnL >= 0;
  return (
    <div className={`trade-card ${isProfit ? "trade-profit" : "trade-loss"}`}>
      <span className="trade-rank">#{rank}</span>
      <div className="trade-symbol">{round.symbol}</div>
      <div className={`trade-pnl mono ${isProfit ? "val-positive" : "val-negative"}`}>
        {formatSignedUsd(round.finalPnL)}
      </div>
      <div className="trade-meta">
        <span className="mono">{formatPercent(round.returnPercent)}</span>
        <span className="trade-duration">{formatDuration(round.durationDays)}</span>
      </div>
      <div className="trade-dates">
        {round.firstDate} → {round.lastDate}
      </div>
    </div>
  );
};

const BestWorstTrades = ({ rounds }: BestWorstTradesProps) => {
  if (rounds.length === 0) return null;

  const sorted = [...rounds].sort((a, b) => b.finalPnL - a.finalPnL);
  const best = sorted.slice(0, 3);
  const worst = sorted.slice(-3).reverse();

  return (
    <div className="best-worst-section">
      <div className="best-worst-group">
        <h4 className="best-worst-title best-title">🏆 העסקאות הטובות ביותר</h4>
        <div className="best-worst-grid">
          {best.map((r, i) => (
            <TradeCard key={`best-${r.symbol}-${r.lastDate}`} round={r} rank={i + 1} />
          ))}
        </div>
      </div>
      <div className="best-worst-group">
        <h4 className="best-worst-title worst-title">📉 העסקאות הגרועות ביותר</h4>
        <div className="best-worst-grid">
          {worst.map((r, i) => (
            <TradeCard key={`worst-${r.symbol}-${r.lastDate}`} round={r} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default BestWorstTrades;
