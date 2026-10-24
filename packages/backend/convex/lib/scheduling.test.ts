import { describe, expect, test } from "vitest";
import { getCentralHour, getNextNineAmCentral } from "./scheduling";

describe("getNextNineAmCentral", () => {
  test("returns today at 9 AM Central when it is before 9", () => {
    // 2026-10-24T06:26:00Z = 1:26 AM CDT
    const result = getNextNineAmCentral(Date.UTC(2026, 9, 24, 6, 26, 0));
    expect(new Date(result).toISOString()).toBe("2026-10-24T14:00:00.000Z");
  });

  test("returns tomorrow at 9 AM Central when it is after 9", () => {
    // 2026-10-24T15:00:00Z = 10:00 AM CDT
    const result = getNextNineAmCentral(Date.UTC(2026, 9, 24, 15, 0, 0));
    expect(new Date(result).toISOString()).toBe("2026-10-25T14:00:00.000Z");
  });

  test("handles Central Standard Time", () => {
    // 2026-12-01T07:00:00Z = 1:00 AM CST
    const result = getNextNineAmCentral(Date.UTC(2026, 11, 1, 7, 0, 0));
    expect(new Date(result).toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });

  test("reports the Central hour", () => {
    // 2026-10-24T06:26:00Z = 1:26 AM CDT
    expect(getCentralHour(Date.UTC(2026, 9, 24, 6, 26, 0))).toBe(1);
    // 2026-10-24T14:00:00Z = 9:00 AM CDT
    expect(getCentralHour(Date.UTC(2026, 9, 24, 14, 0, 0))).toBe(9);
  });
});
