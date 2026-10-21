/**
 * `.meganstudy` — a deck one student hands to another.
 *
 * Plain JSON: the cards, and the study guide only when the sender asks for it.
 * Nothing of the sender's own goes in it — no review history, no ids, no
 * source files, no slide images — so opening one always makes a fresh deck
 * that starts at "new", and never touches a deck the receiver already has.
 *
 * A file comes from anywhere, so reading one checks every field and caps
 * sizes before anything reaches the database.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/db/client";
import { courses, exams } from "@/db/schema";
import { insertDeck, type DeckCard, type DeckGuide, type DeckSection } from "@/lib/decks/insert";
import { snapshotCards, snapshotGuide } from "@/lib/decks/snapshot";
import { fileSlug } from "@/lib/export/slug";

export const SHARE_FORMAT = "meganstudy";
/** Bumped when the shape changes; a newer file is refused rather than misread. */
export const SHARE_VERSION = 1;
export const SHARE_EXTENSION = ".meganstudy";
export const SHARE_MIME = "application/vnd.meganstudy+json";
/** Recorded as the imported guide's model. */
export const SHARE_ORIGIN = "meganstudy";

/** Larger than any real deck, small enough that a bad file can't stall the app. */
export const SHARE_MAX_BYTES = 10 * 1024 * 1024;
export const SHARE_MAX_CARDS = 5000;
const MAX_TEXT = 20_000;
const MAX_LIST = 50;
const MAX_TOPICS = 200;
const MAX_SECTIONS = 100;

export type ShareFile = {
  format: typeof SHARE_FORMAT;
  version: number;
  exportedAt: string;
  deck: {
    title: string;
    course: string;
    term: string | null;
    cards: DeckCard[];
    guide: DeckGuide | null;
  };
};

export class ShareFileError extends Error {}

/** The share file for a deck, or null when there is no such deck. */
export function buildShareFile(
  db: Db,
  examId: string,
  options: { includeGuide?: boolean } = {},
  now = new Date(),
): ShareFile | null {
  const exam = db.select().from(exams).where(eq(exams.id, examId)).get();
  if (!exam) return null;
  const course = db.select().from(courses).where(eq(courses.id, exam.courseId)).get();

  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now.toISOString(),
    deck: {
      title: exam.title,
      course: course?.title ?? "Shared decks",
      term: course?.term ?? null,
      cards: snapshotCards(db, examId),
      guide: options.includeGuide ? snapshotGuide(db, examId) : null,
    },
  };
}

export function shareFilename(title: string): string {
  return `${fileSlug(title, "deck")}${SHARE_EXTENSION}`;
}

// ── Reading ─────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, where: string, { optional = false, max = MAX_TEXT } = {}): string | null {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new ShareFileError(`${where} is missing.`);
  }
  if (typeof value !== "string") throw new ShareFileError(`${where} isn't text.`);
  if (value.length > max) throw new ShareFileError(`${where} is too long.`);
  return value;
}

function required(value: unknown, where: string, max = MAX_TEXT): string {
  const result = text(value, where, { max })!.trim();
  if (!result) throw new ShareFileError(`${where} is empty.`);
  return result;
}

function list(value: unknown, where: string, max = MAX_LIST): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ShareFileError(`${where} isn't a list.`);
  if (value.length > max) throw new ShareFileError(`${where} has too many entries.`);
  return value.map((item, i) => text(item, `${where} ${i + 1}`)!);
}

function readCard(value: unknown, index: number): DeckCard {
  const where = `Card ${index + 1}`;
  if (!isObj(value)) throw new ShareFileError(`${where} isn't a card.`);
  return {
    topic: text(value.topic, `${where}'s topic`, { optional: true, max: 500 }),
    question: required(value.question, `${where}'s question`),
    directAnswer: required(value.directAnswer, `${where}'s answer`),
    fullExplanation: text(value.fullExplanation, `${where}'s explanation`, { optional: true }),
    // `insertDeck` stores only types it knows; anything else becomes a plain card.
    cardType: text(value.cardType, `${where}'s type`, { optional: true, max: 50 }) ?? "atomic",
    sourceExcerpt: text(value.sourceExcerpt, `${where}'s source`, { optional: true }),
    essentialPoints: list(value.essentialPoints, `${where}'s rubric`),
    misconceptions: list(value.misconceptions, `${where}'s wrong answers`),
  };
}

