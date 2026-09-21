/**
 * Prompts for card generation.
 *
 * The rules here are PRD §2 (atomization, process cards, completeness) and
 * §3 (provenance, no hallucination) stated as model instructions. Slides are
 * presented with citation tokens so a card's citation can be checked against
 * the material it was generated from.
 */
import type { SourceSlide, StudyGuideObjective } from "@/db/schema";

import {
  DENSITY_PRESETS,
  ratioFor,
  type DensityMode,
} from "./density";

/** Stable, short token the model cites instead of a UUID. */
export function citationToken(slide: Pick<SourceSlide, "index">) {
  return `S${slide.index}`;
}

/**
 * The opening line of every generation system prompt.
 *
 * Kept stable so a caller can recognise a generation request whichever
 * density it was built for.
 */
export const GENERATION_PREAMBLE =
  "You build flashcards for a student from their own lecture material.";

/**
 * What to keep, and how finely to cut it.
 *
 * This is the only part of the system prompt density changes. Provenance and
 * rubric rules are identical in every mode: a sparser deck is a smaller
 * selection of the same material, never a looser standard for it.
 */
const SELECTION: Record<Exclude<DensityMode, "custom">, string> = {
  exhaustive: `ATOMICITY (this is the core requirement)
- One card tests exactly ONE fact. Never combine two facts with "and".
- Decompose every concept into its separate facets. For a hormone that means
  separate cards for: where it is produced, what triggers its release, what
  tissue and receptor it acts on, what it actually does, and how it is
  regulated. Do not answer several of those in one card.
- For a process or pathway, produce: one card per discrete step, a card on the
  ORDER of the steps, a card on WHY a key step happens (its mechanism or
  rationale), and one whole-process summary card.
- After the discrete cards, add integration cards that test how facets or
  concepts relate to each other. An integration card still has to quote ONE
  slide verbatim: quote the fragment supporting its main claim, and cite that
  slide. Never stitch an excerpt together from two different slides.

COMPLETENESS
- Cover exceptions, comparisons, worked examples, and numeric values. These are
  exactly what exams test.
- There is no limit on card count. Do not summarize to save space.
- Do not produce two cards that test the same fact. Cards that test genuinely
  different details of the same concept are not duplicates.

BREADTH (this is where most decks fail)
- A broad or structural heading is a CONTAINER, not a question. "Anatomy and
  physiology of the eye" is not one card; it is every structure, every layer,
  every fluid, every mechanism and every pathway the material gives for the
  eye — cornea, lens, retina, the refraction of light, phototransduction, the
  route from photoreceptor to visual cortex, and so on, each as its own card.
- Work through the material structure by structure and step by step. For each
  structure ask: what is it, where is it, what is it made of, what does it do,
  how does it relate to the structure next to it. For each pathway ask: what
  are the steps, in what order, and what happens at each one.
- Never answer a broad heading with a single summary card. If you find
  yourself writing one card whose answer is a list, split the list.`,

  standard: `WHAT TO EXTRACT
- One card tests exactly ONE fact. Never combine two facts with "and".
- Take the core of the material: definitions, mechanisms, the steps of a
  process and the order they happen in, the relationships between structures,
  numeric values, and the comparisons and exceptions an exam would test.
- Decompose a concept into the facets that are genuinely tested separately.
  For a hormone: where it is produced, what triggers its release, what it acts
  on, what it does, and how it is regulated.
- Do NOT write several near-identical cards for one concept. If two cards
  would be answered by the same sentence, write one of them.
- Skip conversational bullets, transitional slides, administrative content,
  and anything the material simply repeats.
- A broad heading is still a container, not a single card: split it into the
  structures and steps the material actually explains. But a minor sub-bullet
  that only supports a concept does not need a card of its own.`,

  high_yield: `WHAT TO EXTRACT (be selective — this is a final-week pass)
- Take only what is high-yield: stated learning objectives, bolded or
  emphasised terms, summary tables, and the concepts the rest of the material
  is built on.
- Group related sub-points into a single synthesis card rather than one card
  per sub-point. A card here may carry two or three tightly linked facts when
  they are always recalled together.
- Discard trivial background context, transitional bullets, asides, and detail
  that merely supports a concept rather than being tested itself.
- Prefer the whole-process summary over a card per step, and the comparison
  over separate cards for the two things being compared.
- Expect far fewer cards than this material could yield. That is the point.`,
};

const PROVENANCE_AND_RUBRICS = `PROVENANCE (non-negotiable)
- Every card cites the slide token it came from, e.g. "S7".
- sourceExcerpt must be text copied VERBATIM from that slide. Copy it exactly,
  character for character. Do not paraphrase, reformat, or correct it.
- You may shorten a long quote with "..." between the parts you keep, but every
  part you keep must still be copied exactly.
- If the material does not state something, DO NOT generate a card for it and
  do not fill the gap from your own knowledge. List it in uncoveredNotes.
- fullExplanation may add clarifying context beyond the source. When it does,
  set hasAiSupplement to true. When it contains only source material, set it
  to false.

RUBRICS
- essentialPoints are what a typed answer MUST say to count as correct. Keep
  each one short and independently checkable.
- optionalPoints are worth credit but not required.
- commonMisconceptions are plausible wrong answers. Prioritise reversed
  directionality (increase vs. decrease) and mechanism mix-ups (synthesis vs.
  secretion), which are what students actually get wrong.

Write questions a student can answer from memory, not questions about the
slides. Never write "According to slide 7, ...".`;

