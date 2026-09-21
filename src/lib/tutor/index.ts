/**
 * The tutor (PRD §10).
 *
 * Plain functions over an `LlmProvider`, like every other model-facing part of
 * this app: the panel, a script and a test all reach the same code, and none
 * of them knows which provider is behind it.
 */
import { LlmError, type ChatTurn, type LlmProvider } from "@/lib/llm";

import {
  CARD_EXTRACTION_SCHEMA,
  TUTOR_SCHEMA,
  type CardExtraction,
  type ExtractedCard,
  type TutorResponse,
} from "./schemas";
import { CARD_EXTRACTION_SYSTEM, TUTOR_SYSTEM } from "./prompts";

export * from "./schemas";
export * from "./prompts";

/**
 * How much of the conversation is sent back each time.
 *
 * Every turn carries its images, and a page is around a megabyte, so an
 * unbounded transcript would grow the request without bound. Ten turns keeps
 * a session coherent without re-uploading a morning's worth of slides.
 */
export const MAX_TURNS = 10;

function requireChat(provider: LlmProvider) {
  if (!provider.generateChat) {
    throw new LlmError(
      `The ${provider.name} model cannot hold a conversation. Choose another in Settings.`,
    );
  }
  return provider.generateChat.bind(provider);
}

/** Refuses rather than silently dropping the picture a question is about. */
function checkVision(provider: LlmProvider, turns: ChatTurn[]) {
  const hasImages = turns.some((turn) => turn.images?.length);
  if (hasImages && provider.vision === false) {
    throw new LlmError(
      `${provider.model} reads text, not pictures. Switch to Gemini, Claude or OpenAI in Settings to ask about a diagram.`,
    );
  }
}

export async function askTutor(
  provider: LlmProvider,
  turns: ChatTurn[],
): Promise<TutorResponse> {
  checkVision(provider, turns);
  const chat = requireChat(provider);

  const { data } = await chat<TutorResponse>({
    feature: "tutor",
    system: TUTOR_SYSTEM,
    turns: turns.slice(-MAX_TURNS),
    schema: TUTOR_SCHEMA,
    // Warmer than extraction: an explanation that reads like a schema dump
    // does not teach anything.
    temperature: 0.4,
    maxOutputTokens: 2048,
  });

  if (!data?.reply?.trim()) {
    throw new LlmError("The model returned an empty answer.");
  }

  return {
    reply: data.reply,
    suggestions: (data.suggestions ?? []).slice(0, 3),
    beyondMaterial: data.beyondMaterial === true,
  };
}

export type ExtractionRequest = {
  turns: ChatTurn[];
  /** What the student asked for, e.g. "3 cards about enzyme regulation". */
  instruction?: string;
  /** Hard ceiling, so "make cards" cannot return forty. */
  limit?: number;
};

export const DEFAULT_CARD_LIMIT = 8;

export async function extractCards(
  provider: LlmProvider,
  request: ExtractionRequest,
): Promise<ExtractedCard[]> {
  checkVision(provider, request.turns);
  const chat = requireChat(provider);

  const limit = Math.min(request.limit ?? DEFAULT_CARD_LIMIT, 20);
  const ask =
    request.instruction?.trim() ||
    "Turn the facts in this conversation into flashcards.";

  const { data } = await chat<CardExtraction>({
    feature: "tutor_extract",
    system: CARD_EXTRACTION_SYSTEM,
    turns: [
      ...request.turns.slice(-MAX_TURNS),
      {
        role: "user",
        text: `${ask}\n\nReturn at most ${limit} cards. Cards only — do not reply in prose.`,
      },
    ],
    schema: CARD_EXTRACTION_SCHEMA,
    temperature: 0,
    maxOutputTokens: 4096,
  });

  return (data?.cards ?? [])
    .filter((card) => card.question?.trim() && card.directAnswer?.trim())
    .slice(0, limit)
    .map((card) => ({
      topic: card.topic?.trim() || "From the tutor",
      question: card.question.trim(),
      directAnswer: card.directAnswer.trim(),
      fullExplanation: card.fullExplanation?.trim() || undefined,
      essentialPoints: (card.essentialPoints ?? []).filter(Boolean),
      commonMisconceptions: (card.commonMisconceptions ?? []).filter(Boolean),
      fromMaterial: card.fromMaterial === true,
    }));
}
