import { describe, expect, it } from "vitest";
import { formatDateLabel, parseDateToTimestamp, parseDateYear } from "./dates";

describe("date helpers", () => {
  it("parses Excel serial dates without loading XLSX in the initial app bundle", () => {
    expect(formatDateLabel("45292")).toBe("01/01/2024");
    expect(parseDateYear("45292")).toBe(2024);
    expect(new Date(parseDateToTimestamp("45292")).getFullYear()).toBe(2024);
  });

  it("formats common date strings consistently", () => {
    expect(formatDateLabel("1/2/2026")).toBe("01/02/2026");
    expect(formatDateLabel("2026-02-01")).toBe("01/02/2026");
  });
});
