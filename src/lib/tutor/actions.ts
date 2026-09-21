"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { slideImage } from "@/lib/diagrams/render";
import { getProvider, LlmError, type ChatTurn } from "@/lib/llm";
import { readProvider } from "@/lib/settings";

import { askTutor, extractCards, type ExtractedCard } from "./index";
import { saveTutorCards } from "./save";

export type TutorMessage = {
  role: "user" | "model";
  text: string;
  /** Data URLs the student attached, and the slide they sent, if any. */
  images?: string[];
};

/** `data:image/png;base64,...` into the two parts a provider wants. */
function splitDataUrl(url: string) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function buildTurns(
  messages: TutorMessage[],
  slideId?: string | null,
): Promise<ChatTurn[]> {
  const turns: ChatTurn[] = messages.map((message) => ({
    role: message.role,
    text: message.text,
    images: (message.images ?? [])
      .map(splitDataUrl)
      .filter((image): image is NonNullable<typeof image> => image !== null),
  }));

  // The page under discussion rides along with the newest question, so the
  // model has it in view without it being re-sent on every turn.
  if (slideId) {
    const last = turns.at(-1);
    if (last?.role === "user") {
      const image = await slideImage(db, slideId);
      last.images = [
        { mimeType: "image/png", data: image.data.toString("base64") },
        ...(last.images ?? []),
      ];
    }
  }

  return turns;
}

export type AskResult =
  | { ok: true; reply: string; suggestions: string[]; beyondMaterial: boolean }
  | { ok: false; error: string };

export async function askTutorAction(input: {
  messages: TutorMessage[];
  slideId?: string | null;
  provider?: "gemini" | "anthropic" | "openai" | "local";
}): Promise<AskResult> {
  try {
    const provider = getProvider(input.provider);
    const answer = await askTutor(provider, await buildTurns(input.messages, input.slideId));
    return { ok: true, ...answer, suggestions: answer.suggestions ?? [] };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof LlmError || error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

export type ExtractResult =
  | { ok: true; cards: ExtractedCard[] }
  | { ok: false; error: string };

export async function extractCardsAction(input: {
  messages: TutorMessage[];
  slideId?: string | null;
  instruction?: string;
  limit?: number;
  provider?: "gemini" | "anthropic" | "openai" | "local";
}): Promise<ExtractResult> {
  try {
    const provider = getProvider(input.provider);
    const cards = await extractCards(provider, {
      turns: await buildTurns(input.messages, input.slideId),
      instruction: input.instruction,
      limit: input.limit,
    });

    if (cards.length === 0) {
      return {
        ok: false,
        error: "Nothing in this conversation made a clean card yet. Ask about something specific first.",
      };
    }

    return { ok: true, cards };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveTutorCardsAction(input: {
  examId: string;
  sourceSlideId?: string | null;
  cards: ExtractedCard[];
}) {
  const ids = saveTutorCards(db, input);
  revalidatePath(`/exams/${input.examId}`);
  revalidatePath(`/exams/${input.examId}/cards`);
  return ids.length;
}

/** Which model is answering, so the panel can name it and know if it sees. */
export async function tutorProviderAction() {
  try {
    const provider = getProvider();
    return {
      id: readProvider(),
      name: provider.name,
      model: provider.model,
      vision: provider.vision !== false,
    };
  } catch (error) {
    return {
      id: readProvider(),
      name: readProvider(),
      model: null,
      vision: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
