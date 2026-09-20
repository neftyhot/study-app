/**
 * Validation for the coverage passes.
 *
 * Same principle as card generation: the model's output is a claim, not a
 * fact. Every reference must resolve to a row we handed it, and every quote
 * must really occur in the slide it cites — reusing `excerptAppearsIn`, the
 * same check that gates card provenance.
 */
import type { Flashcard, SourceSlide, StudyGuideObjective } from "@/db/schema";
import { excerptAppearsIn } from "@/lib/generate/validate";

import type { LabeledSlide, Tokenized } from "./prompts";
import type {
  ConflictResponse,
  CoverageMappingResponse,
  CoverageReviewResponse,
  CoverageStatus,
  SourceSupport,
} from "./schemas";

export function byToken<T>(items: Tokenized<T>[]): Map<string, T> {
  return new Map(items.map(({ token, item }) => [token.toLowerCase(), item]));
}

/**
 * Resolves a token reference, tolerating the shapes models emit: "C12",
 * "[C12]", "Card C12". Any single token that resolves is accepted; a reference
 * naming several is ambiguous, so the first that resolves wins and the rest
 * are ignored rather than guessed at.
 */
export function resolveToken<T>(
  reference: string | undefined,
  index: Map<string, T>,
): T | undefined {
  const raw = reference?.trim().toLowerCase() ?? "";
  if (!raw) return undefined;

  const exact = index.get(raw);
  if (exact) return exact;

  for (const token of raw.match(/[a-z]\d+/g) ?? []) {
    const item = index.get(token);
    if (item) return item;
  }

  return undefined;
}

/* ---------------------------------------------------------------- Mapping */

export type ResolvedMapping = {
  objective: StudyGuideObjective;
  status: CoverageStatus;
  cards: { card: Flashcard; status: "covered" | "partially_covered" }[];
  missingPoints: string[];
  rationale: string;
};

export type MappingValidation = {
  mappings: ResolvedMapping[];
  /** Card references the model invented; surfaced as an audit signal. */
  unresolvedReferences: number;
};

export function validateMapping(
  response: CoverageMappingResponse,
  objectives: Tokenized<StudyGuideObjective>[],
  cards: Tokenized<Flashcard>[],
): MappingValidation {
  const objectiveIndex = byToken(objectives);
  const cardIndex = byToken(cards);
  const returned = new Map<string, ResolvedMapping>();
  let unresolvedReferences = 0;

  for (const entry of response.objectives ?? []) {
    const objective = resolveToken(entry.objective, objectiveIndex);
    if (!objective) {
      unresolvedReferences += 1;
      continue;
    }

    const seen = new Set<string>();
    const resolvedCards: ResolvedMapping["cards"] = [];

    for (const reference of entry.cards ?? []) {
      const card = resolveToken(reference.card, cardIndex);
      if (!card) {
        unresolvedReferences += 1;
        continue;
      }
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      resolvedCards.push({ card, status: reference.status });
    }

    returned.set(objective.id, {
      objective,
      status: reconcile(entry.status, resolvedCards.length),
      cards: resolvedCards,
      missingPoints: (entry.missingPoints ?? []).filter((p) => p.trim()),
      rationale: entry.rationale?.trim() ?? "",
    });
  }

  // An objective the model skipped is not evidence of coverage. Recording it
  // as missing is the safe direction: it flows into the source-review pass
  // rather than silently reading as covered on the checklist.
  const mappings = objectives.map(
    ({ item }) =>
      returned.get(item.id) ?? {
        objective: item,
        status: "missing" as const,
        cards: [],
        missingPoints: [],
        rationale: "The coverage pass returned no judgement for this objective.",
      },
  );

  return { mappings, unresolvedReferences };
}

/**
 * Keeps the verdict consistent with the cards that actually resolved. A
 * "covered" verdict backed by no card, or a "missing" verdict that still
 * lists cards, would render as nonsense on the checklist.
 */
