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
import { isDue, todayIso } from "@/lib/srs";

import { MINUTES, reviewsWithin, roundMinutes, STRUGGLING_LAPSES } from "./estimate";

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
};

export type PlanInput = {
  cards: PlanCard[];
  /** Exam date as YYYY-MM-DD, or null if none is set. */
  examDate: string | null;
  dailyMinutes: number | null;
  today?: string;
  /** Whether a coverage matrix exists; without one, "unmapped" means nothing. */
  hasCoverage?: boolean;
};

export const DEFAULT_DAILY_MINUTES = 30;

export type Cut = {
  id: "application" | "unmapped" | "unemphasised";
  label: string;
  detail: string;
  cards: number;
  minutesSaved: number;
};

export type StudyPlan = {
  daysLeft: number | null;
  dailyMinutes: number;
  /** What today should contain. */
  today: {
    due: number;
    struggling: number;
    fresh: number;
    minutes: number;
    /** True when reviews alone use the whole budget. */
    reviewsFillTheDay: boolean;
  };
  totals: {
    cards: number;
    unstudied: number;
    learned: number;
    struggling: number;
    due: number;
  };
  workload: {
    /** Minutes of work left before the exam, reviews included. */
    minutes: number;
    /** Minutes available before the exam. */
    capacity: number | null;
    /** Positive when there is more work than time. */
    deficitMinutes: number | null;
    /** Minutes a day that would actually clear it. */
    requiredDailyMinutes: number | null;
  };
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

export function buildPlan(input: PlanInput): StudyPlan {
  const today = input.today ?? todayIso();
  const dailyMinutes = input.dailyMinutes ?? DEFAULT_DAILY_MINUTES;
  const cards = input.cards.filter((card) => !card.excluded);

  const daysLeft =
    input.examDate === null ? null : Math.max(0, daysBetween(today, input.examDate));

  const due = cards.filter((card) => isDue(card, today));
  const struggling = cards.filter(isStruggling);
  const unstudied = cards.filter(isUnstudied);
  const learned = cards.length - unstudied.length;

  /* ------------------------------------------------------------ Today */

  // Due reviews come first because they decay: a review skipped today costs
  // more than a new card not started today.
  const dueMinutes = due.length * MINUTES.typedReview;
  const strugglingOnly = struggling.filter((card) => !isDue(card, today));
  const strugglingMinutes =
    strugglingOnly.length * (MINUTES.typedReview + MINUTES.strugglingExtra);

  const spent = dueMinutes + strugglingMinutes;
  const remaining = Math.max(0, dailyMinutes - spent);
  const fresh = Math.min(
    unstudied.length,
    Math.floor(remaining / MINUTES.newConcept),
  );

  /* --------------------------------------------------------- Workload */

  // Every card still to learn, plus the reviews those and the already-learned
  // cards will generate between now and the exam.
  const reviewsPerCard = daysLeft === null ? 0 : reviewsWithin(daysLeft);
  const workloadMinutes =
    unstudied.length * MINUTES.newConcept +
    (unstudied.length + learned) * reviewsPerCard * MINUTES.typedReview +
    struggling.length * MINUTES.strugglingExtra;

  const capacity = daysLeft === null ? null : daysLeft * dailyMinutes;
  const deficit =
    capacity === null ? null : Math.max(0, workloadMinutes - capacity);

  /* ------------------------------------------------------------- Cuts */

  const cuts: Cut[] = [];

  const application = cards.filter((card) => card.cardType === "application");
  if (application.length > 0) {
    cuts.push({
      id: "application",
      label: "Set aside application questions",
      detail:
        "Higher-order cards are worth most once the underlying facts are solid. They are the first thing to drop when time is short.",
      cards: application.length,
      minutesSaved: costOf(application, reviewsPerCard),
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
        minutesSaved: costOf(unmapped, reviewsPerCard),
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
        minutesSaved: costOf(rest, reviewsPerCard),
      });
    }
  }

  return {
    daysLeft,
    dailyMinutes,
    today: {
      due: due.length,
      struggling: strugglingOnly.length,
      fresh,
      minutes: roundMinutes(spent + fresh * MINUTES.newConcept),
      reviewsFillTheDay: fresh === 0 && unstudied.length > 0,
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
      requiredDailyMinutes:
        daysLeft === null || daysLeft === 0
          ? null
          : roundMinutes(workloadMinutes / daysLeft),
    },
    cuts: cuts.sort((a, b) => b.minutesSaved - a.minutesSaved),
  };
}

/** What a set of cards costs between now and the exam. */
function costOf(cards: PlanCard[], reviewsPerCard: number): number {
  const unstudied = cards.filter(isUnstudied).length;

  return roundMinutes(
    unstudied * MINUTES.newConcept +
      cards.length * reviewsPerCard * MINUTES.typedReview,
  );
}
