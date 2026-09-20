/**
 * Learn-mode tests.
 *
 * The ladder is a pure state machine, so the rules that decide what counts as
 * mastery are tested directly rather than inferred from UI behaviour.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  cardRubrics,
  courses,
  exams,
  flashcards,
  studyProgress,
} from "@/db/schema";

import {
  applyOutcome,
  isComplete,
  nextStep,
  roundSummary,
  skipRecognition,
  startRound,
  type RoundState,
  type Step,
} from "./ladder";
import { buildMcq, type McqCard } from "./mcq";
import { applyLearnResult } from "./progress";
import {
  clampRoundSize,
  loadLearn,
  startLearnSession,
  startNextRound,
  submitOutcome,
} from "./session";
import { createKeywordGrader } from "./typed";

/** Answers the current step, asserting one exists. */
function answer(
  state: RoundState,
  outcome: { correct: boolean; guessed?: boolean },
): { state: RoundState; step: Step } {
  const step = nextStep(state);
  if (!step) throw new Error("round already complete");
  return { state: applyOutcome(state, step, outcome), step };
}

function runCorrectly(state: RoundState, limit = 200): RoundState {
  let current = state;
  for (let i = 0; i < limit && !isComplete(current); i += 1) {
    current = answer(current, { correct: true }).state;
  }
  return current;
}

