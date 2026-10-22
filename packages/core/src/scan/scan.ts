/**
 * Cards from photos of the student's own notes.
 *
 * Opt-in by design: nothing is sent until the student has seen which model
 * will read the photos and roughly what it will cost, and ticked a box saying
 * so. Each photo is one call, so a bad photo costs one call, not the batch.
 *
 * Cards made this way are marked `fromScan`: a model read the handwriting,
 * and the student should know a card might carry its misreading.
 */
import { estimateCost, formatCost } from "../llm/pricing";
import { LlmError, type ChatImage, type LlmProvider } from "../llm/types";
import { CARD_EXTRACTION_SCHEMA } from "../tutor/schemas";
import type { ExtractedCard } from "../tutor/schemas";

export const MAX_SCAN_IMAGES = 10;
/** Per photo, after the window shrinks it. Larger is refused, not truncated. */
export const MAX_SCAN_IMAGE_BYTES = 8 * 1024 * 1024;
export const SCAN_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const CARDS_PER_IMAGE = 15;
export const SCAN_TOPIC = "From a scan";

/**
 * Generous per-call token budget for the estimate. A photo is ~1,100–1,600
 * input tokens on the hosted models at the size the window sends; the prompt
 * adds ~500; a full page of cards is ~2,500 out. Rounded up so the real cost
 * lands under the estimate, not over it.
 */
const INPUT_TOKENS_PER_IMAGE = 2_200;
const OUTPUT_TOKENS_PER_IMAGE = 3_000;

export type ScanEstimate = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** USD, or null when the model's price is unknown (e.g. a local model). */
  cost: number | null;
  costLabel: string;
};

export function estimateScan(model: string, imageCount: number): ScanEstimate {
  const calls = Math.max(0, Math.min(imageCount, MAX_SCAN_IMAGES));
  const usage = {
    inputTokens: calls * INPUT_TOKENS_PER_IMAGE,
    outputTokens: calls * OUTPUT_TOKENS_PER_IMAGE,
  };
  const cost = estimateCost(model, usage);
  return { calls, ...usage, cost, costLabel: formatCost(cost) };
}

export const SCAN_SYSTEM = `You turn a photo of a student's own study notes into flashcards.

- Read only what is written or drawn in the photo. Do not add facts the notes
  do not contain; set fromMaterial to false on any card whose answer you had to
  complete from general knowledge.
- One card tests exactly ONE fact. Never combine two facts with "and".
- If a word is unreadable, leave that fact out rather than guessing.
- topic is the heading or subject the fact sits under in the notes.
- essentialPoints are what a typed answer MUST say to be correct.
- If the photo has no notes in it (a blank page, a selfie, a screenshot of
  something else), return no cards.`;

type Extraction = { cards?: Partial<ExtractedCard>[] };

/** Reads one photo. Throws LlmError when the model can't see pictures. */
export async function scanImage(provider: LlmProvider, image: ChatImage): Promise<ExtractedCard[]> {
  if (provider.vision === false) {
    throw new LlmError(`${provider.model} reads text, not pictures. Choose Gemini, Claude or OpenAI in Settings to scan notes.`);
  }
  if (!provider.generateChat) {
    throw new LlmError(`The ${provider.name} model can't read photos. Choose another in Settings.`);
  }
  const { data } = await provider.generateChat<Extraction>({
    feature: "scan",
    system: SCAN_SYSTEM,
    turns: [
      {
        role: "user",
        text: `Make flashcards from these notes. Return at most ${CARDS_PER_IMAGE} cards. Cards only — no prose.`,
        images: [image],
      },
    ],
    schema: CARD_EXTRACTION_SCHEMA,
    temperature: 0,
    maxOutputTokens: 4096,
    thinking: "low",
    timeoutMs: 60_000,
  });
  return cleanCards(data?.cards ?? []);
}

export function cleanCards(
  cards: Partial<ExtractedCard>[],
  limit = CARDS_PER_IMAGE,
  fallbackTopic = SCAN_TOPIC,
): ExtractedCard[] {
  return cards
    .filter((card) => card.question?.trim() && card.directAnswer?.trim())
    .slice(0, limit)
    .map((card) => ({
      topic: card.topic?.trim() || fallbackTopic,
      question: card.question!.trim(),
      directAnswer: card.directAnswer!.trim(),
      fullExplanation: card.fullExplanation?.trim() || undefined,
      essentialPoints: (card.essentialPoints ?? []).filter(Boolean),
      commonMisconceptions: (card.commonMisconceptions ?? []).filter(Boolean),
      fromMaterial: card.fromMaterial === true,
    }));
}
