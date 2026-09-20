/**
 * In-session help (PRD §14).
 *
 * Two things must hold no matter what the model returns: a hint must not
 * contain the answer, and an answer given after help must not count as recall.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  answerAttempts,
  assistEvents,
  cardRubrics,
  courses,
  errorDiagnoses,
  exams,
  flashcards,
  sourceFiles,
  sourceSlides,
  studyProgress,
} from "@/db/schema";
import {
  loadLearn,
  provideAssist,
  recordAttempt,
  startLearnSession,
  submitOutcome,
} from "@/lib/learn/session";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";

import {
  diagnoseCard,
  DIAGNOSIS_THRESHOLD,
  hintLeaksAnswer,
  requestAssist,
  structuralHint,
  wrongAnswers,
} from "./index";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let cardId: string;

const POINTS = ["posterior pituitary", "increases water reabsorption"];

function stub(body: string, outside = false) {
  const requests: StructuredRequest[] = [];
  const provider: LlmProvider = {
    name: "stub",
    model: "stub",
    generateStructured: vi.fn(async (request: StructuredRequest) => {
      requests.push(request);
      return { data: { body, usesOutsideKnowledge: outside } as never };
    }),
  };
  return { provider, requests };
}

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const courseId = db
    .insert(courses)
    .values({ title: "Physiology" })
    .returning()
    .get().id;
  examId = db
    .insert(exams)
    .values({ courseId, title: "Exam 2" })
    .returning()
    .get().id;

  const fileId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "lecture.pptx",
      fileType: "pptx",
      role: "slides",
      rawPath: "lecture.pptx",
      status: "ready",
    })
    .returning()
    .get().id;

  const slideId = db
    .insert(sourceSlides)
    .values({
      sourceFileId: fileId,
      index: 4,
      rawText: "ADH is released from the posterior pituitary.",
    })
    .returning()
    .get().id;

  cardId = db
    .insert(flashcards)
    .values({
      examId,
      topic: "ADH",
      question: "Where is ADH released and what does it do?",
      directAnswer:
        "From the posterior pituitary; it increases water reabsorption.",
      sourceSlideId: slideId,
      sourceExcerpt: "ADH is released from the posterior pituitary.",
    })
    .returning()
    .get().id;

  db.insert(cardRubrics)
    .values({ flashcardId: cardId, essentialPoints: POINTS })
    .run();
});

describe("hint leakage", () => {
  it("catches a hint that states a required point", () => {
    expect(
      hintLeaksAnswer(
        "Remember it comes from the posterior pituitary.",
        POINTS,
        "irrelevant",
      ),
    ).toBe(true);
  });

  it("catches a hint that gives away the whole answer", () => {
    expect(
      hintLeaksAnswer(
        "It is released from the posterior pituitary and increases water reabsorption.",
        [],
        "From the posterior pituitary; it increases water reabsorption.",
      ),
    ).toBe(true);
  });

  it("allows a hint that points without telling", () => {
    expect(
      hintLeaksAnswer(
        "Think about which lobe stores hormones made elsewhere, and which way it pushes fluid.",
        POINTS,
        "From the posterior pituitary; it increases water reabsorption.",
      ),
    ).toBe(false);
  });

  it("builds a fallback hint that cannot leak, because it has no content", () => {
    const hint = structuralHint(2, "slide 4 of lecture.pptx");

    expect(hint).toContain("2 separate points");
    expect(hint).toContain("slide 4 of lecture.pptx");
    expect(hintLeaksAnswer(hint, POINTS, "anything")).toBe(false);
  });
});

describe("requestAssist", () => {
  it("replaces a hint that gave away the answer", async () => {
    const { provider } = stub(
      "The answer is the posterior pituitary, and it increases water reabsorption.",
    );

    const event = await requestAssist(db, provider, {
      cardId,
      kind: "hint",
    });

    // The model wrote the answer out; the student must not see it.
    expect(event?.body).not.toContain("posterior");
    expect(event?.body).toContain("2 separate points");
  });

  it("keeps a hint that stayed on the right side of the line", async () => {
    const { provider } = stub("Think about which lobe simply stores hormones.");
    const event = await requestAssist(db, provider, { cardId, kind: "hint" });

    expect(event?.body).toBe("Think about which lobe simply stores hormones.");
  });

  it("grounds help in the card's own source material", async () => {
    const { provider, requests } = stub("Plainly: ...");
    await requestAssist(db, provider, { cardId, kind: "simpler" });

    expect(requests[0].prompt).toContain(
      "ADH is released from the posterior pituitary.",
    );
    expect(requests[0].prompt).toContain("posterior pituitary");
  });

  it("records that help was given, and whether it went beyond the notes", async () => {
    const { provider } = stub("An example from elsewhere.", true);
    await requestAssist(db, provider, { cardId, kind: "example" });

    const events = db.select().from(assistEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("example");
    expect(events[0].usesOutsideKnowledge).toBe(true);
  });

  it("shows the source slide without calling a model at all", async () => {
    const { provider } = stub("should not be used");
    const event = await requestAssist(db, provider, { cardId, kind: "source" });

    expect(provider.generateStructured).not.toHaveBeenCalled();
    expect(event?.body).toContain("slide 4 of lecture.pptx");
    expect(event?.body).toContain("ADH is released from the posterior pituitary.");
  });
});

describe("assisted practice", () => {
  it("stops the next attempt on that concept from counting", async () => {
    const otherIds = db
      .insert(flashcards)
      .values(
        Array.from({ length: 4 }, (_, i) => ({
          examId,
          question: `Q${i}`,
          directAnswer: `A${i}`,
        })),
      )
      .returning()
      .all()
      .map((row) => row.id);
    expect(otherIds).toHaveLength(4);

    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });

    // Climb to a rung that would otherwise count.
    let step = loadLearn(db, session.id)!.step!;
    const target = step.cardId;
    submitOutcome(db, session.id, target, { correct: true, verdict: "correct" });
    submitOutcome(db, session.id, target, { correct: true, verdict: "correct" });

    let guard = 0;
    while (guard++ < 30) {
      step = loadLearn(db, session.id)!.step!;
      if (step.cardId === target) break;
      submitOutcome(db, session.id, step.cardId, {
        correct: true,
        verdict: "correct",
      });
    }
    expect(step.countsTowardMastery).toBe(true);

    const { provider } = stub("A gentle nudge.");
    await provideAssist(db, provider, session.id, target, "hint");

    // Same rung, same concept — but now it is practice.
    const after = loadLearn(db, session.id)!.step!;
    expect(after.cardId).toBe(target);
    expect(after.countsTowardMastery).toBe(false);
  });

  it("marks the attempt itself as assisted", () => {
    const attempt = recordAttempt(db, {
      flashcardId: cardId,
      answer: "after a hint",
      grade: {
        verdict: "correct",
        metPoints: POINTS,
        missedPoints: [],
        creditedOptional: [],
        errorType: "none",
        feedback: "",
        provisional: false,
      },
      countsTowardMastery: false,
      assisted: true,
    });

    expect(attempt.assisted).toBe(true);
  });

  it("does not promote mastery for an assisted answer", async () => {
    const session = startLearnSession(db, examId, { scope: "all", roundSize: 5 });
    const step = loadLearn(db, session.id)!.step!;

    const { provider } = stub("A nudge.");
    await provideAssist(db, provider, session.id, step.cardId, "hint");

    submitOutcome(db, session.id, step.cardId, {
      correct: true,
      verdict: "correct",
    });

    const progress = db
      .select()
      .from(studyProgress)
      .where(eq(studyProgress.flashcardId, step.cardId))
      .get();

    expect(progress?.immediateRecallCount).toBe(0);
    expect(progress?.retentionCount).toBe(0);
  });
});

describe("diagnosing repeated errors", () => {
  function wrongAttempt(answer: string) {
    recordAttempt(db, {
      flashcardId: cardId,
      answer,
      grade: {
        verdict: "incorrect",
        metPoints: [],
        missedPoints: POINTS,
        creditedOptional: [],
        errorType: "mechanism",
        feedback: "",
        provisional: false,
      },
      countsTowardMastery: true,
    });
  }

  function diagnosisStub() {
    const requests: StructuredRequest[] = [];
    const provider: LlmProvider = {
      name: "stub",
      model: "stub",
      generateStructured: vi.fn(async (request: StructuredRequest) => {
        requests.push(request);
        return {
          data: {
            category: "term_confusion",
            explanation: "Anterior and posterior keep being swapped.",
            suggestion: "Learn which lobe makes hormones and which stores them.",
          } as never,
        };
      }),
    };
    return { provider, requests };
  }

  it("waits for a pattern rather than diagnosing one bad answer", async () => {
    wrongAttempt("the anterior pituitary");
    const { provider } = diagnosisStub();

    expect(await diagnoseCard(db, provider, cardId)).toBeUndefined();
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it("diagnoses from what the student actually wrote", async () => {
    wrongAttempt("the anterior pituitary");
    wrongAttempt("anterior lobe, I think");

    const { provider, requests } = diagnosisStub();
    const diagnosis = await diagnoseCard(db, provider, cardId)!;

    expect(requests[0].prompt).toContain("anterior lobe, I think");
    expect(diagnosis?.category).toBe("term_confusion");
    expect(db.select().from(errorDiagnoses).all()).toHaveLength(1);
  });

  it("does not pay twice for the same conclusion", async () => {
    wrongAttempt("anterior");
    wrongAttempt("anterior lobe");

    const first = diagnosisStub();
    await diagnoseCard(db, first.provider, cardId);

    const second = diagnosisStub();
    await diagnoseCard(db, second.provider, cardId);

    expect(second.provider.generateStructured).not.toHaveBeenCalled();
  });

  it("re-diagnoses once there are new wrong answers", async () => {
    wrongAttempt("anterior");
    wrongAttempt("anterior lobe");
    const first = diagnosisStub();
    await diagnoseCard(db, first.provider, cardId);

    wrongAttempt("somewhere in the brain");
    const second = diagnosisStub();
    await diagnoseCard(db, second.provider, cardId);

    expect(second.provider.generateStructured).toHaveBeenCalled();
    expect(db.select().from(errorDiagnoses).all()).toHaveLength(1);
  });

  it("ignores practice drills and overridden grades", () => {
    wrongAttempt("a real miss");
    recordAttempt(db, {
      flashcardId: cardId,
      answer: "a drill",
      grade: {
        verdict: "incorrect",
        metPoints: [],
        missedPoints: [],
        creditedOptional: [],
        errorType: "incomplete",
        feedback: "",
        provisional: false,
      },
      countsTowardMastery: false,
      practice: true,
    });

    db.update(answerAttempts)
      .set({ overridden: true })
      .where(eq(answerAttempts.answer, "a real miss"))
      .run();

    expect(wrongAnswers(db, cardId)).toEqual([]);
  });

  it("needs two wrong answers before it looks", () => {
    expect(DIAGNOSIS_THRESHOLD).toBe(2);
  });
});