describe("ladder", () => {
  it("starts novel concepts at recognition and known ones at typed recall", () => {
    const state = startRound(["a", "b"], { skipRecognitionFor: ["b"] });
    expect(state.concepts[0].stage).toBe("mcq");
    expect(state.concepts[1].stage).toBe("typed_immediate");
  });

  it("never treats a multiple-choice answer as recall", () => {
    const state = startRound(["a"]);
    expect(nextStep(state)?.countsTowardMastery).toBe(false);
  });

  it("does not count the typed attempt taken right after an MCQ", () => {
    // The mastery safeguard from PRD §5: the correct option was just on
    // screen, so typing it back proves nothing.
    let state = startRound(["a"]);
    state = answer(state, { correct: true }).state;

    const step = nextStep(state);
    expect(step?.stage).toBe("typed_immediate");
    expect(step?.countsTowardMastery).toBe(false);
  });

  it("counts a cold typed attempt when recognition was skipped", () => {
    const state = startRound(["a"], { skipRecognitionFor: ["a"] });
    const step = nextStep(state);
    expect(step?.stage).toBe("typed_immediate");
    expect(step?.countsTowardMastery).toBe(true);
  });

  it("re-prompts a concept only after 3 to 5 intervening items", () => {
    let state = startRound(["a", "b", "c", "d", "e", "f"]);
    state = answer(state, { correct: true }).state; // mcq
    state = answer(state, { correct: true }).state; // typed_immediate

    const concept = state.concepts.find((c) => c.cardId === "a")!;
    expect(concept.stage).toBe("typed_interleaved");
    expect(concept.dueAt - state.step).toBeGreaterThanOrEqual(3);
    expect(concept.dueAt - state.step).toBeLessThanOrEqual(5);
  });

  it("fills the delay with other concepts instead of waiting", () => {
    let state = startRound(["a", "b", "c", "d", "e"]);
    state = answer(state, { correct: true }).state;
    state = answer(state, { correct: true }).state;

    expect(nextStep(state)?.cardId).toBe("b");
  });

  it("clears the just-saw-it flag once other items have intervened", () => {
    let state = startRound(["a", "b", "c", "d", "e"]);
    state = answer(state, { correct: true }).state; // a: mcq
    state = answer(state, { correct: true }).state; // a: typed_immediate

    // Play other concepts until "a" comes back around.
    let guard = 0;
    while (nextStep(state)?.cardId !== "a" && guard < 30) {
      state = answer(state, { correct: true }).state;
      guard += 1;
    }

    const step = nextStep(state)!;
    expect(step.cardId).toBe("a");
    expect(step.stage).toBe("typed_interleaved");
    expect(step.countsTowardMastery).toBe(true);
  });

  it("re-asks the same rung after a wrong answer rather than climbing", () => {
    let state = startRound(["a", "b", "c", "d", "e"]);
    state = answer(state, { correct: true }).state; // mcq passed
    state = answer(state, { correct: false }).state; // typed missed

    const concept = state.concepts.find((c) => c.cardId === "a")!;
    expect(concept.stage).toBe("typed_immediate");
    expect(concept.errors).toBe(1);
    expect(concept.answerShown).toBe(true);
  });

  it("treats an admitted guess as no evidence, not as an error", () => {
    let state = startRound(["a", "b", "c", "d", "e"]);
    const first = answer(state, { correct: true, guessed: true });
    state = first.state;

    const concept = state.concepts.find((c) => c.cardId === "a")!;
    expect(concept.stage).toBe("mcq");
    expect(concept.tier).toBe("none");
    expect(concept.errors).toBe(0);
  });

  it("switches to the sub-concept breakdown after repeated errors", () => {
    let state = startRound(["a"]);
    state = answer(state, { correct: false }).state;
    state = answer(state, { correct: false }).state;

    expect(nextStep(state)?.remediate).toBe(true);
  });

  it("parks a concept after persistent errors instead of drilling forever", () => {
    let state = startRound(["a"]);
    for (let i = 0; i < 4; i += 1) {
      const step = nextStep(state);
      if (!step) break;
      state = applyOutcome(state, step, { correct: false });
    }

    const concept = state.concepts[0];
    expect(concept.done).toBe(true);
    expect(concept.struggled).toBe(true);
    expect(isComplete(state)).toBe(true);
  });

  it("reaches recall mastery only through the delayed rungs", () => {
    const finished = runCorrectly(startRound(["a", "b", "c", "d", "e", "f"]));

    expect(isComplete(finished)).toBe(true);
    const summary = roundSummary(finished);
    expect(summary.mastered).toBe(6);
    expect(summary.struggled).toBe(0);
    // Four rungs per concept: recognize, recall, recall again, recall later.
    expect(summary.steps).toBe(24);
  });

  it("lets a student skip recognition without skipping recall", () => {
    const state = skipRecognition(startRound(["a", "b"]), "a");
    const step = nextStep(state)!;

    expect(step.stage).toBe("typed_immediate");
    expect(step.countsTowardMastery).toBe(true);

    // Skipping ahead still leaves every recall rung to climb.
    expect(roundSummary(runCorrectly(state)).steps).toBe(7);
  });
});

