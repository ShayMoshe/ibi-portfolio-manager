import { useState, useEffect } from "react";
import { StockPrice } from "../stockPriceService";

interface Alert {
  id: string;
  symbol: string;
  condition: "above" | "below";
  targetPrice: number;
  triggered: boolean;
  createdAt: number;
}

const STORAGE_KEY = "ibi_price_alerts";

const loadAlerts = (): Alert[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
};

const saveAlerts = (alerts: Alert[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
};

interface PriceAlertsProps {
  symbols: string[];
  livePrices: Map<string, StockPrice>;
}

const PriceAlerts = ({ symbols, livePrices }: PriceAlertsProps) => {
  const [alerts, setAlerts] = useState<Alert[]>(loadAlerts);
  const [newSymbol, setNewSymbol] = useState(symbols[0] ?? "");
  const [newCondition, setNewCondition] = useState<"above" | "below">("above");
  const [newPrice, setNewPrice] = useState("");
  const [triggered, setTriggered] = useState<Alert[]>([]);

  // Check alerts whenever live prices update.
  useEffect(() => {
    const fired: Alert[] = [];
    const updated = alerts.map((alert) => {
      const price = livePrices.get(alert.symbol)?.price;
      if (!price || alert.triggered) return alert;
      const hit = alert.condition === "above" ? price >= alert.targetPrice : price <= alert.targetPrice;
      if (hit) {
        fired.push({ ...alert, triggered: true });
        return { ...alert, triggered: true };
      }
      return alert;
    });
    if (fired.length > 0) {
      setAlerts(updated);
      saveAlerts(updated);
      setTriggered((prev) => [...prev, ...fired]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrices]);

  const addAlert = () => {
    const price = parseFloat(newPrice);
    if (!newSymbol || !Number.isFinite(price) || price <= 0) return;
    const alert: Alert = {
      id: `${Date.now()}-${newSymbol}`,
      symbol: newSymbol,
      condition: newCondition,
      targetPrice: price,
      triggered: false,
      createdAt: Date.now(),
    };
    const updated = [...alerts, alert];
    setAlerts(updated);
    saveAlerts(updated);
    setNewPrice("");
  };

  const removeAlert = (id: string) => {
    const updated = alerts.filter((a) => a.id !== id);
    setAlerts(updated);
    saveAlerts(updated);
  };

  const dismissTriggered = (id: string) => setTriggered((prev) => prev.filter((a) => a.id !== id));

  return (
    <div className="alerts-panel">
      {triggered.map((a) => (
        <div key={a.id} className="alert-triggered-banner">
          🔔 <strong>{a.symbol}</strong> עבר {a.condition === "above" ? "מעל" : "מתחת"} ${a.targetPrice}
          <button className="alert-dismiss" onClick={() => dismissTriggered(a.id)}>
            ✕
          </button>
        </div>
      ))}

      <div className="alert-add-row">
        <select value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} className="alert-select">
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={newCondition}
          onChange={(e) => setNewCondition(e.target.value as "above" | "below")}
          className="alert-select"
        >
          <option value="above">מעל</option>
          <option value="below">מתחת</option>
        </select>
        <input
          type="number"
          placeholder="מחיר יעד $"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          className="alert-price-input"
          step="0.01"
          min="0"
        />
        <button
          type="button"
          className="upload"
          onClick={addAlert}
          style={{ padding: "8px 16px", fontSize: "0.88rem" }}
        >
          + הוסף התראה
        </button>
      </div>

      {alerts.length > 0 ? (
        <div className="alerts-list">
          {alerts.map((a) => {
            const currentPrice = livePrices.get(a.symbol)?.price;
            return (
              <div key={a.id} className={`alert-item ${a.triggered ? "alert-item-triggered" : ""}`}>
                <span className="alert-symbol">{a.symbol}</span>
                <span className="alert-condition">{a.condition === "above" ? "↑ מעל" : "↓ מתחת"}</span>
                <span className="mono alert-target">${a.targetPrice.toFixed(2)}</span>
                {currentPrice ? (
                  <span className="mono alert-current val-muted">כעת: ${currentPrice.toFixed(2)}</span>
                ) : (
                  <span className="alert-current val-muted">—</span>
                )}
                <span className={`alert-status ${a.triggered ? "val-positive" : "val-muted"}`}>
                  {a.triggered ? "✓ הופעל" : "⏳ ממתין"}
                </span>
                <button className="alert-remove" onClick={() => removeAlert(a.id)}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty" style={{ padding: "20px 0" }}>
          אין התראות. הגדר התראה ראשונה למעלה.
        </p>
      )}
    </div>
  );
};

export default PriceAlerts;
