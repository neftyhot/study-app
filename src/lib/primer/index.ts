/**
 * The Primer: a read-through of the deck before the first flashcard.
 *
 * Flashcards test facts one at a time; a student meeting a topic cold needs
 * the story those facts belong to first. The Primer walks the slides in
 * lecture order and explains each concept at one of three depths, citing the
 * slide every sentence came from.
 *
 * Citations are checked, not trusted. A sentence may only cite a slide that
 * exists, and its excerpt is kept only if it really appears on that slide —
 * a callout that quotes words the lecturer never wrote would be worse than no
 * callout at all.
 *
 * Counter-examples are written on demand, one section at a time, and stored:
 * most are never opened, and one that is opened twice is paid for once.
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import {
  primerGuides,
  primerSections,
  sourceFiles,
  sourceSlides,
  type PrimerDepth,
  type PrimerSection,
} from "@/db/schema";
import type { JsonSchema, LlmProvider } from "@/lib/llm";

import type { CitedSentence, CounterExample } from "./types";

export type { CitedSentence, CounterExample } from "./types";

export const PRIMER_DEPTHS: { id: PrimerDepth; label: string; blurb: string }[] = [
  { id: "summary", label: "Summary", blurb: "The key takeaways, nothing more." },
  { id: "balanced", label: "Balanced", blurb: "A textbook walkthrough of each concept." },
  {
    id: "foundational",
    label: "First Principles (Foundational)",
    blurb: "Starts from zero: plain words, analogies, every step spelled out.",
  },
];

export function isPrimerDepth(value: unknown): value is PrimerDepth {
  return PRIMER_DEPTHS.some((depth) => depth.id === value);
}

/* ------------------------------------------------------------------------ */
/* Source material                                                          */
/* ------------------------------------------------------------------------ */

export type PrimerSlide = {
  id: string;
  /** 1-based position of the file among the exam's slideshows, by upload. */
  documentIndex: number;
  /** 1-based slide or page number. */
  slideNumber: number;
  text: string;
  hasImage: boolean;
};

/**
 * Every lecture slide of an exam, in lecture order.
 *
 * Study guides are left out: they list what to know, not what it means, and
 * the document numbering must match the one flashcards use (lib/order.ts).
 */
export function loadPrimerSlides(db: Db, examId: string): PrimerSlide[] {
  const files = db
    .select({ id: sourceFiles.id })
    .from(sourceFiles)
    .where(and(eq(sourceFiles.examId, examId), ne(sourceFiles.role, "study_guide")))
    .orderBy(asc(sourceFiles.createdAt), sql`rowid`)
    .all();

  return files.flatMap((file, i) =>
    db
      .select()
      .from(sourceSlides)
      .where(eq(sourceSlides.sourceFileId, file.id))
      .orderBy(asc(sourceSlides.index))
      .all()
      .map((slide) => ({
        id: slide.id,
        documentIndex: i + 1,
        slideNumber: slide.index,
        text: [slide.title, slide.rawText, slide.speakerNotes]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join("\n"),
        hasImage: Boolean(slide.imagePath),
      })),
  );
}

export function slideKey(documentIndex: number, slideNumber: number): string {
  return `${documentIndex}:${slideNumber}`;
}

/** Roughly what flash-lite reads comfortably in one call, with room to answer. */
export const MAX_PRIMER_CHARS = 400_000;

