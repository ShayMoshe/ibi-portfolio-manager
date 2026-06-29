import { useEffect, useMemo, useState } from "react";
import {
  fetchStockPrice,
  getCachedStockPrice,
  StockPrice,
  RateLimitError,
  MissingApiKeyError,
} from "./stockPriceService";
import { parseDateToTimestamp, formatDateLabel, formatDuration } from "./utils/dates";
import { formatNumber, formatUsd, formatSignedUsd, formatPercent } from "./utils/format";
import KPICard from "./components/KPICard";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";

interface StockDetailProps {
  ticker: string;
  rows: Record<string, string>[];
  onBack: () => void;
  portfolioValue?: number;
  // This ticker also has a closed (past) trade — sold to zero earlier, then
  // re-bought. Surface a link to that closed-position summary.
  hasPastTrade?: boolean;
  onViewPastTrade?: () => void;
}

// Public, no-login stock-analysis sites that resolve by ticker alone.
// (Google Finance needs an exchange suffix, so we link a Google search instead —
// it reliably surfaces the finance card without us guessing the exchange.)
const ANALYSIS_LINKS: { label: string; build: (t: string) => string }[] = [
  { label: "Yahoo Finance", build: (t) => `https://finance.yahoo.com/quote/${encodeURIComponent(t)}` },
  { label: "Google", build: (t) => `https://www.google.com/search?q=${encodeURIComponent(`${t} stock`)}` },
  { label: "StockAnalysis", build: (t) => `https://stockanalysis.com/stocks/${encodeURIComponent(t)}/` },
  { label: "Finviz", build: (t) => `https://finviz.com/quote.ashx?t=${encodeURIComponent(t)}` },
  { label: "TradingView", build: (t) => `https://www.tradingview.com/symbols/${encodeURIComponent(t)}/` },
  { label: "CNBC", build: (t) => `https://www.cnbc.com/quotes/${encodeURIComponent(t)}` },
  { label: "𝕏", build: (t) => `https://x.com/search?q=${encodeURIComponent(`@${t}`)}&src=typed_query` },
];

// Persist the profit-range slider choice across sessions.
const PROFIT_RANGE_KEY = "ibi_profit_range_max";
const loadProfitRange = (): number => {
  const v = Number(localStorage.getItem(PROFIT_RANGE_KEY));
  return Number.isFinite(v) && v >= 100 && v <= 5000 ? v : 500;
};

