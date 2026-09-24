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
  MAX_DAILY_MINUTES,
  MINUTES,
  reviewsWithin,
  type PlanCard,
} from "./index";
import { addDays, todayIso } from "@/lib/srs";

const TODAY = "2026-03-10";
const WEEKENDS = 0b1000001;

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
    // With no exam date the day is the default half hour.
    const result = plan({
      cards: [
        ...cards(20, { state: "retained", nextReviewDue: "2026-03-01" }),
        ...cards(50),
      ],
    });

    expect(result.today.due).toBe(20);
    // 20 reviews at 0.6 min leaves 18 minutes: nine new concepts at 2 min.
    expect(result.today.fresh).toBe(9);
  });

  it("counts a stuck card as needing extra time, not just another review", () => {
    const withStruggles = plan({ cards: cards(10, { state: "recognition", lapses: 3 }) });
    const without = plan({ cards: cards(10, { state: "recognition", lapses: 0 }) });

    expect(withStruggles.today.struggling).toBe(10);
    expect(withStruggles.today.minutes).toBeGreaterThan(without.today.minutes);
  });

  it("ignores cards the student excluded", () => {
    const result = plan({ cards: cards(40, { excluded: true }) });
    expect(result.totals.cards).toBe(0);
  });

  it("fills a default day with new material when there is no exam date", () => {
    const result = plan({ cards: cards(100) });
    expect(result.dailyMinutes).toBe(DEFAULT_DAILY_MINUTES);
    expect(result.today.fresh).toBe(15);
    expect(result.today.due).toBe(0);
  });

  it("asks for nothing new on a day off", () => {
    // March 10, 2026 is a Tuesday; study only at weekends.
    const result = plan({ cards: cards(100), studyDays: WEEKENDS });
    expect(result.today.studyDay).toBe(false);
    expect(result.today.fresh).toBe(0);
    expect(result.today.minutes).toBe(0);
  });
});

describe("the daily time is worked out, not chosen", () => {
  it("is enough to start every card before the exam", () => {
    const result = plan({ cards: cards(100), examDate: addDays(TODAY, 14) });

    expect(result.overloaded).toBe(false);
    expect(result.workload.unreachedByExam).toBe(0);
    expect(result.workload.deficitMinutes).toBe(0);
    expect(result.dailyMinutes % 5).toBe(0);
    expect(result.dailyMinutes).toBeGreaterThanOrEqual(
      result.workload.requiredDailyMinutes!,
    );
  });

  it("is the least that does it, give or take rounding", () => {
    const result = plan({ cards: cards(100), examDate: addDays(TODAY, 14) });
    // Two weeks with the last day kept for review: 100 cards over 13 days is
    // about 8 a day, 16 minutes of new material plus reviews.
    expect(result.dailyMinutes).toBeGreaterThan(15);
    expect(result.dailyMinutes).toBeLessThan(40);
  });

  it("goes up when the student studies fewer days", () => {
    const everyDay = plan({ cards: cards(100), examDate: addDays(TODAY, 14) });
    const weekends = plan({
      cards: cards(100),
      examDate: addDays(TODAY, 14),
      studyDays: WEEKENDS,
    });

    expect(weekends.studyDaysLeft).toBe(4);
    expect(weekends.dailyMinutes).toBeGreaterThan(everyDay.dailyMinutes);
    expect(weekends.workload.unreachedByExam).toBe(0);
  });

  it("is zero when there is nothing left to do", () => {
    const result = plan({ cards: [], examDate: addDays(TODAY, 7) });
    expect(result.dailyMinutes).toBe(0);
    expect(result.overloaded).toBe(false);
  });

  it("caps the day and says so when the deck cannot fit", () => {
    const result = plan({ cards: cards(2000), examDate: addDays(TODAY, 3) });

    expect(result.overloaded).toBe(true);
    expect(result.dailyMinutes).toBe(MAX_DAILY_MINUTES);
    expect(result.workload.unreachedByExam).toBeGreaterThan(0);
    expect(result.workload.deficitMinutes).toBeGreaterThan(0);
  });

  it("is overloaded when no study day falls before the exam", () => {
    // Tuesday to Thursday, weekends only.
    const result = plan({
      cards: cards(10),
      examDate: addDays(TODAY, 2),
      studyDays: WEEKENDS,
    });

    expect(result.studyDaysLeft).toBe(0);
    expect(result.overloaded).toBe(true);
    expect(result.workload.requiredDailyMinutes).toBeNull();
    expect(result.workload.unreachedByExam).toBe(10);
  });
});