export function primerSourceText(slides: PrimerSlide[]): string {
  let used = 0;
  const blocks: string[] = [];
  for (const slide of slides) {
    if (!slide.text) continue;
    const block = `[S${slide.documentIndex}.${slide.slideNumber}]\n${slide.text}`;
    if (used + block.length > MAX_PRIMER_CHARS) break;
    used += block.length;
    blocks.push(block);
  }
  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------------ */
/* Generation                                                               */
/* ------------------------------------------------------------------------ */

/*
 * The model reports "no citation" as 0 and "" rather than null: nullable
 * types are the part of JSON Schema structured-output providers disagree on.
 * `normaliseSentence` turns them back into nulls.
 */
const SENTENCE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    text: { type: "string", description: "One sentence." },
    source_document_index: {
      type: "integer",
      description: "N from the [SN.M] tag of the slide this sentence rests on; 0 if none.",
    },
    source_slide_number: {
      type: "integer",
      description: "M from the [SN.M] tag of the slide this sentence rests on; 0 if none.",
    },
    source_excerpt: {
      type: "string",
      description:
        "A short phrase copied character for character from that slide; empty if none.",
    },
  },
  required: ["text", "source_document_index", "source_slide_number", "source_excerpt"],
  additionalProperties: false,
};

const SENTENCES = (description: string): JsonSchema => ({
  type: "array",
  description,
  items: SENTENCE_SCHEMA,
});

