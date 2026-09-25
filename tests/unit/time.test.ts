import { describe, expect, it } from "vitest";
import { resolveDate } from "../../shared/filters";
import { addDays, formatLondonDateTime, londonDate, londonToday } from "../../shared/time";

describe("UK time helpers", () => {
  it("uses BST in summer: late-evening UTC drops belong to the next UK day", () => {
    expect(londonDate("2026-09-25T22:59:59.000Z")).toBe("2026-09-25");
    expect(londonDate("2026-09-25T23:00:00.000Z")).toBe("2026-09-26");
    expect(formatLondonDateTime("2026-09-25T23:30:15.000Z")).toBe("2026-09-26 00:30:15 BST");
  });

  it("uses GMT in winter", () => {
    expect(londonDate("2026-11-20T23:30:00.000Z")).toBe("2026-11-20");
    expect(formatLondonDateTime("2026-11-20T23:30:15.000Z")).toBe("2026-11-20 23:30:15 GMT");
  });

  it("handles the clocks-go-back day (25 Oct 2026, 01:00 UTC)", () => {
    expect(formatLondonDateTime("2026-10-25T00:30:00.000Z")).toBe("2026-10-25 01:30:00 BST");
    expect(formatLondonDateTime("2026-10-25T01:30:00.000Z")).toBe("2026-10-25 01:30:00 GMT");
  });

  it("resolves today/tomorrow as UK calendar days", () => {
    const lateEvening = new Date("2026-09-25T23:15:00Z"); // 00:15 BST on the 26th
    expect(londonToday(lateEvening)).toBe("2026-09-26");
    expect(resolveDate("today", lateEvening)).toBe("2026-09-26");
    expect(resolveDate("tomorrow", lateEvening)).toBe("2026-09-27");
    expect(resolveDate("yesterday", lateEvening)).toBe("2026-09-25");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(formatLondonDateTime(null)).toBe("");
  });
});
