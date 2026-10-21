import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  funnelReport,
  generationBucket,
  generationErrorCategory,
  noteReturns,
  recordFunnel,
  recordSource,
} from "@/lib/funnel";
import { buildReport } from "@/lib/telemetry";

let db: Db;

beforeEach(() => {
  db = drizzle(new Database(":memory:"), { schema }) as unknown as Db;
  migrate(db, { migrationsFolder: "./drizzle" });
});

describe("the funnel", () => {
  it("records each step once, and reports names only", () => {
    expect(recordFunnel(db, "first_launch")).toBe(true);
    expect(recordFunnel(db, "first_launch")).toBe(false);
    recordFunnel(db, "first_generation_completed", { durationMs: 95_000 });
    recordFunnel(db, "first_generation_failed", { error: "429 quota exhausted for slides.pdf" });

    const report = funnelReport(db);
    expect(report).toEqual({
      events: ["first_launch", "first_generation_completed", "first_generation_failed"],
      generationBucket: "1-3m",
      generationError: "quota",
      source: null,
    });
    // No timestamps and no free text anywhere in what is sent.
    expect(JSON.stringify(report)).not.toMatch(/\d{4}-\d{2}-\d{2}|slides|pdf/);
  });

  it("buckets durations and sorts errors into categories", () => {
    expect(generationBucket(59_000)).toBe("<1m");
    expect(generationBucket(60_000)).toBe("1-3m");
    expect(generationBucket(9 * 60_000)).toBe("3-10m");
    expect(generationBucket(11 * 60_000)).toBe(">10m");
    expect(generationErrorCategory("API key not valid")).toBe("key");
    expect(generationErrorCategory("fetch failed")).toBe("network");
    expect(generationErrorCategory("something odd")).toBe("other");
  });

  it("keeps the first known source and nothing else", () => {
    expect(recordSource(db, "my roommate Jess")).toBe(false);
    expect(recordSource(db, "poster")).toBe(true);
    expect(recordSource(db, "friend")).toBe(false);
    expect(funnelReport(db).source).toBe("poster");
  });

  it("notes coming back after a day and a week", () => {
    const start = new Date("2026-10-01T12:00:00Z");
    recordFunnel(db, "first_launch", {}, start);
    noteReturns(db, new Date("2026-10-01T20:00:00Z"));
    expect(funnelReport(db).events).toEqual(["first_launch"]);
    noteReturns(db, new Date("2026-10-02T13:00:00Z"));
    expect(funnelReport(db).events).toContain("returned_day_1");
    noteReturns(db, new Date("2026-10-09T13:00:00Z"));
    expect(funnelReport(db).events).toContain("returned_day_7");
  });

  it("rides along in the usage report", () => {
    recordFunnel(db, "privacy_accepted");
    expect(buildReport(db).funnel.events).toEqual(["privacy_accepted"]);
  });
});
