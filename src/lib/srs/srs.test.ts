/**
 * Scheduler tests.
 *
 * The scheduler is pure, so the rules PRD §6 actually cares about — which
 * signals count, what a miss costs, what a missed week costs — are asserted
 * directly rather than inferred from a session.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { courses, exams, flashcards, studyProgress } from "@/db/schema";
import { gradeCard } from "@/lib/study/session";
import { buildQueue, filterCards, type QueueCard } from "@/lib/study/queue";

import {
  addDays,
  DEFAULT_EASE,
  daysOverdue,
  isDue,
  MIN_EASE,
  scheduleFor,
  scheduleReview,
  todayIso,
  type ScheduleState,
} from "./index";

const TODAY = "2026-03-10";

function state(overrides: Partial<ScheduleState> = {}): ScheduleState {
  return {
    state: "unstudied",
    intervalDays: 0,
    nextReviewDue: null,
    ease: DEFAULT_EASE,
    retentionCount: 0,
    lastCreditedAt: null,
    ...overrides,
  };
}

describe("dates", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-03-30", 3)).toBe("2026-04-02");
  });

  it("adds days across a daylight-saving change", () => {
    // US DST starts 2026-03-08; naive 24h arithmetic slips a day here.
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
  });

  it("treats an overdue card as due", () => {
    expect(isDue({ nextReviewDue: "2026-03-01" }, TODAY)).toBe(true);
    expect(isDue({ nextReviewDue: TODAY }, TODAY)).toBe(true);
    expect(isDue({ nextReviewDue: "2026-03-11" }, TODAY)).toBe(false);
    expect(isDue({ nextReviewDue: null }, TODAY)).toBe(false);
  });

  it("measures how far behind a card is", () => {
    expect(daysOverdue({ nextReviewDue: "2026-03-03" }, TODAY)).toBe(7);
    expect(daysOverdue({ nextReviewDue: "2026-03-30" }, TODAY)).toBe(0);
  });

  it("produces today in the local calendar", () => {
    expect(todayIso(new Date(2026, 2, 10, 23, 30))).toBe("2026-03-10");
  });
});

describe("scheduleReview", () => {
  const pass = { quality: "pass", retentionEligible: true } as const;

  it("schedules nothing at all for an admitted guess", () => {
    const before = state({ intervalDays: 7, nextReviewDue: "2026-03-17" });
    expect(
      scheduleReview(before, { ...pass, guessed: true }, TODAY),
    ).toEqual(before);
  });

  it("starts a new card at one day", () => {
    const next = scheduleReview(state(), pass, TODAY);
    expect(next.intervalDays).toBe(1);
    expect(next.nextReviewDue).toBe("2026-03-11");
    expect(next.lastCreditedAt).toBe(TODAY);
  });

  it("does not grant retention on the very first success", () => {
    // Nothing multi-day has happened yet — there is no earlier day to retain from.
    expect(scheduleReview(state(), pass, TODAY).state).toBe("unstudied");
    expect(scheduleReview(state(), pass, TODAY).retentionCount).toBe(0);
  });

  it("grants retention for an unaided recall on a later day", () => {
    const next = scheduleReview(
      state({
        state: "immediate_recall",
        intervalDays: 1,
        lastCreditedAt: "2026-03-09",
      }),
      pass,
      TODAY,
    );

    expect(next.state).toBe("retained");
    expect(next.retentionCount).toBe(1);
    expect(next.intervalDays).toBe(3);
  });

  it("never grants retention to a signal that was not independent recall", () => {
    const next = scheduleReview(
      state({
        state: "recognition",
        intervalDays: 1,
        lastCreditedAt: "2026-03-09",
      }),
      { quality: "pass", retentionEligible: false },
      TODAY,
    );

    // The review is still scheduled — it just proves nothing about retention.
    expect(next.intervalDays).toBe(3);
    expect(next.state).toBe("recognition");
    expect(next.retentionCount).toBe(0);
  });

  it("grows later intervals by the ease multiplier", () => {
    const next = scheduleReview(
      state({ intervalDays: 10, ease: 2.5, lastCreditedAt: "2026-03-01" }),
      pass,
      TODAY,
    );
    expect(next.intervalDays).toBe(25);
  });

  it("ignores a second success on the same day", () => {
    const before = state({
      intervalDays: 3,
      nextReviewDue: "2026-03-13",
      lastCreditedAt: TODAY,
    });
    // Grinding one card in one sitting must not push it out a month.
    expect(scheduleReview(before, pass, TODAY)).toEqual(before);
  });

  it("halves a missed card's interval instead of resetting it", () => {
    const next = scheduleReview(
      state({ state: "retained", intervalDays: 20, lastCreditedAt: "2026-02-01" }),
      { quality: "fail", retentionEligible: true },
      TODAY,
    );

    expect(next.intervalDays).toBe(10);
    expect(next.nextReviewDue).toBe("2026-03-20");
    expect(next.ease).toBeCloseTo(DEFAULT_EASE - 0.2);
  });

  it("costs a miss one tier at most", () => {
    const fail = { quality: "fail", retentionEligible: true } as const;

    expect(scheduleReview(state({ state: "retained" }), fail, TODAY).state).toBe(
      "immediate_recall",
    );
    // Forgetting one part of a concept must not erase the parts that are known.
    expect(
      scheduleReview(state({ state: "immediate_recall" }), fail, TODAY).state,
    ).toBe("immediate_recall");
  });

  it("keeps the spacing for a partial answer rather than pushing it out", () => {
    const next = scheduleReview(
      state({ intervalDays: 6, lastCreditedAt: "2026-03-01" }),
      { quality: "partial", retentionEligible: true },
      TODAY,
    );

    expect(next.intervalDays).toBe(6);
    expect(next.nextReviewDue).toBe("2026-03-16");
    expect(next.ease).toBeCloseTo(DEFAULT_EASE - 0.15);
    expect(next.retentionCount).toBe(0);
  });

  it("does not punish a card for being answered late", () => {
    // Two weeks overdue, recalled correctly: scheduled from its interval.
    const next = scheduleReview(
      state({
        state: "retained",
        intervalDays: 8,
        nextReviewDue: "2026-02-24",
        lastCreditedAt: "2026-02-16",
      }),
      { quality: "pass", retentionEligible: true },
      TODAY,
    );

    expect(next.intervalDays).toBe(Math.round(8 * DEFAULT_EASE));
    expect(next.state).toBe("retained");
  });

  it("keeps ease within bounds however badly a card goes", () => {
    let current = state({ intervalDays: 4 });
    for (let i = 0; i < 20; i += 1) {
      current = scheduleReview(
        current,
        { quality: "fail", retentionEligible: true },
        TODAY,
      );
    }
    expect(current.ease).toBe(MIN_EASE);
    // And it is still scheduled, not wiped.
    expect(current.intervalDays).toBe(1);
  });

  it("builds a realistic multi-day ladder", () => {
    let current = state({ state: "immediate_recall" });
    const days = [TODAY, "2026-03-11", "2026-03-14", "2026-03-21"];
    const intervals: number[] = [];

    for (const day of days) {
      current = scheduleReview(current, { quality: "pass", retentionEligible: true }, day);
      intervals.push(current.intervalDays);
    }

    // 1d, 3d, then the ease multiplier, which itself grows slightly per pass.
    expect(intervals).toEqual([1, 3, 7, 17]);
    expect(current.retentionCount).toBe(3);
    expect(current.state).toBe("retained");
  });
});

describe("scheduleFor", () => {
  it("schedules against the tier the grader just promoted to", () => {
    const next = scheduleFor(
      { intervalDays: 1, lastCreditedAt: "2026-03-09", ease: DEFAULT_EASE },
      "immediate_recall",
      { quality: "pass", retentionEligible: true },
      TODAY,
    );
    expect(next.state).toBe("retained");
  });

  it("starts from defaults for a card with no progress row", () => {
    const next = scheduleFor(undefined, "recognition", {
      quality: "pass",
      retentionEligible: false,
    }, TODAY);

    expect(next.intervalDays).toBe(1);
    expect(next.ease).toBeCloseTo(DEFAULT_EASE + 0.05);
  });
});

describe("due queue", () => {
  function card(overrides: Partial<QueueCard> = {}): QueueCard {
    return {
      id: crypto.randomUUID(),
      topic: null,
      starred: false,
      excluded: false,
      lastGrade: null,
      nextReviewDue: null,
      cardType: "atomic",
      ...overrides,
    };
  }

  it("selects only cards due today or earlier", () => {
    const cards = [
      card({ nextReviewDue: "2026-03-01" }),
      card({ nextReviewDue: TODAY }),
      card({ nextReviewDue: "2026-04-01" }),
      card(),
    ];

    expect(filterCards(cards, { scope: "due", today: TODAY })).toHaveLength(2);
  });

  it("leads with the longest overdue card", () => {
    const old = card({ nextReviewDue: "2026-02-01" });
    const recent = card({ nextReviewDue: TODAY });

    expect(buildQueue([recent, old], { scope: "due", today: TODAY })).toEqual([
      old.id,
      recent.id,
    ]);
  });

  it("leaves excluded cards out of the review queue", () => {
    const cards = [card({ nextReviewDue: TODAY, excluded: true })];
    expect(filterCards(cards, { scope: "due", today: TODAY })).toHaveLength(0);
  });
});

describe("scheduling through a graded session", () => {
  type TestDb = ReturnType<typeof drizzle<typeof schema>>;
  let db: TestDb;
  let cardId: string;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: "./drizzle" });

    const course = db
      .insert(courses)
      .values({ title: "Physiology" })
      .returning()
      .get();
    const examId = db
      .insert(exams)
      .values({ courseId: course.id, title: "Exam 2" })
      .returning()
      .get().id;
    cardId = db
      .insert(flashcards)
      .values({ examId, question: "Q", directAnswer: "A" })
      .returning()
      .get().id;
  });

  function progress() {
    return db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardId))
      .get();
  }

  it("schedules a flip-card grade without granting retention", () => {
    gradeCard(db, cardId, "easy");

    const row = progress();
    expect(row?.intervalDays).toBe(1);
    expect(row?.nextReviewDue).toBe(addDays(todayIso(), 1));
    // Self-graded after a reveal: the schedule moves, the retention axis does not.
    expect(row?.retentionCount).toBe(0);
    expect(row?.state).toBe("recognition");
  });

  it("treats 'difficult' as a partial rather than a miss", () => {
    gradeCard(db, cardId, "easy");
    const first = progress();

    gradeCard(db, cardId, "difficult");
    const second = progress();

    expect(second?.intervalDays).toBe(first?.intervalDays);
    expect(second?.ease).toBeLessThan(first!.ease);
    expect(second?.lapses).toBe(0);
  });

  it("records a missed card as a lapse and shortens its interval", () => {
    gradeCard(db, cardId, "easy");
    gradeCard(db, cardId, "missed");

    const row = progress();
    expect(row?.lapses).toBe(1);
    expect(row?.intervalDays).toBe(1);
    expect(row?.nextReviewDue).not.toBeNull();
  });
});
