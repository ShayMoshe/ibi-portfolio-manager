import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import SortableTable, { Column as TableColumn } from "./SortableTable";
import StockDetail from "./StockDetail";
import ClosedPositionDetail from "./ClosedPositionDetail";
import Dashboard from "./components/Dashboard";
import Analytics from "./components/Analytics";
import PriceAlerts from "./components/PriceAlerts";
import StockSidebar, { SidebarItem } from "./components/StockSidebar";
import { usePortfolio } from "./hooks/usePortfolio";
import { exportToExcel } from "./utils/exportExcel";
import { formatSignedUsd } from "./utils/format";

const columns = [
  "תאריך",
  "סוג פעולה",
  "שם נייר",
  "מס' נייר / סימבול",
  "כמות",
  "שער ביצוע",
  "מטבע",
  "עמלת פעולה",
  "עמלות נלוות",
  "תמורה במט\"ח",
  "תמורה בשקלים",
  "יתרה שקלית",
  "אומדן מס רווחי הון",
] as const;

type Column = (typeof columns)[number];
type Row = Record<Column, string>;

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const isRowEmpty = (row: unknown[]) =>
  row.every((cell) => normalizeHeader(cell) === "");

const parseDateYear = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const parsed = XLSX.SSF.parse_date_code(numeric);
      if (parsed && parsed.y) {
        return parsed.y;
      }
    }
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmyMatch) {
    return Number(dmyMatch[3]);
  }

  const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymdMatch) {
    return Number(ymdMatch[1]);
  }

  return null;
};

// Parse date to timestamp for sorting
const parseDateToTimestamp = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  // Try Excel date number
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const parsed = XLSX.SSF.parse_date_code(numeric);
      if (parsed && parsed.y) {
        return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
      }
    }
  }

  // Try DD/MM/YYYY format
  const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1; // month is 0-indexed
    const year = parseInt(dmyMatch[3], 10);
    return new Date(year, month, day).getTime();
  }

  // Try YYYY-MM-DD format
  const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(year, month, day).getTime();
  }

  return 0;
};

const formatDateLabel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const parsed = XLSX.SSF.parse_date_code(numeric);
      if (parsed && parsed.y) {
        const day = String(parsed.d).padStart(2, "0");
        const month = String(parsed.m).padStart(2, "0");
        return `${day}/${month}/${parsed.y}`;
      }
    }
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    return `${day}/${month}/${dmyMatch[3]}`;
  }

  const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymdMatch) {
    const day = ymdMatch[3].padStart(2, "0");
    const month = ymdMatch[2].padStart(2, "0");
    return `${day}/${month}/${ymdMatch[1]}`;
  }

  return trimmed;
};

const validateYears = (rows: Row[]) => {
  const years = new Set<number>();
  let invalidCount = 0;

  rows.forEach((row) => {
    const year = parseDateYear(row["תאריך"]);
    if (year === null) {
      if (row["תאריך"].trim() !== "") {
        invalidCount += 1;
      }
      return;
    }
    years.add(year);
  });

  if (years.size === 0) {
    return {
      ok: false,
      message: "לא נמצאו תאריכים תקינים בקבצים שהועלו.",
    };
  }

  const currentYear = new Date().getFullYear();
  const yearArray = Array.from(years).sort((a, b) => a - b);
  const minYear = yearArray[0];
  const maxYear = yearArray[yearArray.length - 1];
  const issues: string[] = [];

  if (invalidCount > 0) {
    issues.push(`נמצאו ${invalidCount} תאריכים שלא ניתן לקרוא.`);
  }

  if (!years.has(currentYear)) {
    issues.push(`חסר מידע עבור השנה הנוכחית (${currentYear}).`);
  }

  if (maxYear > currentYear) {
    const futureYears = yearArray.filter((year) => year > currentYear);
    issues.push(`נמצאו שנים עתידיות: ${futureYears.join(", ")}.`);
  }

  const missingYears: number[] = [];
  for (let year = minYear; year <= currentYear; year += 1) {
    if (!years.has(year)) {
      missingYears.push(year);
    }
  }

  if (missingYears.length > 0) {
    issues.push(`חסרות שנים: ${missingYears.join(", ")}.`);
  }

  return {
    ok: issues.length === 0,
    message: issues.join(" "),
  };
};

const readSheetRows = (sheet: XLSX.WorkSheet): Row[] => {
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (rawRows.length < 2) {
    return [];
  }

  const headerRow = rawRows[0] ?? [];
  const headerIndex = new Map<string, number>();

  headerRow.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key) {
      headerIndex.set(key, index);
    }
  });

  if (headerIndex.size === 0) {
    return [];
  }

  const rows: Row[] = [];

  for (let i = 1; i < rawRows.length; i += 1) {
    const rawRow = rawRows[i] ?? [];
    if (isRowEmpty(rawRow)) {
      continue;
    }

    const row: Row = columns.reduce((acc, column) => {
      const idx = headerIndex.get(normalizeHeader(column));
      const value = idx === undefined ? "" : rawRow[idx];
      acc[column] = value === undefined || value === null ? "" : String(value);
      return acc;
    }, {} as Row);

    rows.push(row);
  }

  return rows;
};

const parseWorkbook = (workbook: XLSX.WorkBook) => {
  const rows: Row[] = [];

  workbook.SheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      return;
    }

    rows.push(...readSheetRows(sheet));
  });

  return rows;
};