export const PRIMER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      description: "The lecture's concepts, in the order the slides introduce them.",
      items: {
        type: "object",
        properties: {
          conceptName: { type: "string" },
          definition: SENTENCES("What it is, in plain language."),
          breakdown: SENTENCES("How it works and why: the mechanism and the causes."),
          example: SENTENCES("One concrete example of it in action."),
        },
        required: ["conceptName", "definition", "breakdown", "example"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts"],
  additionalProperties: false,
};

type RawSentence = {
  text?: string;
  source_document_index?: number | null;
  source_slide_number?: number | null;
  source_excerpt?: string | null;
};

type PrimerResponse = {
  concepts: {
    conceptName: string;
    definition: RawSentence[];
    breakdown: RawSentence[];
    example: RawSentence[];
  }[];
};

const DEPTH_INSTRUCTIONS: Record<PrimerDepth, string> = {
  summary: `DEPTH: SUMMARY
Key takeaways only. One sentence of definition, one or two of breakdown, one
of example. A student skimming before class should finish in five minutes.`,
  balanced: `DEPTH: BALANCED
A textbook walkthrough. Two or three sentences of definition, a paragraph of
breakdown that follows the cause-and-effect chain, and a worked example.`,
  foundational: `DEPTH: FIRST PRINCIPLES (FOUNDATIONAL)
Assume the student has never met the subject. Define every technical word the
first time it appears, in everyday language. Build each idea from the ones
before it, one step at a time, and never skip a step because it seems obvious.
Use an everyday analogy in the breakdown (a thermostat, a lock and key, a
queue at a shop) and say where the analogy stops holding. Prefer many short
sentences to a few long ones.`,
};

export const PRIMER_SYSTEM = `You write a pre-study primer for a student about to learn from these lecture slides.

Each slide is tagged [SN.M]: slideshow N, slide M.

- Cover the concepts in the order the slides introduce them. Never reorder
  alphabetically or by importance.
- For each concept give its name, a plain-language definition, a breakdown of
  how it works and why (mechanism and causality, not a list of facts), and one
  concrete example.
- Every sentence stands alone as one sentence.
- Cite the slide a sentence rests on with its N and M, and copy a short
  phrase from that slide exactly as written as the excerpt. If a sentence
  goes beyond the slides (an analogy, a bridging explanation), give 0, 0 and
  an empty excerpt rather than a citation it does not deserve.
- Never contradict the slides.`;

export function primerPrompt(depth: PrimerDepth, sourceText: string): string {
  return `${DEPTH_INSTRUCTIONS[depth]}\n\nSLIDES\n${sourceText}`;
}

function squash(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Turns the model's sentence into one the page can trust.
 *
 * A citation to a slide that does not exist is dropped; an excerpt that is not
 * on the cited slide is dropped but the citation kept, since the slide itself
 * is still the right place to look.
 */
export function normaliseSentence(
  raw: RawSentence,
  slides: Map<string, PrimerSlide>,
): CitedSentence | null {
  const text = raw.text?.trim();
  if (!text) return null;

  const doc = raw.source_document_index ?? 0;
  const page = raw.source_slide_number ?? 0;
  const slide = doc > 0 && page > 0 ? slides.get(slideKey(doc, page)) : undefined;
  if (!slide) {
    return { text, source_document_index: null, source_slide_number: null, source_excerpt: null };
  }

  const excerpt = raw.source_excerpt?.trim() ?? "";
  const verbatim = excerpt.length > 0 && squash(slide.text).includes(squash(excerpt));

  return {
    text,
    source_document_index: slide.documentIndex,
    source_slide_number: slide.slideNumber,
    source_excerpt: verbatim ? excerpt : null,
  };
}

function sentences(raw: RawSentence[] | undefined, slides: Map<string, PrimerSlide>) {
  return (raw ?? [])
    .map((sentence) => normaliseSentence(sentence, slides))
    .filter((sentence): sentence is CitedSentence => sentence !== null);
}

export class PrimerError extends Error {}

/**
 * Writes the Primer for one depth, replacing any earlier one at that depth.
 *
 * The replacement happens only once the new one is in hand, so a failed call
 * leaves the student with the guide they had.
 */
export async function generatePrimer(
  db: Db,
  llm: LlmProvider,
  examId: string,
  depth: PrimerDepth,
): Promise<string> {
  const slides = loadPrimerSlides(db, examId);
  const sourceText = primerSourceText(slides);
  if (!sourceText) {
    throw new PrimerError("Upload lecture slides first: there is nothing to explain yet.");
  }

  const { data } = await llm.generateStructured<PrimerResponse>({
    feature: "primer",
    system: PRIMER_SYSTEM,
    prompt: primerPrompt(depth, sourceText),
    schema: PRIMER_SCHEMA,
    temperature: 0.3,
    thinking: "minimal",
  });

  const bySlide = new Map(slides.map((slide) => [slideKey(slide.documentIndex, slide.slideNumber), slide]));
  const concepts = (data.concepts ?? [])
    .map((concept) => ({
      conceptName: concept.conceptName?.trim() ?? "",
      definition: sentences(concept.definition, bySlide),
      breakdown: sentences(concept.breakdown, bySlide),
      example: sentences(concept.example, bySlide),
    }))
    .filter((concept) => concept.conceptName && concept.definition.length > 0);

  if (concepts.length === 0) {
    throw new PrimerError("The model returned no usable concepts. Try again.");
  }

  return db.transaction((tx) => {
    tx.delete(primerGuides)
      .where(and(eq(primerGuides.examId, examId), eq(primerGuides.depth, depth)))
      .run();
    const guide = tx
      .insert(primerGuides)
      .values({ examId, depth, model: llm.model })
      .returning()
      .get();
    tx.insert(primerSections)
      .values(concepts.map((concept, orderIndex) => ({ guideId: guide.id, orderIndex, ...concept })))
      .run();
    return guide.id;
  });
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                  */
/* ------------------------------------------------------------------------ */

/** Where a citation's callout finds its slide picture. */
export type CitationSlide = { slideId: string; hasImage: boolean };

export type PrimerView = {
  guide: { id: string; depth: PrimerDepth; model: string | null; createdAt: string };
  sections: PrimerSection[];
  /** Keyed by `slideKey`, only for slides some sentence cites. */
  slides: Record<string, CitationSlide>;
};

export function getPrimer(db: Db, examId: string, depth: PrimerDepth): PrimerView | null {
  const guide = db
    .select()
    .from(primerGuides)
    .where(and(eq(primerGuides.examId, examId), eq(primerGuides.depth, depth)))
    .get();
  if (!guide) return null;

  const sections = db
    .select()
    .from(primerSections)
    .where(eq(primerSections.guideId, guide.id))
    .orderBy(asc(primerSections.orderIndex))
    .all();

  const cited = new Set(
    sections
      .flatMap((section) => [...section.definition, ...section.breakdown, ...section.example])
      .filter((s) => s.source_document_index !== null && s.source_slide_number !== null)
      .map((s) => slideKey(s.source_document_index!, s.source_slide_number!)),
  );
  const slides: Record<string, CitationSlide> = {};
  for (const slide of loadPrimerSlides(db, examId)) {
    const key = slideKey(slide.documentIndex, slide.slideNumber);
    if (cited.has(key)) slides[key] = { slideId: slide.id, hasImage: slide.hasImage };
  }

  return {
    guide: { id: guide.id, depth: guide.depth, model: guide.model, createdAt: guide.createdAt },
    sections,
    slides,
  };
}

/** Which depths already have a guide, so the selector can say so. */
export function primerDepthsWritten(db: Db, examId: string): PrimerDepth[] {
  return db
    .select({ depth: primerGuides.depth })
    .from(primerGuides)
    .where(eq(primerGuides.examId, examId))
    .all()
    .map((row) => row.depth);
}

/* ------------------------------------------------------------------------ */
/* Counter-examples                                                         */
/* ------------------------------------------------------------------------ */

export const COUNTER_EXAMPLE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    misconception: {
      type: "string",
      description: "A belief a student plausibly holds about this concept that is wrong.",
    },
    incorrectApplication: {
      type: "string",
      description: "A concrete case where someone applies the concept wrongly because of it.",
    },
    whyFlawed: {
      type: "string",
      description: "Why that reasoning fails, tied to the concept's actual mechanism.",
    },
  },
  required: ["misconception", "incorrectApplication", "whyFlawed"],
  additionalProperties: false,
};

export const COUNTER_EXAMPLE_SYSTEM = `You show a student what a concept is NOT.

Give the single most common misconception about it — reversed direction
(increase vs. decrease) and mechanism mix-ups first — then a concrete case of
applying the concept wrongly because of that misconception, then why it is
wrong, tied to how the concept actually works. Keep each part to two or three
sentences. Never contradict the explanation you are given.`;

export function counterExamplePrompt(section: Pick<PrimerSection, "conceptName" | "definition" | "breakdown" | "example">): string {
  const join = (list: CitedSentence[]) => list.map((s) => s.text).join(" ");
  return [
    `CONCEPT: ${section.conceptName}`,
    `DEFINITION: ${join(section.definition)}`,
    `HOW IT WORKS: ${join(section.breakdown)}`,
    `EXAMPLE: ${join(section.example)}`,
  ].join("\n");
}

/**
 * A section's counter-example, written the first time anyone asks.
 *
 * `llm` is a factory so a cached answer never needs a key, and never counts
 * as a model call. Returns null when the section no longer exists.
 */
export async function counterExample(
  db: Db,
  llm: () => LlmProvider,
  sectionId: string,
): Promise<{ counterExample: CounterExample; cached: boolean } | null> {
  const section = db.select().from(primerSections).where(eq(primerSections.id, sectionId)).get();
  if (!section) return null;
  if (section.counterExample) return { counterExample: section.counterExample, cached: true };

  const { data } = await llm().generateStructured<CounterExample>({
    feature: "counter_example",
    system: COUNTER_EXAMPLE_SYSTEM,
    prompt: counterExamplePrompt(section),
    schema: COUNTER_EXAMPLE_SCHEMA,
    temperature: 0.4,
    thinking: "minimal",
  });

  const result: CounterExample = {
    misconception: data.misconception?.trim() ?? "",
    incorrectApplication: data.incorrectApplication?.trim() ?? "",
    whyFlawed: data.whyFlawed?.trim() ?? "",
  };
  if (!result.misconception || !result.whyFlawed) {
    throw new PrimerError("The model's counter-example was incomplete. Try again.");
  }

  db.update(primerSections)
    .set({ counterExample: result, counterExampleAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(primerSections.id, sectionId))
    .run();

  return { counterExample: result, cached: false };
}