/** The preset whose prose fits a custom ratio most closely. */
export function nearestPreset(ratio: number): Exclude<DensityMode, "custom"> {
  const entries = Object.entries(DENSITY_PRESETS) as [
    Exclude<DensityMode, "custom">,
    { cardsPerUnit: number },
  ][];

  return entries.reduce((best, [mode, preset]) =>
    Math.abs(preset.cardsPerUnit - ratio) <
    Math.abs(DENSITY_PRESETS[best].cardsPerUnit - ratio)
      ? mode
      : best,
  entries[0][0]);
}

export function generationSystem(
  density: DensityMode = "exhaustive",
  customRatio?: number | null,
): string {
  const ratio = ratioFor(density, customRatio);
  const selection = SELECTION[density === "custom" ? nearestPreset(ratio) : density];

  // A number is only given to the model when the student set one. For a
  // preset, the prose is the instruction; adding a quota to it would invite
  // padding, which the validator would then reject as unsupported cards.
  const target =
    density === "custom"
      ? `\n\nTARGET DENSITY\nAim for roughly ${formatRatio(ratio)} per slide on average across this batch.\nThis is guidance for how finely to cut, not a quota: never invent a card, pad\nwith trivia, or drop a genuinely testable fact in order to hit it.`
      : "";

  return `${GENERATION_PREAMBLE}\n\n${selection}\n\n${PROVENANCE_AND_RUBRICS}${target}`;
}

function formatRatio(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  return `${rounded} card${rounded === 1 ? "" : "s"}`;
}

/** The prompt generation used before density was configurable. */
export const GENERATION_SYSTEM = generationSystem("exhaustive");

/** Renders slides into the prompt body, tagged with citation tokens. */
export function renderSlides(slides: SourceSlide[]): string {
  return slides
    .map((slide) => {
      const parts = [`[${citationToken(slide)}]`];
      if (slide.title) parts.push(`Title: ${slide.title}`);
      if (slide.rawText) parts.push(slide.rawText);

      for (const table of slide.tables) {
        const rendered = table.rows
          .map((row) => row.join(" | "))
          .join("\n");
        if (rendered.trim()) parts.push(`Table:\n${rendered}`);
      }

      // Speaker notes routinely carry the professor's actual explanation, so
      // they are prompt material, not metadata.
      if (slide.speakerNotes) parts.push(`Speaker notes: ${slide.speakerNotes}`);

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

/** PRD §9 — appended only when the student asked for application questions. */
export const APPLICATION_RULES = `
ALSO PRODUCE APPLICATION CARDS (cardType "application")
After the factual cards for a concept, add higher-order questions that make
the student USE the fact rather than restate it:
- Perturbation: "What happens if <structure or step> is damaged, blocked, or
  inhibited?" (facet "perturbation")
- Directional shift: "What happens to X when Y increases / decreases?"
  (facet "directional_shift")
- Scenario: a short concrete situation whose answer requires the mechanism —
  a patient presentation, a lab result, an experimental manipulation.
  (facet "scenario")

These follow the same provenance rule as every other card: the excerpt must be
copied verbatim from the slide that supports the underlying mechanism. If the
material does not state the mechanism, do not invent a consequence for it.
Set hasAiSupplement to true when the reasoning goes beyond what is stated.`;

export type PromptOptions = {
  /** PRD §9 higher-order questions, off unless the student asked. */
  includeApplication?: boolean;
};

function applicationSection(options?: PromptOptions): string {
  return options?.includeApplication ? `\n${APPLICATION_RULES}\n` : "";
}

export function fullCoveragePrompt(
  slides: SourceSlide[],
  options?: PromptOptions,
): string {
  return `Generate flashcards covering every testable fact in the slides below.

Work concept by concept. For each concept, produce the full set of atomic
cards its facets call for, then any integration cards that connect it to other
concepts in this material.
${applicationSection(options)}
SLIDES
${renderSlides(slides)}`;
}

export function objectiveFocusPrompt(
  slides: SourceSlide[],
  objectives: StudyGuideObjective[],
  options?: PromptOptions,
): string {
  const list = objectives
    .map((o, i) => `${o.label ?? i + 1}. ${o.promptText}`)
    .join("\n");

  return `Generate flashcards that answer the study-guide objectives below,
using only the slides that follow.

Stay anchored to these objectives, and treat each one as a CHECKLIST of
everything it covers rather than as a single question.

- A narrow objective ("Where is ADH released?") still needs its facets split.
- A broad or structural objective ("Anatomy and physiology of the eye",
  "The cardiac cycle") needs EXHAUSTIVE decomposition: every structure named
  in the material, every mechanism, and every step of every pathway it
  involves, each as its own card. Go through the slides for that objective and
  account for all of it. An objective like that is usually worth ten to forty
  cards, not one.
- Before moving on from an objective, re-read it and ask what part of it you
  have not yet turned into a card.

If the slides do not contain what an objective asks for, do not invent it:
record the objective in uncoveredNotes instead.
${applicationSection(options)}

STUDY-GUIDE OBJECTIVES
${list}

SLIDES
${renderSlides(slides)}`;
}
