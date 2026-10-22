/**
 * Cards from a file the student picked on the phone: slides, a Word or PDF
 * handout, plain notes.
 *
 * The desktop's generator is tied to its database (source files, page ranges,
 * coverage). This is the compact version iOS needs: the extracted units are
 * packed into a few batches of roughly BATCH_WORDS words, one call each, with
 * the same "one fact per card, only from the material" rules as a scan.
 *
 * Nothing here is logged or sent anywhere but the student's own AI provider.
 */
import type { ExtractedUnit } from "../ingest/types";
import { estimateCost, formatCost } from "../llm/pricing";
import { LlmError, type ChatImage, type LlmProvider } from "../llm/types";
import { cleanCards } from "../scan/scan";
import { CARD_EXTRACTION_SCHEMA, type ExtractedCard } from "../tutor/schemas";

/** About three slides' worth of dense text, or a page and a half of notes. */
export const BATCH_WORDS = 1_500;
/** A hard cap on calls per file, so a 300-page PDF can't run up a bill. */
export const MAX_BATCHES = 20;
const CARDS_PER_BATCH = 25;
export const FILE_TOPIC = "From your file";

/** Generous per-call budget for the estimate (prompt + batch in, cards out). */
const INPUT_TOKENS_PER_BATCH = 3_000;
const OUTPUT_TOKENS_PER_BATCH = 5_000;
/** A PDF sent whole (no text layer) is billed per page; ~260 tokens a page. */
const INPUT_TOKENS_PER_PDF_PAGE = 300;

export const FROM_TEXT_SYSTEM = `You turn a student's course material into flashcards.

- Use only facts the material states. Set fromMaterial to false on any card
  whose answer you had to complete from general knowledge.
- One card tests exactly ONE fact. Never combine two facts with "and".
- Prefer what a teacher would test: definitions, causes, consequences, dates,
  formulas, steps of a process, comparisons. Skip course logistics (due dates,
  room numbers, grading policy) and slide boilerplate.
- topic is the heading or slide title the fact sits under.
- essentialPoints are what a typed answer MUST say to be correct.
- If the material has nothing worth testing, return no cards.`;

export type TextBatch = {
  /** "Slides 3–7", "Section 2", for progress text. */
  label: string;
  text: string;
  words: number;
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** One unit as the model reads it: its title, body, tables and notes. */
export function unitText(unit: ExtractedUnit): string {
  const parts: string[] = [];
  if (unit.title) parts.push(`## ${unit.title}`);
  if (unit.rawText) parts.push(unit.rawText);
  for (const table of unit.tables) parts.push(table.rows.map((row) => row.join(" | ")).join("\n"));
  if (unit.speakerNotes) parts.push(`Speaker notes: ${unit.speakerNotes}`);
  return parts.join("\n\n").trim();
}

/**
 * Packs units into batches in reading order. A unit is never split across
 * batches (the extractors already split long ones), and at most MAX_BATCHES
 * are returned: `truncated` says whether the end of the file was left out.
 */
export function batchUnits(
  units: ExtractedUnit[],
  unitName = "Section",
): { batches: TextBatch[]; truncated: boolean } {
  const batches: TextBatch[] = [];
  let current: { first: number; last: number; parts: string[]; words: number } | null = null;

  const flush = () => {
    if (!current) return;
    const range = current.first === current.last ? `${current.first}` : `${current.first}–${current.last}`;
    batches.push({
      label: `${current.first === current.last ? unitName : `${unitName}s`} ${range}`,
      text: current.parts.join("\n\n"),
      words: current.words,
    });
    current = null;
  };

  for (const unit of units) {
    const text = unitText(unit);
    if (!text) continue;
    const words = wordCount(text);
    if (current && current.words + words > BATCH_WORDS) flush();
    if (!current) current = { first: unit.index, last: unit.index, parts: [], words: 0 };
    current.parts.push(text);
    current.last = unit.index;
    current.words += words;
  }
  flush();

  return { batches: batches.slice(0, MAX_BATCHES), truncated: batches.length > MAX_BATCHES };
}

export type FileEstimate = { calls: number; cost: number | null; costLabel: string };

export function estimateFromText(model: string, batchCount: number): FileEstimate {
  const calls = Math.min(batchCount, MAX_BATCHES);
  const cost = estimateCost(model, {
    inputTokens: calls * INPUT_TOKENS_PER_BATCH,
    outputTokens: calls * OUTPUT_TOKENS_PER_BATCH,
  });
  return { calls, cost, costLabel: formatCost(cost) };
}

export function estimateFromPdf(model: string, pages: number): FileEstimate {
  const cost = estimateCost(model, {
    inputTokens: INPUT_TOKENS_PER_BATCH + pages * INPUT_TOKENS_PER_PDF_PAGE,
    outputTokens: OUTPUT_TOKENS_PER_BATCH,
  });
  return { calls: 1, cost, costLabel: formatCost(cost) };
}

type Extraction = { cards?: Partial<ExtractedCard>[] };

function requireChat(provider: LlmProvider) {
  if (!provider.generateChat) {
    throw new LlmError(`The ${provider.name} model can't make cards here. Choose another in Settings.`);
  }
  return provider.generateChat.bind(provider);
}

/** One batch of text into cards. */
export async function cardsFromText(provider: LlmProvider, batch: TextBatch): Promise<ExtractedCard[]> {
  const chat = requireChat(provider);
  const { data } = await chat<Extraction>({
    feature: "generate",
    system: FROM_TEXT_SYSTEM,
    turns: [
      {
        role: "user",
        text: `Make flashcards from this material (${batch.label}). Return at most ${CARDS_PER_BATCH} cards. Cards only — no prose.\n\n<material>\n${batch.text}\n</material>`,
      },
    ],
    schema: CARD_EXTRACTION_SCHEMA,
    temperature: 0,
    maxOutputTokens: 8192,
    thinking: "low",
    timeoutMs: 90_000,
  });
  return cleanCards(data?.cards ?? [], CARDS_PER_BATCH, FILE_TOPIC);
}

/**
 * A whole document the model reads itself: a scanned PDF with no text layer.
 * Only providers that read files (Gemini does) can take this path.
 */
export async function cardsFromDocument(provider: LlmProvider, document: ChatImage): Promise<ExtractedCard[]> {
  if (provider.vision === false) {
    throw new LlmError(`${provider.model} reads text, not scanned pages. Choose Gemini in Settings to read this PDF.`);
  }
  const chat = requireChat(provider);
  const { data } = await chat<Extraction>({
    feature: "generate",
    system: FROM_TEXT_SYSTEM,
    turns: [
      {
        role: "user",
        text: `Make flashcards from this document. Return at most ${CARDS_PER_BATCH * 2} cards. Cards only — no prose.`,
        images: [document],
      },
    ],
    schema: CARD_EXTRACTION_SCHEMA,
    temperature: 0,
    maxOutputTokens: 16384,
    thinking: "low",
    timeoutMs: 120_000,
  });
  return cleanCards(data?.cards ?? [], CARDS_PER_BATCH * 2, FILE_TOPIC);
}
