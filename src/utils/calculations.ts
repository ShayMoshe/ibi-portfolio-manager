import {
  Transaction,
  Position,
  RealizedRound,
  StockPerformance,
  PortfolioSummary,
  ACTION,
  CAPITAL_GAINS_TAX_RATE,
} from "../types";
import type { StockPrice } from "../stockPriceService";
import { isStockSymbol, matchesDividendSymbol } from "./ibiParser";

const DAY_MS = 86_400_000;

// Unique alphabetic stock tickers, sorted.
export const getStockSymbols = (transactions: Transaction[]): string[] => {
  const symbols = new Set<string>();
  transactions.forEach((t) => {
    if (isStockSymbol(t.symbol)) symbols.add(t.symbol);
  });
  return Array.from(symbols).sort((a, b) => a.localeCompare(b));
};

// Buy/sell/grant transactions for one symbol, time-sorted with a running
// cumulative share count.
interface TradeTxn extends Transaction {
  isBuy: boolean;
  cumulative: number;
}

export const tradeTransactions = (transactions: Transaction[], symbol: string): TradeTxn[] => {
  const trades = transactions
    .filter(
      (t) =>
        t.symbol === symbol &&
        (t.action === ACTION.BUY_FX || t.action === ACTION.SELL_FX || t.action === ACTION.GRANT)
    )
    .map((t) => ({ ...t, isBuy: t.action !== ACTION.SELL_FX, cumulative: 0 }))
    .sort((a, b) => a.timestamp - b.timestamp);

  let cumulative = 0;
  trades.forEach((t) => {
    cumulative += t.delta;
    t.cumulative = cumulative;
  });
  return trades;
};

interface DividendEntry {
  timestamp: number;
  date: string;
  dividend: number;
  tax: number;
  net: number;
}

// Dividend/tax events for a symbol, collapsed per date.
export const dividendsForSymbol = (transactions: Transaction[], symbol: string): DividendEntry[] => {
  const byDate = new Map<string, DividendEntry>();
  transactions.forEach((t) => {
    const isDividend = t.action === ACTION.DIVIDEND;
    const isTax = t.action === ACTION.DIVIDEND_TAX;
    if (!isDividend && !isTax) return;
    if (!matchesDividendSymbol(t.name, symbol)) return;
    if (!t.timestamp || !t.date || t.quantity === 0) return;

    const entry =
      byDate.get(t.date) ?? { timestamp: t.timestamp, date: t.date, dividend: 0, tax: 0, net: 0 };
    if (isDividend) entry.dividend += t.quantity;
    else entry.tax += t.quantity;
    entry.net = entry.dividend - entry.tax;
    byDate.set(t.date, entry);
  });
  return Array.from(byDate.values()).sort((a, b) => a.timestamp - b.timestamp);
};

// Completed buy→sell cycles for a symbol (cumulative shares hit 0). Mirrors the
// logic in ClosedPositionDetail, including dividends earned within each window.
export const computeRealizedRounds = (
  transactions: Transaction[],
  symbol: string
): RealizedRound[] => {
  const trades = tradeTransactions(transactions, symbol);
  if (trades.length === 0) return [];
  const dividends = dividendsForSymbol(transactions, symbol);

  const rounds: RealizedRound[] = [];
  let start = 0;

  trades.forEach((t, i) => {
    if (Math.abs(t.cumulative) >= 0.0001) return;
    const slice = trades.slice(start, i + 1);
    start = i + 1;
    if (slice.length === 0) return;

    const first = slice[0];
    const last = slice[slice.length - 1];
    let costBasis = 0;
    let proceeds = 0;
    let buyFees = 0;
    let sellFees = 0;

    slice.forEach((txn) => {
      if (txn.isBuy) {
        costBasis += txn.price * txn.quantity;
        buyFees += txn.fee;
      } else {
        proceeds += txn.price * txn.quantity;
        sellFees += txn.fee;
      }
    });

    const totalFees = buyFees + sellFees;
    const netFromTrading = proceeds - costBasis - totalFees;
    const capitalGainsTax = netFromTrading > 0 ? netFromTrading * CAPITAL_GAINS_TAX_RATE : 0;
    const netAfterTax = netFromTrading - capitalGainsTax;

    const windowDivs = dividends.filter(
      (d) => d.timestamp >= first.timestamp && d.timestamp <= last.timestamp
    );
    const dividendsGross = windowDivs.reduce((s, d) => s + d.dividend, 0);
    const dividendsTax = windowDivs.reduce((s, d) => s + d.tax, 0);
    const dividendsNet = windowDivs.reduce((s, d) => s + d.net, 0);

    const finalPnL = netAfterTax + dividendsNet;
    const totalInvested = costBasis + buyFees;

    rounds.push({
      symbol,
      firstDate: first.date,
      lastDate: last.date,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp,
      durationDays: Math.round((last.timestamp - first.timestamp) / DAY_MS),
      costBasis,
      proceeds,
      buyFees,
      sellFees,
      totalFees,
      netFromTrading,
      capitalGainsTax,
      netAfterTax,
      dividendsGross,
      dividendsTax,
      dividendsNet,
      finalPnL,
      returnPercent: totalInvested > 0 ? (finalPnL / totalInvested) * 100 : 0,
    });
  });

  return rounds;
};

