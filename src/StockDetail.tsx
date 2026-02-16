import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Area, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchHistoricalData, fetchStockPrice, HistoricalDataPoint, StockPrice, RateLimitError } from "./stockPriceService";

interface StockDetailProps {
  ticker: string;
  rows: Record<string, string>[];
  onBack: () => void;
}

const StockDetail = ({ ticker, rows, onBack }: StockDetailProps) => {
  const [price, setPrice] = useState<StockPrice | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

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


  const dividendRows = useMemo(() => {
    const byDate = new Map<string, { timestamp: number; dateLabel: string; dividend: number; tax: number }>();

    rows.forEach((row) => {
      const actionType = String(row["סוג פעולה"] ?? "").trim();
      const stockName = String(row["שם נייר"] ?? "").trim();
      if (!stockName.includes(ticker)) {
        return;
      }

      const isDividend = actionType === "הפקדה דיבידנד מטח";
      const isTax = actionType === "משיכת מס חול מטח";
      if (!isDividend && !isTax) {
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

  useEffect(() => {
    const loadData = async () => {
      setIsPriceLoading(true);
      setIsHistoryLoading(true);
      setPriceError(null);
      setHistoryError(null);
      setPrice(null);
      setHistoricalData([]);

      const [priceResult, historyResult] = await Promise.allSettled([
        fetchStockPrice(ticker),
        fetchHistoricalData(ticker),
      ]);

      if (priceResult.status === "fulfilled") {
        setPrice(priceResult.value);
      } else {
        console.error("Failed to load stock price:", priceResult.reason);
        if (priceResult.reason instanceof RateLimitError) {
          setPriceError("הגעת למגבלת השימוש היומית של ה-API עבור מחיר המניה. נסה שוב מאוחר יותר.");
        } else {
          setPriceError("שגיאה בטעינת מחיר המניה. נסה שוב מאוחר יותר.");
        }
      }

      if (historyResult.status === "fulfilled") {
        setHistoricalData(historyResult.value);
      } else {
        console.error("Failed to load historical data:", historyResult.reason);
        if (historyResult.reason instanceof RateLimitError) {
          setHistoryError("הגעת למגבלת השימוש היומית של ה-API עבור הגרף. נסה שוב מאוחר יותר.");
        } else {
          setHistoryError("שגיאה בטעינת נתוני הגרף. נסה שוב מאוחר יותר.");
        }
      }

      setIsPriceLoading(false);
      setIsHistoryLoading(false);
    };

    loadData();
  }, [ticker]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("he-IL", { month: "short", day: "numeric" });
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="chart-tooltip">
          <p className="tooltip-date">{formatDate(payload[0].payload.date)}</p>
          <p className="tooltip-price">${payload[0].value.toFixed(2)}</p>
          <p className="tooltip-label">מחיר סגירה</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="stock-detail">
      <button className="back-button" onClick={onBack}>
        ← חזרה לרשימת מניות
      </button>

      {(priceError || historyError) && (
        <div className="error-message">
          {priceError && <p>⚠️ {priceError}</p>}
          {historyError && <p>⚠️ {historyError}</p>}
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

        <div className="chart-card">
          <div className="chart-header">
            <h2>מחיר ב-90 הימים האחרונים</h2>
            {isHistoryLoading && <span className="chart-status">טוען גרף...</span>}
          </div>
          {historicalData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={historicalData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                <defs>
                  <linearGradient id="priceGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f172a" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  stroke="#64748b"
                  tickMargin={8}
                  style={{ fontSize: "0.85rem" }}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                  stroke="#64748b"
                  width={60}
                  style={{ fontSize: "0.85rem" }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="none"
                  fill="url(#priceGlow)"
                />
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="#0f172a"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: "#0f172a", fill: "#ffffff" }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : isHistoryLoading ? (
            <div className="loading">טוען נתוני גרף...</div>
          ) : (
            <div className="empty">אין נתונים היסטוריים זמינים</div>
          )}
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
