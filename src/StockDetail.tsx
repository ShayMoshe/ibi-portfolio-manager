import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { fetchStockPrice, getCachedStockPrice, StockPrice, RateLimitError } from "./stockPriceService";

interface StockDetailProps {
  ticker: string;
  rows: Record<string, string>[];
  onBack: () => void;
}

const StockDetail = ({ ticker, rows, onBack }: StockDetailProps) => {
  const [price, setPrice] = useState<StockPrice | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);

  const formatNumber = (value: number): string => {
    const rounded = Math.round(value * 100) / 100;
    if (rounded === Math.floor(rounded)) {
      return rounded.toLocaleString("en-US");
    }
    return rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const parseDateToTimestamp = (value: string): number => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

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
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      return new Date(year, month, day).getTime();
    }

    const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      return new Date(year, month, day).getTime();
    }

    return 0;
  };

  const formatDateLabel = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const parsed = XLSX.SSF.parse_date_code(numeric);
        if (parsed && parsed.y) {
          const day = String(parsed.d).padStart(2, "0");
          const month = String(parsed.m).padStart(2, "0");
          return `${day}/${month}/${parsed.y}`;
        }
      }
    }

    const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, "0");
      const month = dmyMatch[2].padStart(2, "0");
      return `${day}/${month}/${dmyMatch[3]}`;
    }

    const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
    if (ymdMatch) {
      const day = ymdMatch[3].padStart(2, "0");
      const month = ymdMatch[2].padStart(2, "0");
      return `${day}/${month}/${ymdMatch[1]}`;
    }

    return trimmed;
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

        if (tickerValue !== ticker || (!isBuy && !isSell && !isBenefit)) {
          return null;
        }

        const timestamp = parseDateToTimestamp(dateValue);
        const dateLabel = formatDateLabel(dateValue);

        return {
          timestamp,
          dateLabel,
          actionLabel: isBenefit ? "הטבה" : isBuy ? "קנייה" : "מכירה",
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
      return {
        ...row,
        cumulative,
      };
    });
  }, [rows, ticker]);


  // רק הפעולות מהרכישה האחרונה אחרי שמכרנו הכל
  const currentHoldingRows = useMemo(() => {
    let lastZeroIndex = -1;
    transactionRows.forEach((row, i) => {
      if (row.cumulative === 0) lastZeroIndex = i;
    });
    return transactionRows.slice(lastZeroIndex + 1);
  }, [transactionRows]);

  const weightedAvgPrice = useMemo(() => {
    let totalCost = 0;
    let totalQty = 0;
    currentHoldingRows.forEach((row) => {
      if (row.actionLabel === "קנייה" || row.actionLabel === "הטבה") {
        totalCost += row.price * row.quantity;
        totalQty += row.quantity;
      }
    });
    return totalQty > 0 ? totalCost / totalQty : null;
  }, [currentHoldingRows]);

  const dividendRows = useMemo(() => {
    const byDate = new Map<string, { timestamp: number; dateLabel: string; dividend: number; tax: number }>();

    const stockPattern = new RegExp(`\\/\\s*${ticker}\\s+US`, "i");

    rows.forEach((row) => {
      const actionType = String(row["סוג פעולה"] ?? "").trim();
      const stockName = String(row["שם נייר"] ?? "").trim();

      const isDividend = actionType === "הפקדה דיבידנד מטח";
      const isTax = actionType === "משיכת מס חול מטח";
      if (!isDividend && !isTax) {
        return;
      }

      if (!stockPattern.test(stockName)) {
        return;
      }

      const dateValue = String(row["תאריך"] ?? "").trim();
      const timestamp = parseDateToTimestamp(dateValue);
      const dateLabel = formatDateLabel(dateValue);
      const amountStr = String(row["כמות"] ?? "").trim();
      const amount = Math.abs(parseFloat(amountStr) || 0);

      if (!timestamp || !dateLabel || amount === 0) {
        return;
      }

      const existing = byDate.get(dateLabel) ?? {
        timestamp,
        dateLabel,
        dividend: 0,
        tax: 0,
      };

      if (isDividend) {
        existing.dividend += amount;
      } else if (isTax) {
        existing.tax += amount;
      }

      byDate.set(dateLabel, existing);
    });

    return Array.from(byDate.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((entry) => ({
        ...entry,
        net: entry.dividend - entry.tax,
      }));
  }, [rows, ticker]);

  const dividendTotals = useMemo(() => {
    return dividendRows.reduce(
      (acc, row) => {
        acc.dividend += row.dividend;
        acc.tax += row.tax;
        acc.net += row.net;
        return acc;
      },
      { dividend: 0, tax: 0, net: 0 }
    );
  }, [dividendRows]);

  const currentHoldingQty = useMemo(() => {
    return currentHoldingRows.length > 0 ? currentHoldingRows[currentHoldingRows.length - 1].cumulative : 0;
  }, [currentHoldingRows]);

  const breakEvenPrice = useMemo(() => {
    if (currentHoldingQty <= 0) return null;

    const totalCost = currentHoldingRows.reduce((sum, row) => {
      if (row.actionLabel === "קנייה" || row.actionLabel === "הטבה") {
        return sum + row.price * row.quantity;
      }
      return sum;
    }, 0);

    const totalFees = currentHoldingRows.reduce((sum, row) => sum + row.fee, 0);
    const sellFee = 7.5;

    // דיבידנדים רק מתקופת ההחזקה הנוכחית
    const holdingStartTimestamp = currentHoldingRows.length > 0 ? currentHoldingRows[0].timestamp : 0;
    const currentHoldingDividendsNet = dividendRows
      .filter((row) => row.timestamp >= holdingStartTimestamp)
      .reduce((sum, row) => sum + row.net, 0);

    return (totalCost + totalFees + sellFee - currentHoldingDividendsNet) / currentHoldingQty;
  }, [currentHoldingQty, currentHoldingRows, dividendRows]);

  const profitTargetRows = useMemo(() => {
    const targets = [100, 200, 300];
    if (breakEvenPrice === null || currentHoldingQty <= 0) {
      return targets.map((target) => ({
        target,
        price: null as number | null,
      }));
    }

    return targets.map((target) => {
      // כדי להרוויח נטו X אחרי 25% מס צריך רווח ברוטו של X/0.75
      const grossProfitNeeded = target / 0.75;
      return {
        target,
        price: breakEvenPrice + grossProfitNeeded / currentHoldingQty,
      };
    });
  }, [breakEvenPrice, currentHoldingQty]);
  // helper used by the targets table and the custom-price input
  const calculateNetProfit = (sellPrice: number): number | null => {
    if (breakEvenPrice === null || currentHoldingQty <= 0) {
      return null;
    }

    const grossProfit = (sellPrice - breakEvenPrice) * currentHoldingQty;
    return grossProfit > 0 ? grossProfit * 0.75 : grossProfit;
  };

  const [customPriceInput, setCustomPriceInput] = useState<string>("");

  const targetTableRows = useMemo(() => {
    const baseRows = [
      {
        id: "break-even",
        label: "ללא הפסד",
        price: breakEvenPrice,
        profit: 0 as number | null,
        isToday: false,
      },
      ...profitTargetRows.map((row) => ({
        id: `profit-${row.target}`,
        label: `רווח $${row.target}`,
        price: row.price,
        profit: row.target as number | null,
        isToday: false,
      })),
    ];

    const todayRow = {
      id: "today-price",
      label: "מחיר היום",
      price: price?.price ?? null,
      profit: price ? calculateNetProfit(price.price) : null,
      isToday: true,
    };

    return [...baseRows, todayRow].sort((a, b) => {
      if (a.profit === null && b.profit === null) return 0;
      if (a.profit === null) return 1;
      if (b.profit === null) return -1;
      return a.profit - b.profit;
    });
  }, [breakEvenPrice, currentHoldingQty, price, profitTargetRows]);

  useEffect(() => {
    const loadData = async () => {
      setIsPriceLoading(true);
      setPriceError(null);
      const cached = getCachedStockPrice(ticker);
      if (cached) setPrice(cached);

      try {
        const priceData = await fetchStockPrice(ticker);
        if (priceData) setPrice(priceData);
      } catch (err) {
        console.error("Failed to load stock price:", err);
        if (err instanceof RateLimitError) {
          setPriceError("הגעת למגבלת השימוש היומית של ה-API עבור מחיר המניה. נסה שוב מאוחר יותר.");
        } else {
          setPriceError("שגיאה בטעינת מחיר המניה. נסה שוב מאוחר יותר.");
        }
      }

      setIsPriceLoading(false);
    };

    loadData();
  }, [ticker]);

  return (
    <div className="stock-detail">
      <button className="back-button" onClick={onBack}>
        ← חזרה לרשימת מניות
      </button>

      {priceError && (
        <div className="error-message">
          <p>⚠️ {priceError}</p>
          <p className="error-hint">הנתונים המוצגים עשויים להיות מהזיכרון המטמון (עד 24 שעות)</p>
        </div>
      )}

      <div className="stock-header">
          <div className="stock-header-top">
            <h1 className="stock-ticker">{ticker}</h1>
            <div className="stock-links">
              <a
                className="stock-link"
                href={`https://www.google.com/finance/quote/${encodeURIComponent(ticker)}`}
                target="_blank"
                rel="noreferrer"
              >
                Google Finance
              </a>
              <a
                className="stock-link"
                href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`}
                target="_blank"
                rel="noreferrer"
              >
                Yahoo Finance
              </a>
            </div>
          </div>
          <div className="stock-info">
            <div className="price-section">
              {isPriceLoading ? (
                <span className="price-status">טוען מחיר...</span>
              ) : price ? (
                <>
                  <span className="current-price">${price.price.toFixed(2)}</span>
                  <span
                    className={
                      price.change >= 0
                        ? "price-change-positive"
                        : "price-change-negative"
                    }
                  >
                    {price.change >= 0 ? "+" : ""}
                    {price.change.toFixed(2)} ({price.change >= 0 ? "+" : ""}
                    {price.changePercent.toFixed(2)}%)
                  </span>
                </>
              ) : (
                <span className="price-status">אין מחיר זמין</span>
              )}
            </div>
          </div>
        </div>

        <div className="stock-stats-card">
          <div className="stat-item">
            <span className="stat-label">מחיר ממוצע משוקלל</span>
            <span className="stat-value">
              {weightedAvgPrice !== null ? `$${formatNumber(weightedAvgPrice)}` : "-"}
            </span>
          </div>
          <div className="profit-targets-card">
            <h3>מחירי יעד למכירה</h3>
            <div className="custom-price-input" style={{ marginBottom: 8 }}>
              <label style={{ marginRight: 8 }}>הזן מחיר מותאם אישית:</label>
              <input
                type="text"
                value={customPriceInput}
                onChange={(e) => setCustomPriceInput(e.target.value)}
                placeholder="מחיר למניה"
                style={{ width: 120, marginRight: 8 }}
              />
              <span>
                {(() => {
                  const parsed = parseFloat(customPriceInput.replace(/[,\s\$]/g, ""));
                  const cp = Number.isFinite(parsed) ? parsed : null;
                  const profit = cp !== null ? calculateNetProfit(cp) : null;
                  return profit === null ? "-" : `$${formatNumber(profit)}`;
                })()}
              </span>
            </div>
            <div className="table-wrap stock-targets-table-wrap">
              <table className="stock-targets-table">
                <thead>
                  <tr>
                    <th>מחיר למניה</th>
                    <th>רווח מחושב</th>
                  </tr>
                </thead>
                <tbody>
                  {targetTableRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.price !== null ? `$${formatNumber(row.price)}` : "-"}
                        {row.isToday && row.price !== null ? (
                          <span className="stock-targets-current-label"> (מחיר נוכחי)</span>
                        ) : null}
                      </td>
                      <td>{row.profit !== null ? `$${formatNumber(row.profit)}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

          <div className="stock-transactions-card">
            <h2>קניות ומכירות</h2>
            {transactionRows.length === 0 ? (
              <div className="empty">אין פעולות קניה/מכירה למניה זו.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>פעולה</th>
                      <th>כמות</th>
                      <th>מחיר</th>
                      <th>עמלת פעולה</th>
                      <th>כמות מצטברת</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactionRows.map((row, index) => (
                      <tr key={`${row.dateLabel}-${index}`}>
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
                        <td>{row.price ? `${formatNumber(row.price)}$` : "-"}</td>
                        <td>{row.fee ? `${formatNumber(row.fee)}$` : "-"}</td>
                        <td>{formatNumber(row.cumulative)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="stock-transactions-card">
            <h2>דיבידנד לפי תאריך</h2>
            {dividendRows.length === 0 ? (
              <div className="empty">אין דיבידנדים למניה זו.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>סכום דיבידנד</th>
                      <th>מס</th>
                      <th>סכום מחושב</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRows.map((row, index) => (
                      <tr key={`${row.dateLabel}-${index}`}>
                        <td>{row.dateLabel}</td>
                        <td>{row.dividend ? `${formatNumber(row.dividend)}$` : "-"}</td>
                        <td>{row.tax ? `${formatNumber(row.tax)}$` : "-"}</td>
                        <td>{row.net ? `${formatNumber(row.net)}$` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="dividend-summary-row">
                      <td>סה"כ</td>
                      <td>{dividendTotals.dividend ? `${formatNumber(dividendTotals.dividend)}$` : "-"}</td>
                      <td>{dividendTotals.tax ? `${formatNumber(dividendTotals.tax)}$` : "-"}</td>
                      <td>{dividendTotals.net ? `${formatNumber(dividendTotals.net)}$` : "-"}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
    </div>
  );
};

export default StockDetail;
