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
  primerTopics,
  sourceFiles,
  sourceSlides,
  type PrimerDepth,
  type PrimerFormat,
  type PrimerSection,
  type PrimerTopic,
} from "@/db/schema";
import type { JsonSchema, LlmProvider } from "@/lib/llm";

import {
  cleanCalculations,
  cleanGivens,
  exampleView,
  type CalculationStep,
  type CitedSentence,
  type CounterExample,
  type ExtraExample,
  type NumberGiven,
} from "./types";
import { TOPIC_CAP } from "./formats";
import { SKIP_LOGISTICS_RULE } from "@/lib/logistics";

export type { CitedSentence, CounterExample } from "./types";
export {
  PRIMER_DEPTHS,
  PRIMER_FORMATS,
  TOPIC_CAP,
  isPrimerDepth,
  isPrimerFormat,
} from "./formats";

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

/**
 * Slides per request. A study guide is written a stretch of lecture at a time:
 * asked to explain a whole deck in one reply, a model names the few concepts
 * it has room for and leaves the rest out — 3 concepts for a deck that made
 * 499 flashcards. Ten slides is a stretch it can cover sentence by sentence.
 */
export const PRIMER_BATCH_SLIDES = 10;
/** A batch also stops growing past this much text, for text-heavy pages. */
export const PRIMER_BATCH_CHARS = 24_000;
/** Requests in flight at once. */
export const PRIMER_CONCURRENCY = 4;
/**
 * Slides with less text than this are titles, agendas and section dividers:
 * nothing to explain, so their going uncited is not a gap.
 */
export const MIN_TEACHABLE_CHARS = 60;

function slideBlock(slide: PrimerSlide): string {
  return `[S${slide.documentIndex}.${slide.slideNumber}]\n${slide.text}`;
}

export function primerSourceText(slides: PrimerSlide[]): string {
  return slides.filter((slide) => slide.text).map(slideBlock).join("\n\n");
}

