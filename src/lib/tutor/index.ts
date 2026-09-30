/**
 * The tutor (PRD §10).
 *
 * Plain functions over an `LlmProvider`, like every other model-facing part of
 * this app: the panel, a script and a test all reach the same code, and none
 * of them knows which provider is behind it.
 */
import { LlmError, type ChatRequest, type ChatTurn, type LlmProvider } from "@/lib/llm";

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
 * Text is cheap, so a session keeps forty turns of it and follow-ups build on
 * what was already said. Pictures are not: only the opening turn (the page
 * under discussion) and the last few keep theirs.
 */
export const MAX_TURNS = 40;
const IMAGE_TURNS = 4;

/** The window of turns sent, starting on a question and lightened of old images. */
export function trimTurns(turns: ChatTurn[]): ChatTurn[] {
  let kept = turns.slice(-MAX_TURNS);
  const firstUser = kept.findIndex((turn) => turn.role === "user");
  if (firstUser > 0) kept = kept.slice(firstUser);
  return kept.map((turn, index) =>
    index === 0 || index >= kept.length - IMAGE_TURNS || !turn.images?.length
      ? turn
      : { ...turn, images: [] },
  );
}

/**
 * The system prompt with the student's material and flashcards appended,
 * when there are any.
 */
function withMaterial(system: string, material?: string, cards?: string) {
  let out = system;
  if (material?.trim()) {
    out += `\n\nTHE STUDENT'S MATERIAL\nEvery page of the deck they are studying, in order. Cite pages as [file — Slide N] when you draw on them.\n\n${material}`;
  }
  if (cards?.trim()) {
    out += `\n\nTHE STUDENT'S FLASHCARDS\nThe cards already made from this material, numbered exactly as the app shows them. When the student says "flashcard N", "card N" or "#N", they mean Flashcard #N below — not slide N or page N of any file. Quote that card, then answer about it.\n\n${cards}`;
  }
  return out;
}

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

/** One try at an answer; normal replies take seconds, so this is a stall. */
const ATTEMPT_TIMEOUT_MS = 45_000;
/** The whole answer, retries included. */
const ANSWER_DEADLINE_MS = 90_000;

export async function askTutor(
  provider: LlmProvider,
  turns: ChatTurn[],
  material?: string,
  cards?: string,
): Promise<TutorResponse> {
  checkVision(provider, turns);
  const chat = requireChat(provider);
  // Retries, and the provider chain behind them, all stop at one deadline.
  const deadline = AbortSignal.timeout(ANSWER_DEADLINE_MS);

  const request: ChatRequest = {
    feature: "tutor",
    system: withMaterial(TUTOR_SYSTEM, material, cards),
    turns: trimTurns(turns),
    schema: TUTOR_SCHEMA,
    // Warmer than extraction: an explanation that reads like a schema dump
    // does not teach anything.
    temperature: 0.4,
    maxOutputTokens: 4096,
    // Left to itself the model thinks at length before a chat reply, and the
    // thinking comes out of the same budget: the first answer came back empty.
    thinking: "low",
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    signal: deadline,
  };

  // A first request sometimes comes back empty or cut off (a cold model, a
  // busy server, an answer that ran past the limit); asking again almost
  // always works, so the student should not have to.
  let data: TutorResponse | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3 && !deadline.aborted; attempt += 1) {
    try {
      data = (await chat<TutorResponse>(request)).data;
      if (data?.reply?.trim()) break;
      lastError = new LlmError("The model returned an empty answer.");
    } catch (error) {
      lastError = error;
      if (isRateLimited(error)) throw rateLimitError(error);
      if (!isRetryable(error)) throw error;
    }
    data = undefined;
    if (deadline.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }

  if (!data?.reply?.trim() && deadline.aborted) {
    throw new LlmError(
      `The tutor got no answer from ${provider.name === "gemini" ? "Gemini" : "the model"} within ${ANSWER_DEADLINE_MS / 1000} seconds. Its servers are sometimes overloaded, most often on free keys; ask again in a moment.`,
      lastError,
    );
  }
  if (!data?.reply?.trim()) {
    throw lastError instanceof Error
      ? lastError
      : new LlmError("The model returned an empty answer.");
  }

  return {
    reply: data.reply,
    suggestions: (data.suggestions ?? []).slice(0, 3),
    beyondMaterial: data.beyondMaterial === true,
  };
}

/**
 * The key is over its per-minute allowance. By the time this reaches the
 * tutor, the provider chain has already tried every model it has; asking
 * again within seconds only lengthens the wait before the student is told.
 */
function isRateLimited(error: unknown) {
  if (error instanceof LlmError && error.kind === "limit") return true;
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  return /\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(text);
}

function rateLimitError(error: unknown) {
  if (error instanceof LlmError && error.kind === "limit") return error;
  return new LlmError(
    "Your AI key is over its per-minute limit right now. Wait a minute and ask again.",
    error,
    "limit",
  );
}

/** Worth asking again: a busy or flaky server, or an answer that came back broken. */
function isRetryable(error: unknown) {
  // Every model in the chain is out of quota; asking again will not help.
  if (error instanceof LlmError && error.kind === "limit") return false;
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  return /empty answer|no content|malformed JSON|\b(500|502|503|504)\b|UNAVAILABLE|overloaded|timed? ?out|ECONNRESET|fetch failed|socket/i.test(text);
}

export type ExtractionRequest = {
  turns: ChatTurn[];
  /** What the student asked for, e.g. "3 cards about enzyme regulation". */
  instruction?: string;
  /** Hard ceiling, so "make cards" cannot return forty. */
  limit?: number;
  /** The deck's text, so cards can be checked against it. */
  material?: string;
  /** The numbered cards already made, so "card N" resolves and none repeat. */
  cards?: string;
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
    system: withMaterial(CARD_EXTRACTION_SYSTEM, request.material, request.cards),
    turns: [
      ...trimTurns(request.turns),
      {
        role: "user",
        text: `${ask}\n\nReturn at most ${limit} cards. Cards only — do not reply in prose.`,
      },
    ],
    schema: CARD_EXTRACTION_SCHEMA,
    temperature: 0,
    maxOutputTokens: 4096,
    thinking: "low",
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
