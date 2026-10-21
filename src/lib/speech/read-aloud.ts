/**
 * Read aloud: the side of the card the student is looking at, spoken by the
 * system's own voices (Web Speech). Nothing leaves the computer and nothing
 * is downloaded; where the browser has no voices the control is hidden.
 */
import { BLANK, clozeQuestion, clozeRevealed } from "@/lib/cards/cloze";

export type SpeakableCard = {
  question: string;
  directAnswer: string;
  cardType?: string | null;
};

/** The words for one side: a cloze blank is read as "blank", not underscores. */
export function speechText(card: SpeakableCard, side: "question" | "answer"): string {
  const cloze = card.cardType === "cloze";
  if (side === "question") {
    const question = cloze ? clozeQuestion(card.question) : card.question;
    return tidy(question.split(BLANK).join(" blank "));
  }
  if (cloze) return tidy(clozeRevealed(card.question));
  return tidy(card.directAnswer);
}

function tidy(text: string): string {
  return text
    .replace(/[*_`#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A study-guide concept: its name, then what it is, how it breaks down, and the example. */
export function sectionSpeech(section: {
  conceptName: string;
  definition: { text: string }[];
  breakdown: { text: string }[];
  example: { text: string }[];
}): string {
  const parts = [
    `${section.conceptName}.`,
    ...section.definition.map((s) => s.text),
    ...section.breakdown.map((s) => s.text),
    ...(section.example.length ? ["For example:", ...section.example.map((s) => s.text)] : []),
  ];
  return tidy(parts.join(" "));
}

export function canReadAloud(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** Speaks `text`, cutting off anything already being read. */
export function readAloud(text: string, onEnd?: () => void): void {
  if (!canReadAloud() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = document.documentElement.lang || "en-US";
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  synth.speak(utterance);
}

export function stopReading(): void {
  if (canReadAloud()) window.speechSynthesis.cancel();
}
