import { describe, expect, it } from "vitest";
import { ACTION, Transaction } from "../types";
import {
  computeOpenPosition,
  computePortfolioSummary,
  computeRealizedRounds,
  dividendsForSymbol,
} from "./calculations";

const tx = (overrides: Partial<Transaction>): Transaction => ({
  date: "01/01/2026",
  timestamp: new Date(2026, 0, 1).getTime(),
  year: 2026,
  action: ACTION.BUY_FX,
  name: "TEST US",
  symbol: "TEST",
  quantity: 0,
  delta: 0,
  price: 0,
  currency: "$",
  fee: 0,
  proceedsIls: 0,
  proceedsFx: 0,
  raw: {} as Transaction["raw"],
  ...overrides,
});

describe("portfolio calculations", () => {
  it("derives the current open position after a full close and rebuy", () => {
    const transactions = [
      tx({ action: ACTION.BUY_FX, quantity: 10, delta: 10, price: 100, fee: 5 }),
      tx({
        date: "02/01/2026",
        timestamp: new Date(2026, 0, 2).getTime(),
        action: ACTION.SELL_FX,
        quantity: 10,
        delta: -10,
        price: 110,
        fee: 5,
      }),
      tx({
        date: "03/01/2026",
        timestamp: new Date(2026, 0, 3).getTime(),
        action: ACTION.BUY_FX,
        quantity: 4,
        delta: 4,
        price: 120,
        fee: 5,
      }),
    ];

    const position = computeOpenPosition(transactions, "TEST");

    expect(position?.quantity).toBe(4);
    expect(position?.avgCost).toBe(120);
    expect(position?.costBasis).toBe(480);
  });

  it("computes realized rounds with fees, capital gains tax and dividends", () => {
    const transactions = [
      tx({ action: ACTION.BUY_FX, quantity: 10, delta: 10, price: 100, fee: 5 }),
      tx({
        date: "15/01/2026",
        timestamp: new Date(2026, 0, 15).getTime(),
        action: ACTION.DIVIDEND,
        name: "דיב/ TEST US",
        symbol: "99028",
        quantity: 20,
      }),
      tx({
        date: "15/01/2026",
        timestamp: new Date(2026, 0, 15).getTime(),
        action: ACTION.DIVIDEND_TAX,
        name: "מסח/ TEST US",
        symbol: "99028",
        quantity: 5,
      }),
      tx({
        date: "01/02/2026",
        timestamp: new Date(2026, 1, 1).getTime(),
        action: ACTION.SELL_FX,
        quantity: 10,
        delta: -10,
        price: 120,
        fee: 5,
      }),
    ];

    const [round] = computeRealizedRounds(transactions, "TEST");

    expect(round.costBasis).toBe(1000);
    expect(round.proceeds).toBe(1200);
    expect(round.totalFees).toBe(10);
    expect(round.netFromTrading).toBe(190);
    expect(round.capitalGainsTax).toBe(47.5);
    expect(round.dividendsNet).toBe(15);
    expect(round.finalPnL).toBe(157.5);
  });

  it("groups dividend and tax events by date", () => {
    const dividends = dividendsForSymbol(
      [
        tx({ action: ACTION.DIVIDEND, name: "דיב/ TEST US", symbol: "99028", quantity: 7 }),
        tx({ action: ACTION.DIVIDEND_TAX, name: "מסח/ TEST US", symbol: "99028", quantity: 2 }),
      ],
      "TEST"
    );

    expect(dividends).toHaveLength(1);
    expect(dividends[0].dividend).toBe(7);
    expect(dividends[0].tax).toBe(2);
    expect(dividends[0].net).toBe(5);
  });

  it("summarizes market value and realized P&L without a server", () => {
    const summary = computePortfolioSummary(
      [
        {
          symbol: "TEST",
          quantity: 2,
          avgCost: 100,
          costBasis: 200,
          buyFees: 0,
          firstBuyTimestamp: 0,
          firstBuyDate: "",
          holdingDays: 0,
          currentPrice: 125,
          marketValue: 250,
          unrealizedPnL: 50,
          unrealizedPnLPercent: 25,
          dayChange: 4,
        },
      ],
      [
        {
          symbol: "DONE",
          firstDate: "01/01/2026",
          lastDate: "02/01/2026",
          firstTimestamp: new Date(2026, 0, 1).getTime(),
          lastTimestamp: new Date(2026, 0, 2).getTime(),
          durationDays: 1,
          costBasis: 100,
          proceeds: 130,
          buyFees: 1,
          sellFees: 1,
          totalFees: 2,
          netFromTrading: 28,
          capitalGainsTax: 7,
          netAfterTax: 21,
          dividendsGross: 0,
          dividendsTax: 0,
          dividendsNet: 0,
          finalPnL: 21,
          returnPercent: 20.8,
        },
      ],
      new Map(),
      2026
    );

    expect(summary.totalMarketValue).toBe(250);
    expect(summary.unrealizedPnL).toBe(50);
    expect(summary.realizedPnLYTD).toBe(21);
    expect(summary.dayChange).toBe(4);
  });
});
