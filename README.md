# IBI Portfolio Manager (Frontend)

This is a frontend-only React SPA built with Vite. It lets you upload one or more XLSX files and merges all rows from every sheet into a single table.

## Getting started

```bash
npm install
npm run dev
```

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
