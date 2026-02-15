const ALPHA_VANTAGE_API_KEY = "92CBJTETWFQ9MQEM."; // Replace with your API key from https://www.alphavantage.co/support/#api-key

export interface StockPrice {
  price: number;
  change: number;
  changePercent: number;
  symbol: string;
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

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// Helper functions for localStorage caching
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
    console.warn('Failed to save to localStorage:', error);
  }
};

export const fetchStockPrice = async (symbol: string): Promise<StockPrice | null> => {
  const now = Date.now();
  const cached = cache.get(symbol);
  
  // Check in-memory cache first (5 minutes)
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  // Check localStorage cache (24 hours)
  const localCached = getFromLocalStorage<StockPrice>(`stock_price_${symbol}`);
  if (localCached && now - localCached.timestamp < LOCAL_STORAGE_CACHE_DURATION) {
    // Update in-memory cache
    cache.set(symbol, localCached);
    return localCached.data;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`API response for ${symbol}:`, data);
    
    // Check for rate limit error
    if (data.Note && data.Note.includes('API call frequency')) {
      throw new RateLimitError('Rate limit reached. Please try again later.');
    }
    if (data.Information) {
      throw new RateLimitError('API rate limit exceeded.');
    }
    
    const quote = data["Global Quote"];
    
    if (!quote || !quote["05. price"]) {
      console.log(`No quote data found for ${symbol}`);
      return null;
    }
    
    const price = parseFloat(quote["05. price"]);
    const change = parseFloat(quote["09. change"]);
    const changePercent = parseFloat(quote["10. change percent"].replace("%", ""));
    
    const result: StockPrice = {
      price,
      change,
      changePercent,
      symbol,
    };
    
    console.log(`Parsed price for ${symbol}:`, result);
    
    // Save to both caches
    cache.set(symbol, { data: result, timestamp: now });
    saveToLocalStorage(`stock_price_${symbol}`, result, now);
    
    return result;
  } catch (error) {
    console.error(`Failed to fetch price for ${symbol}:`, error);
    return null;
  }
};

export const fetchMultipleStockPrices = async (symbols: string[]): Promise<Map<string, StockPrice>> => {
  const results = new Map<string, StockPrice>();
  
  console.log(`Fetching prices for ${symbols.length} symbols:`, symbols);
  
  // Fetch in batches to respect API rate limits (5 requests per minute for free tier)
  const batchSize = 5;
  const delayBetweenBatches = 60000; // 1 minute
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}:`, batch);
    
    const promises = batch.map(async (symbol) => {
      const price = await fetchStockPrice(symbol);
      if (price) {
        console.log(`Adding ${symbol} to results:`, price);
        results.set(symbol, price);
      }
    });
    
    await Promise.all(promises);
    console.log(`Results after batch ${Math.floor(i / batchSize) + 1}:`, results.size);
    
    // Wait between batches if there are more symbols
    if (i + batchSize < symbols.length) {
      console.log(`Waiting 1 minute before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }
  
  console.log(`Final results:`, results.size, Array.from(results.keys()));
  return results;
};

export const fetchHistoricalData = async (symbol: string): Promise<HistoricalDataPoint[]> => {
  const now = Date.now();
  const cached = historicalCache.get(symbol);
  
  // Check in-memory cache first (5 minutes)
  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  
  // Check localStorage cache (24 hours)
  const localCached = getFromLocalStorage<HistoricalDataPoint[]>(`stock_history_${symbol}`);
  if (localCached && now - localCached.timestamp < LOCAL_STORAGE_CACHE_DURATION) {
    // Update in-memory cache
    historicalCache.set(symbol, localCached);
    return localCached.data;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check for rate limit error
    if (data.Note && data.Note.includes('API call frequency')) {
      throw new RateLimitError('Rate limit reached. Please try again later.');
    }
    if (data.Information) {
      throw new RateLimitError('API rate limit exceeded.');
    }
    
    const timeSeries = data["Time Series (Daily)"];
    
    if (!timeSeries) {
      return [];
    }
    
    const historicalData: HistoricalDataPoint[] = Object.entries(timeSeries)
      .map(([date, values]: [string, any]) => ({
        date,
        close: parseFloat(values["4. close"]),
        volume: parseFloat(values["5. volume"]),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-90); // Last 90 days
    
    // Save to both caches
    historicalCache.set(symbol, { data: historicalData, timestamp: now });
    saveToLocalStorage(`stock_history_${symbol}`, historicalData, now);
    
    return historicalData;
  } catch (error) {
    console.error(`Failed to fetch historical data for ${symbol}:`, error);
    return [];
  }
};
