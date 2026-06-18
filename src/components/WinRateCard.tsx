import { RealizedRound } from "../types";
import { formatSignedUsd } from "../utils/format";
import { formatDuration } from "../utils/dates";

interface WinRateCardProps {
  rounds: RealizedRound[];
}

const WinRateCard = ({ rounds }: WinRateCardProps) => {
  if (rounds.length === 0) return null;

  const wins = rounds.filter((r) => r.finalPnL > 0);
  const losses = rounds.filter((r) => r.finalPnL < 0);
  const winRate = (wins.length / rounds.length) * 100;

  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r.finalPnL, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, r) => s + r.finalPnL, 0) / losses.length : 0;
  const riskReward = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  const avgDuration = rounds.reduce((s, r) => s + r.durationDays, 0) / rounds.length;

  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const filled = (winRate / 100) * circ;

  return (
    <div className="winrate-card">
      <div className="winrate-gauge-wrap">
        <svg viewBox="0 0 120 120" className="winrate-svg">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={winRate >= 50 ? "var(--accent-green)" : "var(--accent-red)"}
            strokeWidth="10"
            strokeDasharray={`${filled} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="winrate-center">
          <span className="winrate-number mono">{winRate.toFixed(0)}%</span>
          <span className="winrate-label">Win Rate</span>
        </div>
      </div>

      <div className="winrate-stats">
        <div className="winrate-stat">
          <span className="winrate-stat-label">עסקאות</span>
          <span className="winrate-stat-value mono">{rounds.length}</span>
        </div>
        <div className="winrate-stat">
          <span className="winrate-stat-label">ממוצע רווח</span>
          <span className="winrate-stat-value mono val-positive">{formatSignedUsd(avgWin)}</span>
        </div>
        <div className="winrate-stat">
          <span className="winrate-stat-label">ממוצע הפסד</span>
          <span className="winrate-stat-value mono val-negative">{formatSignedUsd(avgLoss)}</span>
        </div>
        <div className="winrate-stat">
          <span className="winrate-stat-label">Risk/Reward</span>
          <span className="winrate-stat-value mono">{riskReward.toFixed(2)}x</span>
        </div>
        <div className="winrate-stat">
          <span className="winrate-stat-label">ממוצע אחזקה</span>
          <span className="winrate-stat-value mono">{formatDuration(Math.round(avgDuration))}</span>
        </div>
      </div>
    </div>
  );
};

export default WinRateCard;
