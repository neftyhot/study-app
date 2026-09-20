/**
 * Prompts for the three coverage passes (PRD §3).
 *
 * Everything the model may refer to is handed to it with a short token —
 * O-tokens for objectives, C-tokens for cards, S-tokens for slides. Tokens are
 * assigned per call and mean nothing outside it, which is deliberate: the
 * model can only point at material we actually gave it, and `validate.ts`
 * drops anything that does not resolve.
 */
import type { Flashcard, SourceSlide, StudyGuideObjective } from "@/db/schema";

export type Tokenized<T> = { token: string; item: T };

export function tokenize<T>(
  prefix: string,
  items: readonly T[],
): Tokenized<T>[] {
  return items.map((item, i) => ({ token: `${prefix}${i + 1}`, item }));
}

/** A slide plus the file it came from — slide 3 of two decks is two slides. */
export type LabeledSlide = { slide: SourceSlide; fileName: string };

export function slideLabel({ slide, fileName }: LabeledSlide): string {
  return `${fileName}, slide ${slide.index}`;
}

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

export function renderObjectives(
  objectives: Tokenized<StudyGuideObjective>[],
): string {
  return objectives
    .map(({ token, item }) => {
      const label = item.label ? `${item.label}. ` : "";
      return `[${token}] ${label}${item.promptText}`;
    })
    .join("\n");
}

export function renderCards(cards: Tokenized<Flashcard>[]): string {
  if (cards.length === 0) return "(no candidate cards)";

  return cards
    .map(({ token, item }) => {
      const topic = item.topic ? `${item.topic} — ` : "";
      return [
        `[${token}] ${topic}${item.question}`,
        `    A: ${clip(item.directAnswer, 400)}`,
      ].join("\n");
    })
    .join("\n");
}

export function renderSlides(slides: Tokenized<LabeledSlide>[]): string {
  if (slides.length === 0) return "(no slides)";

  return slides
    .map(({ token, item }) => {
      const parts = [`[${token}] (${slideLabel(item)})`];
      if (item.slide.title) parts.push(`Title: ${item.slide.title}`);
      if (item.slide.rawText) parts.push(clip(item.slide.rawText, 1200));

      for (const table of item.slide.tables) {
        const rendered = table.rows.map((row) => row.join(" | ")).join("\n");
        if (rendered.trim()) parts.push(`Table:\n${clip(rendered, 600)}`);
      }

      if (item.slide.speakerNotes) {
        parts.push(`Speaker notes: ${clip(item.slide.speakerNotes, 800)}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

/* ------------------------------------------------ Pass 1: cards→objectives */

export const MAPPING_SYSTEM = `You audit whether a student's flashcard deck answers their study guide.

For each objective, decide which of the candidate cards actually help answer
it, then judge whether those cards TOGETHER answer the whole objective.

- "covered": a student who knows every listed card can answer the objective in
  full. Nothing it asks for is left out.
- "partially_covered": the cards answer part of it. List exactly what is left
  out in missingPoints.
- "missing": no candidate card answers it. Return an empty cards array.

Be strict. An objective asking for a mechanism AND its regulation is not
covered by cards about the mechanism alone. Topic overlap is not coverage: a
card is only relevant if answering it helps answer the objective.

Cite cards only by the tokens given. Never invent a card. Return exactly one
entry per objective, including objectives with no matching cards.`;

export function mappingPrompt(
  objectives: Tokenized<StudyGuideObjective>[],
  cards: Tokenized<Flashcard>[],
): string {
  return `Decide how well the candidate cards cover each objective.

STUDY-GUIDE OBJECTIVES
${renderObjectives(objectives)}

CANDIDATE CARDS
${renderCards(cards)}`;
}

/* ------------------------------------------- Pass 2: secondary source review */

export const REVIEW_SYSTEM = `You check whether a student's uploaded course material answers a study-guide
objective, ignoring what flashcards exist.

This is the second opinion on a gap: the deck does not cover these objectives,
and the student needs to know whether that is a generation failure or whether
their files simply never cover the material.

- "answers": the slides contain everything the objective asks for.
- "partial": the slides address it but leave part of it unanswered.
- "silent": the slides do not address the objective.

sourceExcerpt must be copied VERBATIM from the slide you cite, character for
character. You may shorten a long quote with "..." between the parts you keep,
but every part you keep must still be exact. If nothing supports the objective,
return "silent" with empty strings for the citation and excerpt — never quote a
slide that does not really say it.

Return exactly one entry per objective.`;

export function reviewPrompt(
  objectives: Tokenized<StudyGuideObjective>[],
  slides: Tokenized<LabeledSlide>[],
): string {
  return `Decide whether the slides below answer each objective.

OBJECTIVES
${renderObjectives(objectives)}

SLIDES
${renderSlides(slides)}`;
}

/* ------------------------------------------------ Pass 3: conflict detection */

export const CONFLICT_SYSTEM = `You compare slides from DIFFERENT files in a student's course material and
report statements that contradict each other.

A conflict is a factual disagreement: different numeric values or ranges for
the same quantity, opposite directions of an effect (increases vs. decreases),
different locations, structures, or orderings for the same process, or
different classifications of the same thing.

These are NOT conflicts: one slide giving more detail than another, different
wording for the same fact, different levels of approximation that do not
disagree, or two slides discussing different things.

Quote both sides VERBATIM from the slides you cite. Do not resolve the
conflict and do not decide which source is right — the student decides that.
Report nothing rather than reporting a disagreement you are unsure about.`;

export function conflictPrompt(slides: Tokenized<LabeledSlide>[]): string {
  return `Find statements in these slides that contradict each other. The
slides come from different files covering overlapping material.

SLIDES
${renderSlides(slides)}`;
}
