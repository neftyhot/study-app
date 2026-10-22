/**
 * The shared core on its own: imported by relative path, with none of the
 * desktop's aliases, server modules or Node APIs, the way the iOS bundle
 * sees it. The desktop's own suites cover the same code through its shims.
 */
import { describe, expect, it } from "vitest";

import { parseShareFile, SHARE_FORMAT, SHARE_VERSION, ShareFileError, shareFilename } from "./share/meganstudy";
import { addDays, DEFAULT_EASE, isDue, scheduleReview, type ScheduleState } from "./srs/schedule";

const fresh: ScheduleState = {
  state: "recognition",
  intervalDays: 0,
  nextReviewDue: null,
  ease: DEFAULT_EASE,
  retentionCount: 0,
  lastCreditedAt: null,
};

describe("SRS in the core", () => {
  it("spaces a right answer out and brings a miss back sooner", () => {
    const day1 = "2026-10-01";
    const passed = scheduleReview(fresh, { quality: "pass", retentionEligible: true }, day1);
    expect(passed.intervalDays).toBeGreaterThanOrEqual(1);
    expect(passed.nextReviewDue).toBe(addDays(day1, passed.intervalDays));
    expect(passed.lastCreditedAt).toBe(day1);

    const day2 = passed.nextReviewDue!;
    const again = scheduleReview(passed, { quality: "pass", retentionEligible: true }, day2);
    expect(again.state).toBe("retained");
    expect(again.intervalDays).toBeGreaterThan(passed.intervalDays);

    const missed = scheduleReview(again, { quality: "fail", retentionEligible: true }, again.nextReviewDue!);
    expect(missed.intervalDays).toBe(Math.max(1, Math.floor(again.intervalDays / 2)));
    expect(missed.ease).toBeLessThan(again.ease);
  });

  it("gives no credit twice in a day and none for a guess", () => {
    const day = "2026-10-01";
    const once = scheduleReview(fresh, { quality: "pass", retentionEligible: true }, day);
    expect(scheduleReview(once, { quality: "pass", retentionEligible: true }, day)).toBe(once);
    expect(scheduleReview(once, { quality: "fail", retentionEligible: false, guessed: true }, day)).toBe(once);
  });

  it("treats overdue as due", () => {
    expect(isDue({ nextReviewDue: "2026-09-01" }, "2026-10-01")).toBe(true);
    expect(isDue({ nextReviewDue: "2026-10-02" }, "2026-10-01")).toBe(false);
    expect(isDue({ nextReviewDue: null }, "2026-10-01")).toBe(false);
  });
});

describe(".meganstudy reading in the core", () => {
  const file = {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: "2026-10-01T00:00:00.000Z",
    deck: {
      title: "Cell Biology",
      course: "BIO 101",
      term: null,
      cards: [
        {
          topic: "Cells",
          question: "What makes ATP?",
          directAnswer: "The mitochondria",
          fullExplanation: null,
          cardType: "definition",
          sourceExcerpt: null,
          essentialPoints: ["mitochondria"],
        },
      ],
      guide: null,
    },
  };

  it("reads back what the desktop writes", () => {
    const parsed = parseShareFile(JSON.stringify(file));
    expect(parsed.deck.title).toBe("Cell Biology");
    expect(parsed.deck.cards).toHaveLength(1);
    expect(parsed.deck.cards[0].question).toBe("What makes ATP?");
  });

  it("refuses something that is not a deck", () => {
    expect(() => parseShareFile("not json")).toThrow(ShareFileError);
    expect(() => parseShareFile(JSON.stringify({ format: "other" }))).toThrow(ShareFileError);
  });

  it("names the file after the deck", () => {
    expect(shareFilename("Cell Biology")).toMatch(/\.meganstudy$/);
  });
});
