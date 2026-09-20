/**
 * Prompts for card generation.
 *
 * The rules here are PRD §2 (atomization, process cards, completeness) and
 * §3 (provenance, no hallucination) stated as model instructions. Slides are
 * presented with citation tokens so a card's citation can be checked against
 * the material it was generated from.
 */
import type { SourceSlide, StudyGuideObjective } from "@/db/schema";

/** Stable, short token the model cites instead of a UUID. */
export function citationToken(slide: Pick<SourceSlide, "index">) {
  return `S${slide.index}`;
}

export const GENERATION_SYSTEM = `You build flashcards for a student from their own lecture material.

ATOMICITY (this is the core requirement)
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
  yourself writing one card whose answer is a list, split the list.

PROVENANCE (non-negotiable)
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
