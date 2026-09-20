/**
 * Grading tests.
 *
 * `reconcileGrade` is where the guarantees live — the prompt asks, the code
 * enforces — so most of these drive it directly with the shapes a model
 * actually returns, including self-contradictory ones.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  answerAttempts,
  cardRubrics,
  courses,
  exams,
  flashcards,
  studyProgress,
} from "@/db/schema";
import {
  overrideAttempt,
  recordAttempt,
  lastMissedPoints,
} from "@/lib/learn/session";
import type { TypedGrade, TypedRequest } from "@/lib/learn/typed";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";

import { getTypedGrader } from "./index";
import { tokenizePoints } from "./prompts";
import { createSemanticGrader, reconcileGrade } from "./semantic";
import type { GradeResponse } from "./schemas";

const request: TypedRequest = {
  question: "What does aldosterone do to sodium?",
  expected: "It increases sodium reabsorption in the distal tubule.",
  essentialPoints: ["increases sodium reabsorption", "distal tubule"],
  optionalPoints: ["acts on principal cells"],
  misconceptions: ["It decreases sodium reabsorption."],
  answer: "aldosterone makes the distal tubule take back more sodium",
};

const points = tokenizePoints(request);

function response(overrides: Partial<GradeResponse> = {}): GradeResponse {
  return {
    verdict: "correct",
    errorType: "none",
    metPoints: ["P1", "P2"],
    missedPoints: [],
    creditedOptional: [],
    feedback: "Both points are there.",
    ...overrides,
  };
}

describe("reconcileGrade", () => {
  it("accepts a clean pass", () => {
    const grade = reconcileGrade(response(), points);
    expect(grade.verdict).toBe("correct");
    expect(grade.metPoints).toHaveLength(2);
    expect(grade.errorType).toBe("none");
  });

  it("fails a directionality error however the grader scored it", () => {
    // The gate is enforced here, not trusted to the prompt: every point met,
    // verdict "correct", but the direction was reversed.
    const grade = reconcileGrade(
      response({ verdict: "correct", errorType: "directionality" }),
      points,
    );
    expect(grade.verdict).toBe("incorrect");
    expect(grade.errorType).toBe("directionality");
  });

  it("fails a mechanism error even when scored as partial", () => {
    const grade = reconcileGrade(
      response({ verdict: "partial", errorType: "mechanism" }),
      points,
    );
    expect(grade.verdict).toBe("incorrect");
  });

  it("treats a point the grader never mentioned as missed", () => {
    const grade = reconcileGrade(
      response({ metPoints: ["P1"], missedPoints: [] }),
      points,
    );
    expect(grade.verdict).toBe("partial");
    expect(grade.missedPoints).toEqual(["distal tubule"]);
  });

  it("resolves a point reported both ways as missed", () => {
    const grade = reconcileGrade(
      response({ metPoints: ["P1", "P2"], missedPoints: ["P2"] }),
      points,
    );
    expect(grade.metPoints).toEqual(["increases sodium reabsorption"]);
    expect(grade.missedPoints).toEqual(["distal tubule"]);
  });

  it("drops point tokens that were never in the rubric", () => {
    const grade = reconcileGrade(
      response({ metPoints: ["P1", "P9"], missedPoints: ["P2"] }),
      points,
    );
    expect(grade.metPoints).toEqual(["increases sodium reabsorption"]);
    expect(grade.missedPoints).toEqual(["distal tubule"]);
  });

  it("reads a decorated token", () => {
    const grade = reconcileGrade(
      response({ metPoints: ["[P1]", "P2 (site)"] }),
      points,
    );
    expect(grade.metPoints).toHaveLength(2);
  });

  it("downgrades a 'correct' verdict that still has a missing point", () => {
    const grade = reconcileGrade(
      response({ verdict: "correct", metPoints: ["P1"], missedPoints: ["P2"] }),
      points,
    );
    expect(grade.verdict).toBe("partial");
    expect(grade.errorType).toBe("incomplete");
  });

  it("upgrades a hedged verdict when every point was in fact met", () => {
    const grade = reconcileGrade(
      response({ verdict: "partial", metPoints: ["P1", "P2"] }),
      points,
    );
    expect(grade.verdict).toBe("correct");
  });

  it("marks an answer that met nothing as unrelated", () => {
    const grade = reconcileGrade(
      response({
        verdict: "incorrect",
        metPoints: [],
        missedPoints: ["P1", "P2"],
      }),
      points,
    );
    expect(grade.verdict).toBe("incorrect");
    expect(grade.errorType).toBe("unrelated");
  });

  it("credits optional points without requiring them", () => {
    const grade = reconcileGrade(
      response({ creditedOptional: ["O1"] }),
      points,
    );
    expect(grade.verdict).toBe("correct");
    expect(grade.creditedOptional).toEqual(["acts on principal cells"]);
  });

  it("supplies feedback when the grader returned none", () => {
    const grade = reconcileGrade(
      response({ feedback: "  ", errorType: "directionality" }),
      points,
    );
    expect(grade.feedback).toMatch(/direction/i);
  });
});

describe("semantic grader", () => {
  function stub(data: GradeResponse) {
    const requests: StructuredRequest[] = [];
    const provider: LlmProvider = {
      name: "stub",
      model: "stub-model",
      generateStructured: vi.fn(async (r: StructuredRequest) => {
        requests.push(r);
        return { data: data as never };
      }),
    };
    return { provider, requests };
  }

  it("does not spend a call on an empty answer", async () => {
    const { provider } = stub(response());
    const grade = await createSemanticGrader(provider).grade({
      ...request,
      answer: "   ",
    });

    expect(provider.generateStructured).not.toHaveBeenCalled();
    expect(grade.verdict).toBe("incorrect");
    expect(grade.missedPoints).toHaveLength(2);
  });

  it("hands the rubric over as tokens and names the known wrong answers", async () => {
    const { provider, requests } = stub(response());
    await createSemanticGrader(provider).grade(request);

    const prompt = requests[0].prompt;
    expect(prompt).toContain("[P1] increases sodium reabsorption");
    expect(prompt).toContain("[O1] acts on principal cells");
    expect(prompt).toContain("It decreases sodium reabsorption.");
    expect(prompt).toContain(request.answer);
  });

  it("requires only the missed points when drilling them", async () => {
    const { provider, requests } = stub(
      response({ metPoints: ["P1"], missedPoints: [] }),
    );
    const grade = await createSemanticGrader(provider).grade({
      ...request,
      focusPoints: ["distal tubule"],
    });

    expect(requests[0].prompt).toContain("[P1] distal tubule");
    expect(requests[0].prompt).toContain("practising only the points");
    // With one required point met, the drill is a pass.
    expect(grade.verdict).toBe("correct");
  });

  it("is not marked provisional", async () => {
    const { provider } = stub(response());
    const grade = await createSemanticGrader(provider).grade(request);
    expect(grade.provisional).toBe(false);
  });
});

describe("grader selection", () => {
  const key = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
  });

  it("falls back to the keyword stand-in when no provider is configured", async () => {
    delete process.env.GEMINI_API_KEY;
    const grader = getTypedGrader();

    const grade = await grader.grade(request);
    // A session without an API key still runs — but says what graded it.
    expect(grade.provisional).toBe(true);
  });

  it("uses the semantic grader when a key is present", () => {
    process.env.GEMINI_API_KEY = "test-key";
    expect(getTypedGrader().name).toMatch(/semantic/);
  });
});

describe("attempts and overrides", () => {
  type TestDb = ReturnType<typeof drizzle<typeof schema>>;
  let db: TestDb;
  let cardId: string;

  const grade: TypedGrade = {
    verdict: "partial",
    metPoints: ["distal tubule"],
    missedPoints: ["increases sodium reabsorption"],
    creditedOptional: [],
    errorType: "incomplete",
    feedback: "Half of it.",
    provisional: false,
  };

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
    db.insert(cardRubrics)
      .values({
        flashcardId: cardId,
        essentialPoints: ["increases sodium reabsorption", "distal tubule"],
      })
      .run();
  });

  it("keeps the student's words alongside the verdict", () => {
    const attempt = recordAttempt(db, {
      flashcardId: cardId,
      answer: "it works on the distal tubule",
      grade,
      countsTowardMastery: true,
      stage: "typed_interleaved",
    });

    expect(attempt.answer).toBe("it works on the distal tubule");
    expect(attempt.verdict).toBe("partial");
    expect(attempt.missedPoints).toEqual(["increases sodium reabsorption"]);
  });

  it("credits the card and clears the lapse when the student overrules it", () => {
    db.insert(studyProgress)
      .values({ flashcardId: cardId, state: "recognition", lapses: 1 })
      .run();

    const attempt = recordAttempt(db, {
      flashcardId: cardId,
      answer: "distal tubule takes back more sodium",
      grade,
      countsTowardMastery: true,
      stage: "typed_interleaved",
    });

    expect(overrideAttempt(db, attempt.id)?.attempt.overridden).toBe(true);

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardId))
      .get();

    expect(progress?.state).toBe("immediate_recall");
    expect(progress?.lapses).toBe(0);
    // Every rubric point is credited: the student says their answer said it.
    expect(progress?.masteredPoints).toEqual([
      "distal tubule",
      "increases sodium reabsorption",
    ]);
  });

  it("does not let an override promote an attempt that never counted", () => {
    const attempt = recordAttempt(db, {
      flashcardId: cardId,
      answer: "whatever",
      grade,
      countsTowardMastery: false,
      stage: "typed_immediate",
    });

    overrideAttempt(db, attempt.id);

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, cardId))
      .get();
    expect(progress?.state).toBe("unstudied");
  });

  it("overrides an attempt only once", () => {
    const attempt = recordAttempt(db, {
      flashcardId: cardId,
      answer: "x",
      grade,
      countsTowardMastery: true,
    });

    expect(overrideAttempt(db, attempt.id)).toBeDefined();
    expect(overrideAttempt(db, attempt.id)).toBeUndefined();
  });

  it("will not override a practice drill, which was never scored", () => {
    const attempt = recordAttempt(db, {
      flashcardId: cardId,
      answer: "x",
      grade,
      countsTowardMastery: false,
      practice: true,
    });

    expect(overrideAttempt(db, attempt.id)).toBeUndefined();
    expect(db.select().from(studyProgress).all()).toHaveLength(0);
  });

  it("offers the last scored attempt's misses for drilling", () => {
    recordAttempt(db, {
      flashcardId: cardId,
      answer: "x",
      grade,
      countsTowardMastery: true,
    });

    expect(lastMissedPoints(db, cardId)).toEqual([
      "increases sodium reabsorption",
    ]);
  });

  it("records a practice drill without scoring it", () => {
    recordAttempt(db, {
      flashcardId: cardId,
      answer: "drill",
      grade: { ...grade, verdict: "correct", missedPoints: [] },
      countsTowardMastery: false,
      practice: true,
    });

    expect(db.select().from(answerAttempts).all()).toHaveLength(1);
    expect(db.select().from(studyProgress).all()).toHaveLength(0);
  });
});
