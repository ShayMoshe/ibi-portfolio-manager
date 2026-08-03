import type { RawRow } from "../types";

export const UPLOAD_CACHE_KEY = "ibi_uploaded_data";
export const UPLOAD_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type StoredUpload = {
  expiresAt: number;
  fileNames: string[];
  rows: RawRow[];
  savedAt: number;
};

export type CachedUpload = StoredUpload;

export const readCachedUpload = (
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now()
): CachedUpload | null => {
  try {
    const raw = storage.getItem(UPLOAD_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as Partial<StoredUpload>;
    if (
      !Array.isArray(cached.rows) ||
      cached.rows.length === 0 ||
      !Array.isArray(cached.fileNames) ||
      typeof cached.expiresAt !== "number" ||
      cached.expiresAt <= now
    ) {
      storage.removeItem(UPLOAD_CACHE_KEY);
      return null;
    }

    return {
      rows: cached.rows as RawRow[],
      fileNames: cached.fileNames as string[],
      expiresAt: cached.expiresAt,
      // Caches written before this field was added still have a reliable age:
      // their expiry was always calculated as 30 days from upload.
      savedAt:
        typeof cached.savedAt === "number" && cached.savedAt <= cached.expiresAt
          ? cached.savedAt
          : cached.expiresAt - UPLOAD_CACHE_TTL_MS,
    };
  } catch {
    // Invalid or inaccessible browser storage should never block an upload.
    return null;
  }
};

export const saveCachedUpload = (
  storage: Pick<Storage, "setItem">,
  rows: RawRow[],
  fileNames: string[],
  now = Date.now()
): CachedUpload | null => {
  try {
    const cached: CachedUpload = {
      rows,
      fileNames,
      savedAt: now,
      expiresAt: now + UPLOAD_CACHE_TTL_MS,
    };
    storage.setItem(UPLOAD_CACHE_KEY, JSON.stringify(cached));
    return cached;
  } catch {
    // Quota limits and private-browsing restrictions are handled gracefully.
    return null;
  }
};

export const clearCachedUpload = (storage: Pick<Storage, "removeItem">) => {
  try {
    storage.removeItem(UPLOAD_CACHE_KEY);
  } catch {
    // Clearing optional browser storage is best-effort.
  }
};

export const formatUploadAge = (savedAt: number, now = Date.now()): string => {
  const elapsedMinutes = Math.max(0, Math.floor((now - savedAt) / 60000));
  if (elapsedMinutes < 1) return "הועלה עכשיו";
  if (elapsedMinutes < 60) {
    return elapsedMinutes === 1 ? "הועלה לפני דקה" : `הועלה לפני ${elapsedMinutes} דקות`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return elapsedHours === 1 ? "הועלה לפני שעה" : `הועלה לפני ${elapsedHours} שעות`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return elapsedDays === 1 ? "הועלה לפני יום" : `הועלה לפני ${elapsedDays} ימים`;
};
