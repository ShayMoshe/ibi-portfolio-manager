// Live stock prices via Yahoo Finance — NO API KEY REQUIRED.
//
// Yahoo's public chart endpoint is free but blocks direct browser calls (CORS),
// so we try it directly first and then fall back through a couple of public
// CORS proxies. One endpoint gives us both the latest quote and daily history.
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

// URL builders tried in order until one succeeds. Direct first (works outside a
// browser / when CORS allows), then public proxies.
const PROXY_BUILDERS: Array<(url: string) => string> = [
  (url) => url,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

export interface StockPrice {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency: string;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

export interface HistoricalDataPoint {
  date: string;
  close: number;
  volume: number;
}

const cache = new Map<string, { data: StockPrice; timestamp: number }>();
const historicalCache = new Map<string, { data: HistoricalDataPoint[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in memory
const LOCAL_STORAGE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in localStorage

// Prefixes versioned per provider so a provider switch never reads stale data.
const PRICE_KEY = (symbol: string) => `yahoo_price_${symbol}`;
const HISTORY_KEY = (symbol: string) => `yahoo_history_${symbol}`;

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

// Kept for backwards compatibility with callers that still reference it; the
// no-key Yahoo provider never throws this.
export class MissingApiKeyError extends Error {
  constructor() {
    super("No API key is required for the Yahoo price provider.");
    this.name = "MissingApiKeyError";
  }
}

const getFromLocalStorage = <T>(key: string): { data: T; timestamp: number } | null => {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    return JSON.parse(item);
  } catch {
    return null;
  }
};

const saveToLocalStorage = <T>(key: string, data: T, timestamp: number): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp }));
  } catch (error) {
    console.warn("Failed to save to localStorage:", error);
  }
};

// Fetch the Yahoo chart JSON for a symbol/range, trying each proxy in turn.
const fetchYahooChart = async (symbol: string, range: string, interval: string): Promise<any> => {
  const yahooUrl = `${YAHOO_BASE}${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  let lastError: unknown = null;
  let sawRateLimit = false;

  for (const build of PROXY_BUILDERS) {
    try {
      const response = await fetch(build(yahooUrl), {
        headers: { Accept: "application/json" },
      });
      if (response.status === 429) {
        sawRateLimit = true;
        continue; // try the next proxy
      }
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (data?.chart?.result?.[0]) {
        return data;
      }
      // Some proxies wrap the body as a string — try to parse defensively.
      if (typeof data === "string") {
        const parsed = JSON.parse(data);
        if (parsed?.chart?.result?.[0]) return parsed;
      }
      lastError = new Error("Unexpected Yahoo response shape");
    } catch (error) {
      lastError = error;
    }
  }

  if (sawRateLimit) {
    throw new RateLimitError("Yahoo Finance rate limit reached. Please try again shortly.");
  }
  throw lastError ?? new Error("All price sources failed");
};

export const getCachedStockPrice = (symbol: string): StockPrice | null => {
  const now = Date.now();
  const inMemory = cache.get(symbol);
  if (inMemory && now - inMemory.timestamp < CACHE_DURATION) {
    return inMemory.data;
  }
  const local = getFromLocalStorage<StockPrice>(PRICE_KEY(symbol));
  if (local && now - local.timestamp < LOCAL_STORAGE_CACHE_DURATION) {
    return local.data;
  }
  return null;
};

export const fetchStockPrice = async (symbol: string): Promise<StockPrice | null> => {
  const now = Date.now();

  const cached = cache.get(symbol);
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  const localCached = getFromLocalStorage<StockPrice>(PRICE_KEY(symbol));
  if (localCached && now - localCached.timestamp < LOCAL_STORAGE_CACHE_DURATION) {
    cache.set(symbol, localCached);
    return localCached.data;
  }

  try {
    const data = await fetchYahooChart(symbol, "1d", "1d");
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") {
      return null;
    }

    const price = Number(meta.regularMarketPrice) || 0;
    const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose) || 0;
    const change = price - previousClose;
    const changePercent = previousClose ? (change / previousClose) * 100 : 0;

    const result: StockPrice = {
      symbol,
      price,
      change,
      changePercent,
      previousClose,
      currency: meta.currency || "USD",
      fiftyTwoWeekHigh: Number(meta.fiftyTwoWeekHigh) || undefined,
      fiftyTwoWeekLow: Number(meta.fiftyTwoWeekLow) || undefined,
    };

    cache.set(symbol, { data: result, timestamp: now });
    saveToLocalStorage(PRICE_KEY(symbol), result, now);
    return result;
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    console.error(`Failed to fetch price for ${symbol}:`, error);
    return null;
  }
};

// Fetch many symbols with bounded concurrency. Public proxies are gentle on
// rate limits, so we keep the pool small. Cached symbols resolve instantly.
export const fetchMultipleStockPrices = async (
  symbols: string[]
): Promise<Map<string, StockPrice>> => {
  const results = new Map<string, StockPrice>();
  const unique = Array.from(new Set(symbols));
  const CONCURRENCY = 4;

  let cursor = 0;
  let rateLimited = false;

  const worker = async () => {
    while (cursor < unique.length && !rateLimited) {
      const symbol = unique[cursor];
      cursor += 1;
      try {
        const price = await fetchStockPrice(symbol);
        if (price) results.set(symbol, price);
      } catch (error) {
        if (error instanceof RateLimitError) {
          rateLimited = true;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return results;
};

// Daily candles for the last ~3 months (free via the same Yahoo endpoint).
export const fetchHistoricalData = async (symbol: string): Promise<HistoricalDataPoint[]> => {
  const now = Date.now();

  const cached = historicalCache.get(symbol);
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  const localCached = getFromLocalStorage<HistoricalDataPoint[]>(HISTORY_KEY(symbol));
  if (localCached && now - localCached.timestamp < LOCAL_STORAGE_CACHE_DURATION) {
    historicalCache.set(symbol, localCached);
    return localCached.data;
  }

  try {
    const data = await fetchYahooChart(symbol, "3mo", "1d");
    const result = data?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
    const volumes: number[] = result?.indicators?.quote?.[0]?.volume ?? [];

    const historicalData: HistoricalDataPoint[] = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split("T")[0],
        close: Number(closes[i]) || 0,
        volume: Number(volumes[i]) || 0,
      }))
      .filter((point) => point.close > 0);

    historicalCache.set(symbol, { data: historicalData, timestamp: now });
    saveToLocalStorage(HISTORY_KEY(symbol), historicalData, now);
    return historicalData;
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }
    console.error(`Failed to fetch historical data for ${symbol}:`, error);
    return [];
  }
};
