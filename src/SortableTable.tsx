import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  filterType?: 'text' | 'date';
  sortComparator?: (a: unknown, b: unknown) => number;
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface SortableTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  emptyMessage?: string;
  toolbarSlot?: React.ReactNode;
}

const SortableTable = <T extends Record<string, unknown>>({
  columns,
  data,
  getRowKey,
  emptyMessage = "אין נתונים להצגה.",
  toolbarSlot,
}: SortableTableProps<T>) => {
  // Initialize with date column sorted desc if exists
  const dateColumn = columns.find(col => col.filterType === 'date');
  const [sortColumn, setSortColumn] = useState<string | null>(dateColumn?.key || null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(dateColumn ? 'desc' : null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      } else {
        setSortDirection("asc");
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
  };

  const handleFilterChange = (columnKey: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [columnKey]: value,
    }));
  };

  const sortedAndFilteredData = useMemo(() => {
    let result = [...data];

    // Apply filters
    Object.keys(filters).forEach((columnKey) => {
      const filterValue = filters[columnKey]?.toLowerCase().trim();
      if (filterValue) {
        result = result.filter((row) => {
          const cellValue = String(row[columnKey] ?? "")
            .toLowerCase()
            .trim();
          return cellValue.includes(filterValue);
        });
      }
    });

    // Apply sorting
    if (sortColumn && sortDirection) {
      const column = columns.find(col => col.key === sortColumn);
      
      result.sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];

        // Use custom comparator if provided
        if (column?.sortComparator) {
          const comparison = column.sortComparator(aValue, bValue);
          return sortDirection === "asc" ? comparison : -comparison;
        }

        const aStr = String(aValue ?? "");
        const bStr = String(bValue ?? "");

        const aNum = Number(aStr);
        const bNum = Number(bStr);

        let comparison = 0;

        if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
          comparison = aNum - bNum;
        } else {
          comparison = aStr.localeCompare(bStr, "he");
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [data, filters, sortColumn, sortDirection, columns]);

  return (
    <>
      <div className="table-toolbar">
        <div className="table-toolbar-group">{toolbarSlot}</div>
        <button
          type="button"
          className={showFilters ? "filter-toggle active" : "filter-toggle"}
          onClick={() => setShowFilters(!showFilters)}
        >
          {showFilters ? "🔍 הסתר סינון" : "🔍 הצג סינון"}
        </button>
      </div>
      <div className="table-wrap">
        <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                <div className="th-content">
                  {column.sortable !== false ? (
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() => handleSort(column.key)}
                    >
                      {column.label}
                      {sortColumn === column.key && sortDirection && (
                        <span className="sort-indicator">
                          {sortDirection === "asc" ? " ▲" : " ▼"}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span>{column.label}</span>
                  )}
                </div>
                {column.filterable && showFilters && (
                  <input
                    type="text"
                    className="filter-input"
                    placeholder="סנן..."
                    value={filters[column.key] ?? ""}
                    onChange={(e) =>
                      handleFilterChange(column.key, e.target.value)
                    }
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedAndFilteredData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedAndFilteredData.map((row, index) => (
              <tr key={getRowKey(row, index)}>
                {columns.map((column) => (
                  <td key={`${getRowKey(row, index)}-${column.key}`}>
                    {column.render
                      ? column.render(row[column.key], row)
                      : String(row[column.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
    </>
  );
};

export default SortableTable;