// The current open holding for a symbol (shares remaining after the last time
// the position was fully closed). Mirrors StockDetail's weighted-average logic.
export const computeOpenPosition = (
  transactions: Transaction[],
  symbol: string
): Position | null => {
  const trades = tradeTransactions(transactions, symbol);
  if (trades.length === 0) return null;

  let lastZeroIndex = -1;
  trades.forEach((t, i) => {
    if (Math.abs(t.cumulative) < 0.0001) lastZeroIndex = i;
  });
  const holding = trades.slice(lastZeroIndex + 1);
  const quantity = holding.length > 0 ? holding[holding.length - 1].cumulative : 0;
  if (quantity <= 0.0001) return null;

  let buyCost = 0;
  let buyQty = 0;
  let buyFees = 0;
  holding.forEach((t) => {
    if (t.isBuy) {
      buyCost += t.price * t.quantity;
      buyQty += t.quantity;
      buyFees += t.fee;
    }
  });

  const avgCost = buyQty > 0 ? buyCost / buyQty : 0;
  const firstBuy = holding[0];

  return {
    symbol,
    quantity,
    avgCost,
    costBasis: avgCost * quantity,
    buyFees,
    firstBuyTimestamp: firstBuy?.timestamp ?? 0,
    firstBuyDate: firstBuy?.date ?? "",
    holdingDays: firstBuy?.timestamp ? Math.round((Date.now() - firstBuy.timestamp) / DAY_MS) : 0,
  };
};

// All current open positions.
export const computeOpenPositions = (transactions: Transaction[]): Position[] =>
  getStockSymbols(transactions)
    .map((symbol) => computeOpenPosition(transactions, symbol))
    .filter((p): p is Position => p !== null);

// Aggregate realized performance per symbol (closed cycles only).
export const computeStockPerformance = (transactions: Transaction[]): StockPerformance[] => {
  const symbols = getStockSymbols(transactions);
  const openSymbols = new Set(computeOpenPositions(transactions).map((p) => p.symbol));

  return symbols
    .map((symbol) => {
      const rounds = computeRealizedRounds(transactions, symbol);
      const sum = (key: keyof RealizedRound) =>
        rounds.reduce((s, r) => s + (r[key] as number), 0);
      const costBasis = sum("costBasis");
      const finalPnL = sum("finalPnL");
      const totalInvested = costBasis + sum("buyFees");
      return {
        symbol,
        rounds: rounds.length,
        costBasis,
        proceeds: sum("proceeds"),
        fees: sum("totalFees"),
        netFromTrading: sum("netFromTrading"),
        capitalGainsTax: sum("capitalGainsTax"),
        dividendsNet: sum("dividendsNet"),
        finalPnL,
        returnPercent: totalInvested > 0 ? (finalPnL / totalInvested) * 100 : 0,
        isOpen: openSymbols.has(symbol),
      };
    })
    .filter((p) => p.rounds > 0 || p.isOpen);
};

// Fill live-valuation fields on positions from a price map and compute weights.
export const valuePositions = (
  positions: Position[],
  prices: Map<string, StockPrice>
): Position[] => {
  const valued = positions.map((p) => {
    const price = prices.get(p.symbol);
    if (!price) {
      return { ...p, marketValue: p.costBasis };
    }
    const marketValue = p.quantity * price.price;
    const unrealizedPnL = marketValue - p.costBasis;
    return {
      ...p,
      currentPrice: price.price,
      marketValue,
      unrealizedPnL,
      unrealizedPnLPercent: p.costBasis > 0 ? (unrealizedPnL / p.costBasis) * 100 : 0,
      dayChange: p.quantity * price.change,
    };
  });

  const total = valued.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  return valued.map((p) => ({
    ...p,
    weightPercent: total > 0 ? ((p.marketValue ?? 0) / total) * 100 : 0,
  }));
};

