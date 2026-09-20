/**
 * Generation jobs.
 *
 * The behaviour that matters: progress is real, it survives the client going
 * away, and two runs cannot overlap.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  courses,
  exams,
  flashcards,
  generationJobs,
  sourceFiles,
  sourceSlides,
} from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";

import { activeJob, latestJob, startGenerationJob } from "./jobs";
import type { GenerationResponse } from "./schemas";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;
let fileId: string;

/** Answers each batch from the slides it was given, with a pause we control. */
function stubProvider(options: { gate?: Promise<void> } = {}) {
  const provider: LlmProvider = {
    name: "stub",
    model: "stub",
    generateStructured: vi.fn(async (request: StructuredRequest) => {
      if (options.gate) await options.gate;

      const token = request.prompt.match(/\[(S\d+)\]/)?.[1] ?? "S1";
      const line =
        request.prompt.match(/Body line one for slide \d+/)?.[0] ?? "";

      const data: GenerationResponse = {
        cards: [
          {
            topic: "T",
            facet: "definition",
            cardType: "atomic",
            question: `Q for ${token} ${Math.random()}`,
            directAnswer: line,
            hasAiSupplement: false,
            slideCitation: token,
            sourceExcerpt: line,
            essentialPoints: [],
          },
        ],
      };

      return { data: data as never };
    }),
  };

  return provider;
}

function seedSlides(count: number) {
  for (let i = 1; i <= count; i += 1) {
    db.insert(sourceSlides)
      .values({
        sourceFileId: fileId,
        index: i,
        rawText: `Body line one for slide ${i}`,
      })
      .run();
  }
}

async function settle() {
  // Let the un-awaited generation promise chain run to completion.
  for (let i = 0; i < 50; i += 1) await new Promise((r) => setTimeout(r, 5));
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
  fileId = db
    .insert(sourceFiles)
    .values({
      examId,
      filename: "deck.pptx",
      fileType: "pptx",
      role: "slides",
      rawPath: "deck.pptx",
      status: "ready",
    })
    .returning()
    .get().id;
});

describe("startGenerationJob", () => {
  it("returns a running job immediately, before any card exists", () => {
    seedSlides(4);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const job = startGenerationJob(db, stubProvider({ gate }), examId);

    // The request answers now; the work has not even called the model yet.
    expect(job.status).toBe("running");
    expect(db.select().from(flashcards).all()).toHaveLength(0);

    release();
  });

  it("records progress as batches finish, not as they start", async () => {
    seedSlides(24);
    startGenerationJob(db, stubProvider(), examId, { batchSize: 8 });
    await settle();

    const job = latestJob(db, examId)!;
    expect(job.status).toBe("done");
    expect(job.batchCount).toBe(3);
    expect(job.batchIndex).toBe(3);
    expect(job.cardsCreated).toBe(db.select().from(flashcards).all().length);
  });

  it("keeps running when nobody is watching", async () => {
    seedSlides(16);
    startGenerationJob(db, stubProvider(), examId, { batchSize: 8 });

    // Nothing polls, nothing awaits — exactly what navigating away looks like.
    await settle();

    expect(latestJob(db, examId)?.status).toBe("done");
    expect(db.select().from(flashcards).all().length).toBeGreaterThan(0);
  });

  it("stores the finished summary for the panel to show later", async () => {
    seedSlides(8);
    startGenerationJob(db, stubProvider(), examId);
    await settle();

    const job = latestJob(db, examId)!;
    const summary = job.summary as { cardsCreated: number; rejections: [] };

    expect(summary.cardsCreated).toBe(job.cardsCreated);
    expect(Array.isArray(summary.rejections)).toBe(true);
  });

  it("reports only a running job as active", async () => {
    seedSlides(8);
    startGenerationJob(db, stubProvider(), examId);
    await settle();

    expect(activeJob(db, examId)).toBeUndefined();
    expect(latestJob(db, examId)?.status).toBe("done");
  });

  it("records a failure instead of hanging on a spinner", async () => {
    seedSlides(8);
    const provider: LlmProvider = {
      name: "stub",
      model: "stub",
      generateStructured: vi.fn(async () => {
        throw new Error("model unavailable");
      }),
    };

    startGenerationJob(db, provider, examId);
    await settle();

    const job = latestJob(db, examId)!;
    expect(job.status).toBe("failed");
    expect(job.error).toContain("model unavailable");
    expect(job.finishedAt).not.toBeNull();
  });

  it("keeps the target deck when generating into a copy", async () => {
    seedSlides(8);
    const other = db
      .insert(exams)
      .values({
        courseId: db.select().from(courses).get()!.id,
        title: "Copy",
      })
      .returning()
      .get();

    const job = startGenerationJob(db, stubProvider(), examId, {
      mode: "separate",
      targetExamId: other.id,
    });
    await settle();

    expect(db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get()
      ?.targetExamId).toBe(other.id);
  });
});
