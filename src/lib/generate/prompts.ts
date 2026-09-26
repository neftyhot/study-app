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
  ADMIN_MAX_RATIO,
  DENSITY_PRESETS,
  isHighDensity,
  ratioFor,
  type DensityMode,
} from "./density";
import type { GenerationDetail } from "./schemas";

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

  standard: `WHAT TO EXTRACT (select, do not exhaust)
- One card tests exactly ONE fact. Never combine two facts with "and".
- For each slide, find the one or two things on it most likely to be examined:
  a definition, a mechanism, a cause and its effect, the order of a process, a
  key comparison. Write those. Most slides deserve one card; a dense slide may
  deserve two or three; a transitional slide deserves none.
- Do NOT split every concept into all of its facets. Where it is produced,
  what triggers it, what it acts on and how it is regulated are four cards
  only if the slide actually teaches all four as separate points.
- Do NOT write several near-identical cards for one concept. If two cards
  would be answered by the same sentence, write one of them.
- Skip conversational bullets, examples that only illustrate, administrative
  content, and anything the material simply repeats.

`,
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

const RUBRICS_FULL = `EXPLANATION
- fullExplanation may add clarifying context beyond the source. When it does,
  set hasAiSupplement to true. When it contains only source material, set it
  to false.

RUBRICS
- essentialPoints are what a typed answer MUST say to count as correct. Keep
  each one short and independently checkable.
- optionalPoints are worth credit but not required.
- commonMisconceptions are plausible wrong answers. Prioritise reversed
  directionality (increase vs. decrease) and mechanism mix-ups (synthesis vs.
  secretion), which are what students actually get wrong.`;

/**
 * The lean run's rubric section.
 *
 * It says what NOT to write as well as what to write, because a model told
 * only about the schema will still pad the answer with the explanation it was
 * not asked for — and that padding is most of what a bulk run spends its time
 * producing.
 */
const RUBRICS_LEAN = `RUBRICS
- essentialPoints are what a typed answer MUST say to count as correct. Give
  between one and three, each short and independently checkable.

BE BRIEF
- Do NOT generate long explanations, background essays, or misconception lists
  during bulk generation. Keep direct answers concise.
- directAnswer is one or two sentences. Do not add an explanation paragraph,
  and do not restate the question inside the answer: answer "Melatonin", not
  "The pineal gland synthesizes melatonin". An answer that repeats the
  question's words gives itself away in multiple choice.
- Do not write commentary, headings or preamble around the cards.

EMPHASIS
- Set professorEmphasis to true only when the material itself marks the point
  as important: "know this", "will be on the exam", a stated learning
  objective, or a speaker note stressing it. Otherwise false.`;

const PROVENANCE_AND_RUBRICS = `PROVENANCE (non-negotiable)
- Every card cites the slide token it came from, e.g. "S7".
- sourceExcerpt must be text copied VERBATIM from that slide. Copy it exactly,
  character for character. Do not paraphrase, reformat, or correct it.
- You may shorten a long quote with "..." between the parts you keep, but every
  part you keep must still be copied exactly.
- If the material does not state something, DO NOT generate a card for it and
  do not fill the gap from your own knowledge. Make no card instead.

Write questions a student can answer from memory, not questions about the
slides. Never write "According to slide 7, ...".

TOPICS
- topic is the broad section a card sits in — the heading a lecturer would put
  on a contents slide ("Olfactory system", "Thyroid gland"), never the single
  term the card asks about ("Olfactory bulb", "TSH").
- Every card from the same section uses the same topic, spelled the same way.
  A batch of slides normally needs one to three topics, not one per card.`;

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

/**
 * How far above a stated target the model's output lands.
 *
 * Measured on the Endocrine chapter (96 pages) with gemini-2.5-flash: told
 * 0.3 cards a page it produced 0.67, told 1.0 it produced 1.81 — about 1.9x
 * both times — so the number the model is given is scaled down by this.
 *
 * It is not linear, which is why the estimate does not rely on it: told 0.53,
 * the model still produced 1.44, because dense material has a floor below
 * which cutting further would mean dropping testable facts. The estimate uses
 * measured yields (`expectedPerUnit`) instead. Re-measure with
 * `npm run generate:bench` if the default model changes.
 */
export const MODEL_OVERSHOOT = 1.9;
// Per-model values now live in `MODEL_CALIBRATION` (density.ts); this remains
// the default for callers that do not say which model will read the prompt.