/** Splits the slides with text into runs in lecture order, each small enough to cover fully. */
export function primerBatches(
  slides: PrimerSlide[],
  size: number = PRIMER_BATCH_SLIDES,
  maxChars: number = PRIMER_BATCH_CHARS,
): PrimerSlide[][] {
  const batches: PrimerSlide[][] = [];
  let current: PrimerSlide[] = [];
  let chars = 0;
  for (const slide of slides) {
    if (!slide.text) continue;
    const length = slideBlock(slide).length;
    if (current.length > 0 && (current.length >= size || chars + length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(slide);
    chars += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
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

/** A sentence with a heading of its own: a question, or what it is set against. */
const LABELLED = (description: string, label: string): JsonSchema => ({
  type: "array",
  description,
  items: {
    ...SENTENCE_SCHEMA,
    properties: {
      label: { type: "string", description: label },
      ...(SENTENCE_SCHEMA.properties as Record<string, JsonSchema>),
    },
    required: ["label", ...(SENTENCE_SCHEMA.required as string[])],
  },
});

/** What each format asks for in place of "how it works". */
const BREAKDOWN: Record<PrimerFormat, JsonSchema> = {
  explained: SENTENCES("How it works and why: the mechanism and the causes."),
  bullets: SENTENCES(
    "The facts a student must know about it, one fact per item, each short enough to be a bullet point.",
  ),
  qa: LABELLED(
    "Self-test questions on it. The label is the question; the text is its answer.",
    "A question a student could be asked about this concept on the exam.",
  ),
  compare: LABELLED(
    "How it differs from the ideas it is most often confused with. The label names the other idea; the text says the difference.",
    "The other idea, in a few words, e.g. \"vs. Inflation\".",
  ),
};

const GIVENS: JsonSchema = {
  type: "array",
  description:
    "Every number this concept states, in the definition, breakdown or example, each with what it is. Empty when it states none.",
  items: {
    type: "object",
    properties: {
      label: { type: "string", description: "What the number is, e.g. \"Revenue\"." },
      value: { type: "string", description: "The number with its unit, e.g. \"$50,000\"." },
    },
    required: ["label", "value"],
    additionalProperties: false,
  },
};

const CALCULATIONS: JsonSchema = {
  type: "array",
  description:
    "Every step of the example's working, in order, none skipped. Empty when the example works nothing out.",
  items: {
    type: "object",
    properties: {
      label: { type: "string", description: "What this step finds, e.g. \"Gross profit\"." },
      expression: {
        type: "string",
        description: "The working with the numbers filled in, e.g. \"$50,000 − $30,000\".",
      },
      result: { type: "string", description: "The value it comes to, with units." },
    },
    required: ["label", "expression", "result"],
    additionalProperties: false,
  },
};

/**
 * The response shape for one format. Without examples the example field is
 * left out altogether, so the model spends nothing writing one.
 */
export function primerSchema(format: PrimerFormat = "explained", withExamples = true): JsonSchema {
  return {
    type: "object",
    properties: {
      concepts: {
        type: "array",
        description:
          "Every concept these slides teach, in the order they introduce them. Together they must cover every slide with content.",
        items: {
          type: "object",
          properties: {
            conceptName: { type: "string", description: "A short, specific name for the idea." },
            topic: {
              type: "string",
              description:
                "The broader subject heading of the lecture this concept falls under, 2-5 words, reused word for word by concepts that share it.",
            },
            definition: SENTENCES(
              format === "explained" ? "What it is, in plain language." : "What it is, in one plain sentence.",
            ),
            breakdown: BREAKDOWN[format],
            ...(withExamples
              ? {
                  example: SENTENCES("One specific, concrete example of it in action."),
                  calculations: CALCULATIONS,
                }
              : {}),
            givens: GIVENS,
          },
          required: [
            "conceptName",
            "topic",
            "definition",
            "breakdown",
            ...(withExamples ? ["example", "calculations"] : []),
            "givens",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["concepts"],
    additionalProperties: false,
  };
}

export const PRIMER_SCHEMA: JsonSchema = primerSchema();

type RawSentence = {
  label?: string | null;
  text?: string;
  source_document_index?: number | null;
  source_slide_number?: number | null;
  source_excerpt?: string | null;
};

type PrimerResponse = {
  concepts: {
    conceptName: string;
    topic?: string;
    definition: RawSentence[];
    breakdown: RawSentence[];
    example?: RawSentence[];
    givens?: unknown;
    calculations?: unknown;
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

/** How many breakdown items each non-paragraph format asks for, by depth. */
const FORMAT_COUNTS: Record<Exclude<PrimerFormat, "explained">, Record<PrimerDepth, string>> = {
  bullets: { summary: "2 to 3", balanced: "4 to 6", foundational: "6 to 10" },
  qa: { summary: "2", balanced: "3 or 4", foundational: "5 to 8" },
  compare: { summary: "1", balanced: "2 or 3", foundational: "3 to 5" },
};

function formatInstructions(format: PrimerFormat, depth: PrimerDepth): string {
  if (format === "explained") return "";
  const plain =
    depth === "foundational"
      ? " Still define every technical word in everyday language the first time it appears."
      : "";
  const count = FORMAT_COUNTS[format][depth];
  switch (format) {
    case "bullets":
      return `FORMAT: KEY FACTS
Break each concept into the facts a student needs, not a paragraph. The
definition is one plain sentence. The breakdown is ${count} bullet points,
each one fact: a rule, a cause, a number, a condition, a step, a term. Each
bullet is short (under about 20 words) and makes sense read on its own. No
filler, no "it is important to note".${plain}`;
    case "qa":
      return `FORMAT: Q&A SELF-TEST
Break each concept into questions a student could be asked about it. The
definition is one plain sentence. The breakdown is ${count} question-and-answer
pairs: the label is the question, the text is its answer in one or two
sentences. Mix the kinds of question: what it is, why it happens, what
changes when something else changes, and (where the subject has numbers) a
small calculation with the working in the answer.${plain}`;
    case "compare":
      return `FORMAT: COMPARE & CONTRAST
Break each concept down by setting it against the ideas it is most easily
confused with, from this lecture where possible. The definition is one plain
sentence. The breakdown is ${count} contrast${count === "1" ? "" : "s"}: the label names the
other idea ("vs. Fixed costs"), the text says the one difference that tells
them apart and how to spot which is which.${plain}`;
  }
}

export const PRIMER_SYSTEM = `You write one stretch of a study guide for a student about to learn from these lecture slides. Other stretches of the same lecture are written separately and joined afterwards, so explain what is on these slides and nothing else.

Each slide is tagged [SN.M]: slideshow N, slide M.

- Cover EVERYTHING taught on these slides. Every slide with real content must
  be explained by at least one concept; a student who reads only this guide
  must not meet anything in the lecture it left out. Skip only title,
  agenda, "questions?" and reference-list slides.
- One concept per distinct idea: a term, a process, a structure, a rule, a
  comparison, a formula. Do not merge unrelated ideas to save space, and do
  not split one idea across several concepts. Expect roughly one concept for
  every one or two slides of content.
- Keep each concept to its most useful points. A student should not have to
  wade through restated or minor details to find what matters for the exam.
- Cover the concepts in the order the slides introduce them. Never reorder
  alphabetically or by importance.
- Give each concept the broader topic it belongs to, as a short heading. Use
  the same wording for concepts that share a topic.
- For each concept give its name, a plain-language definition, a breakdown of
  how it works and why (mechanism and causality, not a list of facts), and,
  when asked for, one example. Keep the specifics the slides give: numbers,
  names, steps, conditions. If a FORMAT is given below, it decides what the
  breakdown holds.
- Examples are specific, never generic. In a subject built on numbers
  (accounting, finance, economics, statistics, chemistry, physics, maths), use
  real figures and work the calculation through: "Revenue $50,000, cost of
  goods sold $30,000, so gross profit is $20,000 and the margin 40%", not "a
  company earns revenue and has costs". In other subjects name a specific
  case: a named disease, law, event, organism, character or situation, with
  the detail that shows the concept at work. Never put made-up numbers on a
  subject that does not use numbers.
- Never leave out an intermediate calculation. State every number the working
  needs, including values the slides had already worked out, and list every
  step in "calculations" — each step's result is used by a later step or is
  the answer, and no value appears from nowhere. A student who missed the
  class example must be able to follow it from this guide alone.
- "givens" lists every number the concept states, each labelled with what it
  is, so a student can see all of them together.
- Every sentence stands alone as one sentence.
- Cite the slide a sentence rests on with its N and M, and copy a short
  phrase from that slide exactly as written as the excerpt. If a sentence
  goes beyond the slides (an analogy, a bridging explanation), give 0, 0 and
  an empty excerpt rather than a citation it does not deserve.
- Never contradict the slides.`;

export function primerPrompt(
  depth: PrimerDepth,
  sourceText: string,
  context: {
    part?: number;
    parts?: number;
    gapFill?: boolean;
    skipLogistics?: boolean;
    format?: PrimerFormat;
    withExamples?: boolean;
  } = {},
): string {
  const where =
    context.parts && context.parts > 1
      ? `\n\nThis is part ${context.part} of ${context.parts} of the lecture.`
      : "";
  const gap = context.gapFill
    ? context.skipLogistics
      ? "\n\nThese slides were left out of the first pass. Write at least one concept for every one of them that teaches something; one that is only course logistics stays out."
      : "\n\nThese slides were left out of the first pass. Write at least one concept for every one of them."
    : "";
  const logistics = context.skipLogistics ? `\n\n${SKIP_LOGISTICS_RULE}` : "";
  const format = formatInstructions(context.format ?? "explained", depth);
  const examples =
    context.withExamples === false
      ? "\n\nDo not write examples: the student asked for none."
      : "";
  return `${DEPTH_INSTRUCTIONS[depth]}${format ? `\n\n${format}` : ""}${examples}${where}${gap}${logistics}\n\nSLIDES\n${sourceText}`;
}

/* ------------------------------------------------------------------------ */
/* Compiling: topics, order, overview                                       */
/* ------------------------------------------------------------------------ */

export const OUTLINE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    overview: {
      type: "string",
      description:
        "Two to four sentences: what this lecture teaches as a whole, and the route through it.",
    },
    topics: {
      type: "array",
      description: "The chapters of the guide, foundations first.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A short chapter heading." },
          intro: {
            type: "string",
            description:
              "One to three sentences: what this topic covers and how it builds on the topics before it.",
          },
          conceptIds: {
            type: "array",
            description: "The ids of its concepts, in the order to learn them.",
            items: { type: "integer" },
          },
        },
        required: ["title", "intro", "conceptIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["overview", "topics"],
  additionalProperties: false,
};

/** At most this many topics, however long the lecture. */
export const MAX_TOPICS = 12;

export function outlineSystem(cap: number): string {
  return `You organise the concepts of a lecture into the chapters of a study guide.

You get every concept, numbered, with the section heading it came from and its definition.

- Group them into topics a student would recognise as chapters of the course,
  usually 4 to ${MAX_TOPICS} topics, never more than ${MAX_TOPICS}. Fewer for a short lecture.
- A topic holds AT MOST ${cap} concepts. Where a topic has more, keep the ${cap}
  a student most needs for the exam (core definitions, mechanisms, anything
  the lecture stresses) and leave the rest out. Never create extra topics
  just to fit the concepts you left out.
- Order the topics so that anything a topic relies on is taught in an earlier
  topic: foundations and vocabulary first, then the mechanisms built on them,
  then applications, comparisons and exceptions. Where there is no dependency,
  keep the lecture's order.
- Within a topic, order the concepts the same way: each one should only need
  the ones before it.
- A concept id appears in at most one topic. Leave one out only because its
  topic is full, and then leave out the least important.
- The overview says what the lecture is about and how the topics lead into
  one another, for a student who has not seen it yet.`;
}

/** The outline instructions with no cap to speak of, for callers that want every concept kept. */
export const OUTLINE_SYSTEM = outlineSystem(TOPIC_CAP.foundational);

export type OutlineConcept = { conceptName: string; topic: string; summary: string };

export function outlinePrompt(concepts: OutlineConcept[]): string {
  return [
    "CONCEPTS",
    ...concepts.map(
      (concept, i) => `[${i}] ${concept.conceptName} (from: ${concept.topic || "—"}) — ${concept.summary}`,
    ),
  ].join("\n");
}

type OutlineResponse = {
  overview?: string;
  topics?: { title?: string; intro?: string; conceptIds?: number[] }[];
};

export type Outline = {
  overview: string;
  topics: { title: string; intro: string; conceptIds: number[] }[];
};

/**
 * Topics by the section headings the batches gave, in lecture order: the
 * outline to fall back on when the organising call fails.
 */
export function fallbackOutline(concepts: OutlineConcept[], cap = Infinity): Outline {
  const topics: Outline["topics"] = [];
  const byTitle = new Map<string, Outline["topics"][number]>();
  concepts.forEach((concept, i) => {
    const title = concept.topic.trim() || "Key concepts";
    const key = title.toLowerCase();
    let topic = byTitle.get(key);
    if (!topic) {
      topic = { title, intro: "", conceptIds: [] };
      byTitle.set(key, topic);
      topics.push(topic);
    }
    if (topic.conceptIds.length < cap) topic.conceptIds.push(i);
  });
  return { overview: "", topics };
}

/**
 * Makes the model's outline safe to store: each concept at most once, and no
 * topic over `cap`. A concept the model left out goes into the topic that
 * holds the concept just before it in the lecture, right after it — where a
 * reader of the slides would have met it — if that topic has room. With no
 * cap, nothing is lost.
 */
export function completeOutline(
  raw: OutlineResponse,
  concepts: OutlineConcept[],
  cap = Infinity,
): Outline {
  const count = concepts.length;
  const seen = new Set<number>();
  const topics: Outline["topics"] = [];

  for (const topic of raw.topics ?? []) {
    const title = topic.title?.trim();
    const ids: number[] = [];
    for (const id of topic.conceptIds ?? []) {
      if (!Number.isInteger(id) || id < 0 || id >= count || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (!title || ids.length === 0) continue;
    topics.push({ title, intro: topic.intro?.trim() ?? "", conceptIds: ids.slice(0, cap) });
    // A concept cut off here counts as left out: it may still fit elsewhere.
    for (const id of ids.slice(cap)) seen.delete(id);
    if (topics.length >= MAX_TOPICS) break;
  }

  if (topics.length === 0) return fallbackOutline(concepts, cap);

  const placedIds = new Set(topics.flatMap((t) => t.conceptIds));
  for (let id = 0; id < count; id++) {
    if (placedIds.has(id)) continue;
    let home: Outline["topics"][number] | undefined;
    let after = -1;
    for (let before = id - 1; before >= 0; before--) {
      if (!placedIds.has(before)) continue;
      home = topics.find((t) => t.conceptIds.includes(before))!;
      after = before;
      break;
    }
    if (!home) home = topics[0];
    if (home.conceptIds.length >= cap) continue;
    if (after === -1) home.conceptIds.unshift(id);
    else home.conceptIds.splice(home.conceptIds.indexOf(after) + 1, 0, id);
    placedIds.add(id);
  }

  return { overview: raw.overview?.trim() ?? "", topics };
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
  const label = raw.label?.trim();
  const labelled = label ? { label } : {};

  const doc = raw.source_document_index ?? 0;
  const page = raw.source_slide_number ?? 0;
  const slide = doc > 0 && page > 0 ? slides.get(slideKey(doc, page)) : undefined;
  if (!slide) {
    return { text, source_document_index: null, source_slide_number: null, source_excerpt: null, ...labelled };
  }

  const excerpt = raw.source_excerpt?.trim() ?? "";
  const verbatim = excerpt.length > 0 && squash(slide.text).includes(squash(excerpt));

  return {
    text,
    source_document_index: slide.documentIndex,
    source_slide_number: slide.slideNumber,
    source_excerpt: verbatim ? excerpt : null,
    ...labelled,
  };
}

function sentences(raw: RawSentence[] | undefined, slides: Map<string, PrimerSlide>) {
  return (raw ?? [])
    .map((sentence) => normaliseSentence(sentence, slides))
    .filter((sentence): sentence is CitedSentence => sentence !== null);
}

export class PrimerError extends Error {}

export type PrimerProgress = {
  stage: "explaining" | "filling_gaps" | "organising" | "saving";
  /** Requests finished and planned; `total` grows if gaps need a second pass. */
  done: number;
  total: number;
};

type Concept = {
  conceptName: string;
  topic: string;
  definition: CitedSentence[];
  breakdown: CitedSentence[];
  example: CitedSentence[];
  givens?: NumberGiven[];
  calculations?: CalculationStep[];
};

async function inPool<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function citedKeys(concepts: Concept[]): Set<string> {
  return new Set(
    concepts
      .flatMap((c) => [...c.definition, ...c.breakdown, ...c.example])
      .filter((s) => s.source_document_index !== null && s.source_slide_number !== null)
      .map((s) => slideKey(s.source_document_index!, s.source_slide_number!)),
  );
}

/** Slides with something to teach that no sentence cites yet. */
export function uncoveredSlides(slides: PrimerSlide[], cited: Set<string>): PrimerSlide[] {
  return slides.filter(
    (slide) =>
      slide.text.length >= MIN_TEACHABLE_CHARS &&
      !cited.has(slideKey(slide.documentIndex, slide.slideNumber)),
  );
}

function nameKey(name: string): string {
  return squash(name).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Joins concepts two batches both explained — a slide run often ends and the
 * next begins on the same idea. Their sentences are kept, not chosen between,
 * so nothing either batch said is lost.
 */
export function mergeConcepts(concepts: Concept[]): Concept[] {
  const merged: Concept[] = [];
  const byName = new Map<string, Concept>();
  for (const concept of concepts) {
    const key = nameKey(concept.conceptName);
    const existing = byName.get(key);
    if (!existing) {
      const copy = { ...concept };
      byName.set(key, copy);
      merged.push(copy);
      continue;
    }
    const known = new Set(
      [...existing.definition, ...existing.breakdown, ...existing.example].map((s) => squash(s.text)),
    );
    const fresh = (list: CitedSentence[]) => list.filter((s) => !known.has(squash(s.text)));
    existing.definition = [...existing.definition, ...fresh(concept.definition)];
    existing.breakdown = [...existing.breakdown, ...fresh(concept.breakdown)];
    existing.example = [...existing.example, ...fresh(concept.example)];
    const seenGivens = new Set((existing.givens ?? []).map((g) => squash(`${g.label} ${g.value}`)));
    existing.givens = [
      ...(existing.givens ?? []),
      ...(concept.givens ?? []).filter((g) => !seenGivens.has(squash(`${g.label} ${g.value}`))),
    ];
    // Two workings of different examples do not interleave; keep the first.
    if (!existing.calculations?.length) existing.calculations = concept.calculations;
  }
  return merged;
}

/**
 * Writes the Primer for one depth and format, replacing any earlier one of
 * the same kind.
 *
 * Three passes. The slides are explained a batch at a time, so the guide
 * covers the whole lecture instead of the few ideas one reply has room for.
 * Any slide with content that no sentence cites is sent again on its own.
 * Then one call arranges every concept into topics, foundations first, and
 * `completeOutline` puts back any concept that call forgot.
 *
 * The replacement happens only once the new one is in hand, so a failed call
 * leaves the student with the guide they had.
 */
export async function generatePrimer(
  db: Db,
  llm: LlmProvider,
  examId: string,
  depth: PrimerDepth,
  options: {
    batchSize?: number;
    concurrency?: number;
    /** Leave announcements and course admin out. Default on. */
    skipLogistics?: boolean;
    /** How each concept is broken down. Default "explained". */
    format?: PrimerFormat;
    /** Write an example for every concept. Default on. */
    withExamples?: boolean;
    onProgress?: (progress: PrimerProgress) => void;
  } = {},
): Promise<string> {
  const skipLogistics = options.skipLogistics !== false;
  const format = options.format ?? "explained";
  const withExamples = options.withExamples !== false;
  const cap = TOPIC_CAP[depth];
  const schema = primerSchema(format, withExamples);
  const slides = loadPrimerSlides(db, examId);
  const batches = primerBatches(slides, options.batchSize ?? PRIMER_BATCH_SLIDES);
  if (batches.length === 0) {
    throw new PrimerError("Upload lecture slides first: there is nothing to explain yet.");
  }

  const bySlide = new Map(slides.map((slide) => [slideKey(slide.documentIndex, slide.slideNumber), slide]));
  const concurrency = options.concurrency ?? PRIMER_CONCURRENCY;
  let total = batches.length + 1;
  let done = 0;
  const report = (stage: PrimerProgress["stage"]) =>
    options.onProgress?.({ stage, done, total });
  report("explaining");

  const explain = async (batch: PrimerSlide[], context: Parameters<typeof primerPrompt>[2]) => {
    const { data } = await llm.generateStructured<PrimerResponse>({
      feature: "primer",
      system: PRIMER_SYSTEM,
      prompt: primerPrompt(depth, primerSourceText(batch), {
        ...context,
        skipLogistics,
        format,
        withExamples,
      }),
      schema,
      temperature: 0.3,
      thinking: "minimal",
    });
    return (data.concepts ?? [])
      .map((concept): Concept => ({
        conceptName: concept.conceptName?.trim() ?? "",
        topic: concept.topic?.trim() ?? "",
        definition: sentences(concept.definition, bySlide),
        breakdown: sentences(concept.breakdown, bySlide),
        example: withExamples ? sentences(concept.example, bySlide) : [],
        givens: cleanGivens(concept.givens),
        calculations: withExamples ? cleanCalculations(concept.calculations) : [],
      }))
      .filter((concept) => concept.conceptName && concept.definition.length > 0);
  };

  // A batch that fails is retried once; a second failure fails the run, since
  // a guide with a stretch of lecture missing is the thing this is fixing.
  const attempt = async (batch: PrimerSlide[], context: Parameters<typeof primerPrompt>[2]) => {
    try {
      return await explain(batch, context);
    } catch {
      return explain(batch, context);
    }
  };

  const perBatch = await inPool(batches, concurrency, async (batch, i) => {
    const concepts = await attempt(batch, { part: i + 1, parts: batches.length });
    done++;
    report("explaining");
    return concepts;
  });
  let concepts = perBatch.flat();

  const missed = uncoveredSlides(batches.flat(), citedKeys(concepts));
  if (missed.length > 0) {
    const gapBatches = primerBatches(missed, options.batchSize ?? PRIMER_BATCH_SLIDES);
    total += gapBatches.length;
    report("filling_gaps");
    const filled = await inPool(gapBatches, concurrency, async (batch) => {
      // A gap pass is a bonus: if it fails, the first pass still stands.
      const extra = await attempt(batch, { gapFill: true }).catch(() => []);
      done++;
      report("filling_gaps");
      return extra;
    });
    // Each gap concept goes after the last concept that cites a slide before it.
    concepts = placeInLectureOrder(concepts, filled.flat(), slides);
  }

  concepts = mergeConcepts(concepts);
  if (concepts.length === 0) {
    throw new PrimerError("The model returned no usable concepts. Try again.");
  }

  report("organising");
  const outlineInput: OutlineConcept[] = concepts.map((concept) => ({
    conceptName: concept.conceptName,
    topic: concept.topic,
    summary: concept.definition[0]?.text ?? "",
  }));
  let outline: Outline;
  try {
    const { data } = await llm.generateStructured<OutlineResponse>({
      feature: "primer",
      system: outlineSystem(cap),
      prompt: outlinePrompt(outlineInput),
      schema: OUTLINE_SCHEMA,
      temperature: 0.2,
      thinking: "minimal",
    });
    outline = completeOutline(data, outlineInput, cap);
  } catch {
    // The concepts are the guide; the chapters only arrange them. Better
    // chapters by lecture heading than no guide.
    outline = fallbackOutline(outlineInput, cap);
  }
  done++;
  report("saving");

  return db.transaction((tx) => {
    tx.delete(primerGuides)
      .where(
        and(
          eq(primerGuides.examId, examId),
          eq(primerGuides.depth, depth),
          eq(primerGuides.format, format),
        ),
      )
      .run();
    const guide = tx
      .insert(primerGuides)
      .values({ examId, depth, format, model: llm.model, overview: outline.overview || null })
      .returning()
      .get();
    let orderIndex = 0;
    outline.topics.forEach((topic, topicIndex) => {
      const row = tx
        .insert(primerTopics)
        .values({ guideId: guide.id, orderIndex: topicIndex, title: topic.title, intro: topic.intro })
        .returning()
        .get();
      tx.insert(primerSections)
        .values(
          topic.conceptIds.map((id) => {
            const { conceptName, definition, breakdown, example, givens, calculations } = concepts[id];
            return {
              guideId: guide.id,
              topicId: row.id,
              orderIndex: orderIndex++,
              conceptName,
              definition,
              breakdown,
              example,
              givens: givens?.length ? givens : null,
              calculations: calculations?.length ? calculations : null,
            };
          }),
        )
        .run();
    });
    return guide.id;
  });
}

/** Where a concept sits in the lecture: the earliest slide it cites. */
function firstSlidePosition(concept: Concept, position: Map<string, number>): number {
  let best = Infinity;
  for (const s of [...concept.definition, ...concept.breakdown, ...concept.example]) {
    if (s.source_document_index === null || s.source_slide_number === null) continue;
    const at = position.get(slideKey(s.source_document_index, s.source_slide_number));
    if (at !== undefined && at < best) best = at;
  }
  return best;
}

function placeInLectureOrder(concepts: Concept[], extra: Concept[], slides: PrimerSlide[]): Concept[] {
  const position = new Map(slides.map((slide, i) => [slideKey(slide.documentIndex, slide.slideNumber), i]));
  const result = [...concepts];
  for (const concept of extra) {
    const at = firstSlidePosition(concept, position);
    let insertAt = result.length;
    if (Number.isFinite(at)) {
      const after = result.findIndex((c) => firstSlidePosition(c, position) > at);
      if (after !== -1) insertAt = after;
    }
    result.splice(insertAt, 0, concept);
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                  */
/* ------------------------------------------------------------------------ */

/** Where a citation's callout finds its slide picture. */
export type CitationSlide = { slideId: string; hasImage: boolean };

export type PrimerChapter = {
  /** Null for a guide written before chapters existed: it shows as one run. */
  id: string | null;
  title: string;
  intro: string;
  sections: PrimerSection[];
};

export type PrimerView = {
  guide: {
    id: string;
    depth: PrimerDepth;
    format: PrimerFormat;
    model: string | null;
    createdAt: string;
    overview: string | null;
  };
  /** In teaching order; every section appears in exactly one. */
  chapters: PrimerChapter[];
  sections: PrimerSection[];
  /** Keyed by `slideKey`, only for slides some sentence cites. */
  slides: Record<string, CitationSlide>;
};

export function getPrimer(
  db: Db,
  examId: string,
  depth: PrimerDepth,
  format: PrimerFormat = "explained",
): PrimerView | null {
  const guide = db
    .select()
    .from(primerGuides)
    .where(
      and(
        eq(primerGuides.examId, examId),
        eq(primerGuides.depth, depth),
        eq(primerGuides.format, format),
      ),
    )
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

  const topics: PrimerTopic[] = db
    .select()
    .from(primerTopics)
    .where(eq(primerTopics.guideId, guide.id))
    .orderBy(asc(primerTopics.orderIndex))
    .all();
  const chapters: PrimerChapter[] = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    intro: topic.intro,
    sections: sections.filter((section) => section.topicId === topic.id),
  }));
  const loose = sections.filter(
    (section) => !section.topicId || !topics.some((topic) => topic.id === section.topicId),
  );
  if (loose.length > 0) {
    chapters.push({ id: null, title: chapters.length ? "More concepts" : "Concepts", intro: "", sections: loose });
  }

  return {
    guide: {
      id: guide.id,
      depth: guide.depth,
      format: guide.format,
      model: guide.model,
      createdAt: guide.createdAt,
      overview: guide.overview,
    },
    chapters: chapters.filter((chapter) => chapter.sections.length > 0),
    sections,
    slides,
  };
}

/** Which depth and format pairs already have a guide, so the selector can say so. */
export function primerGuidesWritten(
  db: Db,
  examId: string,
): { depth: PrimerDepth; format: PrimerFormat }[] {
  return db
    .select({ depth: primerGuides.depth, format: primerGuides.format })
    .from(primerGuides)
    .where(eq(primerGuides.examId, examId))
    .all();
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

/** Sentences as one run of prose, each labelled one prefixed with its label. */
function joinSentences(list: CitedSentence[]): string {
  return list.map((s) => (s.label ? `${s.label} ${s.text}` : s.text)).join(" ");
}

export function counterExamplePrompt(section: Pick<PrimerSection, "conceptName" | "definition" | "breakdown" | "example">): string {
  const join = joinSentences;
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

/* ------------------------------------------------------------------------ */
/* More examples                                                            */
/* ------------------------------------------------------------------------ */

/** Past this, the student has plenty; the button says so instead of paying again. */
export const MAX_EXTRA_EXAMPLES = 5;

export const EXAMPLE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    example: {
      type: "string",
      description:
        "One new specific, concrete example of the concept in action, as a short paragraph of 2-4 sentences.",
    },
    calculations: {
      type: "array",
      description:
        "Every calculation behind the numbers in the example, in the order they are worked out, including any value the example states without showing how it was found. Empty when the example has no numbers worked out.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "What this step finds, e.g. \"Gross profit\"." },
          expression: {
            type: "string",
            description: "The working with the numbers filled in, e.g. \"$50,000 − $30,000\".",
          },
          result: { type: "string", description: "The value with units, e.g. \"$20,000\"." },
        },
        required: ["label", "expression", "result"],
        additionalProperties: false,
      },
    },
  },
  required: ["example", "calculations"],
  additionalProperties: false,
};

export const EXAMPLE_SYSTEM = `You give a student one more concrete example of a concept from their lecture.

- Make it clearly different from every example they have already seen: a
  different setting, different numbers, or a different angle on the mechanism.
- Walk through it so the concept's mechanism is visible, in 2-4 plain
  sentences.
- Be specific, never generic. In a subject built on numbers (accounting,
  finance, economics, statistics, chemistry, physics, maths), use real
  figures and work the calculation through. In other subjects name a specific
  case (a named disease, law, event, organism, character or situation) with
  the detail that shows the concept at work. Never put made-up numbers on a
  subject that does not use numbers.
- When the example works numbers through, list every calculation in
  "calculations", in order, so no value appears from nowhere: each step's
  label, the expression with the numbers filled in, and the result. Every
  number in the example that was calculated must match a step's result, and
  each step must be arithmetically correct. When there are no numbers to work
  out, leave "calculations" empty.
- Never contradict the explanation you are given.`;

export function examplePrompt(
  section: Pick<PrimerSection, "conceptName" | "definition" | "breakdown" | "example">,
  seen: ExtraExample[],
): string {
  const join = joinSentences;
  const already = [join(section.example), ...seen.map((e) => exampleView(e).text)].filter(Boolean);
  return [
    `CONCEPT: ${section.conceptName}`,
    `DEFINITION: ${join(section.definition)}`,
    `HOW IT WORKS: ${join(section.breakdown)}`,
    already.length
      ? `EXAMPLES ALREADY SHOWN (do not repeat):\n${already.map((e, i) => `${i + 1}. ${e}`).join("\n")}`
      : "No example has been shown yet.",
  ].join("\n");
}

/** Writes one more example for a section and keeps it. Null when the section is gone. */
export async function anotherExample(
  db: Db,
  llm: () => LlmProvider,
  sectionId: string,
): Promise<{ examples: ExtraExample[] } | null> {
  const section = db.select().from(primerSections).where(eq(primerSections.id, sectionId)).get();
  if (!section) return null;
  const seen = section.extraExamples ?? [];
  if (seen.length >= MAX_EXTRA_EXAMPLES) return { examples: seen };

  const { data } = await llm().generateStructured<{
    example: string;
    calculations?: CalculationStep[];
  }>({
    feature: "primer_example",
    system: EXAMPLE_SYSTEM,
    prompt: examplePrompt(section, seen),
    schema: EXAMPLE_SCHEMA,
    temperature: 0.7,
    thinking: "minimal",
  });

  const example = data.example?.trim();
  if (!example) throw new PrimerError("The model did not write an example. Try again.");

  const calculations = (data.calculations ?? [])
    .filter((step) => step && typeof step.expression === "string" && step.expression.trim())
    .map((step) => ({
      label: String(step.label ?? "").trim(),
      expression: step.expression.trim(),
      result: String(step.result ?? "").trim(),
    }));

  const examples: ExtraExample[] = [
    ...seen,
    calculations.length ? { text: example, calculations } : example,
  ];
  db.update(primerSections).set({ extraExamples: examples }).where(eq(primerSections.id, sectionId)).run();
  return { examples };
}
