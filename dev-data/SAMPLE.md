# Sample Dev Files

To test the auto-load feature:

1. Place your test `.xlsx` files in this folder (e.g., `portfolio-2023.xlsx`, `portfolio-2024.xlsx`)
2. Run `npm run dev`
3. The app will automatically detect and load all xlsx files

Example:
```
dev-data/
  ├── README.md
  ├── SAMPLE.md (this file)
  ├── portfolio-2023.xlsx  ← your test files
  └── portfolio-2024.xlsx  ← will be auto-loaded
```

**Note:** The `.xlsx` files are gitignored, so they won't be committed to the repository.
