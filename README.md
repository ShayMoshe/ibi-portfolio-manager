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

## GitHub Pages note

The app is configured with `base: "./"` in `vite.config.ts` so it can be hosted under GitHub Pages without absolute paths. If you later host the site under a repository subpath and want explicit routing, set `base` to `"/YOUR_REPO_NAME/"`.