export const computePortfolioSummary = (
  positions: Position[],
  realizedRounds: RealizedRound[],
  prices: Map<string, StockPrice>,
  currentYear = new Date().getFullYear()
): PortfolioSummary => {
  const hasLivePrices = positions.some((p) => p.currentPrice !== undefined);
  const totalMarketValue = positions.reduce((s, p) => s + (p.marketValue ?? p.costBasis), 0);
  const totalCostBasis = positions.reduce((s, p) => s + p.costBasis, 0);
  const unrealizedPnL = totalMarketValue - totalCostBasis;
  const dayChange = positions.reduce((s, p) => s + (p.dayChange ?? 0), 0);
  const prevValue = totalMarketValue - dayChange;

  const realizedPnLAllTime = realizedRounds.reduce((s, r) => s + r.finalPnL, 0);
  const realizedPnLYTD = realizedRounds
    .filter((r) => new Date(r.lastTimestamp).getFullYear() === currentYear)
    .reduce((s, r) => s + r.finalPnL, 0);

  return {
    totalMarketValue,
    totalCostBasis,
    unrealizedPnL,
    unrealizedPnLPercent: totalCostBasis > 0 ? (unrealizedPnL / totalCostBasis) * 100 : 0,
    realizedPnLYTD,
    realizedPnLAllTime,
    holdingsCount: positions.length,
    dayChange,
    dayChangePercent: prevValue > 0 ? (dayChange / prevValue) * 100 : 0,
    hasLivePrices,
  };
};

// Allocation slices by market value (for the donut chart).
export interface AllocationSlice {
  symbol: string;
  value: number;
  percent: number;
}

export const computeAllocation = (positions: Position[]): AllocationSlice[] => {
  const total = positions.reduce((s, p) => s + (p.marketValue ?? p.costBasis), 0);
  return positions
    .map((p) => {
      const value = p.marketValue ?? p.costBasis;
      return { symbol: p.symbol, value, percent: total > 0 ? (value / total) * 100 : 0 };
    })
    .sort((a, b) => b.value - a.value);
};

// Realized P&L grouped by month, with a cumulative series (for the timeline).
export interface TimelineBucket {
  monthKey: string;
  monthLabel: string;
  timestamp: number;
  pnl: number;
  cumulative: number;
}

export const computeRealizedTimeline = (rounds: RealizedRound[]): TimelineBucket[] => {
  const closed = rounds.filter((r) => r.lastTimestamp > 0);
  if (closed.length === 0) return [];

  const byMonth = new Map<string, TimelineBucket>();
  closed.forEach((r) => {
    const d = new Date(r.lastTimestamp);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const bucket =
      byMonth.get(monthKey) ?? {
        monthKey,
        monthLabel: `${String(month).padStart(2, "0")}/${year}`,
        timestamp: new Date(year, month - 1, 1).getTime(),
        pnl: 0,
        cumulative: 0,
      };
    bucket.pnl += r.finalPnL;
    byMonth.set(monthKey, bucket);
  });

  let cumulative = 0;
  return Array.from(byMonth.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((b) => {
      cumulative += b.pnl;
      return { ...b, cumulative };
    });
};

// Per-year realized summary (for the year-comparison table).
export interface YearlySummary {
  year: number;
  trades: number;
  gains: number; // sum of profitable rounds' pre-tax trading P&L
  losses: number; // sum of losing rounds' pre-tax trading P&L (negative)
  netFromTrading: number;
  capitalGainsTax: number;
  dividendsNet: number;
  finalPnL: number;
}

export const computeYearlySummary = (rounds: RealizedRound[]): YearlySummary[] => {
  const byYear = new Map<number, YearlySummary>();
  rounds.forEach((r) => {
    const year = new Date(r.lastTimestamp).getFullYear();
    const e =
      byYear.get(year) ??
      {
        year,
        trades: 0,
        gains: 0,
        losses: 0,
        netFromTrading: 0,
        capitalGainsTax: 0,
        dividendsNet: 0,
        finalPnL: 0,
      };
    if (r.netFromTrading >= 0) e.gains += r.netFromTrading;
    else e.losses += r.netFromTrading;
    e.netFromTrading += r.netFromTrading;
    e.capitalGainsTax += r.capitalGainsTax;
    e.dividendsNet += r.dividendsNet;
    e.finalPnL += r.finalPnL;
    e.trades += 1;
    byYear.set(year, e);
  });
  return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
};

// Quarterly realized P&L per year, shaped for a grouped bar chart:
// [{ quarter: "Q1", "2025": 120, "2026": 80 }, ...]
export interface QuarterlyComparison {
  years: number[];
  data: Array<Record<string, number | string>>;
}

export const computeQuarterlyComparison = (rounds: RealizedRound[]): QuarterlyComparison => {
  const years = Array.from(
    new Set(rounds.map((r) => new Date(r.lastTimestamp).getFullYear()))
  ).sort((a, b) => a - b);

  const data: Array<Record<string, number | string>> = [1, 2, 3, 4].map((q) => {
    const row: Record<string, number | string> = { quarter: `Q${q}` };
    years.forEach((y) => {
      row[String(y)] = 0;
    });
    return row;
  });

  rounds.forEach((r) => {
    const d = new Date(r.lastTimestamp);
    const q = Math.floor(d.getMonth() / 3); // 0..3
    const key = String(d.getFullYear());
    data[q][key] = (data[q][key] as number) + r.finalPnL;
  });

  return { years, data };
};
