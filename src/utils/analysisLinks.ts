// Public, no-login stock-analysis sites that resolve by ticker alone.
// Google Finance needs an exchange suffix, so we link a Google search instead
// of guessing the exchange.
export const ANALYSIS_LINKS: { label: string; build: (ticker: string) => string }[] = [
  { label: "Yahoo Finance", build: (ticker) => `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}` },
  { label: "Google", build: (ticker) => `https://www.google.com/search?q=${encodeURIComponent(`${ticker} stock`)}` },
  { label: "StockAnalysis", build: (ticker) => `https://stockanalysis.com/stocks/${encodeURIComponent(ticker)}/` },
  { label: "Finviz", build: (ticker) => `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}` },
  { label: "TradingView", build: (ticker) => `https://www.tradingview.com/symbols/${encodeURIComponent(ticker)}/` },
  { label: "CNBC", build: (ticker) => `https://www.cnbc.com/quotes/${encodeURIComponent(ticker)}` },
  { label: "𝕏", build: (ticker) => `https://x.com/search?q=${encodeURIComponent(`@${ticker}`)}&src=typed_query` },
];
