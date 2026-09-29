"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { slideImage } from "@/lib/diagrams/render";
import { getProvider, LlmError, type ChatTurn } from "@/lib/llm";
import { readProvider } from "@/lib/settings";

import { deckContext, flashcardContext, type ContextQuery } from "./context";
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
  focus?: string | null,
): Promise<ChatTurn[]> {
  const turns: ChatTurn[] = messages.map((message) => ({
    role: message.role,
    text: message.text,
    images: (message.images ?? [])
      .map(splitDataUrl)
      .filter((image): image is NonNullable<typeof image> => image !== null),
  }));

  // The page and the card under discussion open the conversation, and are
  // re-attached on every request, so a follow-up never loses sight of them.
  const first = turns.find((turn) => turn.role === "user");
  if (first && focus?.trim()) {
    first.text = `${focus.trim()}\n\n${first.text}`;
  }
  if (first && slideId) {
    try {
      const image = await slideImage(db, slideId);
      first.images = [
        { mimeType: "image/png", data: image.data.toString("base64") },
        ...(first.images ?? []),
      ];
    } catch {
      // A page with nothing to draw still has its text in the material.
    }
  }

  return turns;
}

/**
 * What the student is asking about: their last two questions and the card on
 * screen. Earlier turns are left out so an old topic does not crowd out the
 * new one.
 */
function queryFor(input: TutorInput & { instruction?: string }): ContextQuery {
  const recent = input.messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.text);
  return {
    text: [input.focus ?? "", input.instruction ?? "", ...recent].join("\n"),
    slideId: input.slideId,
  };
}

export type AskResult =
  | { ok: true; reply: string; suggestions: string[]; beyondMaterial: boolean }
  | { ok: false; error: string };

type TutorInput = {
  messages: TutorMessage[];
  /** The deck whose material the tutor reads. */
  examId?: string | null;
  slideId?: string | null;
  /** What the student is looking at, e.g. the card they were just asked. */
  focus?: string | null;
  provider?: "gemini" | "anthropic" | "openai" | "local";
};

export async function askTutorAction(input: TutorInput): Promise<AskResult> {
  try {
    const provider = getProvider(input.provider);
    const query = queryFor(input);
    const [material, cards] = input.examId
      ? await Promise.all([
          deckContext(input.examId, provider.name, query),
          flashcardContext(input.examId, provider.name, query),
        ])
      : ["", ""];
    const answer = await askTutor(
      provider,
      await buildTurns(input.messages, input.slideId, input.focus),
      material,
      cards,
    );
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

export async function extractCardsAction(
  input: TutorInput & { instruction?: string; limit?: number },
): Promise<ExtractResult> {
  try {
    const provider = getProvider(input.provider);
    const query = queryFor(input);
    const [material, existing] = input.examId
      ? await Promise.all([
          deckContext(input.examId, provider.name, query),
          flashcardContext(input.examId, provider.name, query),
        ])
      : ["", ""];
    const cards = await extractCards(provider, {
      material,
      cards: existing,
      turns: await buildTurns(input.messages, input.slideId, input.focus),
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