function readSection(value: unknown, where: string): DeckSection {
  if (!isObj(value)) throw new ShareFileError(`${where} isn't a section.`);
  const wrong = value.misconception;
  let misconception: DeckSection["misconception"] = null;
  if (wrong !== undefined && wrong !== null) {
    if (!isObj(wrong)) throw new ShareFileError(`${where}'s common mistake isn't valid.`);
    misconception = {
      misconception: text(wrong.misconception, `${where}'s common mistake`)!,
      incorrectApplication: text(wrong.incorrectApplication, `${where}'s common mistake`)!,
      whyFlawed: text(wrong.whyFlawed, `${where}'s common mistake`)!,
    };
  }
  return {
    conceptName: required(value.conceptName, `${where}'s name`, 500),
    definition: list(value.definition, `${where}'s definition`),
    breakdown: list(value.breakdown, `${where}'s breakdown`),
    example: list(value.example, `${where}'s example`),
    misconception,
  };
}

function readGuide(value: unknown): DeckGuide | null {
  if (value === undefined || value === null) return null;
  if (!isObj(value)) throw new ShareFileError("The study guide isn't valid.");
  if (!Array.isArray(value.topics)) throw new ShareFileError("The study guide has no topics.");
  if (value.topics.length > MAX_TOPICS) throw new ShareFileError("The study guide has too many topics.");
  return {
    overview: text(value.overview, "The guide's overview", { optional: true }),
    topics: value.topics.map((topic: unknown, t) => {
      const where = `Guide topic ${t + 1}`;
      if (!isObj(topic)) throw new ShareFileError(`${where} isn't valid.`);
      if (!Array.isArray(topic.sections)) throw new ShareFileError(`${where} has no sections.`);
      if (topic.sections.length > MAX_SECTIONS) throw new ShareFileError(`${where} has too many sections.`);
      return {
        title: required(topic.title, `${where}'s title`, 500),
        intro: text(topic.intro, `${where}'s intro`, { optional: true }) ?? "",
        sections: topic.sections.map((section: unknown, s) => readSection(section, `${where}, section ${s + 1}`)),
      };
    }),
  };
}

/** Parses and checks a file's text. Throws `ShareFileError` with a reason a student can read. */
export function parseShareFile(raw: string): ShareFile {
  if (raw.length > SHARE_MAX_BYTES) throw new ShareFileError("That file is too large to be a deck.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ShareFileError("That isn't a Megan Study deck file.");
  }
  if (!isObj(data) || data.format !== SHARE_FORMAT) {
    throw new ShareFileError("That isn't a Megan Study deck file.");
  }
  if (typeof data.version !== "number" || !Number.isInteger(data.version) || data.version < 1) {
    throw new ShareFileError("That deck file is damaged.");
  }
  if (data.version > SHARE_VERSION) {
    throw new ShareFileError("That deck was shared from a newer version of Megan Study. Update the app to open it.");
  }
  const deck = data.deck;
  if (!isObj(deck)) throw new ShareFileError("That deck file is damaged.");
  if (!Array.isArray(deck.cards) || deck.cards.length === 0) {
    throw new ShareFileError("That deck has no cards.");
  }
  if (deck.cards.length > SHARE_MAX_CARDS) throw new ShareFileError("That deck has too many cards.");

  return {
    format: SHARE_FORMAT,
    version: data.version,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt.slice(0, 40) : "",
    deck: {
      title: required(deck.title, "The deck's title", 300),
      course: text(deck.course, "The course", { optional: true, max: 300 })?.trim() || "Shared decks",
      term: text(deck.term, "The term", { optional: true, max: 100 }),
      cards: deck.cards.map(readCard),
      guide: readGuide(deck.guide),
    },
  };
}

/** Reads a file and adds it as a new deck. Returns the new deck's id. */
export function importShareFile(db: Db, raw: string): { examId: string; cardCount: number } {
  const file = parseShareFile(raw);
  const examId = insertDeck(db, { ...file.deck, origin: SHARE_ORIGIN });
  return { examId, cardCount: file.deck.cards.length };
}
