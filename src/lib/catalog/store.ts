/**
 * The shared deck catalog, by college, professor, course and exam.
 *
 * Listings live on the app's server (workers/licensing/src/catalog.ts), which
 * checks every share with a content model before it's listed and limits how
 * often anyone can share. A shared deck is a snapshot of its cards and study
 * guide (no slides or slide citations, which are the professor's material),
 * and adding one copies that snapshot into a new deck of the student's own.
 * Nothing is listed until the student shares it, and only the install that
 * shared a listing can change or remove it.
 */
import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { serverUrl } from "@/lib/app-info";
import { readSetting, writeSetting } from "@/lib/settings";
import { installId } from "@/lib/telemetry";
import {
  cardRubrics,
  courses,
  exams,
  flashcards,
  primerGuides,
  primerSections,
  primerTopics,
} from "@/db/schema";
import type { CitedSentence } from "@/lib/primer/types";

import type { CatalogDeck, CatalogDeckDetail, CatalogKind, PublishInput } from "./types";

type CardSnapshot = {
  topic: string | null;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: string;
  sourceExcerpt: string | null;
  essentialPoints: string[];
};

type GuideSnapshot = {
  overview: string | null;
  topics: { title: string; intro: string; sections: SectionSnapshot[] }[];
};

type SectionSnapshot = {
  conceptName: string;
  definition: string[];
  breakdown: string[];
  example: string[];
};

export class CatalogError extends Error {}

const OFFLINE = "Can't reach the catalog right now. Check your connection and try again.";

/** Calls the catalog server as this install; throws CatalogError with its message. */
async function remote<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = serverUrl();
  if (!base) throw new CatalogError("The catalog isn't available in this build.");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      // Sharing waits on the content check, so it gets longer than a read.
      signal: AbortSignal.timeout(init.method && init.method !== "GET" ? 45_000 : 10_000),
      headers: { "Content-Type": "application/json", "X-Install-Id": installId(db), ...init.headers },
    });
  } catch {
    throw new CatalogError(OFFLINE);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new CatalogError(body?.error ?? (response.status >= 500 ? OFFLINE : "The catalog couldn't do that."));
  }
  return body;
}

/** Everything listed, plus this install's own hidden listings; `offline` says why when the server can't be reached. */
export async function listCatalog(): Promise<{ decks: CatalogDeck[]; offline: string | null }> {
  try {
    const { decks } = await remote<{ decks: CatalogDeck[] }>("/catalog");
    return { decks, offline: null };
  } catch (error) {
    if (error instanceof CatalogError) return { decks: [], offline: error.message };
    throw error;
  }
}

export async function getCatalogDeck(id: string): Promise<CatalogDeckDetail> {
  return remote<CatalogDeckDetail>(`/catalog/${encodeURIComponent(id)}`);
}

/** The student's own decks, to pick one to publish. */
export function listOwnDecks() {
  return db
    .select({ examId: exams.id, examTitle: exams.title, courseTitle: courses.title, term: courses.term })
    .from(exams)
    .innerJoin(courses, eq(courses.id, exams.courseId))
    .orderBy(asc(courses.title), asc(exams.title))
    .all();
}

function snapshotCards(examId: string): CardSnapshot[] {
  const rows = db
    .select({
      topic: flashcards.topic,
      question: flashcards.question,
      directAnswer: flashcards.directAnswer,
      fullExplanation: flashcards.fullExplanation,
      cardType: flashcards.cardType,
      sourceExcerpt: flashcards.sourceExcerpt,
      excluded: flashcards.excluded,
      essentialPoints: cardRubrics.essentialPoints,
    })
    .from(flashcards)
    .leftJoin(cardRubrics, eq(cardRubrics.flashcardId, flashcards.id))
    .where(eq(flashcards.examId, examId))
    .orderBy(
      asc(flashcards.sourceDocumentIndex),
      asc(flashcards.sourcePageNumber),
      asc(flashcards.documentOrderIndex),
    )
    .all();
  return rows
    .filter((r) => !r.excluded)
    .map((r) => ({
      topic: r.topic,
      question: r.question,
      directAnswer: r.directAnswer,
      fullExplanation: r.fullExplanation,
      cardType: r.cardType,
      sourceExcerpt: r.sourceExcerpt,
      essentialPoints: r.essentialPoints ?? [],
    }));
}

const texts = (sentences: CitedSentence[] | null) => (sentences ?? []).map((s) => s.text);

/** The fullest guide the deck has: the one with the most sections. */
function snapshotGuide(examId: string): GuideSnapshot | null {
  const guides = db.select().from(primerGuides).where(eq(primerGuides.examId, examId)).all();
  let best: { guide: (typeof guides)[number]; count: number } | null = null;
  for (const guide of guides) {
    const count = db
      .select({ id: primerSections.id })
      .from(primerSections)
      .where(eq(primerSections.guideId, guide.id))
      .all().length;
    if (count > 0 && (!best || count > best.count)) best = { guide, count };
  }
  if (!best) return null;

  const topics = db
    .select()
    .from(primerTopics)
    .where(eq(primerTopics.guideId, best.guide.id))
    .orderBy(asc(primerTopics.orderIndex))
    .all();
  const sections = db
    .select()
    .from(primerSections)
    .where(eq(primerSections.guideId, best.guide.id))
    .orderBy(asc(primerSections.orderIndex))
    .all();

  const toSection = (s: (typeof sections)[number]): SectionSnapshot => ({
    conceptName: s.conceptName,
    definition: texts(s.definition),
    breakdown: texts(s.breakdown),
    example: texts(s.example),
  });

  const grouped = topics.map((t) => ({
    title: t.title,
    intro: t.intro,
    sections: sections.filter((s) => s.topicId === t.id).map(toSection),
  }));
  const loose = sections.filter((s) => !s.topicId || !topics.some((t) => t.id === s.topicId));
  if (loose.length > 0) grouped.push({ title: "Concepts", intro: "", sections: loose.map(toSection) });

  return { overview: best.guide.overview, topics: grouped.filter((t) => t.sections.length > 0) };
}

