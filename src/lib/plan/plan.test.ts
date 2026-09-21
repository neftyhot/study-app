/**
 * Exam-date planning (PRD §12).
 *
 * The planner's job is to be honest about arithmetic a student would rather
 * not do, so these check the numbers rather than the prose.
 */
import { describe, expect, it } from "vitest";

import {
  buildPlan,
  DEFAULT_DAILY_MINUTES,
  formatMinutes,
  MINUTES,
  reviewsWithin,
  type PlanCard,
} from "./index";
import { addDays, todayIso } from "@/lib/srs";

const TODAY = "2026-03-10";

function card(overrides: Partial<PlanCard> = {}): PlanCard {
  return {
    id: crypto.randomUUID(),
    cardType: "atomic",
    excluded: false,
    state: null,
    lapses: 0,
    nextReviewDue: null,
    mapsToObjective: true,
    emphasised: false,
    ...overrides,
  };
}

function cards(count: number, overrides: Partial<PlanCard> = {}): PlanCard[] {
  return Array.from({ length: count }, () => card(overrides));
}

function plan(input: Partial<Parameters<typeof buildPlan>[0]> = {}) {
  return buildPlan({
    cards: [],
    examDate: null,
    dailyMinutes: 30,
    today: TODAY,
    ...input,
  });
}

describe("reviewsWithin", () => {
  it("walks the real scheduling ladder, not a flat rate", () => {
    // Intervals are 1, 3, 7, 17… so a fortnight is three reviews, not fourteen.
    expect(reviewsWithin(1)).toBe(1);
    expect(reviewsWithin(4)).toBe(2);
    expect(reviewsWithin(14)).toBe(3);
    expect(reviewsWithin(0)).toBe(0);
    expect(reviewsWithin(-5)).toBe(0);
  });

  it("grows slowly, because spacing does", () => {
    // Four times the days is nowhere near four times the reviews.
    expect(reviewsWithin(120)).toBeLessThan(reviewsWithin(30) * 2);
  });
});

describe("today's plan", () => {
  it("does due reviews before starting anything new", () => {
    const result = plan({
      cards: [
        ...cards(10, { state: "retained", nextReviewDue: "2026-03-01" }),
        ...cards(50),
      ],
      dailyMinutes: 10,
    });

    expect(result.today.due).toBe(10);
    // 10 reviews at 0.6 min leaves 4 minutes: two new concepts at 2 min each.
    expect(result.today.fresh).toBe(2);
  });

  it("says when reviews alone fill the day", () => {
    const result = plan({
      cards: [
        ...cards(60, { state: "retained", nextReviewDue: "2026-03-01" }),
        ...cards(20),
      ],
      dailyMinutes: 20,
    });

    expect(result.today.fresh).toBe(0);
    expect(result.today.reviewsFillTheDay).toBe(true);
  });

  it("does not flag a full day when there is nothing new left", () => {
    const result = plan({
      cards: cards(60, { state: "retained", nextReviewDue: "2026-03-01" }),
      dailyMinutes: 5,
    });

    expect(result.today.reviewsFillTheDay).toBe(false);
  });

  it("counts a stuck card as needing extra time, not just another review", () => {
    const withStruggles = plan({
      cards: cards(10, { state: "recognition", lapses: 3 }),
      dailyMinutes: 60,
    });
    const without = plan({
      cards: cards(10, { state: "recognition", lapses: 0 }),
      dailyMinutes: 60,
    });

    expect(withStruggles.today.struggling).toBe(10);
    expect(withStruggles.today.minutes).toBeGreaterThan(without.today.minutes);
  });

  it("ignores cards the student excluded", () => {
    const result = plan({ cards: cards(40, { excluded: true }) });
    expect(result.totals.cards).toBe(0);
  });

  it("fills the day with new material when nothing is due", () => {
    const result = plan({ cards: cards(100), dailyMinutes: 30 });
    expect(result.today.fresh).toBe(15);
    expect(result.today.due).toBe(0);
  });
});