export function generationSystem(
  density: DensityMode = "exhaustive",
  customRatio?: number | null,
  detail: GenerationDetail = "full",
  /** The running model's measured overshoot; see `MODEL_CALIBRATION`. */
  overshoot: number = MODEL_OVERSHOOT,
): string {
  // The route has already held the ratio to what the licence allows.
  const ratio = ratioFor(density, customRatio, ADMIN_MAX_RATIO);
  const selection = SELECTION[density === "custom" ? nearestPreset(ratio) : density];

  // Exhaustive is the one setting with no number. Prose alone was measured
  // to overshoot badly — "standard" produced three cards a slide, no leaner
  // than exhaustive — so the leaner settings state their target. Padding, the
  // risk a number carries, only arises when the target is above what the
  // material naturally yields, which for these settings it never is.
  const target =
    density === "exhaustive"
      ? ""
      : isHighDensity(density, customRatio)
        ? highDensityTarget(ratio)
        : `\n\nTARGET DENSITY\nAim for roughly ${formatRatio(ratio / overshoot)} per slide on average across this batch.\nThis is a ceiling on how finely to cut, not a quota: fewer is right when a\nslide is thin, and you must never invent a card or pad with trivia to reach it.`;

  const rubrics = detail === "lean" ? RUBRICS_LEAN : RUBRICS_FULL;

  return `${GENERATION_PREAMBLE}\n\n${selection}\n\n${PROVENANCE_AND_RUBRICS}\n\n${rubrics}${target}`;
}

/**
 * An admin's explicit count, far above what any preset asks for.
 *
 * Stated as the number itself, not scaled by overshoot: the student has
 * chosen it knowingly, and the risk at this density is not too many cards but
 * the same card several times over. So the model is told how to find more
 * distinct cards on one slide, and that repeating one is worse than stopping.
 */
function highDensityTarget(ratio: number): string {
  return `

TARGET DENSITY (REQUESTED EXPLICITLY)
The student has asked for about ${formatRatio(ratio)} per slide. Produce that
many for every slide whose material supports it.

To reach it without repeating yourself, work through each slide from several
angles, one card per distinct angle:
- every term, value, list item, exception and qualifier stated, each on its own;
- the reverse direction of a definition (given the description, name the term);
- cause and effect, and what changes if a step or input changes;
- how two items on the slide or in this batch differ or relate;
- the order of steps in a process, one step per card;
- a worked example or calculation using the slide's own figures.

EVERY CARD MUST TEST SOMETHING NO OTHER CARD TESTS. Before writing a card,
check it against the cards you have already written in this reply and the
ALREADY COVERED list, if there is one. A card that asks the same thing in
different words, or swaps only the wording of the answer, is a duplicate. When a
slide has no distinct fact left, stop there and move on: fewer cards is correct
then, and a repeated or invented card is always wrong.`;
}

function formatRatio(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  return `${rounded} card${rounded === 1 ? "" : "s"}`;
}

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
  /**
   * Questions the deck already has for these slides. Shown so the model can
   * add to them instead of rewriting them; the validator still rejects any
   * repeat that gets through.
   */
  covered?: string[];
};

/** How many existing questions a prompt lists, at most. */
export const MAX_COVERED = 200;

function applicationSection(options?: PromptOptions): string {
  return options?.includeApplication ? `\n${APPLICATION_RULES}\n` : "";
}

function coveredSection(options?: PromptOptions): string {
  const covered = options?.covered?.slice(0, MAX_COVERED) ?? [];
  if (covered.length === 0) return "";
  return `
ALREADY COVERED
The deck already has these questions for these slides. Do not repeat any of
them, even reworded; write only cards that test something they do not.
${covered.map((question) => `- ${question.replace(/\s+/g, " ").trim()}`).join("\n")}
`;
}

export function fullCoveragePrompt(
  slides: SourceSlide[],
  options?: PromptOptions,
): string {
  return `Generate flashcards covering every testable fact in the slides below.

Work concept by concept. For each concept, produce the full set of atomic
cards its facets call for, then any integration cards that connect it to other
concepts in this material.
${applicationSection(options)}${coveredSection(options)}
SLIDES
${renderSlides(slides)}`;
}

export function objectiveToken(index: number): string {
  return `O${index + 1}`;
}

export function objectiveFocusPrompt(
  slides: SourceSlide[],
  objectives: StudyGuideObjective[],
  options?: PromptOptions,
): string {
  // Tokens are per batch, like slide tokens: the model tags each card with
  // the one it answers, which is how the run knows afterwards which
  // objectives got no card at all.
  const list = objectives
    .map((o, i) => `[${objectiveToken(i)}] ${o.label ? `${o.label}. ` : ""}${o.promptText}`)
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

Set each card's objective to the token of the objective it answers, e.g. "O2".

These are only the objectives these slides are likely to answer, and other
slides will be asked about the rest. If the slides do not contain what an
objective asks for, do not invent it — make no card for it.
${applicationSection(options)}${coveredSection(options)}

STUDY-GUIDE OBJECTIVES
${list}

SLIDES
${renderSlides(slides)}`;
}