const KINDS: CatalogKind[] = ["exam", "quiz", "test", "module", "assignment", "custom"];

type Details = Pick<PublishInput, "title" | "college" | "professor" | "course" | "kind" | "customKind" | "term" | "description">;

const clean = (s: string | null | undefined) => s?.trim() || null;

/** Catches missing fields here, before anything is sent. */
function checkDetails(input: Details) {
  if (!clean(input.college)) throw new CatalogError("Enter the college.");
  if (!clean(input.professor)) throw new CatalogError("Enter the professor.");
  if (!clean(input.course)) throw new CatalogError("Enter the course.");
  if (!clean(input.title)) throw new CatalogError("Give the deck a title.");
  if (!KINDS.includes(input.kind)) throw new CatalogError("Pick what the deck is for.");
  if (input.kind === "custom" && !clean(input.customKind)) throw new CatalogError("Name the custom type.");
}

const detailsBody = (fields: Details) => ({
  title: clean(fields.title),
  college: clean(fields.college),
  professor: clean(fields.professor),
  course: clean(fields.course),
  kind: fields.kind,
  customKind: fields.kind === "custom" ? clean(fields.customKind) : null,
  term: clean(fields.term),
  description: clean(fields.description),
});

export async function publishDeck(input: PublishInput): Promise<CatalogDeck> {
  checkDetails(input);
  const cards = snapshotCards(input.examId);
  if (cards.length === 0) throw new CatalogError("That deck has no cards to share.");
  const guide = input.includeGuide ? snapshotGuide(input.examId) : null;
  return remote<CatalogDeck>("/catalog", {
    method: "POST",
    body: JSON.stringify({
      ...detailsBody(input),
      uploader: clean(input.uploader) ?? "A student",
      sourceExamId: input.examId,
      cards,
      guide,
    }),
  });
}

export async function updateListing(id: string, fields: Details): Promise<CatalogDeck> {
  checkDetails(fields);
  return remote<CatalogDeck>(`/catalog/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(detailsBody(fields)),
  });
}

export async function removeListing(id: string) {
  await remote(`/catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function reportListing(id: string, reason: string | null) {
  await remote(`/catalog/${encodeURIComponent(id)}/report`, {
    method: "POST",
    body: JSON.stringify({ reason: clean(reason) }),
  });
}

const COLLEGE_SETTING = "catalog_college";

/** The student's current college, asked for the first time the catalog opens. */
export function readCollege(): string | null {
  return readSetting(COLLEGE_SETTING)?.trim() || null;
}

export function writeCollege(college: string): string {
  const value = college.trim().replace(/\s+/g, " ");
  if (!value) throw new CatalogError("Enter your college.");
  if (value.length > 120) throw new CatalogError("That college name is too long.");
  writeSetting(COLLEGE_SETTING, value);
  return value;
}

/** Copies a shared deck into a new deck of the student's own; returns its exam id. */
export async function addToMyDecks(id: string): Promise<string> {
  const row = await remote<{
    title: string;
    course: string;
    term: string | null;
    cards: CardSnapshot[];
    guide: GuideSnapshot | null;
  }>(`/catalog/${encodeURIComponent(id)}/add`, { method: "POST" });
  const { cards, guide } = row;
  if (cards.length === 0) throw new CatalogError("That deck has no cards.");
  const cite = (text: string): CitedSentence => ({
    text,
    source_document_index: null,
    source_slide_number: null,
    source_excerpt: null,
  });

  const examId = db.transaction((tx) => {
    const course =
      tx.select().from(courses).where(eq(courses.title, row.course)).get() ??
      tx.insert(courses).values({ title: row.course, term: row.term }).returning().get();
    const exam = tx
      .insert(exams)
      .values({ courseId: course.id, title: row.title })
      .returning()
      .get();

    for (const card of cards) {
      const inserted = tx
        .insert(flashcards)
        .values({
          examId: exam.id,
          topic: card.topic,
          question: card.question,
          directAnswer: card.directAnswer,
          fullExplanation: card.fullExplanation,
          cardType: card.cardType as (typeof flashcards.$inferInsert)["cardType"],
          sourceExcerpt: card.sourceExcerpt,
        })
        .returning({ id: flashcards.id })
        .get();
      tx.insert(cardRubrics)
        .values({
          flashcardId: inserted.id,
          essentialPoints: card.essentialPoints.length > 0 ? card.essentialPoints : [card.directAnswer],
        })
        .run();
    }

    if (guide) {
      const created = tx
        .insert(primerGuides)
        .values({ examId: exam.id, depth: "balanced", format: "explained", model: "catalog", overview: guide.overview })
        .returning()
        .get();
      let order = 0;
      guide.topics.forEach((topic, topicIndex) => {
        const t = tx
          .insert(primerTopics)
          .values({ guideId: created.id, orderIndex: topicIndex, title: topic.title, intro: topic.intro })
          .returning()
          .get();
        for (const s of topic.sections) {
          tx.insert(primerSections)
            .values({
              guideId: created.id,
              topicId: t.id,
              orderIndex: order++,
              conceptName: s.conceptName,
              definition: s.definition.map(cite),
              breakdown: s.breakdown.map(cite),
              example: s.example.map(cite),
            })
            .run();
        }
      });
    }
    return exam.id;
  });

  return examId;
}
