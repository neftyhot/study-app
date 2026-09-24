/**
 * Exam-date planning and load management (PRD §12).
 *
 * A deck of several hundred cards is not a to-do list, it is a schedule
 * problem: reviews come due whether or not there is time for them, new
 * material competes with them, and the exam does not move. This works out
 * what today should hold, and — the part that matters — says plainly when
 * there is more material than there are days, rather than letting a student
 * discover that the night before.
 *
 * Pure: it takes loaded rows and a date, so every number below is testable
 * without a database or a calendar.
 */
import { addDays, DEFAULT_EASE, isDue, todayIso } from "@/lib/srs";

import { isStudyDay, normaliseStudyDays } from "./days";
import { MINUTES, roundMinutes, STRUGGLING_LAPSES } from "./estimate";

export * from "./days";
export * from "./estimate";

export type PlanCard = {
  id: string;
  cardType: string;
  excluded: boolean;
  /** Null when the card has never been studied. */
  state: "unstudied" | "recognition" | "immediate_recall" | "retained" | null;
  lapses: number;
  nextReviewDue: string | null;
  /** Whether any study-guide objective is covered by this card. */
  mapsToObjective: boolean;
  /** Whether any objective it covers is marked professor-emphasised. */
  emphasised: boolean;
  /** Current spacing, when the card has a schedule. */
  intervalDays?: number | null;
  ease?: number | null;
};

export type PlanInput = {
  cards: PlanCard[];
  /** Exam date as YYYY-MM-DD, or null if none is set. */
  examDate: string | null;
  /** Weekdays the student studies, as a bitmask (see `./days`). Null is every day. */
  studyDays?: number | null;
  today?: string;
  /** Whether a coverage matrix exists; without one, "unmapped" means nothing. */
  hasCoverage?: boolean;
};

/** Today's budget when there is no exam date to plan towards. */
export const DEFAULT_DAILY_MINUTES = 30;

/**
 * The most the plan will ask for on one study day. Past this the answer is
 * not "study five hours a day", it is to cut, so the plan says so.
 */
export const MAX_DAILY_MINUTES = 240;

/** Worked-out daily times are rounded up to this, so they read like a plan. */
const ROUND_TO = 5;

export type Cut = {
  id: "application" | "unmapped" | "unemphasised";
  label: string;
  detail: string;
  cards: number;
  minutesSaved: number;
};

export type PlanDay = {
  date: string;
  /** Reviews that come due that day (including any backlog on day one). */
  reviews: number;
  /** New concepts started that day. */
  fresh: number;
  minutes: number;
  /** A day the student does not study. */
  off: boolean;
};

export type StudyPlan = {
  /** Calendar days before the exam, today included, exam day excluded. */
  daysLeft: number | null;
  /** Of those, the days the student studies. */
  studyDaysLeft: number | null;
  examDate: string | null;
  studyDays: number;
  /**
   * Minutes each study day needs, worked out from the deck and the calendar
   * (rounded up, and capped at `MAX_DAILY_MINUTES`). Without an exam date it
   * is `DEFAULT_DAILY_MINUTES`.
   */
  dailyMinutes: number;
  /** True when finishing would need more than `MAX_DAILY_MINUTES` a day. */
  overloaded: boolean;
  /** What today should contain. */
  today: {
    /** Whether today is one of the student's study days. */
    studyDay: boolean;
    due: number;
    struggling: number;
    fresh: number;
    minutes: number;
  };
  totals: {
    cards: number;
    unstudied: number;
    learned: number;
    struggling: number;
    due: number;
  };
  workload: {
    /** Minutes to learn everything left and keep up its reviews until the exam. */
    minutes: number;
    /** Study time left: study days left × minutes a day. */
    capacity: number | null;
    /** Positive when there is more work than time. */
    deficitMinutes: number | null;
    /** Minutes a day that would get every card learned before the exam. */
    requiredDailyMinutes: number | null;
    /** Cards that will have been started by the exam on this plan. */
    learnedByExam: number | null;
    /** Cards this plan will not reach in time. */
    unreachedByExam: number | null;
  };
  /** Day-by-day schedule, today first, days off included. */
  days: PlanDay[];
  cuts: Cut[];
};

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

