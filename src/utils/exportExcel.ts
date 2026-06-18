import * as XLSX from "xlsx";

// Export an array of plain objects to a downloaded .xlsx file. Object keys
// become column headers (Hebrew labels are fine). A date suffix is appended.
export const exportToExcel = (
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = "נתונים"
): void => {
  if (rows.length === 0) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const stamp = new Date().toISOString().split("T")[0];
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`);
};
