import { describe, expect, it } from "vitest";

import { parseStamp, streaks } from "./stats";

describe("streaks", () => {
  const today = new Date("2026-09-23T15:00:00");

  it("counts today and the unbroken days before it", () => {
    expect(streaks(["2026-09-21", "2026-09-22", "2026-09-23"], today)).toEqual({ current: 3, longest: 3 });
  });

  it("keeps a streak alive until today is over", () => {
    expect(streaks(["2026-09-21", "2026-09-22"], today).current).toBe(2);
  });

  it("breaks on a missed day but remembers the best run", () => {
    const result = streaks(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-20"], today);
    expect(result).toEqual({ current: 0, longest: 4 });
  });
});

describe("parseStamp", () => {
  it("reads SQLite's UTC timestamps", () => {
    expect(parseStamp("2026-09-23 14:05:00")?.toISOString()).toBe("2026-09-23T14:05:00.000Z");
    expect(parseStamp(null)).toBeNull();
  });
});