// Persist uploaded data for the lifetime of the browser tab so a page refresh
// doesn't wipe it. Dev mode auto-loads from /dev-data instead, so we skip the
// session cache there to keep that flow untouched.
const SESSION_KEY = "ibi_session_data";

const readSession = (): { rows: Row[]; fileNames: string[] } | null => {
  if (import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: Row[]; fileNames?: string[] };
    if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    return { rows: parsed.rows, fileNames: Array.isArray(parsed.fileNames) ? parsed.fileNames : [] };
  } catch {
    return null;
  }
};

// Read the session cache once per tab load and reuse it across the state
// initializers below, instead of parsing storage four separate times.
let bootSessionLoaded = false;
let bootSession: { rows: Row[]; fileNames: string[] } | null = null;
const getBootSession = (): { rows: Row[]; fileNames: string[] } | null => {
  if (!bootSessionLoaded) {
    bootSession = readSession();
    bootSessionLoaded = true;
  }
  return bootSession;
};

const App = () => {
  const [rows, setRows] = useState<Row[]>(() => getBootSession()?.rows ?? []);
  const [status, setStatus] = useState<string>(() => {
    const session = getBootSession();
    return session
      ? `Loaded ${session.rows.length} rows from ${session.fileNames.length} file(s).`
      : "Upload XLSX files to begin.";
  });
  const [validationError, setValidationError] = useState<string | null>(() => {
    const session = getBootSession();
    if (!session) return null;
    const validation = validateYears(session.rows);
    return validation.ok ? null : validation.message;
  });
  const [isLoading, setIsLoading] = useState(false);
  const TAB_NAMES = [
    "dashboard",
    "summary",
    "past",
    "account",
    "analytics",
    "table",
    "alerts",
  ] as const;
  type TabName = (typeof TAB_NAMES)[number];

  const getInitialTab = (): TabName => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab && (TAB_NAMES as readonly string[]).includes(tab) ? (tab as TabName) : "dashboard";
  };

  const [activeTab, setActiveTab] = useState<TabName>(getInitialTab);

  const handleTabChange = (tab: TabName) => {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `?${params.toString()}`);
  };
  const [showCumulativeDividends, setShowCumulativeDividends] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("ticker")
  );
  const [fileNames, setFileNames] = useState<string[]>(() => getBootSession()?.fileNames ?? []);
  const [isDragging, setIsDragging] = useState(false);

  // Keep the open stock / past-trade page in the URL so a refresh restores it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedTicker) {
      params.set("ticker", selectedTicker);
    } else {
      params.delete("ticker");
    }
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [selectedTicker]);

  // Cache uploaded data in sessionStorage so it survives a page refresh.
  // Skipped in dev, where /dev-data is auto-loaded on mount instead.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    try {
      if (rows.length > 0) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ rows, fileNames }));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (error) {
      console.warn("Failed to persist session data:", error);
    }
  }, [rows, fileNames]);

  const rowCount = useMemo(() => rows.length, [rows]);

  const portfolio = usePortfolio(rows);

  const closedTickersSet = useMemo(() => {
    const quantities = new Map<string, number>();
    rows.forEach((row) => {
      const sym = row["מס' נייר / סימבול"].trim();
      const actionType = row["סוג פעולה"].trim();
      if (!sym || /^\d+$/.test(sym)) return;
      const amount = parseFloat(row["כמות"].trim()) || 0;
      const current = quantities.get(sym) ?? 0;
      if (actionType === "קניה חול מטח" || actionType === "הטבה") {
        quantities.set(sym, current + amount);
      } else if (actionType === "מכירה חול מטח") {
        quantities.set(sym, current - amount);
      }
    });
    const closed = new Set<string>();
    quantities.forEach((qty, sym) => {
      if (Math.abs(qty) < 0.01) closed.add(sym);
    });
    return closed;
  }, [rows]);
  const uniqueSymbols = useMemo(() => {
    const symbols = new Set<string>();
    rows.forEach((row) => {
      const value = row["מס' נייר / סימבול"].trim();
      if (value && !/^\d+$/.test(value)) {
        symbols.add(value);
      }
    });
    return Array.from(symbols).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const stocksTableData = useMemo(() => {
    const allStocks = uniqueSymbols.map((symbol) => {
      let quantity = 0;
      let totalFees = 0;
      let totalDividends = 0;
      let totalTaxes = 0;
      
      rows.forEach((row) => {
        const ticker = row["מס' נייר / סימבול"].trim();
        const actionType = row["סוג פעולה"].trim();
        const stockName = row["שם נייר"].trim();
        
        // Calculate quantity for this ticker
        if (ticker === symbol) {
          const amountStr = row["כמות"].trim();
          const amount = parseFloat(amountStr) || 0;
          
          if (actionType === "קניה חול מטח" || actionType === "הטבה") {
            quantity += amount;
          } else if (actionType === "מכירה חול מטח") {
            quantity -= amount;
          }
          
          // Sum transaction fees
          const feeStr = row["עמלת פעולה"].trim();
          const fee = parseFloat(feeStr) || 0;
          totalFees += Math.abs(fee);
        }
        
        // Calculate dividends - check if stock name contains the ticker symbol
        if (actionType === "הפקדה דיבידנד מטח" && stockName.includes(symbol)) {
          const dividendStr = row["כמות"].trim();
          const dividend = parseFloat(dividendStr) || 0;
          totalDividends += Math.abs(dividend);
        }
        
        // Calculate taxes - check if stock name contains the ticker symbol
        if (actionType === "משיכת מס חול מטח" && stockName.includes(symbol)) {
          const taxStr = row["כמות"].trim();
          const tax = parseFloat(taxStr) || 0;
          totalTaxes += Math.abs(tax);
        }
      });
      
      return { 
        TICKER: symbol,
        "כמות במניה": quantity.toFixed(2),
        'סה"כ עמלות': `${totalFees.toFixed(2)}$`,
        'סה"כ דיבידנד': `${totalDividends.toFixed(2)}$`,
        'סה"כ מס': `${totalTaxes.toFixed(2)}$`,
        _rawQuantity: quantity,
        _rawFees: totalFees,
        _rawDividends: totalDividends,
        _rawTaxes: totalTaxes,
      };
    });

    // Enrich with live valuation from derived positions / live prices.
    return allStocks.map((stock) => {
      const pos = portfolio.positions.find((p) => p.symbol === stock.TICKER);
      const livePrice = portfolio.livePrices.get(stock.TICKER);
      return {
        ...stock,
        avgCost: pos?.avgCost ?? 0,
        currentPrice: livePrice?.price ?? 0,
        unrealizedPnLPercent: pos?.unrealizedPnLPercent ?? null,
        fiftyTwoWeekHigh: livePrice?.fiftyTwoWeekHigh ?? 0,
        fiftyTwoWeekLow: livePrice?.fiftyTwoWeekLow ?? 0,
      };
    });
  }, [uniqueSymbols, rows, portfolio.positions, portfolio.livePrices]);

  // Split holdings: active (still holds shares) vs. past trades (fully sold).
  const activeStocksData = useMemo(
    () => stocksTableData.filter((stock) => Math.abs(stock._rawQuantity) >= 0.01),
    [stocksTableData]
  );
  const inactiveStocksData = useMemo(
    () => stocksTableData.filter((stock) => Math.abs(stock._rawQuantity) < 0.01),
    [stocksTableData]
  );

  const stocksSummary = useMemo(() => {
    // Calculate summary from all stocks (before filtering)
    const allStocksData = uniqueSymbols.map((symbol) => {
      let quantity = 0;
      let totalFees = 0;
      let totalDividends = 0;
      let totalTaxes = 0;
      
      rows.forEach((row) => {
        const ticker = row["מס' נייר / סימבול"].trim();
        const actionType = row["סוג פעולה"].trim();
        const stockName = row["שם נייר"].trim();
        
        if (ticker === symbol) {
          const amountStr = row["כמות"].trim();
          const amount = parseFloat(amountStr) || 0;
          
          if (actionType === "קניה חול מטח" || actionType === "הטבה") {
            quantity += amount;
          } else if (actionType === "מכירה חול מטח") {
            quantity -= amount;
          }
          
          const feeStr = row["עמלת פעולה"].trim();
          const fee = parseFloat(feeStr) || 0;
          totalFees += Math.abs(fee);
        }
        
        if (actionType === "הפקדה דיבידנד מטח" && stockName.includes(symbol)) {
          const dividendStr = row["כמות"].trim();
          const dividend = parseFloat(dividendStr) || 0;
          totalDividends += Math.abs(dividend);
        }
        
        if (actionType === "משיכת מס חול מטח" && stockName.includes(symbol)) {
          const taxStr = row["כמות"].trim();
          const tax = parseFloat(taxStr) || 0;
          totalTaxes += Math.abs(tax);
        }
      });
      
      return { quantity, totalFees, totalDividends, totalTaxes };
    });
    
    // Calculate total cash transfers (in ILS)
    let totalCashTransfers = 0;
    let totalBenefitsAndOther = 0;
    let totalCapitalGainsTax = 0;
    rows.forEach((row) => {
      const actionType = row["סוג פעולה"].trim();
      const ticker = row["מס' נייר / סימבול"].trim();
      const amountStr = row["תמורה בשקלים"].trim();
      const amount = parseFloat(amountStr) || 0;
      
      if (actionType === "העברה מזומן בשח") {
        totalCashTransfers += Math.abs(amount);
      } else if (ticker === "900") {
        // Any transaction with ticker 900 that is not a cash transfer is benefits/other
        totalBenefitsAndOther += Math.abs(amount);
      }
      
      // Calculate capital gains tax
      if (ticker === "9992983") {
        totalCapitalGainsTax += amount * -1;
      }
    });
    
    return {
      totalQuantity: allStocksData.reduce((sum, s) => sum + s.quantity, 0),
      totalFees: allStocksData.reduce((sum, s) => sum + s.totalFees, 0),
      totalDividends: allStocksData.reduce((sum, s) => sum + s.totalDividends, 0),
      totalTaxes: allStocksData.reduce((sum, s) => sum + s.totalTaxes, 0),
      totalCashTransfers,
      totalBenefitsAndOther,
      totalCapitalGainsTax,
    };
  }, [uniqueSymbols, rows]);

  const depositsByMonth = useMemo(() => {
    type MonthEntry = {
      monthKey: string;
      monthLabel: string;
      timestamp: number;
      amount: number;
      details: { dateLabel: string; amount: number }[];
    };

    const deposits: { dateLabel: string; timestamp: number; amount: number }[] = [];

    rows.forEach((row) => {
      const ticker = row["מס' נייר / סימבול"].trim();
      if (ticker !== "900") {
        return;
      }

      const dateValue = row["תאריך"].trim();
      const dateLabel = formatDateLabel(dateValue);
      const timestamp = parseDateToTimestamp(dateValue);
      const amountStr = row["תמורה בשקלים"].trim();
      const amount = Math.abs(parseFloat(amountStr) || 0);

      if (!dateLabel || !timestamp || amount === 0) {
        return;
      }

      deposits.push({ dateLabel, timestamp, amount });
    });

    if (deposits.length === 0) {
      return [] as MonthEntry[];
    }

    deposits.sort((a, b) => a.timestamp - b.timestamp);

    const monthMap = new Map<string, MonthEntry>();
    const first = new Date(deposits[0].timestamp);
    const last = new Date(deposits[deposits.length - 1].timestamp);
    const start = new Date(first.getFullYear(), first.getMonth(), 1);
    const end = new Date(last.getFullYear(), last.getMonth(), 1);

    for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthLabel = `${String(month).padStart(2, "0")}/${year}`;
      monthMap.set(monthKey, {
        monthKey,
        monthLabel,
        timestamp: cursor.getTime(),
        amount: 0,
        details: [],
      });
    }

    deposits.forEach((entry) => {
      const date = new Date(entry.timestamp);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthEntry = monthMap.get(monthKey);
      if (!monthEntry) {
        return;
      }
      monthEntry.amount += entry.amount;
      monthEntry.details.push({ dateLabel: entry.dateLabel, amount: entry.amount });
    });

    return Array.from(monthMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [rows]);

  const dividendsByMonth = useMemo(() => {
    type MonthEntry = {
      monthKey: string;
      monthLabel: string;
      timestamp: number;
      amount: number;
      cumulativeAmount: number;
      details: { dateLabel: string; amount: number }[];
    };

    const dividends: { dateLabel: string; timestamp: number; amount: number }[] = [];

    rows.forEach((row) => {
      const actionType = row["סוג פעולה"].trim();
      if (actionType !== "הפקדה דיבידנד מטח") {
        return;
      }

      const dateValue = row["תאריך"].trim();
      const dateLabel = formatDateLabel(dateValue);
      const timestamp = parseDateToTimestamp(dateValue);
      const amountStr = row["כמות"].trim();
      const amount = Math.abs(parseFloat(amountStr) || 0);

      if (!dateLabel || !timestamp || amount === 0) {
        return;
      }

      dividends.push({ dateLabel, timestamp, amount });
    });

    if (dividends.length === 0) {
      return [] as MonthEntry[];
    }

    dividends.sort((a, b) => a.timestamp - b.timestamp);

    const monthMap = new Map<string, MonthEntry>();
    const first = new Date(dividends[0].timestamp);
    const last = new Date(dividends[dividends.length - 1].timestamp);
    const start = new Date(first.getFullYear(), first.getMonth(), 1);
    const end = new Date(last.getFullYear(), last.getMonth(), 1);

    for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthLabel = `${String(month).padStart(2, "0")}/${year}`;
      monthMap.set(monthKey, {
        monthKey,
        monthLabel,
        timestamp: cursor.getTime(),
        amount: 0,
        cumulativeAmount: 0,
        details: [],
      });
    }

    dividends.forEach((entry) => {
      const date = new Date(entry.timestamp);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthEntry = monthMap.get(monthKey);
      if (!monthEntry) {
        return;
      }
      monthEntry.amount += entry.amount;
      monthEntry.details.push({ dateLabel: entry.dateLabel, amount: entry.amount });
    });

    let cumulative = 0;
    return Array.from(monthMap.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((entry) => {
        cumulative += entry.amount;
        return {
          ...entry,
          cumulativeAmount: cumulative,
        };
      });
  }, [rows]);

  const stocksTableColumns = useMemo<TableColumn<{ TICKER: string; "כמות במניה": string; 'סה"כ עמלות': string; 'סה"כ דיבידנד': string; 'סה"כ מס': string }>[]>(
    () => [
      {
        key: "TICKER",
        label: "TICKER",
        sortable: true,
        filterable: true,
        render: (value) => {
          const sym = String(value);
          const isClosed = closedTickersSet.has(sym);
          return (
            <button
              className={isClosed ? "ticker-link ticker-link-closed" : "ticker-link"}
              onClick={() => setSelectedTicker(sym)}
              title={isClosed ? "מניה שנמכרה - לחץ לסיכום עסקה" : undefined}
            >
              {sym}
              {isClosed && <span className="ticker-closed-tag">סגור</span>}
            </button>
          );
        },
      },
      {
        key: "כמות במניה",
        label: "כמות במניה",
        sortable: true,
        filterable: false,
      },
      {
        key: 'סה"כ עמלות',
        label: 'סה"כ עמלות',
        sortable: true,
        filterable: false,
      },
      {
        key: 'סה"כ דיבידנד',
        label: 'סה"כ דיבידנד',
        sortable: true,
        filterable: false,
        render: (value) => {
          const strValue = String(value);
          if (strValue === '0.00$' || strValue === '0$') {
            return '-';
          }
          return strValue;
        },
      },
      {
        key: 'סה"כ מס',
        label: 'סה"כ מס',
        sortable: true,
        filterable: false,
        render: (value) => {
          const strValue = String(value);
          if (strValue === '0.00$' || strValue === '0$') {
            return '-';
          }
          return strValue;
        },
      },
      {
        key: "avgCost",
        label: "עלות ממוצעת",
        sortable: true,
        filterable: false,
        render: (value) => {
          const n = Number(value);
          return n > 0 ? <span className="mono">${n.toFixed(2)}</span> : <span className="val-muted">—</span>;
        },
      },
      {
        key: "currentPrice",
        label: "מחיר נוכחי",
        sortable: true,
        filterable: false,
        render: (value) => {
          const n = Number(value);
          return n > 0 ? <span className="mono">${n.toFixed(2)}</span> : <span className="val-muted">—</span>;
        },
      },
      {
        key: "unrealizedPnLPercent",
        label: "תשואה",
        sortable: true,
        filterable: false,
        render: (value) => {
          if (value === null || value === undefined) return <span className="val-muted">—</span>;
          const n = Number(value);
          return (
            <span className={`mono ${n >= 0 ? "val-positive" : "val-negative"}`}>
              {n >= 0 ? "+" : ""}
              {n.toFixed(1)}%
            </span>
          );
        },
      },
      {
        key: "fiftyTwoWeekHigh",
        label: "52W",
        sortable: false,
        filterable: false,
        render: (high, row) => {
          const h = Number(high);
          const l = Number((row as Record<string, unknown>).fiftyTwoWeekLow);
          const price = Number((row as Record<string, unknown>).currentPrice);
          if (!h || !price) return <span className="val-muted">—</span>;
          const pctFromHigh = ((price - h) / h) * 100;
          const pctFromLow = l > 0 ? ((price - l) / l) * 100 : null;
          if (pctFromHigh >= -5) {
            return (
              <span className="badge badge-green" title={`${pctFromHigh.toFixed(1)}% מהשיא`}>
                📈 High
              </span>
            );
          }
          if (pctFromLow !== null && pctFromLow <= 10) {
            return (
              <span className="badge badge-red" title={`${pctFromLow.toFixed(1)}% מהשפל`}>
                📉 Low
              </span>
            );
          }
          return <span className="val-muted">—</span>;
        },
      },
    ],
    [closedTickersSet]
  );

  const transactionsTableColumns = useMemo<TableColumn<Row>[]>(
    () =>
      columns.map((col) => {
        if (col === "תאריך") {
          return {
            key: col,
            label: col,
            sortable: true,
            filterable: true,
            filterType: 'date' as const,
            sortComparator: (a: unknown, b: unknown) => {
              const aTimestamp = parseDateToTimestamp(String(a ?? ""));
              const bTimestamp = parseDateToTimestamp(String(b ?? ""));
              return aTimestamp - bTimestamp;
            },
          };
        }
        return {
          key: col,
          label: col,
          sortable: true,
          filterable: true,
        };
      }),
    []
  );

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    setIsLoading(true);
    setStatus("Parsing files...");

    try {
      const allRows: Row[] = [];
      const fileArray = Array.from(files);

      for (const file of fileArray) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        allRows.push(...parseWorkbook(workbook));
      }

      setFileNames(fileArray.map((file) => file.name));
      setRows(allRows);
      if (allRows.length === 0) {
        setValidationError(null);
        setStatus("No rows found in the uploaded files.");
      } else {
        const validation = validateYears(allRows);
        if (!validation.ok) {
          setValidationError(validation.message);
          setStatus(`שגיאת אימות: ${validation.message}`);
        } else {
          setValidationError(null);
          setStatus(`Loaded ${allRows.length} rows from ${files.length} file(s).`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Failed to parse files: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setRows([]);
    setFileNames([]);
    setValidationError(null);
    setStatus("Upload XLSX files to begin.");
  };

  const handleExportStocks = (data: typeof stocksTableData, filename: string) => {
    exportToExcel(
      data.map((s) => ({
        מניה: s.TICKER,
        כמות: s._rawQuantity,
        "עמלות ($)": s._rawFees,
        "דיבידנד ($)": s._rawDividends,
        "מס ($)": s._rawTaxes,
      })),
      filename,
      "מניות"
    );
  };

  const handleExportTransactions = () => {
    exportToExcel(rows as unknown as Record<string, unknown>[], "ibi_transactions", "פעולות");
  };

  // Keyboard shortcuts: 1-7 switch tabs, R refreshes prices, E exports current tab.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const tabMap: Record<string, TabName> = {
        "1": "dashboard",
        "2": "summary",
        "3": "past",
        "4": "account",
        "5": "analytics",
        "6": "table",
        "7": "alerts",
      };
      if (tabMap[e.key]) {
        handleTabChange(tabMap[e.key]);
        return;
      }
      if (e.key === "r" || e.key === "R") {
        portfolio.refreshPrices();
        return;
      }
      if (e.key === "e" || e.key === "E") {
        if (activeTab === "summary") handleExportStocks(activeStocksData, "ibi_active_stocks");
        else if (activeTab === "past") handleExportStocks(inactiveStocksData, "ibi_past_trades");
        else if (activeTab === "table") handleExportTransactions();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeStocksData, inactiveStocksData]);

  // Auto-load dev files in development mode
  useEffect(() => {
    const loadDevFiles = async () => {
      // Only run in development mode
      if (!import.meta.env.DEV) return;

      try {
        // Use Vite's import.meta.glob to find all .xlsx files in dev-data folder
        const devFiles = import.meta.glob('../dev-data/*.xlsx', { 
          query: '?url',
          import: 'default' 
        });

        const fileKeys = Object.keys(devFiles);
        
        if (fileKeys.length === 0) {
          console.log('No dev files found in dev-data folder');
          return;
        }

        console.log(`Found ${fileKeys.length} dev file(s), auto-loading...`);
        setIsLoading(true);
        setStatus("Loading dev files...");

        const allRows: Row[] = [];

        for (const filePath of fileKeys) {
          const urlModule = await devFiles[filePath]();
          const url = urlModule as string;
          const response = await fetch(url);
          const buffer = await response.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array" });
          allRows.push(...parseWorkbook(workbook));
        }

        setFileNames(fileKeys.map((key) => key.split("/").pop() ?? key));
        setRows(allRows);
        if (allRows.length === 0) {
          setValidationError(null);
          setStatus("No rows found in dev files.");
        } else {
          const validation = validateYears(allRows);
          if (!validation.ok) {
            setValidationError(validation.message);
            setStatus(`שגיאת אימות: ${validation.message}`);
          } else {
            setValidationError(null);
            setStatus(`✓ Auto-loaded ${allRows.length} rows from ${fileKeys.length} dev file(s).`);
          }
        }
      } catch (error) {
        console.error('Failed to auto-load dev files:', error);
        // Don't show error to user, just silently fail and let them upload manually
      } finally {
        setIsLoading(false);
      }
    };

    loadDevFiles();
  }, []); // Run once on mount

  const formatNumber = (value: number): string => {
    // Round to 2 decimal places
    const rounded = Math.round(value * 100) / 100;
    // Check if it's a whole number
    if (rounded === Math.floor(rounded)) {
      return rounded.toLocaleString('en-US');
    }
    return rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Quick-switch sidebar list for the detail view — the group the user drilled
  // in from (active holdings from ראשי, closed positions from עסקאות עבר).
  const detailList = activeTab === "past" ? inactiveStocksData : activeStocksData;
  const perfBySymbol = new Map(portfolio.stockPerformance.map((s) => [s.symbol, s]));
  const sidebarItems: SidebarItem[] = detailList.map((stock) => {
    if (activeTab === "past") {
      const pnl = perfBySymbol.get(stock.TICKER)?.finalPnL ?? 0;
      return {
        ticker: stock.TICKER,
        sub: formatSignedUsd(pnl),
        subKind: pnl >= 0 ? "positive" : "negative",
      };
    }
    const pct = stock.unrealizedPnLPercent;
    return {
      ticker: stock.TICKER,
      sub: pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : undefined,
      subKind: pct != null ? (pct >= 0 ? "positive" : "negative") : "neutral",
    };
  });

  return (
    <div className="page">
      {selectedTicker ? (
        <div className="detail-layout">
          <StockSidebar
            title={activeTab === "past" ? "עסקאות עבר" : "מניות פעילות"}
            items={sidebarItems}
            selected={selectedTicker}
            onSelect={setSelectedTicker}
          />
          <div className="detail-main">
            {closedTickersSet.has(selectedTicker) ? (
              <ClosedPositionDetail
                ticker={selectedTicker}
                rows={rows}
                onBack={() => setSelectedTicker(null)}
              />
            ) : (
              <StockDetail
                ticker={selectedTicker}
                rows={rows}
                onBack={() => setSelectedTicker(null)}
                portfolioValue={portfolio.summary.totalMarketValue}
              />
            )}
          </div>
        </div>
      ) : (
        <>
      <header className="app-header">
        <div className="app-brand">📊 IBI Portfolio</div>
        {rows.length > 0 && (
          <div className="app-header-files">
            {fileNames.map((name, index) => (
              <span key={`${name}-${index}`} className="file-chip" title={name}>
                📄 {name}
              </span>
            ))}
            <label className="upload">
              <input
                type="file"
                accept=".xlsx"
                multiple
                onChange={(event) => handleFiles(event.target.files)}
                disabled={isLoading}
              />
              {isLoading ? "טוען…" : "📤 העלאה"}
            </label>
            <button className="ghost" type="button" onClick={() => window.print()}>
              🖨 PDF
            </button>
            <button className="ghost" type="button" onClick={handleClear}>
              🗑 נקה
            </button>
          </div>
        )}
      </header>

      <main className="app-main">
        {rows.length === 0 ? (
          <div
            className={isDragging ? "upload-zone dragging" : "upload-zone"}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <div className="upload-zone-icon">📂</div>
            <div className="upload-zone-title">גררו קבצי XLSX לכאן</div>
            <p className="upload-zone-subtitle">או לחצו לבחירת קבצים</p>
            <label className="upload">
              <input
                type="file"
                accept=".xlsx"
                multiple
                onChange={(event) => handleFiles(event.target.files)}
                disabled={isLoading}
              />
              {isLoading ? "טוען…" : "בחרו קבצים"}
            </label>
            <p className="upload-zone-hint">תומך בקבצים מ-IBI בלבד · {status}</p>
          </div>
        ) : (
          <>
            {validationError ? (
              <p className="status" role="alert">
                {validationError}
              </p>
            ) : null}
            <nav className="app-tabs" role="tablist" aria-label="Data views">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "dashboard"}
                className={activeTab === "dashboard" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("dashboard")}
              >
                דשבורד
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "summary"}
                className={activeTab === "summary" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("summary")}
              >
                ראשי
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "past"}
                className={activeTab === "past" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("past")}
              >
                עסקאות עבר
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "account"}
                className={activeTab === "account" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("account")}
              >
                חשבון
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "analytics"}
                className={activeTab === "analytics" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("analytics")}
              >
                ניתוח
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "table"}
                className={activeTab === "table" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("table")}
              >
                פעולות
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "alerts"}
                className={activeTab === "alerts" ? "app-tab active" : "app-tab"}
                onClick={() => handleTabChange("alerts")}
              >
                🔔 התראות
              </button>
            </nav>
            <div className="tab-content">
              {activeTab === "dashboard" ? (
                validationError ? (
                  <p className="empty">לא ניתן להציג נתונים עד לתיקון שגיאות האימות.</p>
                ) : (
                  <Dashboard portfolio={portfolio} />
                )
              ) : activeTab === "summary" ? (
          <div className="summary-panel">
            <div className="summary-header">
              <h3>מניות פעילות</h3>
            </div>
            {rows.length === 0 || validationError ? (
              <p className="empty">
                {validationError
                  ? "לא ניתן להציג נתונים עד לתיקון שגיאות האימות."
                  : "עדיין אין נתונים להצגה."}
              </p>
            ) : (
              <SortableTable
                columns={stocksTableColumns}
                data={activeStocksData}
                getRowKey={(row) => row.TICKER}
                emptyMessage="אין מניות פעילות להצגה."
                toolbarSlot={
                  activeStocksData.length > 0 ? (
                    <button
                      type="button"
                      className="export-btn"
                      onClick={() => handleExportStocks(activeStocksData, "ibi_active_stocks")}
                    >
                      ⬇ ייצוא לאקסל
                    </button>
                  ) : null
                }
              />
            )}
          </div>
        ) : activeTab === "past" ? (
          <div className="summary-panel">
            <div className="summary-header">
              <h3>עסקאות עבר</h3>
            </div>
            {rows.length === 0 || validationError ? (
              <p className="empty">
                {validationError
                  ? "לא ניתן להציג נתונים עד לתיקון שגיאות האימות."
                  : "עדיין אין נתונים להצגה."}
              </p>
            ) : (
              <SortableTable
                columns={stocksTableColumns}
                data={inactiveStocksData}
                getRowKey={(row) => row.TICKER}
                emptyMessage="אין עסקאות עבר להצגה."
                toolbarSlot={
                  inactiveStocksData.length > 0 ? (
                    <button
                      type="button"
                      className="export-btn"
                      onClick={() => handleExportStocks(inactiveStocksData, "ibi_past_trades")}
                    >
                      ⬇ ייצוא לאקסל
                    </button>
                  ) : null
                }
              />
            )}
          </div>
        ) : activeTab === "account" ? (
          <div className="account-panel">
            <h3>סיכום חשבון</h3>
            {rows.length === 0 || validationError ? (
              <p className="empty">
                {validationError
                  ? "לא ניתן להציג נתונים עד לתיקון שגיאות האימות."
                  : "עדיין אין נתונים להצגה."}
              </p>
            ) : (
              <>
                <div className="account-summary-grid">
                  <div className="account-card">
                    <div className="account-card-label">סה"כ הפקדות</div>
                    <div className="account-card-value highlight-positive">{formatNumber(stocksSummary.totalCashTransfers)}₪</div>
                    {stocksSummary.totalBenefitsAndOther > 0 && (
                      <div className="account-card-subtext">+{formatNumber(stocksSummary.totalBenefitsAndOther)}₪ הטבות/שונות</div>
                    )}
                  </div>
                  <div className="account-card">
                    <div className="account-card-label">סה"כ עמלות</div>
                    <div className="account-card-value highlight-negative">{formatNumber(stocksSummary.totalFees)}$</div>
                  </div>
                  <div className="account-card">
                    <div className="account-card-label">סה"כ דיבידנד</div>
                    <div className="account-card-value highlight-positive">
                      {stocksSummary.totalDividends > 0 ? `${formatNumber(stocksSummary.totalDividends)}$` : '0$'}
                    </div>
                  </div>
                  <div className="account-card">
                    <div className="account-card-label">מס סה"כ דיבידנד</div>
                    <div className="account-card-value highlight-negative">
                      {stocksSummary.totalTaxes > 0 ? `${formatNumber(stocksSummary.totalTaxes)}$` : '0$'}
                    </div>
                  </div>
                  <div className="account-card">
                    <div className="account-card-label">סה"כ מס רווחי הון</div>
                    <div className="account-card-value highlight-negative">
                      {stocksSummary.totalCapitalGainsTax > 0 ? `${formatNumber(stocksSummary.totalCapitalGainsTax)}₪` : '0₪'}
                    </div>
                  </div>
                </div>
                <div className="account-chart-card">
                  <div className="account-chart-header">הפקדות לפי חודש</div>
                  {depositsByMonth.length === 0 ? (
                    <div className="account-chart-empty">אין הפקדות להצגה.</div>
                  ) : (
                    <div className="account-chart">
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={depositsByMonth} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) {
                                return null;
                              }
                              const data = payload[0].payload as {
                                monthLabel: string;
                                amount: number;
                                details: { dateLabel: string; amount: number }[];
                              };

                              return (
                                <div className="account-chart-tooltip">
                                  <div className="account-chart-tooltip-title">חודש: {data.monthLabel}</div>
                                  <div className="account-chart-tooltip-total">
                                    סה"כ: {formatNumber(data.amount)}₪
                                  </div>
                                  {data.details.length === 0 ? (
                                    <div className="account-chart-tooltip-empty">אין הפקדות בחודש זה.</div>
                                  ) : (
                                    <div className="account-chart-tooltip-list">
                                      {data.details.map((item, index) => (
                                        <div key={`${item.dateLabel}-${index}`} className="account-chart-tooltip-row">
                                          <span>{item.dateLabel}</span>
                                          <span>{formatNumber(item.amount)}₪</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="amount" fill="#22c55e" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="account-chart-card">
                  <div className="account-chart-top-row">
                    <div className="account-chart-header">דיבידנד לפי חודש ($)</div>
                    <label className="account-chart-toggle">
                      <input
                        type="checkbox"
                        checked={showCumulativeDividends}
                        onChange={(event) => setShowCumulativeDividends(event.target.checked)}
                      />
                      <span>{showCumulativeDividends ? "תצוגה מצטברת" : "תצוגה חודשית"}</span>
                    </label>
                  </div>

                  {dividendsByMonth.length === 0 ? (
                    <div className="account-chart-empty">אין דיבידנדים להצגה.</div>
                  ) : (
                    <div className="account-chart">
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={dividendsByMonth} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                          <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `$${formatNumber(Number(value) || 0)}`} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) {
                                return null;
                              }

                              const data = payload[0].payload as {
                                monthLabel: string;
                                amount: number;
                                cumulativeAmount: number;
                                details: { dateLabel: string; amount: number }[];
                              };

                              const displayedAmount = showCumulativeDividends ? data.cumulativeAmount : data.amount;

                              return (
                                <div className="account-chart-tooltip">
                                  <div className="account-chart-tooltip-title">חודש: {data.monthLabel}</div>
                                  <div className="account-chart-tooltip-total">
                                    {showCumulativeDividends ? "סה\"כ מצטבר" : "סה\"כ חודשי"}: ${formatNumber(displayedAmount)}
                                  </div>
                                  <div className="account-chart-tooltip-total">
                                    סה\"כ חודשי: ${formatNumber(data.amount)}
                                  </div>
                                  {data.details.length === 0 ? (
                                    <div className="account-chart-tooltip-empty">אין דיבידנד בחודש זה.</div>
                                  ) : (
                                    <div className="account-chart-tooltip-list">
                                      {data.details.map((item, index) => (
                                        <div key={`${item.dateLabel}-${index}`} className="account-chart-tooltip-row">
                                          <span>{item.dateLabel}</span>
                                          <span>${formatNumber(item.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey={showCumulativeDividends ? "cumulativeAmount" : "amount"}
                            fill={showCumulativeDividends ? "#0ea5e9" : "#16a34a"}
                            radius={[6, 6, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : activeTab === "analytics" ? (
          rows.length === 0 || validationError ? (
            <p className="empty">
              {validationError
                ? "לא ניתן להציג נתונים עד לתיקון שגיאות האימות."
                : "עדיין אין נתונים להצגה."}
            </p>
          ) : (
            <Analytics portfolio={portfolio} />
          )
        ) : activeTab === "alerts" ? (
          <div className="summary-panel">
            <div className="summary-header">
              <h3>התראות מחיר</h3>
            </div>
            <PriceAlerts symbols={uniqueSymbols} livePrices={portfolio.livePrices} />
          </div>
        ) : (
          <>
            {rows.length === 0 || validationError ? (
              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <td colSpan={columns.length} className="empty">
                        {validationError
                          ? "לא ניתן להציג נתונים עד לתיקון שגיאות האימות."
                          : "עדיין אין נתונים להצגה."}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <SortableTable
                columns={transactionsTableColumns}
                data={rows}
                getRowKey={(row, index) => `${row["תאריך"]}-${index}`}
                emptyMessage="עדיין אין נתונים להצגה."
                toolbarSlot={
                  <>
                    <span className="table-row-count">שורות: {rowCount}</span>
                    <button type="button" className="export-btn" onClick={handleExportTransactions}>
                      ⬇ ייצוא לאקסל
                    </button>
                  </>
                }
              />
            )}
          </>
        )}
            </div>
          </>
        )}
      </main>
      {rows.length > 0 && (
        <footer className="keyboard-hint">
          <span>קיצורי מקלדת:</span>
          <kbd>1</kbd>
          <kbd>2</kbd>
          <kbd>3</kbd>
          <kbd>4</kbd>
          <kbd>5</kbd>
          <kbd>6</kbd>
          <kbd>7</kbd>
          <span>מעבר בין טאבים</span>
          <kbd>R</kbd>
          <span>רענן מחירים</span>
          <kbd>E</kbd>
          <span>ייצוא</span>
        </footer>
      )}
        </>
      )}
    </div>
  );
};

export default App;
