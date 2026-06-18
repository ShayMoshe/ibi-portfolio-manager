import * as XLSX from "xlsx";

// Shared date helpers. Logic is identical to the copies previously inlined in
// App / StockDetail / ClosedPositionDetail, centralized here as the single
// source of truth. Supports Excel serial numbers, DD/MM/YYYY and YYYY-MM-DD.

export const parseDateToTimestamp = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const parsed = XLSX.SSF.parse_date_code(numeric);
      if (parsed && parsed.y) {
        return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
      }
    }
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmyMatch) {
    return new Date(
      parseInt(dmyMatch[3], 10),
      parseInt(dmyMatch[2], 10) - 1,
      parseInt(dmyMatch[1], 10)
    ).getTime();
  }

  const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymdMatch) {
    return new Date(
      parseInt(ymdMatch[1], 10),
      parseInt(ymdMatch[2], 10) - 1,
      parseInt(ymdMatch[3], 10)
    ).getTime();
  }

  return 0;
};

export const formatDateLabel = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";

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
    return `${dmyMatch[1].padStart(2, "0")}/${dmyMatch[2].padStart(2, "0")}/${dmyMatch[3]}`;
  }

  const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymdMatch) {
    return `${ymdMatch[3].padStart(2, "0")}/${ymdMatch[2].padStart(2, "0")}/${ymdMatch[1]}`;
  }

  return trimmed;
};

export const parseDateYear = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const parsed = XLSX.SSF.parse_date_code(numeric);
      if (parsed && parsed.y) return parsed.y;
    }
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmyMatch) return Number(dmyMatch[3]);

  const ymdMatch = trimmed.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (ymdMatch) return Number(ymdMatch[1]);

  return null;
};

// Human-friendly holding-duration label (Hebrew).
export const formatDuration = (days: number): string => {
  if (days === 0) return "אותו יום";
  if (days < 30) return `${days} ימים`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} חודשים`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years} שנה ו-${rem} חודשים` : `${years} שנה`;
};
