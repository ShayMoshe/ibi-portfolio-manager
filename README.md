# IBI Portfolio Manager (Frontend)

This is a frontend-only React SPA built with Vite. It lets you upload one or more XLSX files and merges all rows from every sheet into a single table with real-time stock prices.

## Features

- 📊 Upload and parse multiple XLSX files
- 📈 Real-time stock prices and changes
- 🔍 Sortable and filterable tables
- 📱 Responsive design
- ✅ Year validation for data integrity
- 🎯 Filter active stocks only

## Getting started

```bash
npm install
npm run dev
```

## Stock Price API Configuration

The app uses Alpha Vantage API to fetch real-time stock prices. To configure your API key:

1. Get a free API key from [Alpha Vantage](https://www.alphavantage.co/support/#api-key)
2. Open `src/stockPriceService.ts`
3. Replace the `ALPHA_VANTAGE_API_KEY` value with your key:
   ```typescript
   const ALPHA_VANTAGE_API_KEY = "YOUR_API_KEY_HERE";
   ```

**Note:** The free tier allows 5 API requests per minute and 25 requests per day.

### Smart Caching System

To work around API rate limits, the app implements a two-tier caching system:

- **In-Memory Cache**: 5 minutes - Fast access for repeated queries
- **localStorage Cache**: 24 hours - Persistent across browser sessions, reducing API calls significantly

This means once you view a stock's details, the data is cached for 24 hours even if you close the browser. If you hit the daily rate limit, you'll see cached data with a friendly notification.

## Build

```bash
npm run build
```

## GitHub Pages Deployment

The app is automatically deployed to GitHub Pages on every push to the `main` branch.

**Live site:** https://shaymoshe.github.io/ibi-portfolio-manager/

### Setup (one-time)

To enable GitHub Pages deployment:

1. Go to your repository settings on GitHub
2. Navigate to **Settings > Pages**
3. Under **Build and deployment**, set:
   - **Source**: GitHub Actions

The workflow will automatically build and deploy the site on every push to main.
