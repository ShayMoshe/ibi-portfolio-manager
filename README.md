# IBI Portfolio Manager (Frontend)

This is a frontend-only React SPA built with Vite. It lets you upload one or more IBI XLSX files, derives holdings/realized performance locally in the browser, and enriches the portfolio with free market-price data when available.

🌐 **Live Demo:** [https://shaymoshe.github.io/ibi-portfolio-manager/](https://shaymoshe.github.io/ibi-portfolio-manager/)

## Features

- 📊 Upload and parse multiple XLSX files
- 📈 Real-time stock prices and changes
- 🔍 Sortable and filterable tables
- 📱 Responsive design
- ✅ Year validation for data integrity
- 🎯 Filter active stocks only
- 🧭 Portfolio health checks: concentration, fee drag, price coverage, dividends
- ⚖️ Local target-allocation and rebalancing view
- 🧾 Tax estimate export for realized gains/losses
- 🕘 Local upload-history metadata

## Privacy and state model

- No server
- No login
- No paid API key
- Portfolio files are parsed in the browser
- Local browser storage is used only for convenience features such as session restore, price cache, alerts, target allocation and upload-history metadata

## Getting started

```bash
npm install
npm run dev
```

## Stock Price Data

The app uses Yahoo Finance chart endpoints and free public CORS fallbacks. No API key is required.

Because the app stays serverless, price availability depends on the free public endpoints and browser/network limits. Cached prices are used when fresh data is unavailable.

### Smart Caching System

To work around API rate limits, the app implements a two-tier caching system:

- **In-Memory Cache**: 5 minutes - Fast access for repeated queries
- **localStorage Cache**: 24 hours - Persistent across browser sessions, reducing API calls significantly

This means once you view a stock's details, the data is cached for 24 hours even if you close the browser. If you hit the daily rate limit, you'll see cached data with a friendly notification.

## Development sample files

Dev mode can auto-load local XLSX files listed in `dev-data/manifest.json`. This keeps sample files out of the production bundle.

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
