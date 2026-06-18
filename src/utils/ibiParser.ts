import * as XLSX from "xlsx";
import { IBI_COLUMNS, IbiColumn, RawRow, Transaction, BUY_ACTIONS, SELL_ACTIONS } from "../types";
import { formatDateLabel, parseDateToTimestamp, parseDateYear } from "./dates";

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isRowEmpty = (row: unknown[]) => row.every((cell) => normalizeHeader(cell) === "");

const num = (value: string): number => parseFloat(String(value ?? "").trim()) || 0;

// Read every data row of one sheet into RawRow records keyed by IBI_COLUMNS.
const readSheetRows = (sheet: XLSX.WorkSheet): RawRow[] => {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  if (rawRows.length < 2) return [];

  const headerRow = rawRows[0] ?? [];
  const headerIndex = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key) headerIndex.set(key, index);
  });
  if (headerIndex.size === 0) return [];

  const rows: RawRow[] = [];
  for (let i = 1; i < rawRows.length; i += 1) {
    const rawRow = rawRows[i] ?? [];
    if (isRowEmpty(rawRow)) continue;

    const row = IBI_COLUMNS.reduce((acc, column) => {
      const idx = headerIndex.get(normalizeHeader(column));
      const value = idx === undefined ? "" : rawRow[idx];
      acc[column] = value === undefined || value === null ? "" : String(value);
      return acc;
    }, {} as RawRow);

    rows.push(row);
  }

  return rows;
};

// Parse an entire workbook (all sheets merged) into RawRows.
export const parseWorkbook = (workbook: XLSX.WorkBook): RawRow[] => {
  const rows: RawRow[] = [];
  workbook.SheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    if (sheet) rows.push(...readSheetRows(sheet));
  });
  return rows;
};

// Parse one uploaded file into RawRows.
export const parseFile = async (file: File): Promise<RawRow[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  return parseWorkbook(workbook);
};

const col = (row: RawRow, column: IbiColumn) => String(row[column] ?? "").trim();

// Normalize a raw row into a typed Transaction.
export const toTransaction = (row: RawRow): Transaction => {
  const action = col(row, "סוג פעולה");
  const dateValue = col(row, "תאריך");
  const quantity = Math.abs(num(row["כמות"]));
  const isBuy = BUY_ACTIONS.includes(action);
  const isSell = SELL_ACTIONS.includes(action);

  return {
    date: formatDateLabel(dateValue),
    timestamp: parseDateToTimestamp(dateValue),
    year: parseDateYear(dateValue),
    action,
    name: col(row, "שם נייר"),
    symbol: col(row, "מס' נייר / סימבול"),
    quantity,
    delta: isBuy ? quantity : isSell ? -quantity : 0,
    price: num(row["שער ביצוע"]),
    currency: col(row, "מטבע"),
    fee: Math.abs(num(row["עמלת פעולה"])),
    proceedsIls: num(row["תמורה בשקלים"]),
    proceedsFx: num(row['תמורה במט"ח']),
    raw: row,
  };
};

export const toTransactions = (rows: RawRow[]): Transaction[] => rows.map(toTransaction);

// Real, tradable stock symbols are alphabetic tickers (numeric values are
// pseudo-tickers like 900 / 9992983 / 99028).
export const isStockSymbol = (symbol: string): boolean =>
  Boolean(symbol) && !/^\d+$/.test(symbol);

// Dividend / dividend-tax rows reference the stock in "שם נייר" as e.g.
// "דיב/   GOOGL US". Match those to a ticker.
export const matchesDividendSymbol = (name: string, symbol: string): boolean =>
  new RegExp(`\\/\\s*${symbol}\\s+US`, "i").test(name);

export { num };