describe("workload against the calendar", () => {
  it("reports no deficit when there is no exam date", () => {
    const result = plan({ cards: cards(500) });

    expect(result.daysLeft).toBeNull();
    expect(result.studyDaysLeft).toBeNull();
    expect(result.workload.deficitMinutes).toBeNull();
    expect(result.workload.capacity).toBeNull();
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

  it("quotes enough time for the reviews, even with nothing new to start", () => {
    const result = plan({
      cards: cards(200, { state: "retained", nextReviewDue: TODAY }),
      examDate: addDays(TODAY, 7),
    });
    // 200 reviews today alone is two hours.
    expect(result.dailyMinutes).toBeGreaterThanOrEqual(15);
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
  it("never rounds a real cost down to nothing", () => {
    expect(formatMinutes(0.2)).toBe("1 min");
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(135)).toBe("2 hr 15 min");
  });

  it("uses today when no date is given", () => {
    const result = buildPlan({ cards: cards(5), examDate: addDays(todayIso(), 10) });
    expect(result.daysLeft).toBe(10);
  });

  it("keeps the time model honest about what a new card costs", () => {
    // A new concept is the whole ladder, not one look at a card.
    expect(MINUTES.newConcept).toBeGreaterThan(MINUTES.typedReview * 3);
  });
});

describe("an exam a week out (Oct 1, seen Sep 24)", () => {
  // Sep 24, 2026 is a Thursday.
  const today = "2026-09-24";
  const examDate = "2026-10-01";
  const run = (count: number, studyDays: number | null = null) =>
    buildPlan({ cards: cards(count), examDate, studyDays, today });

  it("counts calendar days, not hours", () => {
    const result = run(100);
    expect(result.daysLeft).toBe(7);
    expect(result.studyDaysLeft).toBe(7);
    expect(result.days).toHaveLength(7);
    expect(result.days[0].date).toBe(today);
    expect(result.days.at(-1)?.date).toBe("2026-09-30");
    expect(result.workload.capacity).toBe(7 * result.dailyMinutes);
  });

  it("adds up: day rows match the totals they summarise", () => {
    const result = run(100);
    const fresh = result.days.reduce((sum, day) => sum + day.fresh, 0);
    expect(fresh).toBe(100);
    expect(result.workload.learnedByExam).toBe(fresh);
    expect(result.days[0].fresh).toBe(result.today.fresh);
  });

  it("keeps the night before for review", () => {
    const result = run(20);
    expect(result.days.at(-1)?.fresh).toBe(0);
    expect(result.today.fresh).toBe(Math.ceil(20 / 6));
  });

  it("leaves days off empty and picks up their reviews on the next study day", () => {
    // Mon, Wed, Fri: Sep 25, 28 and 30 before the exam.
    const mwf = 0b0101010;
    const result = run(30, mwf);

    expect(result.studyDaysLeft).toBe(3);
    expect(result.today.studyDay).toBe(false);
    const off = result.days.filter((day) => day.off);
    expect(off.map((day) => day.date)).toEqual([
      "2026-09-24",
      "2026-09-26",
      "2026-09-27",
      "2026-09-29",
    ]);
    for (const day of off) {
      expect(day.minutes).toBe(0);
      expect(day.fresh).toBe(0);
    }

    // Cards started Friday come due Saturday, a day off, so Monday has them.
    const monday = result.days.find((day) => day.date === "2026-09-28")!;
    expect(monday.reviews).toBeGreaterThan(0);
    // The last study day is for review only.
    expect(result.days.at(-1)?.fresh).toBe(0);
    expect(result.workload.unreachedByExam).toBe(0);
  });
});
