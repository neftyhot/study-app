import { describe, expect, it } from "vitest";

import { CHANGE_MIN_GAP_MS, isReportDue, REPORT_EVERY_MS } from "./telemetry";

describe("isReportDue", () => {
  const now = Date.parse("2026-09-24T19:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("sends the first report straight away", () => {
    expect(isReportDue(null, null, "1/1/10", now)).toBe(true);
  });

  it("sends every 15 minutes even when nothing changed", () => {
    expect(isReportDue(ago(REPORT_EVERY_MS - 1000), "1/1/10", "1/1/10", now)).toBe(false);
    expect(isReportDue(ago(REPORT_EVERY_MS), "1/1/10", "1/1/10", now)).toBe(true);
  });

  it("sends a minute after the card count changes", () => {
    expect(isReportDue(ago(CHANGE_MIN_GAP_MS - 1000), "1/1/89", "1/2/230", now)).toBe(false);
    expect(isReportDue(ago(CHANGE_MIN_GAP_MS), "1/1/89", "1/2/230", now)).toBe(true);
  });
});
