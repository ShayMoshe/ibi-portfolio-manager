import { describe, expect, it } from "vitest";
import {
  UPLOAD_CACHE_KEY,
  UPLOAD_CACHE_TTL_MS,
  clearCachedUpload,
  formatUploadAge,
  readCachedUpload,
  saveCachedUpload,
} from "./uploadStorage";
import type { RawRow } from "../types";

const rows = [{ "תאריך": "01/01/2026" }] as RawRow[];

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe("uploaded data storage", () => {
  it("stores parsed uploads for 30 days", () => {
    const storage = createStorage();
    const now = 1_700_000_000_000;

    const saved = saveCachedUpload(storage, rows, ["portfolio.xlsx"], now);

    expect(saved?.expiresAt).toBe(now + UPLOAD_CACHE_TTL_MS);
    expect(readCachedUpload(storage, now + UPLOAD_CACHE_TTL_MS - 1)).toEqual(saved);
  });

  it("removes expired uploads instead of restoring them", () => {
    const storage = createStorage();
    const now = 1_700_000_000_000;
    saveCachedUpload(storage, rows, ["portfolio.xlsx"], now);

    expect(readCachedUpload(storage, now + UPLOAD_CACHE_TTL_MS)).toBeNull();
    expect(storage.getItem(UPLOAD_CACHE_KEY)).toBeNull();
  });

  it("clears a saved upload on reset", () => {
    const storage = createStorage();
    saveCachedUpload(storage, rows, ["portfolio.xlsx"]);

    clearCachedUpload(storage);

    expect(readCachedUpload(storage)).toBeNull();
  });

  it("formats an upload age for the file label", () => {
    const now = 1_700_000_000_000;

    expect(formatUploadAge(now, now)).toBe("הועלה עכשיו");
    expect(formatUploadAge(now - 60 * 60000, now)).toBe("הועלה לפני שעה");
    expect(formatUploadAge(now - 3 * 86400000, now)).toBe("הועלה לפני 3 ימים");
  });
});