const isUnstudied = (card: PlanCard) =>
  card.state === null || card.state === "unstudied";

const isStruggling = (card: PlanCard) =>
  !isUnstudied(card) && card.lapses >= STRUGGLING_LAPSES;

function nextInterval(current: number, ease: number): number {
  if (current <= 0) return 1;
  if (current < 3) return 3;
  return Math.max(4, Math.round(current * ease));
}

function roundUp(minutes: number): number {
  return Math.ceil(minutes / ROUND_TO) * ROUND_TO;
}

/** Indices (0 is today) of the days before the exam the student studies. */
function studyDayIndices(today: string, daysLeft: number, studyDays: number): number[] {
  const indices: number[] = [];
  for (let day = 0; day < daysLeft; day += 1) {
    if (isStudyDay(addDays(today, day), studyDays)) indices.push(day);
  }
  return indices;
}

/**
 * Study days on which new material may be started. With room to spare the
 * last study day before the exam is kept for review, so nothing is first seen
 * the night before.
 */
function teachingDays(study: number[]): Set<number> {
  return new Set(study.length >= 3 ? study.slice(0, -1) : study);
}

type Simulation = {
  days: PlanDay[];
  minutes: number;
  learned: number;
  unreached: number;
  peakMinutes: number;
};

/**
 * Plays the days out one at a time with the real review ladder: each day's
 * due reviews first, then new concepts paced so the deck is finished before
 * the exam — or as many as the budget allows, when a budget is given.
 *
 * Assumes each review succeeds. That is optimistic about lapses, but lapses
 * are already charged through the stuck-card cost, and the alternative is a
 * planner that invents failures.
 */
function simulate(
  cards: PlanCard[],
  today: string,
  daysLeft: number,
  budget: number | null,
  studyDays: number,
): Simulation {
  // Day index a card is next due, and its spacing.
  const scheduled: { due: number; interval: number; ease: number }[] = [];
  let unstudied = 0;
  let stuckExtra = 0;

  for (const card of cards) {
    if (isUnstudied(card)) {
      unstudied += 1;
      continue;
    }
    const due =
      card.nextReviewDue === null
        ? 1
        : Math.max(0, daysBetween(today, card.nextReviewDue));
    scheduled.push({
      due,
      interval: Math.max(0, card.intervalDays ?? 0),
      ease: card.ease || DEFAULT_EASE,
    });
    // A stuck card gets its breakdown and another pass today, matching what
    // today's plan asks for.
    if (isStruggling(card)) {
      stuckExtra +=
        MINUTES.strugglingExtra + (due === 0 ? 0 : MINUTES.typedReview);
    }
  }

  const study = studyDayIndices(today, daysLeft, studyDays);
  const teaching = teachingDays(study);
  const firstStudyDay = study[0];
  const days: PlanDay[] = [];
  let total = 0;
  let peak = 0;
  let remaining = unstudied;
  let teachLeft = teaching.size;

  for (let day = 0; day < daysLeft; day += 1) {
    const date = addDays(today, day);

    // Reviews due on a day off wait for the next study day.
    if (!study.includes(day)) {
      days.push({ date, reviews: 0, fresh: 0, minutes: 0, off: true });
      continue;
    }

    let reviews = 0;
    for (const item of scheduled) {
      if (item.due > day) continue;
      reviews += 1;
      item.interval = nextInterval(item.interval, item.ease);
      item.due = day + item.interval;
    }

    let minutes = reviews * MINUTES.typedReview;
    // Stuck cards get their breakdown on the first study day, not spread out.
    if (day === firstStudyDay) minutes += stuckExtra;

    let fresh = 0;
    if (remaining > 0 && teaching.has(day)) {
      const pace = Math.ceil(remaining / teachLeft);
      const affordable =
        budget === null
          ? pace
          : Math.max(0, Math.floor((budget - minutes) / MINUTES.newConcept));
      fresh = Math.min(pace, affordable, remaining);
      teachLeft -= 1;
    }

    remaining -= fresh;
    minutes += fresh * MINUTES.newConcept;
    for (let i = 0; i < fresh; i += 1) {
      scheduled.push({ due: day + 1, interval: 1, ease: DEFAULT_EASE });
    }

    total += minutes;
    peak = Math.max(peak, minutes);
    days.push({ date, reviews, fresh, minutes: roundMinutes(minutes), off: false });
  }

  return {
    days,
    minutes: total,
    learned: unstudied - remaining,
    unreached: remaining,
    peakMinutes: peak,
  };
}

