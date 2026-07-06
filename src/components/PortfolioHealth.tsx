import { useMemo } from "react";
import { usePortfolio } from "../hooks/usePortfolio";
import { ACTION } from "../types";
import { formatSignedUsd, formatUsd } from "../utils/format";

type Portfolio = ReturnType<typeof usePortfolio>;

interface PortfolioHealthProps {
  portfolio: Portfolio;
}

type HealthKind = "good" | "warn" | "bad" | "info";

interface HealthItem {
  title: string;
  value: string;
  note: string;
  kind: HealthKind;
}

const PortfolioHealth = ({ portfolio }: PortfolioHealthProps) => {
  const { positions, allocation, livePrices, stockPerformance, realizedRounds, transactions, summary } =
    portfolio;

  const items = useMemo<HealthItem[]>(() => {
    const top = allocation[0];
    const top3 = allocation.slice(0, 3).reduce((sum, slice) => sum + slice.percent, 0);
    const pricedCount = positions.filter((p) => livePrices.has(p.symbol)).length;
    const priceCoverage = positions.length > 0 ? (pricedCount / positions.length) * 100 : 0;

    const totalFees = stockPerformance.reduce((sum, stock) => sum + stock.fees, 0);
    const turnover = stockPerformance.reduce((sum, stock) => sum + stock.costBasis + stock.proceeds, 0);
    const feeDrag = turnover > 0 ? (totalFees / turnover) * 100 : 0;

    const closed = realizedRounds.length;
    const winners = realizedRounds.filter((round) => round.finalPnL > 0).length;
    const winRate = closed > 0 ? (winners / closed) * 100 : 0;

    const dividendsNet = transactions.reduce((sum, transaction) => {
      if (transaction.action === ACTION.DIVIDEND) return sum + transaction.quantity;
      if (transaction.action === ACTION.DIVIDEND_TAX) return sum - transaction.quantity;
      return sum;
    }, 0);

    return [
      {
        title: "ריכוזיות גבוהה",
        value: top ? `${top.symbol} · ${top.percent.toFixed(1)}%` : "אין נתונים",
        note:
          top && top.percent > 30
            ? "מניה אחת תופסת חלק גדול מהתיק. כדאי לבדוק אם זה מכוון."
            : "אין מניה בודדת שחוצה 30% מהתיק.",
        kind: top && top.percent > 30 ? "warn" : "good",
      },
      {
        title: "שלוש אחזקות מובילות",
        value: `${top3.toFixed(1)}%`,
        note:
          top3 > 65
            ? "רוב התיק יושב במספר קטן של מניות."
            : "הפיזור בין האחזקות המובילות סביר.",
        kind: top3 > 65 ? "warn" : "good",
      },
      {
        title: "כיסוי מחירים חיים",
        value: `${pricedCount}/${positions.length}`,
        note:
          priceCoverage < 80
            ? "חלק גדול מהשווי עדיין מחושב לפי עלות רכישה."
            : "רוב האחזקות מתומחרות לפי מחיר עדכני או מטמון טרי.",
        kind: priceCoverage < 80 ? "warn" : "good",
      },
      {
        title: "גרירת עמלות",
        value: `${feeDrag.toFixed(2)}%`,
        note:
          feeDrag > 1
            ? `עמלות מצטברות: ${formatUsd(totalFees)}. כדאי לבדוק תדירות מסחר וגודל פקודות.`
            : `עמלות מצטברות: ${formatUsd(totalFees)} ביחס למחזור סביר.`,
        kind: feeDrag > 1 ? "warn" : "good",
      },
      {
        title: "עסקאות סגורות",
        value: closed > 0 ? `${winRate.toFixed(0)}% הצלחה` : "אין עסקאות",
        note:
          closed > 0
            ? `${closed} עסקאות, רווח ממומש כולל ${formatSignedUsd(summary.realizedPnLAllTime)}.`
            : "אין עדיין עסקאות סגורות לניתוח.",
        kind: closed === 0 ? "info" : summary.realizedPnLAllTime >= 0 ? "good" : "bad",
      },
      {
        title: "דיבידנד נטו",
        value: formatSignedUsd(dividendsNet),
        note:
          dividendsNet > 0
            ? "יש תרומה חיובית מדיבידנדים לאחר מס."
            : "אין תרומת דיבידנד נטו חיובית בנתונים.",
        kind: dividendsNet > 0 ? "good" : "info",
      },
    ];
  }, [allocation, livePrices, positions, realizedRounds, stockPerformance, summary, transactions]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <div className="dashboard-card portfolio-health-card">
      <div className="dashboard-card-head">
        <h3>בדיקת בריאות לתיק</h3>
        <span className="dashboard-card-note">חישוב מקומי בלבד, ללא שליחת נתונים</span>
      </div>
      <div className="health-grid">
        {items.map((item) => (
          <div key={item.title} className={`health-item health-${item.kind}`}>
            <div className="health-title">{item.title}</div>
            <div className="health-value mono">{item.value}</div>
            <div className="health-note">{item.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PortfolioHealth;
