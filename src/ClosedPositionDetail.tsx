import { useMemo } from "react";
import * as XLSX from "xlsx";

interface ClosedPositionDetailProps {
  ticker: string;
  rows: Record<string, string>[];
  onBack: () => void;
  // This ticker was re-bought after this round closed and is held again now —
  // link across to the live active-holding view.
  hasActivePosition?: boolean;
  onViewActivePosition?: () => void;
}

const ClosedPositionDetail = ({
  ticker,
  rows,
  onBack,
  hasActivePosition,
  onViewActivePosition,
}: ClosedPositionDetailProps) => {
  const formatNumber = (value: number): string => {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === Math.floor(rounded)) {
      return rounded.toLocaleString("en-US");
    }
    return rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const parseDateToTimestamp = (value: string): number => {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const parsed = XLSX.SSF.parse_date_code(numeric);
        if (parsed && parsed.y) {
          return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
        }
      }
    }
    const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (dmyMatch) {
      return new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10)).getTime();
    }
    const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (ymdMatch) {
      return new Date(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10)).getTime();
    }
    return 0;
  };

  const formatDateLabel = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const parsed = XLSX.SSF.parse_date_code(numeric);
        if (parsed && parsed.y) {
          return `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}`;
        }
      }
    }
    const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (dmyMatch) return `${dmyMatch[1].padStart(2, "0")}/${dmyMatch[2].padStart(2, "0")}/${dmyMatch[3]}`;
    const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (ymdMatch) return `${ymdMatch[3].padStart(2, "0")}/${ymdMatch[2].padStart(2, "0")}/${ymdMatch[1]}`;
    return trimmed;
  };

  const formatDuration = (days: number): string => {
    if (days === 0) return "אותו יום";
    if (days < 30) return `${days} ימים`;
    const months = Math.floor(days / 30.44);
    if (months < 12) return `${months} חודשים`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem > 0 ? `${years} שנה ו-${rem} חודשים` : `${years} שנה`;
  };

  const transactionRows = useMemo(() => {
    const filtered = rows
      .map((row) => {
        const tickerValue = String(row["מס' נייר / סימבול"] ?? "").trim();
        const actionType = String(row["סוג פעולה"] ?? "").trim();
        const dateValue = String(row["תאריך"] ?? "").trim();
        const quantityValue = parseFloat(String(row["כמות"] ?? "").trim()) || 0;
        const priceValue = parseFloat(String(row["שער ביצוע"] ?? "").trim()) || 0;
        const feeValue = parseFloat(String(row["עמלת פעולה"] ?? "").trim()) || 0;

        const isBuy = actionType === "קניה חול מטח";
        const isSell = actionType === "מכירה חול מטח";
        const isBenefit = actionType === "הטבה";

        if (tickerValue !== ticker || (!isBuy && !isSell && !isBenefit)) return null;

        return {
          timestamp: parseDateToTimestamp(dateValue),
          dateLabel: formatDateLabel(dateValue),
          actionLabel: isBenefit ? "הטבה" : isBuy ? "קנייה" : "מכירה",
          isBuy: isBuy || isBenefit,
          quantity: Math.abs(quantityValue),
          delta: isBenefit || isBuy ? quantityValue : -quantityValue,
          price: priceValue,
          fee: Math.abs(feeValue),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    filtered.sort((a, b) => a.timestamp - b.timestamp);

    let cumulative = 0;
    return filtered.map((row) => {
      cumulative += row.delta;
      return { ...row, cumulative };
    });
  }, [rows, ticker]);

  const dividendRows = useMemo(() => {
    const byDate = new Map<string, { timestamp: number; dateLabel: string; dividend: number; tax: number }>();
    const stockPattern = new RegExp(`\\/\\s*${ticker}\\s+US`, "i");

    rows.forEach((row) => {
      const actionType = String(row["סוג פעולה"] ?? "").trim();
      const stockName = String(row["שם נייר"] ?? "").trim();
      const isDividend = actionType === "הפקדה דיבידנד מטח";
      const isTax = actionType === "משיכת מס חול מטח";
      if (!isDividend && !isTax) return;
      if (!stockPattern.test(stockName)) return;

      const dateValue = String(row["תאריך"] ?? "").trim();
      const timestamp = parseDateToTimestamp(dateValue);
      const dateLabel = formatDateLabel(dateValue);
      const amount = Math.abs(parseFloat(String(row["כמות"] ?? "").trim()) || 0);
      if (!timestamp || !dateLabel || amount === 0) return;

      const existing = byDate.get(dateLabel) ?? { timestamp, dateLabel, dividend: 0, tax: 0 };
      if (isDividend) existing.dividend += amount;
      else if (isTax) existing.tax += amount;
      byDate.set(dateLabel, existing);
    });

    return Array.from(byDate.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((entry) => ({ ...entry, net: entry.dividend - entry.tax }));
  }, [rows, ticker]);

  const rounds = useMemo(() => {
    if (transactionRows.length === 0) return [];

    const result: {
      transactions: typeof transactionRows;
      firstDate: string;
      lastDate: string;
      firstTimestamp: number;
      lastTimestamp: number;
      durationDays: number;
      weightedDaysSum: number;
      buyQty: number;
      buyCount: number;
      avgHoldingDays: number | null;
      costBasis: number;
      proceeds: number;
      buyFees: number;
      sellFees: number;
      totalFees: number;
      netFromTrading: number;
      capitalGainsTax: number;
      netAfterTax: number;
      totalInvested: number;
    }[] = [];

    let roundStart = 0;
    transactionRows.forEach((row, i) => {
      if (row.cumulative === 0) {
        const txns = transactionRows.slice(roundStart, i + 1);
        if (txns.length > 0) {
          const first = txns[0];
          const last = txns[txns.length - 1];
          let costBasis = 0, proceeds = 0, buyFees = 0, sellFees = 0;
          // ימי אחזקה ממוצעים: לכל רכישה, הימים מאז הרכישה ועד סגירת העסקה (המכירה האחרונה),
          // משוקלל לפי הכמות שנרכשה בכל פעם.
          let weightedDaysSum = 0, buyQty = 0, buyCount = 0;

          txns.forEach((txn) => {
            if (txn.isBuy) {
              costBasis += txn.price * txn.quantity;
              buyFees += txn.fee;
              weightedDaysSum += ((last.timestamp - txn.timestamp) / 86400000) * txn.quantity;
              buyQty += txn.quantity;
              buyCount += 1;
            } else {
              proceeds += txn.price * txn.quantity;
              sellFees += txn.fee;
            }
          });

          const totalFees = buyFees + sellFees;
          const netFromTrading = proceeds - costBasis - totalFees;
          const capitalGainsTax = netFromTrading > 0 ? netFromTrading * 0.25 : 0;
          const netAfterTax = netFromTrading > 0 ? netFromTrading * 0.75 : netFromTrading;
          const durationDays = Math.round((last.timestamp - first.timestamp) / 86400000);
          // רלוונטי רק כשיש יותר מרכישה אחת — אחרת זהה למשך ההחזקה.
          const avgHoldingDays = buyCount > 1 && buyQty > 0 ? Math.round(weightedDaysSum / buyQty) : null;

          result.push({
            transactions: txns,
            firstDate: first.dateLabel,
            lastDate: last.dateLabel,
            firstTimestamp: first.timestamp,
            lastTimestamp: last.timestamp,
            durationDays,
            weightedDaysSum,
            buyQty,
            buyCount,
            avgHoldingDays,
            costBasis,
            proceeds,
            buyFees,
            sellFees,
            totalFees,
            netFromTrading,
            capitalGainsTax,
            netAfterTax,
            totalInvested: costBasis + buyFees,
          });
        }
        roundStart = i + 1;
      }
    });

    return result;
  }, [transactionRows]);

  const roundsWithDividends = useMemo(() => {
    return rounds.map((round) => {
      const divs = dividendRows.filter(
        (d) => d.timestamp >= round.firstTimestamp && d.timestamp <= round.lastTimestamp
      );
      const dividendsGross = divs.reduce((s, d) => s + d.dividend, 0);
      const dividendsTax = divs.reduce((s, d) => s + d.tax, 0);
      const dividendsNet = divs.reduce((s, d) => s + d.net, 0);
      const finalPnL = round.netAfterTax + dividendsNet;
      const returnPercent = round.totalInvested > 0 ? (finalPnL / round.totalInvested) * 100 : 0;
      return { ...round, dividendsGross, dividendsTax, dividendsNet, finalPnL, returnPercent };
    });
  }, [rounds, dividendRows]);

  const totals = useMemo(() => {
    const costBasis = roundsWithDividends.reduce((s, r) => s + r.costBasis, 0);
    const proceeds = roundsWithDividends.reduce((s, r) => s + r.proceeds, 0);
    const totalFees = roundsWithDividends.reduce((s, r) => s + r.totalFees, 0);
    const netFromTrading = roundsWithDividends.reduce((s, r) => s + r.netFromTrading, 0);
    const capitalGainsTax = roundsWithDividends.reduce((s, r) => s + r.capitalGainsTax, 0);
    const netAfterTax = roundsWithDividends.reduce((s, r) => s + r.netAfterTax, 0);
    const dividendsGross = dividendRows.reduce((s, d) => s + d.dividend, 0);
    const dividendsTax = dividendRows.reduce((s, d) => s + d.tax, 0);
    const dividendsNet = dividendRows.reduce((s, d) => s + d.net, 0);
    const finalPnL = netAfterTax + dividendsNet;
    const totalInvested = roundsWithDividends.reduce((s, r) => s + r.totalInvested, 0);
    const returnPercent = totalInvested > 0 ? (finalPnL / totalInvested) * 100 : 0;

    const allTimestamps = roundsWithDividends.flatMap((r) => [r.firstTimestamp, r.lastTimestamp]).filter(Boolean);
    const firstTimestamp = allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0;
    const lastTimestamp = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0;
    const firstDate = roundsWithDividends[0]?.firstDate ?? "-";
    const lastDate = roundsWithDividends[roundsWithDividends.length - 1]?.lastDate ?? "-";
    const totalDays = firstTimestamp && lastTimestamp ? Math.round((lastTimestamp - firstTimestamp) / 86400000) : 0;

    // ממוצע משוקלל של ימי האחזקה על פני כל הרכישות בכל העסקאות.
    const weightedDaysSum = roundsWithDividends.reduce((s, r) => s + r.weightedDaysSum, 0);
    const buyQty = roundsWithDividends.reduce((s, r) => s + r.buyQty, 0);
    const buyCount = roundsWithDividends.reduce((s, r) => s + r.buyCount, 0);
    const avgHoldingDays = buyCount > 1 && buyQty > 0 ? Math.round(weightedDaysSum / buyQty) : null;

    return {
      costBasis, proceeds, totalFees, netFromTrading, capitalGainsTax,
      netAfterTax, dividendsGross, dividendsTax, dividendsNet,
      finalPnL, totalInvested, returnPercent,
      firstDate, lastDate, totalDays, avgHoldingDays,
    };
  }, [roundsWithDividends, dividendRows]);

  const isProfit = totals.finalPnL >= 0;

  return (
    <div className="stock-detail">
      <button className="back-button" onClick={onBack}>
        ← חזרה לרשימת מניות
      </button>

      {hasActivePosition && onViewActivePosition && (
        <button className="detail-cross-link" onClick={onViewActivePosition}>
          <span className="detail-cross-link-icon">📈</span>
          <span>מניה זו נקנתה מחדש ומוחזקת כעת — צפה באחזקה הפעילה</span>
          <span className="detail-cross-link-arrow">←</span>
        </button>
      )}

      <div className="stock-header">
        <div className="stock-header-top">
          <h1 className="stock-ticker">
            {ticker}
            <span className="closed-position-badge">סגור</span>
          </h1>
        </div>
        <div className="closed-date-range">
          <span>{totals.firstDate} – {totals.lastDate}</span>
          {totals.totalDays > 0 && (
            <span className="closed-duration-pill">{formatDuration(totals.totalDays)}</span>
          )}
          {roundsWithDividends.length > 1 && (
            <span className="closed-duration-pill">{roundsWithDividends.length} עסקאות</span>
          )}
        </div>
      </div>

      <div className={`closed-pnl-hero ${isProfit ? "pnl-profit" : "pnl-loss"}`}>
        <div className="closed-pnl-label">רווח / הפסד נטו סופי</div>
        <div className="closed-pnl-value">
          {totals.finalPnL >= 0 ? "+" : ""}${formatNumber(totals.finalPnL)}
        </div>
        <div className="closed-pnl-percent">
          ({totals.returnPercent >= 0 ? "+" : ""}{totals.returnPercent.toFixed(2)}% על ההשקעה)
        </div>
      </div>

      <div className="closed-summary-grid">
        <div className="closed-summary-card">
          <div className="closed-summary-label">השקעה כוללת</div>
          <div className="closed-summary-value">${formatNumber(totals.totalInvested)}</div>
        </div>
        <div className="closed-summary-card">
          <div className="closed-summary-label">תמורה ממכירות</div>
          <div className="closed-summary-value">${formatNumber(totals.proceeds)}</div>
        </div>
        <div className="closed-summary-card">
          <div className="closed-summary-label">רווח לפני מס</div>
          <div className={`closed-summary-value ${totals.netFromTrading >= 0 ? "val-positive" : "val-negative"}`}>
            {totals.netFromTrading >= 0 ? "+" : ""}${formatNumber(totals.netFromTrading)}
          </div>
        </div>
        <div className="closed-summary-card">
          <div className="closed-summary-label">עמלות</div>
          <div className="closed-summary-value val-negative">-${formatNumber(totals.totalFees)}</div>
        </div>
        <div className="closed-summary-card">
          <div className="closed-summary-label">דיבידנד נטו</div>
          <div className={`closed-summary-value ${totals.dividendsNet > 0 ? "val-positive" : ""}`}>
            {totals.dividendsNet > 0 ? "+" : ""}${formatNumber(totals.dividendsNet)}
          </div>
        </div>
        <div className="closed-summary-card">
          <div className="closed-summary-label">משך ההחזקה</div>
          <div className="closed-summary-value">{formatDuration(totals.totalDays)}</div>
          {totals.avgHoldingDays !== null && (
            <div className="closed-summary-sub">ממוצע משוקלל {formatDuration(totals.avgHoldingDays)}</div>
          )}
        </div>
      </div>

      <div className="stock-transactions-card">
        <h2>פירוט רווח / הפסד</h2>
        <div className="pnl-breakdown">
          <div className="pnl-row">
            <span>תמורה ממכירות</span>
            <span>${formatNumber(totals.proceeds)}</span>
          </div>
          <div className="pnl-row">
            <span>עלות רכישה</span>
            <span>-${formatNumber(totals.costBasis)}</span>
          </div>
          <div className="pnl-row">
            <span>עמלות</span>
            <span>-${formatNumber(totals.totalFees)}</span>
          </div>
          <div className={`pnl-row pnl-subtotal ${totals.netFromTrading >= 0 ? "val-positive" : "val-negative"}`}>
            <span>רווח לפני מס</span>
            <span>{totals.netFromTrading >= 0 ? "+" : ""}${formatNumber(totals.netFromTrading)}</span>
          </div>
          {totals.capitalGainsTax > 0 && (
            <div className="pnl-row val-negative">
              <span>מס רווחי הון (25%)</span>
              <span>-${formatNumber(totals.capitalGainsTax)}</span>
            </div>
          )}
          <div className={`pnl-row pnl-subtotal ${totals.netAfterTax >= 0 ? "val-positive" : "val-negative"}`}>
            <span>רווח נטו ממסחר</span>
            <span>{totals.netAfterTax >= 0 ? "+" : ""}${formatNumber(totals.netAfterTax)}</span>
          </div>
          {totals.dividendsNet !== 0 && (
            <>
              <div className="pnl-row val-positive">
                <span>דיבידנד ברוטו</span>
                <span>+${formatNumber(totals.dividendsGross)}</span>
              </div>
              <div className="pnl-row val-negative">
                <span>מס דיבידנד</span>
                <span>-${formatNumber(totals.dividendsTax)}</span>
              </div>
              <div className="pnl-row val-positive">
                <span>דיבידנד נטו</span>
                <span>+${formatNumber(totals.dividendsNet)}</span>
              </div>
            </>
          )}
          <div className={`pnl-row pnl-total ${totals.finalPnL >= 0 ? "val-positive" : "val-negative"}`}>
            <span>סה"כ נטו</span>
            <span>
              {totals.finalPnL >= 0 ? "+" : ""}${formatNumber(totals.finalPnL)}
              {" "}({totals.returnPercent >= 0 ? "+" : ""}{totals.returnPercent.toFixed(2)}%)
            </span>
          </div>
        </div>
      </div>

      {roundsWithDividends.length > 1 && (
        <div className="stock-transactions-card">
          <h2>סיכום לפי עסקה ({roundsWithDividends.length} עסקאות)</h2>
          <div className="closed-rounds-list">
            {roundsWithDividends.map((round, i) => (
              <div key={i} className={`closed-round-card ${round.finalPnL >= 0 ? "round-profit" : "round-loss"}`}>
                <div className="closed-round-header">
                  <span className="closed-round-number">עסקה {i + 1}</span>
                  <span className="closed-round-dates">{round.firstDate} – {round.lastDate}</span>
                  <span className="closed-round-duration">{formatDuration(round.durationDays)}</span>
                  {round.avgHoldingDays !== null && (
                    <span className="closed-round-duration-avg">ממוצע {formatDuration(round.avgHoldingDays)}</span>
                  )}
                  <span className={`closed-round-pnl ${round.finalPnL >= 0 ? "val-positive" : "val-negative"}`}>
                    {round.finalPnL >= 0 ? "+" : ""}${formatNumber(round.finalPnL)}
                    {" "}({round.returnPercent >= 0 ? "+" : ""}{round.returnPercent.toFixed(2)}%)
                  </span>
                </div>
                <div className="closed-round-stats">
                  <div className="closed-round-stat">
                    <span className="stat-label">השקעה</span>
                    <span>${formatNumber(round.totalInvested)}</span>
                  </div>
                  <div className="closed-round-stat">
                    <span className="stat-label">תמורה</span>
                    <span>${formatNumber(round.proceeds)}</span>
                  </div>
                  <div className="closed-round-stat">
                    <span className="stat-label">עמלות</span>
                    <span className="val-negative">-${formatNumber(round.totalFees)}</span>
                  </div>
                  <div className="closed-round-stat">
                    <span className="stat-label">רווח לפני מס</span>
                    <span className={round.netFromTrading >= 0 ? "val-positive" : "val-negative"}>
                      {round.netFromTrading >= 0 ? "+" : ""}${formatNumber(round.netFromTrading)}
                    </span>
                  </div>
                  {round.dividendsNet !== 0 && (
                    <div className="closed-round-stat">
                      <span className="stat-label">דיבידנד נטו</span>
                      <span className="val-positive">+${formatNumber(round.dividendsNet)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stock-transactions-card">
        <h2>דיבידנדים</h2>
        {dividendRows.length === 0 ? (
          <div className="empty">אין דיבידנדים למניה זו.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>דיבידנד ברוטו</th>
                  <th>מס</th>
                  <th>נטו</th>
                </tr>
              </thead>
              <tbody>
                {dividendRows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.dateLabel}</td>
                    <td>{row.dividend ? `$${formatNumber(row.dividend)}` : "-"}</td>
                    <td>{row.tax ? `-$${formatNumber(row.tax)}` : "-"}</td>
                    <td>{`$${formatNumber(row.net)}`}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="dividend-summary-row">
                  <td>סה"כ</td>
                  <td>${formatNumber(totals.dividendsGross)}</td>
                  <td>-${formatNumber(totals.dividendsTax)}</td>
                  <td>${formatNumber(totals.dividendsNet)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="stock-transactions-card">
        <h2>כל הפעולות</h2>
        {transactionRows.length === 0 ? (
          <div className="empty">אין פעולות לתצוגה.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>פעולה</th>
                  <th>כמות</th>
                  <th>מחיר</th>
                  <th>עמלה</th>
                  <th>כמות מצטברת</th>
                </tr>
              </thead>
              <tbody>
                {transactionRows.map((row, i) => (
                  <tr key={i} className={row.cumulative === 0 ? "round-end-row" : ""}>
                    <td>{row.dateLabel}</td>
                    <td
                      className={
                        row.actionLabel === "קנייה"
                          ? "transaction-buy"
                          : row.actionLabel === "הטבה"
                          ? "transaction-benefit"
                          : "transaction-sell"
                      }
                    >
                      {row.actionLabel}
                    </td>
                    <td>{formatNumber(row.quantity)}</td>
                    <td>{row.price ? `$${formatNumber(row.price)}` : "-"}</td>
                    <td>{row.fee ? `$${formatNumber(row.fee)}` : "-"}</td>
                    <td className={row.cumulative === 0 ? "val-muted" : ""}>
                      {formatNumber(row.cumulative)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClosedPositionDetail;
