/**
 * The developer's remote switches: what the app makes of the server's answer,
 * which AI calls it refuses, and which full-screen notice it shows.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  aiBlockReason,
  aiRestricted,
  blockingScreen,
  MAINTENANCE_ACK_KEY,
  NORMAL_STATUS,
  needsUpdate,
  parseStatus,
  readAppStatus,
  statusSignature,
  UPDATE_ACK_KEY,
  type AppStatus,
} from "@/lib/app-status";
import { writeSetting } from "@/lib/settings";

const status = (overrides: Partial<AppStatus>): AppStatus => ({ ...NORMAL_STATUS, ...overrides });

/** Words the retry logic treats as "try again later"; a switch must never read as one. */
const RETRYABLE = /429|rate limit|quota|overloaded|503|service unavailable|econnreset|etimedout/i;

describe("parseStatus", () => {
  it("falls back to normal for anything odd", () => {
    expect(parseStatus(null)).toEqual(NORMAL_STATUS);
    expect(parseStatus("maintenance")).toEqual(NORMAL_STATUS);
    expect(parseStatus({ mode: "shutdown", minVersion: "latest", until: "soon" })).toEqual(NORMAL_STATUS);
  });

  it("keeps only switched-off known features", () => {
    const parsed = parseStatus({ mode: "ai_paused", features: { tutor: false, decks: true, nope: false } });
    expect(parsed.mode).toBe("ai_paused");
    expect(parsed.features).toEqual({ tutor: false });
  });

  it("caps the message", () => {
    expect(parseStatus({ message: "x".repeat(900) }).message).toHaveLength(500);
  });
});

describe("aiBlockReason", () => {
  it("allows everything when normal", () => {
    expect(aiBlockReason(NORMAL_STATUS, "generate")).toBeNull();
    expect(aiRestricted(NORMAL_STATUS)).toBe(false);
  });

  it("uses the developer's message when there is one", () => {
    expect(aiBlockReason(status({ mode: "ai_paused", message: "Back at 5." }))).toBe("Back at 5.");
  });

  it("puts maintenance before a required update and a single feature", () => {
    const s = status({ mode: "maintenance", minVersion: "99.0.0", features: { tutor: false } });
    expect(aiBlockReason(s, "tutor")).toMatch(/maintenance/);
  });

  it("refuses versions older than minVersion, and only those", () => {
    const s = status({ minVersion: "1.5.0" });
    expect(needsUpdate(s, "1.4.9")).toBe(true);
    expect(needsUpdate(s, "1.5.0")).toBe(false);
    expect(aiBlockReason(s, "generate", "1.4.0")).toMatch(/1\.5\.0/);
    expect(aiBlockReason(s, "generate", "1.6.0")).toBeNull();
  });

  it("turns off one feature group and leaves the rest", () => {
    const s = status({ features: { guides: false } });
    expect(aiBlockReason(s, "primer")).toMatch(/study guides/);
    expect(aiBlockReason(s, "primer_example")).not.toBeNull();
    expect(aiBlockReason(s, "tutor")).toBeNull();
    expect(aiRestricted(s)).toBe(true);
  });

  it("never reads as a retryable error", () => {
    const cases = [
      status({ mode: "maintenance" }),
      status({ mode: "ai_paused" }),
      status({ minVersion: "99.0.0" }),
      status({ features: { decks: false } }),
    ];
    for (const s of cases) expect(aiBlockReason(s, "generate", "1.0.0")).not.toMatch(RETRYABLE);
  });
});

describe("stored status", () => {
  let db: Db;

  beforeEach(() => {
    db = drizzle(new Database(":memory:"), { schema }) as unknown as Db;
    migrate(db as never, { migrationsFolder: "./drizzle" });
  });

  it("is normal before the server has ever answered", () => {
    expect(readAppStatus(db)).toEqual(NORMAL_STATUS);
    expect(blockingScreen(readAppStatus(db), db)).toBeNull();
  });

  it("treats a mode past its until as over, keeping the message", () => {
    writeSetting("app_status", JSON.stringify(status({ mode: "maintenance", message: "Hi", until: 1000 })), db);
    expect(readAppStatus(db, 999).mode).toBe("maintenance");
    const after = readAppStatus(db, 1000);
    expect(after.mode).toBe("normal");
    expect(after.message).toBe("Hi");
  });

  it("survives a corrupt stored value", () => {
    writeSetting("app_status", "{not json", db);
    expect(readAppStatus(db)).toEqual(NORMAL_STATUS);
  });

  it("shows maintenance until acknowledged, and again for a new notice", () => {
    const first = status({ mode: "maintenance", updatedAt: 1 });
    expect(blockingScreen(first, db)).toBe("maintenance");
    writeSetting(MAINTENANCE_ACK_KEY, "1", db);
    expect(blockingScreen(first, db)).toBeNull();
    expect(blockingScreen(status({ mode: "maintenance", updatedAt: 2 }), db)).toBe("maintenance");
  });

  it("shows the update screen until acknowledged for that minimum version", () => {
    const s = status({ minVersion: "9.0.0" });
    expect(blockingScreen(s, db, "1.0.0")).toBe("update");
    expect(blockingScreen(s, db, "9.0.0")).toBeNull();
    writeSetting(UPDATE_ACK_KEY, "9.0.0", db);
    expect(blockingScreen(s, db, "1.0.0")).toBeNull();
    expect(blockingScreen(status({ minVersion: "9.1.0" }), db, "1.0.0")).toBe("update");
  });

  it("changes signature when what is shown would", () => {
    const a = statusSignature(status({ mode: "normal", updatedAt: 1 }));
    expect(statusSignature(status({ mode: "ai_paused", updatedAt: 1 }))).not.toBe(a);
    expect(statusSignature(status({ mode: "normal", updatedAt: 2 }))).not.toBe(a);
  });
});
