/**
 * The Primer: citations checked against the real slides, guides replaced per
 * depth, counter-examples written once and cached, and the ⌄ callout that
 * shows a sentence's slide.
 */
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CitationCallout, CitedText } from "@/components/primer/cited-text";
import * as schema from "@/db/schema";
import { courses, exams, primerGuides, primerSections, sourceFiles, sourceSlides } from "@/db/schema";
import type { LlmProvider, StructuredRequest } from "@/lib/llm";

import {
  PrimerError,
  counterExample,
  generatePrimer,
  getPrimer,
  loadPrimerSlides,
  normaliseSentence,
  primerDepthsWritten,
  slideKey,
  type CitedSentence,
} from "./index";

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let db: TestDb;
let examId: string;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });

  const course = db.insert(courses).values({ title: "A&P" }).returning().get();
  examId = db.insert(exams).values({ courseId: course.id, title: "Exam 1" }).returning().get().id;
});

function upload(
  filename: string,
  createdAt: string,
  slides: { text: string; image?: boolean }[],
  role: "slides" | "study_guide" = "slides",
) {
  const file = db
    .insert(sourceFiles)
    .values({ examId, filename, fileType: "pptx", role, rawPath: filename, createdAt })
    .returning()
    .get();
  return slides.map(
    (slide, i) =>
      db
        .insert(sourceSlides)
        .values({
          sourceFileId: file.id,
          index: i + 1,
          rawText: slide.text,
          imagePath: slide.image ? `slides/${filename}-${i + 1}.png` : null,
        })
        .returning()
        .get().id,
  );
}

/** A provider that answers every call with `data`, and records the calls. */
function fakeProvider(data: unknown, model = "fake-lite") {
  const calls: StructuredRequest[] = [];
  const provider: LlmProvider = {
    name: "fake",
    model,
    async generateStructured<T>(request: StructuredRequest) {
      calls.push(request);
      return { data: data as T };
    },
  };
  return { provider, calls };
}

const s = (text: string, doc = 0, slide = 0, excerpt = "") => ({
  text,
  source_document_index: doc,
  source_slide_number: slide,
  source_excerpt: excerpt,
});

function slidesMap() {
  return new Map(loadPrimerSlides(db, examId).map((x) => [slideKey(x.documentIndex, x.slideNumber), x]));
}

describe("citations", () => {
  beforeEach(() => {
    upload("lecture1.pptx", "2026-01-01 00:00:00", [
      { text: "The Heart\nThe heart has four chambers." },
      { text: "Blood flows through the “right atrium” first." },
    ]);
  });

  it("keeps an excerpt that is really on the cited slide", () => {
    expect(normaliseSentence(s("Four chambers.", 1, 1, "heart has four chambers"), slidesMap())).toEqual({
      text: "Four chambers.",
      source_document_index: 1,
      source_slide_number: 1,
      source_excerpt: "heart has four chambers",
    });
  });

  it("matches despite quote style, case and spacing", () => {
    const sentence = normaliseSentence(s("Atrium.", 1, 2, 'the  "Right Atrium" first'), slidesMap());
    expect(sentence?.source_excerpt).toBe('the  "Right Atrium" first');
  });

  it("drops an invented excerpt but keeps the slide", () => {
    expect(normaliseSentence(s("Five chambers.", 1, 1, "the heart has five chambers"), slidesMap())).toEqual({
      text: "Five chambers.",
      source_document_index: 1,
      source_slide_number: 1,
      source_excerpt: null,
    });
  });

  it("drops a citation to a slide that does not exist", () => {
    for (const [doc, slide] of [
      [1, 9],
      [4, 1],
      [0, 0],
    ]) {
      expect(normaliseSentence(s("Claim.", doc, slide, "x"), slidesMap())).toEqual({
        text: "Claim.",
        source_document_index: null,
        source_slide_number: null,
        source_excerpt: null,
      });
    }
  });

  it("drops an empty sentence", () => {
    expect(normaliseSentence(s("   ", 1, 1), slidesMap())).toBeNull();
  });

  it("numbers slideshows by upload, skipping study guides", () => {
    upload("guide.pdf", "2026-01-02 00:00:00", [{ text: "Q1" }], "study_guide");
    upload("lecture2.pptx", "2026-01-03 00:00:00", [{ text: "Valves prevent backflow." }]);
    expect(normaliseSentence(s("Valves.", 2, 1, "valves prevent backflow"), slidesMap())).toMatchObject({
      source_document_index: 2,
      source_excerpt: "valves prevent backflow",
    });
  });
});