describe("multiple choice", () => {
  const deck: McqCard[] = [
    {
      id: "1",
      topic: "ADH",
      question: "What does ADH do to water reabsorption?",
      directAnswer: "It increases water reabsorption in the collecting duct.",
      misconceptions: ["It decreases water reabsorption in the collecting duct."],
    },
    {
      id: "2",
      topic: "ADH",
      question: "Where is ADH released from?",
      directAnswer: "The posterior pituitary.",
      misconceptions: [],
    },
    {
      id: "3",
      topic: "Aldosterone",
      question: "What does aldosterone do to sodium?",
      directAnswer: "It increases sodium reabsorption in the distal tubule.",
      misconceptions: [],
    },
  ];

  it("uses the card's own misconceptions as distractors first", () => {
    const options = buildMcq(deck[0], deck, { seed: 1 });
    const texts = options.map((option) => option.text);
    expect(texts).toContain(deck[0].misconceptions[0]);
    expect(options.filter((option) => option.correct)).toHaveLength(1);
  });

  it("never offers the correct answer twice", () => {
    const card = { ...deck[0], misconceptions: [deck[0].directAnswer] };
    const options = buildMcq(card, deck, { seed: 2 });
    const correctText = options.find((option) => option.correct)!.text;
    expect(
      options.filter((option) => option.text === correctText),
    ).toHaveLength(1);
  });

  it("debriefs a sibling distractor with the question it really answers", () => {
    const options = buildMcq(deck[1], deck, { seed: 3 });
    const sibling = options.find(
      (option) => option.text === deck[2].directAnswer,
    );
    expect(sibling?.debrief).toContain(deck[2].question);
  });

  it("moves the correct answer around across seeds", () => {
    const positions = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        buildMcq(deck[0], deck, { seed }).findIndex((option) => option.correct),
      ),
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it("prefers a distractor close in length to the correct answer", () => {
    const long = {
      id: "4",
      topic: "ADH",
      question: "Long one?",
      directAnswer: "x".repeat(400),
      misconceptions: [],
    };
    const options = buildMcq(deck[1], [...deck, long], { seed: 4 });
    expect(options.map((o) => o.text)).not.toContain(long.directAnswer);
  });
});

describe("learn progress", () => {
  it("counts a recognition success on its own axis", () => {
    const update = applyLearnResult(undefined, {
      stage: "mcq",
      correct: true,
      countsTowardMastery: false,
    });
    expect(update.state).toBe("recognition");
    expect(update.recognitionCount).toBe(1);
    expect(update.immediateRecallCount).toBe(0);
  });

  it("changes nothing when a correct answer followed a reveal", () => {
    const update = applyLearnResult(
      {
        state: "recognition",
        recognitionCount: 1,
        immediateRecallCount: 0,
        lapses: 0,
        masteredPoints: [],
      },
      { stage: "typed_immediate", correct: true, countsTowardMastery: false },
    );
    expect(update.state).toBe("recognition");
    expect(update.immediateRecallCount).toBe(0);
  });

  it("promotes to immediate recall when the attempt counted", () => {
    const update = applyLearnResult(undefined, {
      stage: "typed_interleaved",
      correct: true,
      countsTowardMastery: true,
    });
    expect(update.state).toBe("immediate_recall");
    expect(update.immediateRecallCount).toBe(1);
  });

  it("keeps sub-points already mastered when a later answer misses some", () => {
    const update = applyLearnResult(
      {
        state: "immediate_recall",
        recognitionCount: 1,
        immediateRecallCount: 1,
        lapses: 0,
        masteredPoints: ["hypothalamus"],
      },
      {
        stage: "typed_delayed",
        correct: false,
        countsTowardMastery: true,
        metPoints: ["posterior pituitary"],
      },
    );
    expect(update.masteredPoints).toEqual([
      "hypothalamus",
      "posterior pituitary",
    ]);
    expect(update.state).toBe("immediate_recall");
    expect(update.lapses).toBe(1);
  });

  it("does not record a guess as a lapse", () => {
    const update = applyLearnResult(undefined, {
      stage: "mcq",
      correct: true,
      guessed: true,
      countsTowardMastery: false,
    });
    expect(update.lapses).toBe(0);
    expect(update.state).toBe("unstudied");
  });

  it("never writes a scheduling field", () => {
    const update = applyLearnResult(undefined, {
      stage: "typed_delayed",
      correct: true,
      countsTowardMastery: true,
    });
    expect(update).not.toHaveProperty("intervalDays");
    expect(update).not.toHaveProperty("nextReviewDue");
  });
});

describe("keyword grader (provisional)", () => {
  const grader = createKeywordGrader();

  it("accepts an answer that covers every required point", async () => {
    const result = await grader.grade({
      question: "Where is ADH made?",
      expected: "In the hypothalamus.",
      essentialPoints: ["hypothalamus"],
      answer: "it is made in the hypothalamus",
    });
    expect(result.verdict).toBe("correct");
  });

  it("reports which points are missing", async () => {
    const result = await grader.grade({
      question: "What does aldosterone do?",
      expected: "Increases sodium reabsorption and potassium secretion.",
      essentialPoints: ["sodium reabsorption", "potassium secretion"],
      answer: "it increases sodium reabsorption",
    });
    expect(result.verdict).toBe("partial");
    expect(result.missedPoints).toEqual(["potassium secretion"]);
  });

  it("rejects an empty answer", async () => {
    const result = await grader.grade({
      question: "Q",
      expected: "A",
      essentialPoints: ["something"],
      answer: "   ",
    });
    expect(result.verdict).toBe("incorrect");
  });
});

describe("learn sessions", () => {
  type TestDb = ReturnType<typeof drizzle<typeof schema>>;
  let db: TestDb;
  let examId: string;
  let cardIds: string[];

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
    examId = db
      .insert(exams)
      .values({ courseId: course.id, title: "Exam 2" })
      .returning()
      .get().id;

    cardIds = db
      .insert(flashcards)
      .values(
        Array.from({ length: 12 }, (_, i) => ({
          examId,
          topic: "ADH",
          question: `Q${i + 1}`,
          directAnswer: `A${i + 1}`,
        })),
      )
      .returning()
      .all()
      .map((row) => row.id);

    db.insert(cardRubrics)
      .values({ flashcardId: cardIds[0], essentialPoints: ["hypothalamus"] })
      .run();
  });

  it("clamps the round size to the 5–8 the PRD specifies", () => {
    expect(clampRoundSize(2)).toBe(5);
    expect(clampRoundSize(20)).toBe(8);
    expect(clampRoundSize(7)).toBe(7);
  });

  it("opens the first round from the first N cards of the deck", () => {
    const session = startLearnSession(db, examId, {
      scope: "all",
      roundSize: 5,
    });

    expect(session.cardOrder).toHaveLength(12);
    expect(session.roundState?.concepts).toHaveLength(5);

    const view = loadLearn(db, session.id)!;
    expect(view.roundNumber).toBe(1);
    expect(view.roundCount).toBe(3);
    expect(view.step?.cardId).toBe(cardIds[0]);
  });

  it("refuses an answer credited to the wrong concept", () => {
    const session = startLearnSession(db, examId, { scope: "all" });
    expect(
      submitOutcome(db, session.id, cardIds[4], { correct: true }),
    ).toBeUndefined();
  });

  it("records progress and survives a reload mid-round", () => {
    const session = startLearnSession(db, examId, { scope: "all" });

    submitOutcome(db, session.id, cardIds[0], { correct: true });

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardIds[0]))
      .get();
    expect(progress?.state).toBe("recognition");

    const view = loadLearn(db, session.id)!;
    expect(view.step?.cardId).toBe(cardIds[0]);
    expect(view.step?.stage).toBe("typed_immediate");
  });

  it("merges mastered sub-points as they are demonstrated", () => {
    const session = startLearnSession(db, examId, { scope: "all" });
    submitOutcome(db, session.id, cardIds[0], {
      correct: true,
      metPoints: ["hypothalamus"],
    });

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardIds[0]))
      .get();
    expect(progress?.masteredPoints).toEqual(["hypothalamus"]);
  });

  it("lets an already-recognized card skip straight to typed recall", () => {
    db.insert(studyProgress)
      .values({ flashcardId: cardIds[0], state: "recognition" })
      .run();

    const session = startLearnSession(db, examId, { scope: "all" });
    expect(session.roundState?.concepts[0].stage).toBe("typed_immediate");
  });

  it("advances through rounds and closes the session at the end", () => {
    const session = startLearnSession(db, examId, {
      scope: "all",
      roundSize: 5,
    });

    expect(startNextRound(db, session.id)).toBe(true);
    expect(loadLearn(db, session.id)?.roundNumber).toBe(2);

    expect(startNextRound(db, session.id)).toBe(true); // cards 11–12
    expect(startNextRound(db, session.id)).toBe(false);

    const finished = loadLearn(db, session.id)!;
    expect(finished.session.completedAt).not.toBeNull();
    expect(finished.state).toBeNull();
  });
});
