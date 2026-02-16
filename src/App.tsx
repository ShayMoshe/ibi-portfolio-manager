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
import { fetchMultipleStockPrices, StockPrice } from "./stockPriceService";
import StockDetail from "./StockDetail";

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

const App = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("Upload XLSX files to begin.");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "table" | "account">("summary");
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const rowCount = useMemo(() => rows.length, [rows]);
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
    
    if (showOnlyActive) {
      return allStocks.filter((stock) => parseFloat(stock["כמות במניה"]) !== 0);
    }
    
    return allStocks;
  }, [uniqueSymbols, rows, showOnlyActive]);

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

  const stocksTableColumns = useMemo<TableColumn<{ TICKER: string; "כמות במניה": string; 'סה"כ עמלות': string; 'סה"כ דיבידנד': string; 'סה"כ מס': string }>[]>(
    () => [
      {
        key: "TICKER",
        label: "TICKER",
        sortable: true,
        filterable: true,
        render: (value) => (
          <button
            className="ticker-link"
            onClick={() => setSelectedTicker(String(value))}
          >
            {String(value)}
          </button>
        ),
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
    ],
    []
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
    setValidationError(null);
    setStatus("Upload XLSX files to begin.");
  };

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

  return (
    <div className="page">
      {selectedTicker ? (
        <StockDetail
          ticker={selectedTicker}
          rows={rows}
          onBack={() => setSelectedTicker(null)}
        />
      ) : (
        <>
      <header className="hero">
        <div>
          <p className="eyebrow">IBI Portfolio Manager</p>
          <h1>IBI Analysis</h1>
        </div>
        <div className="actions">
          {rows.length === 0 ? (
            <>
              <label className="upload">
                <input
                  type="file"
                  accept=".xlsx"
                  multiple
                  onChange={(event) => handleFiles(event.target.files)}
                  disabled={isLoading}
                />
                {isLoading ? "Parsing..." : "בחרו קבצים"}
              </label>
              <p className="status" aria-live="polite">
                {status}
              </p>
            </>
          ) : (
            <button className="ghost" type="button" onClick={handleClear}>
              נקה נתונים
            </button>
          )}
        </div>
      </header>

      <section className="table-card">
        <div className="table-head">
          <div>
            <h2>תצוגת נתונים</h2>
            <span>שורות: {rowCount}</span>
          </div>
          <div className="tabs" role="tablist" aria-label="Data views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "summary"}
              className={activeTab === "summary" ? "tab active" : "tab"}
              onClick={() => setActiveTab("summary")}
            >
              ראשי
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "account"}
              className={activeTab === "account" ? "tab active" : "tab"}
              onClick={() => setActiveTab("account")}
            >
              חשבון
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "table"}
              className={activeTab === "table" ? "tab active" : "tab"}
              onClick={() => setActiveTab("table")}
            >
              טבלת פעולות
            </button>
          </div>
        </div>
        {validationError ? (
          <p className="status" role="alert">
            {validationError}
          </p>
        ) : null}
        {activeTab === "summary" ? (
          <div className="summary-panel">
            <div className="summary-header">
              <h3>רשימת מניות</h3>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showOnlyActive}
                  onChange={(e) => setShowOnlyActive(e.target.checked)}
                />
                הראה רק מניות פעילות
              </label>
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
                data={stocksTableData}
                getRowKey={(row) => row.TICKER}
                emptyMessage="לא נמצאו מניות להצגה."
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
                          <Bar dataKey="amount" fill="#0f172a" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </>
            )}
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
              />
            )}
          </>
        )}
      </section>
        </>
      )}
    </div>
  );
};

export default App;