function reconcile(status: CoverageStatus, cardCount: number): CoverageStatus {
  if (cardCount === 0) return "missing";
  if (status === "missing") return "partially_covered";
  return status;
}

/* ----------------------------------------------------------------- Review */

export type ResolvedReview = {
  objective: StudyGuideObjective;
  sourceSupport: SourceSupport;
  slide?: SourceSlide;
  excerpt?: string;
  missingPoints: string[];
  note: string;
};

export type ReviewValidation = {
  reviews: ResolvedReview[];
  /** Reviews whose supporting quote was not actually in the cited slide. */
  unverifiedCitations: number;
};

export function validateReview(
  response: CoverageReviewResponse,
  objectives: Tokenized<StudyGuideObjective>[],
  slides: Tokenized<LabeledSlide>[],
): ReviewValidation {
  const objectiveIndex = byToken(objectives);
  const slideIndex = byToken(slides);
  const reviews: ResolvedReview[] = [];
  let unverifiedCitations = 0;

  for (const entry of response.reviews ?? []) {
    const objective = resolveToken(entry.objective, objectiveIndex);
    if (!objective) continue;

    const labeled = resolveToken(entry.slideCitation, slideIndex);
    const excerpt = entry.sourceExcerpt?.trim() ?? "";
    const verified =
      labeled !== undefined &&
      excerpt.length > 0 &&
      excerptAppearsIn(excerpt, labeled.slide);

    let sourceSupport = entry.sourceSupport;

    if (!verified && excerpt.length > 0) {
      // A claim that the material covers this, backed by a quote the material
      // does not contain, is exactly the hallucination PRD §3 forbids. Drop
      // the quote and stop short of "fully answered" rather than repeat it.
      unverifiedCitations += 1;
      if (sourceSupport === "answers") sourceSupport = "partial";
    }

    reviews.push({
      objective,
      sourceSupport,
      slide: verified ? labeled.slide : undefined,
      excerpt: verified ? excerpt : undefined,
      missingPoints: (entry.missingPoints ?? []).filter((p) => p.trim()),
      note: entry.note?.trim() ?? "",
    });
  }

  return { reviews, unverifiedCitations };
}

/* -------------------------------------------------------------- Conflicts */

export type ResolvedConflict = {
  topic: string;
  statementA: string;
  slideA: SourceSlide;
  statementB: string;
  slideB: SourceSlide;
  explanation: string;
};

export type ConflictValidation = {
  conflicts: ResolvedConflict[];
  /** Reported conflicts dropped because a quote did not check out. */
  unverified: number;
};

export function validateConflicts(
  response: ConflictResponse,
  slides: Tokenized<LabeledSlide>[],
): ConflictValidation {
  const slideIndex = byToken(slides);
  const conflicts: ResolvedConflict[] = [];
  const seen = new Set<string>();
  let unverified = 0;

  for (const entry of response.conflicts ?? []) {
    const a = resolveToken(entry.slideA, slideIndex);
    const b = resolveToken(entry.slideB, slideIndex);

    if (!a || !b || a.slide.id === b.slide.id) {
      unverified += 1;
      continue;
    }

    // A disagreement inside one file is an inconsistency worth seeing too, but
    // this pass only pairs slides across files, so a same-file pair means the
    // model mixed up its tokens.
    if (a.slide.sourceFileId === b.slide.sourceFileId) {
      unverified += 1;
      continue;
    }

    const statementA = entry.statementA?.trim() ?? "";
    const statementB = entry.statementB?.trim() ?? "";

    if (
      !statementA ||
      !statementB ||
      !excerptAppearsIn(statementA, a.slide) ||
      !excerptAppearsIn(statementB, b.slide)
    ) {
      unverified += 1;
      continue;
    }

    const key = [a.slide.id, b.slide.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    conflicts.push({
      topic: entry.topic?.trim() ?? "",
      statementA,
      slideA: a.slide,
      statementB,
      slideB: b.slide,
      explanation: entry.explanation?.trim() ?? "",
    });
  }

  return { conflicts, unverified };
}
