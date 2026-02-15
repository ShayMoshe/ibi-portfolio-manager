import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
  const [activeTab, setActiveTab] = useState<"summary" | "table">("summary");
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
      
      rows.forEach((row) => {
        const ticker = row["מס' נייר / סימבול"].trim();
        if (ticker !== symbol) return;
        
        const actionType = row["סוג פעולה"].trim();
        const amountStr = row["כמות"].trim();
        const amount = parseFloat(amountStr) || 0;
        
        // Calculate quantity
        if (actionType === "קניה חול מטח" || actionType === "הטבה") {
          quantity += amount;
        } else if (actionType === "מכירה חול מטח") {
          quantity -= amount;
        }
        
        // Sum transaction fees
        const feeStr = row["עמלת פעולה"].trim();
        const fee = parseFloat(feeStr) || 0;
        totalFees += Math.abs(fee); // Use absolute value in case fees are negative
      });
      
      return { 
        TICKER: symbol,
        "כמות במניה": quantity.toFixed(2),
        "עמלת פעולה": totalFees.toFixed(2),
      };
    });
    
    if (showOnlyActive) {
      return allStocks.filter((stock) => parseFloat(stock["כמות במניה"]) !== 0);
    }
    
    return allStocks;
  }, [uniqueSymbols, rows, showOnlyActive]);

  const stocksTableColumns = useMemo<TableColumn<{ TICKER: string; "כמות במניה": string; "עמלת פעולה": string }>[]>(
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
        key: "עמלת פעולה",
        label: "עמלת פעולה",
        sortable: true,
        filterable: false,
      },
    ],
    []
  );

  const transactionsTableColumns = useMemo<TableColumn<Row>[]>(
    () =>
      columns.map((col) => ({
        key: col,
        label: col,
        sortable: true,
        filterable: true,
      })),
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

  return (
    <div className="page">
      {selectedTicker ? (
        <StockDetail ticker={selectedTicker} onBack={() => setSelectedTicker(null)} />
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