describe("writing a primer", () => {
  const response = {
    concepts: [
      {
        conceptName: "Chambers",
        definition: [s("The heart has four chambers.", 1, 1, "The heart has four chambers.")],
        breakdown: [s("Two atria and two ventricles."), s("Blood enters the right atrium.", 1, 2, "right atrium")],
        example: [s("Like a four-room house.")],
      },
      { conceptName: "Empty", definition: [], breakdown: [], example: [] },
      {
        conceptName: "Flow",
        definition: [s("Blood flows one way.", 1, 2)],
        breakdown: [],
        example: [],
      },
    ],
  };

  it("refuses when there are no slides, without calling the model", async () => {
    const { provider, calls } = fakeProvider(response);
    await expect(generatePrimer(db, provider, examId, "balanced")).rejects.toBeInstanceOf(PrimerError);
    expect(calls).toHaveLength(0);
  });

  it("stores concepts in order, drops empty ones, and asks for the right depth", async () => {
    upload("lecture1.pptx", "2026-01-01 00:00:00", [
      { text: "The heart has four chambers.", image: true },
      { text: "Blood enters the right atrium." },
    ]);
    const { provider, calls } = fakeProvider(response);

    await generatePrimer(db, provider, examId, "foundational");

    expect(calls).toHaveLength(1);
    expect(calls[0].feature).toBe("primer");
    expect(calls[0].prompt).toContain("[S1.1]");
    expect(calls[0].prompt).toContain("[S1.2]");

    const primer = getPrimer(db, examId, "foundational")!;
    expect(primer.guide.model).toBe("fake-lite");
    expect(primer.sections.map((x) => x.conceptName)).toEqual(["Chambers", "Flow"]);
    expect(primer.sections[0].breakdown[0].source_document_index).toBeNull();
    expect(Object.keys(primer.slides).sort()).toEqual(["1:1", "1:2"]);
    expect(primer.slides["1:1"].hasImage).toBe(true);
    expect(primer.slides["1:2"].hasImage).toBe(false);
    expect(getPrimer(db, examId, "balanced")).toBeNull();
  });

  it("replaces the guide at that depth and leaves the others", async () => {
    upload("lecture1.pptx", "2026-01-01 00:00:00", [{ text: "The heart has four chambers." }]);
    await generatePrimer(db, fakeProvider(response).provider, examId, "summary");
    await generatePrimer(db, fakeProvider(response).provider, examId, "balanced");
    const second = {
      concepts: [{ conceptName: "Only", definition: [s("Just one.")], breakdown: [], example: [] }],
    };
    await generatePrimer(db, fakeProvider(second).provider, examId, "summary");

    expect(primerDepthsWritten(db, examId).sort()).toEqual(["balanced", "summary"]);
    expect(getPrimer(db, examId, "summary")!.sections.map((x) => x.conceptName)).toEqual(["Only"]);
    expect(db.select().from(primerGuides).all()).toHaveLength(2);
    expect(db.select().from(primerSections).all()).toHaveLength(3);
  });

  it("keeps the old guide when the new one comes back empty", async () => {
    upload("lecture1.pptx", "2026-01-01 00:00:00", [{ text: "The heart has four chambers." }]);
    await generatePrimer(db, fakeProvider(response).provider, examId, "balanced");
    await expect(
      generatePrimer(db, fakeProvider({ concepts: [] }).provider, examId, "balanced"),
    ).rejects.toBeInstanceOf(PrimerError);
    expect(getPrimer(db, examId, "balanced")!.sections).toHaveLength(2);
  });
});

