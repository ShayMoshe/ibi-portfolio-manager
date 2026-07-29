import { useCallback, useMemo, useState } from "react";
import { RawRow, Transaction, RealizedRound } from "../types";
import { toTransactions } from "../utils/ibiParser";
import {
  getStockSymbols,
  computeOpenPositions,
  computeRealizedRounds,
  computeStockPerformance,
  valuePositions,
  computePortfolioSummary,
  computeAllocation,
  computeRealizedTimeline,
  computeYearlySummary,
  computeQuarterlyComparison,
} from "../utils/calculations";
import {
  fetchMultipleStockPrices,
  getCachedStockPrice,
  StockPrice,
  RateLimitError,
} from "../stockPriceService";

// Single source of derived portfolio state. Takes the raw parsed rows and
// exposes typed transactions, derived positions, realized P&L, and live-price
// loading. New dashboard/analytics components consume this; existing tabs keep
// their own logic until migrated.
export const usePortfolio = (rows: RawRow[]) => {
  const [livePrices, setLivePrices] = useState<Map<string, StockPrice>>(new Map());
  const [pricesLoading, setPricesLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  const transactions: Transaction[] = useMemo(() => toTransactions(rows), [rows]);
  const symbols = useMemo(() => getStockSymbols(transactions), [transactions]);

  const basePositions = useMemo(() => computeOpenPositions(transactions), [transactions]);

  const positions = useMemo(
    () => valuePositions(basePositions, livePrices),
    [basePositions, livePrices]
  );

  const realizedRounds: RealizedRound[] = useMemo(
    () => symbols.flatMap((symbol) => computeRealizedRounds(transactions, symbol)),
    [symbols, transactions]
  );

  const stockPerformance = useMemo(
    () => computeStockPerformance(transactions),
    [transactions]
  );

  const summary = useMemo(
    () => computePortfolioSummary(positions, realizedRounds, livePrices),
    [positions, realizedRounds, livePrices]
  );

  const allocation = useMemo(() => computeAllocation(positions), [positions]);
  const realizedTimeline = useMemo(() => computeRealizedTimeline(realizedRounds), [realizedRounds]);
  const yearlySummary = useMemo(() => computeYearlySummary(realizedRounds), [realizedRounds]);
  const quarterlyComparison = useMemo(
    () => computeQuarterlyComparison(realizedRounds),
    [realizedRounds]
  );

  // Hydrate from cache immediately, then refresh from the network.
  const refreshPrices = useCallback(async () => {
    if (basePositions.length === 0) return;
    const openSymbols = basePositions.map((p) => p.symbol);

    const cached = new Map<string, StockPrice>();
    openSymbols.forEach((symbol) => {
      const hit = getCachedStockPrice(symbol);
      if (hit) cached.set(symbol, hit);
    });
    if (cached.size > 0) setLivePrices((prev) => new Map([...prev, ...cached]));

    setPricesLoading(true);
    setPriceError(null);
    try {
      const fresh = await fetchMultipleStockPrices(openSymbols);
      if (fresh.size > 0) setLivePrices((prev) => new Map([...prev, ...fresh]));
    } catch (err) {
      if (err instanceof RateLimitError) {
        setPriceError("מקור המחירים החינמי הגיע למגבלת שימוש זמנית. נסה שוב מאוחר יותר.");
      } else {
        setPriceError("שגיאה בטעינת מחירים ממקור חינמי. יוצגו נתונים מהמטמון אם קיימים.");
      }
    } finally {
      setPricesLoading(false);
    }
  }, [basePositions]);

  return {
    transactions,
    symbols,
    positions,
    realizedRounds,
    stockPerformance,
    summary,
    allocation,
    realizedTimeline,
    yearlySummary,
    quarterlyComparison,
    livePrices,
    pricesLoading,
    priceError,
    refreshPrices,
  };
};
