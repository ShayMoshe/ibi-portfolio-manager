import { useEffect, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { fetchHistoricalData, fetchStockPrice, HistoricalDataPoint, StockPrice, RateLimitError } from "./stockPriceService";

interface StockDetailProps {
  ticker: string;
  onBack: () => void;
}

const StockDetail = ({ ticker, onBack }: StockDetailProps) => {
  const [price, setPrice] = useState<StockPrice | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [priceData, historical] = await Promise.all([
          fetchStockPrice(ticker),
          fetchHistoricalData(ticker),
        ]);
        setPrice(priceData);
        setHistoricalData(historical);
      } catch (error) {
        console.error("Failed to load stock data:", error);
        if (error instanceof RateLimitError) {
          setError('הגעת למגבלת השימוש היומית של ה-API. הנתונים יטענו מהזיכרון המטמון או שתוכל לנסות שוב מחר.');
        } else {
          setError('שגיאה בטעינת נתוני המניה. אנא נסה שוב מאוחר יותר.');
        }
      } finally {
        setIsLoading(false);
      }
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

      {error && (
        <div className="error-message">
          <p>⚠️ {error}</p>
          <p className="error-hint">הנתונים המוצגים עשויים להיות מהזיכרון המטמון (עד 24 שעות)</p>
        </div>
      )}

      {isLoading ? (
        <div className="loading">טוען נתונים...</div>
      ) : (
        <>
          <div className="stock-header">
            <h1 className="stock-ticker">{ticker}</h1>
            {price && (
              <div className="stock-info">
                <div className="price-section">
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
                </div>
              </div>
            )}
          </div>

          <div className="chart-card">
            <h2>מחיר ב-90 הימים האחרונים</h2>
            {historicalData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={historicalData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#64748b"
                    style={{ fontSize: "0.875rem" }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                    stroke="#64748b"
                    style={{ fontSize: "0.875rem" }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty">אין נתונים היסטוריים זמינים</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StockDetail;