describe("counter-examples", () => {
  const answer = {
    misconception: "Atria pump blood to the body.",
    incorrectApplication: "Blaming a weak atrium for low blood pressure.",
    whyFlawed: "The left ventricle does the systemic pumping.",
  };

  async function section() {
    upload("lecture1.pptx", "2026-01-01 00:00:00", [{ text: "The heart has four chambers." }]);
    await generatePrimer(
      db,
      fakeProvider({
        concepts: [{ conceptName: "Chambers", definition: [s("Four chambers.")], breakdown: [], example: [] }],
      }).provider,
      examId,
      "balanced",
    );
    return getPrimer(db, examId, "balanced")!.sections[0].id;
  }

  it("writes once, then answers from the database without a model", async () => {
    const sectionId = await section();
    const { provider, calls } = fakeProvider(answer, "gemini-2.5-flash");
    const factory = vi.fn(() => provider);

    expect(await counterExample(db, factory, sectionId)).toEqual({ counterExample: answer, cached: false });
    expect(calls[0].feature).toBe("counter_example");
    expect(calls[0].prompt).toContain("Chambers");

    expect(await counterExample(db, factory, sectionId)).toEqual({ counterExample: answer, cached: true });
    expect(factory).toHaveBeenCalledTimes(1);

    const row = db.select().from(primerSections).where(eq(primerSections.id, sectionId)).get()!;
    expect(row.counterExample).toEqual(answer);
    expect(row.counterExampleAt).not.toBeNull();
  });

  it("returns null for a missing section, and stores nothing when incomplete", async () => {
    const factory = vi.fn(() => fakeProvider(answer).provider);
    expect(await counterExample(db, factory, "nope")).toBeNull();
    expect(factory).not.toHaveBeenCalled();

    const sectionId = await section();
    await expect(
      counterExample(db, () => fakeProvider({ misconception: "", whyFlawed: "" }).provider, sectionId),
    ).rejects.toBeInstanceOf(PrimerError);
    expect(getPrimer(db, examId, "balanced")!.sections[0].counterExample).toBeNull();
  });
});

describe("citation rendering", () => {
  const cited: CitedSentence = {
    text: "The heart has four chambers.",
    source_document_index: 1,
    source_slide_number: 14,
    source_excerpt: "four chambers",
  };
  const plain: CitedSentence = {
    text: "Think of it as a pump.",
    source_document_index: null,
    source_slide_number: null,
    source_excerpt: null,
  };
  const slides = { "1:14": { slideId: "slide-abc", hasImage: true } };

  it("puts a closed ⌄ after cited sentences only", () => {
    const html = renderToStaticMarkup(createElement(CitedText, { sentences: [cited, plain], slides }));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show source: Slideshow 1 · Slide 14"');
    expect(html).not.toContain("<aside");
    expect(html).toContain("Think of it as a pump.");
  });

  it("opens to the slide label, the verbatim quote and the slide image", () => {
    const html = renderToStaticMarkup(
      createElement(CitedText, { sentences: [cited, plain], slides, defaultOpen: 0 }),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<aside");
    expect(html).toContain("Slideshow 1 · Slide 14");
    expect(html).toMatch(/<blockquote[^>]*>“four chambers”<\/blockquote>/);
    expect(html).toContain('src="/api/slides/slide-abc/image"');
  });

  it("leaves out the quote and image when there are none", () => {
    const html = renderToStaticMarkup(
      createElement(CitationCallout, {
        sentence: { ...cited, source_excerpt: null },
        slide: { slideId: "slide-abc", hasImage: false },
      }),
    );
    expect(html).toContain("Slideshow 1 · Slide 14");
    expect(html).not.toContain("<blockquote");
    expect(html).not.toContain("<img");
    expect(html).toContain("No exact quote");
  });
});