/**
 * The smallest daily budget that gets every card started before the exam.
 * Pacing alone can front-load a day, so this searches rather than taking the
 * busiest day of an unbudgeted run.
 */
function minutesNeeded(
  cards: PlanCard[],
  today: string,
  daysLeft: number,
  studyDays: number,
): number {
  const unbounded = simulate(cards, today, daysLeft, null, studyDays);
  // No study days before the exam: no daily time is enough.
  if (unbounded.unreached > 0) return Number.POSITIVE_INFINITY;
  if (unbounded.peakMinutes === 0) return 0;

  let low = 1;
  let high = Math.max(1, Math.ceil(unbounded.peakMinutes));
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (simulate(cards, today, daysLeft, mid, studyDays).unreached === 0) high = mid;
    else low = mid + 1;
  }
  return high;
}

export function buildPlan(input: PlanInput): StudyPlan {
  const today = input.today ?? todayIso();
  const studyDays = normaliseStudyDays(input.studyDays);
  const cards = input.cards.filter((card) => !card.excluded);

  // Exam day is for the exam: an exam on the 1st, seen on the 24th, leaves
  // seven days (24th–30th), of which the student studies the ones they chose.
  const daysLeft =
    input.examDate === null ? null : Math.max(0, daysBetween(today, input.examDate));
  const studyDaysLeft =
    daysLeft === null ? null : studyDayIndices(today, daysLeft, studyDays).length;
  const studyingToday = isStudyDay(today, studyDays);

  const due = cards.filter((card) => isDue(card, today));
  const struggling = cards.filter(isStruggling);
  const unstudied = cards.filter(isUnstudied);
  const learned = cards.length - unstudied.length;

  // Due reviews come first because they decay: a review skipped today costs
  // more than a new card not started today.
  const dueMinutes = due.length * MINUTES.typedReview;
  const strugglingMinutes = struggling.reduce(
    (sum, card) =>
      sum +
      MINUTES.strugglingExtra +
      (isDue(card, today) ? 0 : MINUTES.typedReview),
    0,
  );
  const spent = dueMinutes + strugglingMinutes;

  /* ------------------------------------------------ The daily time */

  let dailyMinutes = DEFAULT_DAILY_MINUTES;
  let overloaded = false;
  let workloadMinutes = unstudied.length * MINUTES.newConcept + spent;
  let requiredDailyMinutes: number | null = null;
  let learnedByExam: number | null = null;
  let unreachedByExam: number | null = null;
  let days: PlanDay[] = [];
  let fresh = 0;

  if (daysLeft !== null && daysLeft > 0) {
    // The time a day is worked out, not chosen: the least that starts every
    // card before the exam, rounded up so it reads like a plan.
    const needed = minutesNeeded(cards, today, daysLeft, studyDays);
    overloaded = needed > MAX_DAILY_MINUTES;
    const budget = overloaded ? MAX_DAILY_MINUTES : roundUp(needed);
    requiredDailyMinutes = Number.isFinite(needed) ? needed : null;

    workloadMinutes = simulate(cards, today, daysLeft, null, studyDays).minutes;
    const budgeted = simulate(cards, today, daysLeft, budget, studyDays);
    learnedByExam = learned + budgeted.learned;
    unreachedByExam = budgeted.unreached;
    days = budgeted.days;
    fresh = days[0]?.fresh ?? 0;

    // The budget only limits new material; reviews are always done. So the
    // time quoted is whichever is larger: the budget, or an average study
    // day once its reviews are counted.
    const studied = days.filter((day) => !day.off);
    const average =
      studied.length === 0
        ? 0
        : studied.reduce((sum, day) => sum + day.minutes, 0) / studied.length;
    dailyMinutes = overloaded
      ? MAX_DAILY_MINUTES
      : Math.min(MAX_DAILY_MINUTES, Math.max(budget, roundUp(average)));
  } else {
    // No date to plan towards (or it is exam day): fill a default day.
    const affordable = Math.floor(
      Math.max(0, dailyMinutes - spent) / MINUTES.newConcept,
    );
    fresh = studyingToday ? Math.min(unstudied.length, affordable) : 0;
    if (daysLeft === 0) {
      learnedByExam = learned;
      unreachedByExam = unstudied.length;
    }
  }

  const capacity = studyDaysLeft === null ? null : studyDaysLeft * dailyMinutes;
  const deficit =
    capacity === null
      ? null
      : unreachedByExam !== null && unreachedByExam > 0
        ? Math.max(1, workloadMinutes - capacity)
        : 0;

  /* ------------------------------------------------------------- Cuts */

  const costOf = (subset: PlanCard[]) =>
    roundMinutes(
      daysLeft !== null && daysLeft > 0
        ? simulate(subset, today, daysLeft, null, studyDays).minutes
        : subset.filter(isUnstudied).length * MINUTES.newConcept,
    );

  const cuts: Cut[] = [];

  const application = cards.filter((card) => card.cardType === "application");
  if (application.length > 0) {
    cuts.push({
      id: "application",
      label: "Set aside application questions",
      detail:
        "Higher-order cards are worth most once the underlying facts are solid. They are the first thing to drop when time is short.",
      cards: application.length,
      minutesSaved: costOf(application),
    });
  }

  if (input.hasCoverage) {
    const unmapped = cards.filter((card) => !card.mapsToObjective);
    if (unmapped.length > 0) {
      cuts.push({
        id: "unmapped",
        label: "Set aside cards no objective asks for",
        detail:
          "These came from your material but answer nothing on the study guide. Worth knowing, not worth the last week.",
        cards: unmapped.length,
        minutesSaved: costOf(unmapped),
      });
    }

    const emphasised = cards.filter((card) => card.emphasised);
    if (emphasised.length > 0 && emphasised.length < cards.length) {
      const rest = cards.filter((card) => !card.emphasised);
      cuts.push({
        id: "unemphasised",
        label: "Study only what the professor emphasised",
        detail: `Keeps the ${emphasised.length} cards covering flagged objectives and defers the rest.`,
        cards: rest.length,
        minutesSaved: costOf(rest),
      });
    }
  }

  return {
    daysLeft,
    studyDaysLeft,
    examDate: input.examDate,
    studyDays,
    dailyMinutes,
    overloaded,
    today: {
      studyDay: studyingToday,
      due: due.length,
      struggling: struggling.length,
      fresh,
      minutes: studyingToday ? roundMinutes(spent + fresh * MINUTES.newConcept) : 0,
    },
    totals: {
      cards: cards.length,
      unstudied: unstudied.length,
      learned,
      struggling: struggling.length,
      due: due.length,
    },
    workload: {
      minutes: roundMinutes(workloadMinutes),
      capacity: capacity === null ? null : roundMinutes(capacity),
      deficitMinutes: deficit === null ? null : roundMinutes(deficit),
      requiredDailyMinutes,
      learnedByExam,
      unreachedByExam,
    },
    days,
    cuts: cuts.sort((a, b) => b.minutesSaved - a.minutesSaved),
  };
}