describe("workload against the calendar", () => {
  it("reports no deficit when there is no exam date", () => {
    const result = plan({ cards: cards(500) });

    expect(result.daysLeft).toBeNull();
    expect(result.workload.deficitMinutes).toBeNull();
    expect(result.workload.capacity).toBeNull();
  });

  it("finds the deficit when the deck is bigger than the calendar", () => {
    // 400 unstudied cards is at least 800 minutes; 7 days at 30 min is 210.
    const result = plan({
      cards: cards(400),
      examDate: addDays(TODAY, 7),
      dailyMinutes: 30,
    });

    expect(result.daysLeft).toBe(7);
    expect(result.workload.capacity).toBe(210);
    expect(result.workload.deficitMinutes).toBeGreaterThan(0);
    expect(result.workload.requiredDailyMinutes).toBeGreaterThan(30);
  });

  it("reports no deficit when the time is genuinely there", () => {
    const result = plan({
      cards: cards(20),
      examDate: addDays(TODAY, 30),
      dailyMinutes: 60,
    });

    expect(result.workload.deficitMinutes).toBe(0);
  });

  it("counts the reviews learned cards will generate, not just new ones", () => {
    const fresh = plan({ cards: cards(50), examDate: addDays(TODAY, 14) });
    const learned = plan({
      cards: cards(50, { state: "immediate_recall" }),
      examDate: addDays(TODAY, 14),
    });

    // Learning is the bigger cost, but a learned deck is not free.
    expect(learned.workload.minutes).toBeGreaterThan(0);
    expect(fresh.workload.minutes).toBeGreaterThan(learned.workload.minutes);
  });

  it("treats exam day itself as no time left", () => {
    const result = plan({ cards: cards(10), examDate: TODAY });

    expect(result.daysLeft).toBe(0);
    expect(result.workload.capacity).toBe(0);
    expect(result.workload.requiredDailyMinutes).toBeNull();
  });

  it("does not go negative for an exam that has passed", () => {
    const result = plan({ cards: cards(10), examDate: addDays(TODAY, -3) });
    expect(result.daysLeft).toBe(0);
  });
});

describe("triage", () => {
  it("offers application cards first, as the least load-bearing", () => {
    const result = plan({
      cards: [...cards(30), ...cards(20, { cardType: "application" })],
      examDate: addDays(TODAY, 7),
      hasCoverage: true,
    });

    const cut = result.cuts.find((item) => item.id === "application")!;
    expect(cut.cards).toBe(20);
    expect(cut.minutesSaved).toBeGreaterThan(0);
  });

  it("offers cards no objective asks for, but only with a coverage matrix", () => {
    const deck = [...cards(30), ...cards(15, { mapsToObjective: false })];

    expect(
      plan({ cards: deck, examDate: addDays(TODAY, 7), hasCoverage: true }).cuts.some(
        (cut) => cut.id === "unmapped",
      ),
    ).toBe(true);

    // Without coverage, "covers no objective" is not something we know.
    expect(
      plan({ cards: deck, examDate: addDays(TODAY, 7) }).cuts.some(
        (cut) => cut.id === "unmapped",
      ),
    ).toBe(false);
  });

  it("offers professor emphasis only when some cards carry it", () => {
    const mixed = plan({
      cards: [...cards(10, { emphasised: true }), ...cards(40)],
      examDate: addDays(TODAY, 7),
      hasCoverage: true,
    });
    expect(mixed.cuts.some((cut) => cut.id === "unemphasised")).toBe(true);

    // If everything is emphasised, the cut would drop nothing.
    const allFlagged = plan({
      cards: cards(50, { emphasised: true }),
      examDate: addDays(TODAY, 7),
      hasCoverage: true,
    });
    expect(allFlagged.cuts.some((cut) => cut.id === "unemphasised")).toBe(false);
  });

  it("ranks cuts by what they actually save", () => {
    const result = plan({
      cards: [
        ...cards(10, { cardType: "application" }),
        ...cards(60, { mapsToObjective: false }),
        ...cards(30),
      ],
      examDate: addDays(TODAY, 14),
      hasCoverage: true,
    });

    const saved = result.cuts.map((cut) => cut.minutesSaved);
    expect([...saved].sort((a, b) => b - a)).toEqual(saved);
    expect(result.cuts[0].id).toBe("unmapped");
  });

  it("offers nothing to cut from a deck with nothing spare", () => {
    const result = plan({
      cards: cards(20),
      examDate: addDays(TODAY, 30),
      hasCoverage: true,
    });

    expect(result.cuts).toEqual([]);
  });
});

describe("presentation", () => {
  it("falls back to a sensible daily budget", () => {
    expect(plan({ dailyMinutes: null }).dailyMinutes).toBe(DEFAULT_DAILY_MINUTES);
  });

  it("never rounds a real cost down to nothing", () => {
    expect(formatMinutes(0.2)).toBe("1 min");
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(135)).toBe("2 hr 15 min");
  });

  it("uses today when no date is given", () => {
    const result = buildPlan({
      cards: cards(5),
      examDate: addDays(todayIso(), 10),
      dailyMinutes: 30,
    });
    expect(result.daysLeft).toBe(10);
  });

  it("keeps the time model honest about what a new card costs", () => {
    // A new concept is the whole ladder, not one look at a card.
    expect(MINUTES.newConcept).toBeGreaterThan(MINUTES.typedReview * 3);
  });
});
