// ---------------------------------------------------------------------------
// Domain types for the IBI portfolio manager.
//
// IMPORTANT: IBI exports are TRANSACTION logs, not position snapshots. Every
// XLSX row is one transaction (buy / sell / dividend / deposit / tax). Positions,
// cost basis and realized P&L are all *derived* by netting transactions per
// symbol. The product spec's position-shaped `IbiRow` / `COLUMN_MAP` do not
// exist in the real files — these types model what the files actually contain.
// ---------------------------------------------------------------------------

// The 13 fixed columns present in every IBI sheet (Hebrew headers, verbatim).
export const IBI_COLUMNS = [
  "תאריך",
  "סוג פעולה",
  "שם נייר",
  "מס' נייר / סימבול",
  "כמות",
  "שער ביצוע",
  "מטבע",
  "עמלת פעולה",
  "עמלות נלוות",
  'תמורה במט"ח',
  "תמורה בשקלים",
  "יתרה שקלית",
  "אומדן מס רווחי הון",
] as const;

export type IbiColumn = (typeof IBI_COLUMNS)[number];

// Raw row as read from a sheet — every cell stringified.
export type RawRow = Record<IbiColumn, string>;

// Action-type strings exactly as they appear in "סוג פעולה".
export const ACTION = {
  BUY_FX: "קניה חול מטח", // foreign-currency buy (adds shares)
  SELL_FX: "מכירה חול מטח", // foreign-currency sell (removes shares)
  BUY_ILS: "קניה שח", // ILS buy (FX conversions, "מס ששולם", etc.)
  SELL_ILS: "מכירה שח",
  GRANT: "הטבה", // share grant — treated as a buy for holdings
  DIVIDEND: "הפקדה דיבידנד מטח", // dividend deposit (USD)
  DIVIDEND_TAX: "משיכת מס חול מטח", // dividend tax withholding (USD)
  CASH_TRANSFER: "העברה מזומן בשח", // cash deposit into the account (ILS)
  DEPOSIT: "הפקדה",
  WITHDRAWAL: "משיכה",
  INTEREST: "משיכת ריבית מטח",
  MISC_CASH: "שונות מזומן בשח",
} as const;

// Actions that increase a holding's share count.
export const BUY_ACTIONS: readonly string[] = [ACTION.BUY_FX, ACTION.GRANT];
// Actions that decrease a holding's share count.
export const SELL_ACTIONS: readonly string[] = [ACTION.SELL_FX];

// Pseudo-tickers that aren't real securities.
export const SPECIAL_TICKER = {
  DEPOSITS: "900", // cash transfers / benefits / misc
  CAPITAL_GAINS_TAX: "9992983", // capital-gains tax paid (ILS)
  DIVIDEND_PSEUDO: "99028", // dividend / dividend-tax rows
} as const;

// Israeli capital-gains tax rate on realized profit.
export const CAPITAL_GAINS_TAX_RATE = 0.25;

// A normalized, typed transaction derived from a RawRow.
export interface Transaction {
  date: string; // formatted DD/MM/YYYY
  timestamp: number; // ms epoch, 0 when unparsable
  year: number | null;
  action: string; // raw "סוג פעולה"
  name: string; // "שם נייר"
  symbol: string; // "מס' נייר / סימבול" (raw, may be numeric pseudo-ticker)
  quantity: number; // absolute share count
  delta: number; // signed share change (+buy / -sell)
  price: number; // "שער ביצוע"
  currency: string; // "מטבע"
  fee: number; // "עמלת פעולה", absolute
  proceedsIls: number; // "תמורה בשקלים"
  proceedsFx: number; // 'תמורה במט"ח'
  raw: RawRow;
}

// An open holding (still has shares) derived from a symbol's transactions.
export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number; // weighted-average cost of the current holding
  costBasis: number; // avgCost * quantity
  buyFees: number;
  firstBuyTimestamp: number;
  firstBuyDate: string;
  holdingDays: number;
  // Live valuation — populated only when a price is available.
  currentPrice?: number;
  marketValue?: number;
  unrealizedPnL?: number;
  unrealizedPnLPercent?: number;
  dayChange?: number;
  weightPercent?: number;
}

// One completed buy→sell cycle for a symbol (cumulative shares return to 0).
export interface RealizedRound {
  symbol: string;
  firstDate: string;
  lastDate: string;
  firstTimestamp: number;
  lastTimestamp: number;
  durationDays: number;
  costBasis: number;
  proceeds: number;
  buyFees: number;
  sellFees: number;
  totalFees: number;
  netFromTrading: number; // proceeds - costBasis - fees
  capitalGainsTax: number; // 25% of profit, 0 on a loss
  netAfterTax: number;
  dividendsGross: number;
  dividendsTax: number;
  dividendsNet: number;
  finalPnL: number; // netAfterTax + dividendsNet
  returnPercent: number; // finalPnL / total invested
}

// Aggregated realized performance for one symbol (Analytics table row).
export interface StockPerformance {
  symbol: string;
  rounds: number; // number of closed cycles
  costBasis: number; // total invested across closed rounds
  proceeds: number; // total sale proceeds
  fees: number;
  netFromTrading: number; // pre-tax realized trading P&L
  capitalGainsTax: number;
  dividendsNet: number;
  finalPnL: number; // after-tax + dividends
  returnPercent: number;
  isOpen: boolean; // still holding shares
}

// Top-level portfolio KPIs.
export interface PortfolioSummary {
  totalMarketValue: number; // live (falls back to cost basis when no price)
  totalCostBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnLYTD: number; // current-year closed rounds (finalPnL)
  realizedPnLAllTime: number;
  holdingsCount: number;
  dayChange: number; // live
  dayChangePercent: number;
  hasLivePrices: boolean;
}
