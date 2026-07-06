import { useEffect, useMemo, useState } from "react";
import { Position } from "../types";
import { formatSignedUsd, formatUsd } from "../utils/format";

interface TargetAllocationProps {
  positions: Position[];
  totalValue: number;
}

type TargetMap = Record<string, string>;

const STORAGE_KEY = "ibi_target_allocation";

const loadTargets = (): TargetMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const TargetAllocation = ({ positions, totalValue }: TargetAllocationProps) => {
  const [targets, setTargets] = useState<TargetMap>(loadTargets);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(targets));
    } catch {
      /* local browser storage is optional */
    }
  }, [targets]);

  const rows = useMemo(
    () =>
      positions
        .map((position) => {
          const currentPercent = position.weightPercent ?? 0;
          const targetPercent = Number(targets[position.symbol]);
          const hasTarget = Number.isFinite(targetPercent) && targetPercent >= 0;
          const targetValue = hasTarget ? (totalValue * targetPercent) / 100 : null;
          const currentValue = position.marketValue ?? position.costBasis;
          const gapValue = targetValue === null ? null : targetValue - currentValue;
          return {
            symbol: position.symbol,
            currentPercent,
            currentValue,
            targetPercent: hasTarget ? targetPercent : null,
            gapValue,
          };
        })
        .sort((a, b) => Math.abs(b.gapValue ?? 0) - Math.abs(a.gapValue ?? 0)),
    [positions, targets, totalValue]
  );

  const targetTotal = rows.reduce((sum, row) => sum + (row.targetPercent ?? 0), 0);
  const hasTargets = rows.some((row) => row.targetPercent !== null);

  const updateTarget = (symbol: string, value: string) => {
    const cleaned = value.replace(/[^\d.]/g, "");
    setTargets((prev) => ({ ...prev, [symbol]: cleaned }));
  };

  const setCurrentAsTarget = () => {
    const next: TargetMap = {};
    positions.forEach((position) => {
      next[position.symbol] = String(Number((position.weightPercent ?? 0).toFixed(1)));
    });
    setTargets(next);
  };

  const setEqualTarget = () => {
    if (positions.length === 0) return;
    const equal = Number((100 / positions.length).toFixed(1));
    const next: TargetMap = {};
    positions.forEach((position) => {
      next[position.symbol] = String(equal);
    });
    setTargets(next);
  };

  const clearTargets = () => setTargets({});

  if (positions.length === 0) {
    return null;
  }

  return (
    <div className="dashboard-card target-allocation-card">
      <div className="dashboard-card-head">
        <div>
          <h3>יעדי הקצאה ואיזון</h3>
          <p className="dashboard-card-note">
            נשמר מקומית בדפדפן בלבד. אין שרת, אין חשבון, ואין שליחת נתוני תיק.
          </p>
        </div>
        <div className="target-actions">
          <button type="button" className="export-btn" onClick={setCurrentAsTarget}>
            נוכחי כיעד
          </button>
          <button type="button" className="export-btn" onClick={setEqualTarget}>
            חלוקה שווה
          </button>
          <button type="button" className="ghost" onClick={clearTargets}>
            נקה יעדים
          </button>
        </div>
      </div>

      <div className={`target-total ${Math.abs(targetTotal - 100) <= 0.5 ? "ok" : "warn"}`}>
        סך יעדים: <span className="mono">{targetTotal.toFixed(1)}%</span>
        {hasTargets && Math.abs(targetTotal - 100) > 0.5 ? (
          <span> כדאי להגיע ל-100% כדי לקבל תמונת איזון מלאה.</span>
        ) : null}
      </div>

      <div className="target-table-wrap">
        <table className="target-table">
          <thead>
            <tr>
              <th>מניה</th>
              <th>משקל נוכחי</th>
              <th>יעד</th>
              <th>פער כספי</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <td className="target-symbol">{row.symbol}</td>
                <td>
                  <span className="mono">{row.currentPercent.toFixed(1)}%</span>
                  <span className="target-sub mono">{formatUsd(row.currentValue)}</span>
                </td>
                <td>
                  <input
                    className="target-input"
                    inputMode="decimal"
                    value={targets[row.symbol] ?? ""}
                    onChange={(event) => updateTarget(row.symbol, event.target.value)}
                    placeholder="0"
                    aria-label={`יעד הקצאה עבור ${row.symbol}`}
                  />
                  <span className="target-input-suffix">%</span>
                </td>
                <td>
                  {row.gapValue === null ? (
                    <span className="val-muted">—</span>
                  ) : (
                    <span className={`mono ${row.gapValue >= 0 ? "val-positive" : "val-negative"}`}>
                      {formatSignedUsd(row.gapValue)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TargetAllocation;