const StockDetail = ({
  ticker,
  rows,
  onBack,
  portfolioValue,
  hasPastTrade,
  onViewPastTrade,
}: StockDetailProps) => {
  const [price, setPrice] = useState<StockPrice | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);

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

  // Live valuation of the current holding (uses the live price + cost basis).
  const holdingStats = useMemo(() => {
    const qty = currentHoldingQty;
    if (qty <= 0) return null;
    const avgCost = weightedAvgPrice ?? 0;
    const costBasis = avgCost * qty;
    const start = currentHoldingRows.length > 0 ? currentHoldingRows[0].timestamp : 0;
    const holdingDays = start ? Math.round((Date.now() - start) / 86400000) : 0;

    // ימי אחזקה ממוצעים: ממוצע משוקלל של הימים מאז כל רכישה, לפי הכמות שנרכשה בכל פעם.
    // רלוונטי רק כשיש יותר מרכישה אחת — אחרת הוא זהה ל"ימי אחזקה".
    let weightedDaysSum = 0;
    let buyQty = 0;
    let buyCount = 0;
    currentHoldingRows.forEach((row) => {
      if (row.actionLabel === "קנייה" || row.actionLabel === "הטבה") {
        const days = (Date.now() - row.timestamp) / 86400000;
        weightedDaysSum += days * row.quantity;
        buyQty += row.quantity;
        buyCount += 1;
      }
    });
    const avgHoldingDays = buyCount > 1 && buyQty > 0 ? Math.round(weightedDaysSum / buyQty) : null;

    const currentValue = price ? price.price * qty : null;
    const unrealizedPnL = currentValue !== null ? currentValue - costBasis : null;
    const unrealizedPct =
      unrealizedPnL !== null && costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : null;
    const weight =
      currentValue !== null && portfolioValue && portfolioValue > 0
        ? (currentValue / portfolioValue) * 100
        : null;
    return { qty, avgCost, costBasis, holdingDays, avgHoldingDays, currentValue, unrealizedPnL, unrealizedPct, weight };
  }, [currentHoldingQty, weightedAvgPrice, currentHoldingRows, price, portfolioValue]);

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
  const [profitRangeMax, setProfitRangeMax] = useState<number>(loadProfitRange);

  useEffect(() => {
    try {
      localStorage.setItem(PROFIT_RANGE_KEY, String(profitRangeMax));
    } catch {
      /* ignore storage errors */
    }
  }, [profitRangeMax]);

  const chartData = useMemo(() => {
    if (breakEvenPrice === null || currentHoldingQty <= 0) return [];
    const priceRange = (profitRangeMax / 0.75) / currentHoldingQty;
    const minPrice = Math.max(0.01, breakEvenPrice - priceRange * 0.4);
    const maxPrice = breakEvenPrice + priceRange;
    return Array.from({ length: 121 }, (_, i) => {
      const p = minPrice + (maxPrice - minPrice) * (i / 120);
      return {
        price: parseFloat(p.toFixed(2)),
        netProfit: parseFloat((calculateNetProfit(p) ?? 0).toFixed(2)),
      };
    });
  }, [breakEvenPrice, currentHoldingQty, profitRangeMax]);

  const gradientOffset = useMemo(() => {
    if (!chartData.length) return 100;
    const max = Math.max(...chartData.map((d) => d.netProfit));
    const min = Math.min(...chartData.map((d) => d.netProfit));
    if (max <= 0) return 0;
    if (min >= 0) return 100;
    return (max / (max - min)) * 100;
  }, [chartData]);

  const chartRefDots = useMemo(() => {
    if (breakEvenPrice === null || currentHoldingQty <= 0 || chartData.length === 0) return [];
    const minP = chartData[0].price;
    const maxP = chartData[chartData.length - 1].price;
    const dots: { key: string; x: number; y: number; fill: string; label: string; profit: number }[] = [];

    if (breakEvenPrice >= minP && breakEvenPrice <= maxP) {
      dots.push({ key: "be", x: breakEvenPrice, y: 0, fill: "#64748b", label: "ללא הפסד", profit: 0 });
    }
    profitTargetRows.forEach((row) => {
      if (row.price !== null && row.price >= minP && row.price <= maxP) {
        dots.push({ key: `t${row.target}`, x: row.price, y: row.target, fill: "#15803d", label: `רווח $${row.target}`, profit: row.target });
      }
    });
    if (price?.price && price.price >= minP && price.price <= maxP) {
      const p = calculateNetProfit(price.price) ?? 0;
      dots.push({ key: "today", x: price.price, y: p, fill: "#2563eb", label: "מחיר היום", profit: p });
    }
    return dots;
  }, [breakEvenPrice, currentHoldingQty, chartData, profitTargetRows, price]);

  const customPriceForChart = useMemo(() => {
    const parsed = parseFloat(customPriceInput.replace(/[,\s$]/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    if (breakEvenPrice === null || currentHoldingQty <= 0) return null;
    const profit = calculateNetProfit(parsed) ?? 0;
    const inRange = chartData.length > 0 && parsed >= chartData[0].price && parsed <= chartData[chartData.length - 1].price;
    return { price: parsed, profit, inRange };
  }, [customPriceInput, breakEvenPrice, currentHoldingQty, chartData]);

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
        if (err instanceof MissingApiKeyError) {
          setPriceError("חסר מפתח API של Finnhub. הגדר VITE_FINNHUB_API_KEY בקובץ .env.local.");
        } else if (err instanceof RateLimitError) {
          setPriceError("הגעת למגבלת השימוש של ה-API עבור מחיר המניה (60 בקשות לדקה). נסה שוב מאוחר יותר.");
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

      {hasPastTrade && onViewPastTrade && (
        <button className="detail-cross-link" onClick={onViewPastTrade}>
          <span className="detail-cross-link-icon">🕒</span>
          <span>למניה זו יש עסקת עבר (נמכרה ונקנתה מחדש) — צפה בסיכום העסקה הסגורה</span>
          <span className="detail-cross-link-arrow">←</span>
        </button>
      )}

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
              {ANALYSIS_LINKS.map((link) => (
                <a
                  key={link.label}
                  className="stock-link"
                  href={link.build(ticker)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
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

        {holdingStats && (
          <div className="stock-kpi-grid">
            <KPICard label="כמות" value={formatNumber(holdingStats.qty)} icon="📦" />
            <KPICard label="מחיר ממוצע" value={formatUsd(holdingStats.avgCost)} icon="🧾" />
            <KPICard label="עלות כוללת" value={formatUsd(holdingStats.costBasis)} icon="💵" />
            <KPICard
              label="שווי נוכחי"
              value={holdingStats.currentValue !== null ? formatUsd(holdingStats.currentValue) : "—"}
              icon="💼"
            />
            <KPICard
              label="רווח/הפסד לא ממומש"
              value={
                holdingStats.unrealizedPnL !== null ? formatSignedUsd(holdingStats.unrealizedPnL) : "—"
              }
              change={
                holdingStats.unrealizedPct !== null
                  ? formatPercent(holdingStats.unrealizedPct)
                  : undefined
              }
              changeKind={
                holdingStats.unrealizedPnL === null
                  ? "neutral"
                  : holdingStats.unrealizedPnL >= 0
                  ? "positive"
                  : "negative"
              }
              icon="📈"
            />
            <KPICard
              label='סה"כ דיבידנד'
              value={dividendTotals.dividend > 0 ? formatUsd(dividendTotals.dividend) : "—"}
              changeKind={dividendTotals.dividend > 0 ? "positive" : "neutral"}
              sub={dividendTotals.dividend > 0 ? `נטו ${formatUsd(dividendTotals.net)}` : undefined}
              icon="💰"
            />
            <KPICard
              label="ימי אחזקה"
              value={String(holdingStats.holdingDays)}
              sub={
                holdingStats.avgHoldingDays !== null
                  ? `ממוצע משוקלל ${holdingStats.avgHoldingDays}`
                  : undefined
              }
              icon="📅"
            />
            <KPICard
              label="% מהתיק"
              value={holdingStats.weight !== null ? `${holdingStats.weight.toFixed(1)}%` : "—"}
              icon="⚖️"
            />
          </div>
        )}

        <div className="stock-stats-card">
          <div className="profit-chart-card">
            <div className="profit-chart-header">
              <h3>רווח / הפסד לפי מחיר מכירה</h3>
              <div className="profit-chart-controls">
                <span className="profit-chart-range-label">טווח: עד ${formatNumber(profitRangeMax)}</span>
                <input
                  type="range"
                  min={100}
                  max={5000}
                  step={100}
                  value={profitRangeMax}
                  onChange={(e) => setProfitRangeMax(Number(e.target.value))}
                  className="profit-range-slider"
                />
              </div>
            </div>

            <div className="profit-chart-custom-input">
              <span>מחיר מותאם:</span>
              <input
                type="text"
                value={customPriceInput}
                onChange={(e) => setCustomPriceInput(e.target.value)}
                placeholder="הזן מחיר"
                className="profit-custom-price-input"
              />
              {customPriceForChart && (
                <span className={customPriceForChart.profit >= 0 ? "profit-val-positive" : "profit-val-negative"}>
                  {customPriceForChart.profit >= 0 ? "+" : ""}${formatNumber(customPriceForChart.profit)}
                  {!customPriceForChart.inRange && <span className="profit-out-of-range"> (מחוץ לטווח)</span>}
                </span>
              )}
            </div>

            <div className="profit-chart-body">
              <div className="profit-chart-plot">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ top: 14, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="chartFillGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset={`${gradientOffset}%`} stopColor="#22c55e" stopOpacity={0.22} />
                      <stop offset={`${gradientOffset}%`} stopColor="#ef4444" stopOpacity={0.22} />
                    </linearGradient>
                    <linearGradient id="chartStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset={`${gradientOffset}%`} stopColor="#22c55e" stopOpacity={1} />
                      <stop offset={`${gradientOffset}%`} stopColor="#ef4444" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="price"
                    tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickCount={6}
                  />
                  <YAxis
                    tickFormatter={(v) => `${Number(v) < 0 ? "-" : ""}$${formatNumber(Math.abs(Number(v)))}`}
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as { price: number; netProfit: number };
                      return (
                        <div className="profit-chart-tooltip">
                          <div>מחיר: <strong>${d.price.toFixed(2)}</strong></div>
                          <div className={d.netProfit >= 0 ? "profit-val-positive" : "profit-val-negative"}>
                            רווח נטו: {d.netProfit >= 0 ? "+" : ""}${formatNumber(d.netProfit)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="5 3" strokeWidth={1} />
                  <Area
                    type="monotone"
                    dataKey="netProfit"
                    stroke="url(#chartStrokeGradient)"
                    strokeWidth={2.5}
                    fill="url(#chartFillGradient)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                  {chartRefDots.map((dot) => (
                    <ReferenceDot
                      key={dot.key}
                      x={dot.x}
                      y={dot.y}
                      r={5}
                      fill={dot.fill}
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  ))}
                  {customPriceForChart?.inRange && (
                    <ReferenceDot
                      x={customPriceForChart.price}
                      y={customPriceForChart.profit}
                      r={5}
                      fill="#f59e0b"
                      stroke="#ffffff"
                      strokeWidth={2}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="profit-chart-empty">הזן נתוני קנייה לתצוגת הגרף.</div>
            )}
              </div>
              <div className="profit-targets-side">
                <div className="profit-targets-title">מחיר מכירה ליעד רווח נטו</div>
                <table className="profit-targets-table">
                  <thead>
                    <tr>
                      <th>רווח נטו</th>
                      <th>מחיר מכירה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakEvenPrice !== null && (
                      <tr>
                        <td>ללא הפסד</td>
                        <td className="mono">${formatNumber(breakEvenPrice)}</td>
                      </tr>
                    )}
                    {profitTargetRows.map((row) => (
                      <tr key={row.target}>
                        <td className="val-positive">+${row.target}</td>
                        <td className="mono">
                          {row.price !== null ? `$${formatNumber(row.price)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="profit-chart-legend">
              {chartRefDots.map((dot) => (
                <div key={dot.key} className="profit-legend-item">
                  <span className="profit-legend-dot" style={{ background: dot.fill }} />
                  <span className="profit-legend-label">{dot.label}</span>
                  <span className="profit-legend-price">${formatNumber(dot.x)}</span>
                  <span className={`profit-legend-val ${dot.profit >= 0 ? "profit-val-positive" : "profit-val-negative"}`}>
                    {dot.profit >= 0 ? "+" : ""}${formatNumber(dot.profit)}
                  </span>
                </div>
              ))}
              {customPriceForChart && (
                <div className="profit-legend-item">
                  <span className="profit-legend-dot" style={{ background: "#f59e0b" }} />
                  <span className="profit-legend-label">מותאם</span>
                  <span className="profit-legend-price">${formatNumber(customPriceForChart.price)}</span>
                  <span className={`profit-legend-val ${customPriceForChart.profit >= 0 ? "profit-val-positive" : "profit-val-negative"}`}>
                    {customPriceForChart.profit >= 0 ? "+" : ""}${formatNumber(customPriceForChart.profit)}
                  </span>
                </div>
              )}
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
