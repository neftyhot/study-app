/**
 * Provenance enforcement (ARCHITECTURE principle #1, PRD §3).
 *
 * A schema can require a citation field; it cannot make the citation true.
 * This module checks that every card's cited slide exists AND that its excerpt
 * really occurs in that slide's text. A card whose excerpt appears nowhere in
 * the source was not derived from the source, so it is dropped rather than
 * stored — that is what "never hallucinate answers when source material is
 * silent" means in practice.
 */
import type { SourceSlide } from "@/db/schema";

import { citationToken } from "./prompts";
import type { GeneratedCard } from "./schemas";

export type RejectionReason =
  | "unknown_citation"
  | "excerpt_not_in_source"
  | "empty_content"
  | "duplicate";

export type Rejection = {
  card: GeneratedCard;
  reason: RejectionReason;
  detail: string;
};

export type ValidatedCard = {
  card: GeneratedCard;
  slide: SourceSlide;
  /** Set when the excerpt was found on a different slide than the one cited. */
  repairedFrom?: string;
};

export type ValidationResult = {
  accepted: ValidatedCard[];
  rejected: Rejection[];
};

/**
 * Normalizes for comparison only: lowercase, collapse whitespace, and fold the
 * punctuation that varies between a slide's XML and a model's transcription
 * (curly vs. straight quotes, en/em dashes). Deliberately not stripping words —
 * the check must still fail for fabricated content.
 */
export function normalizeForMatch(value: string): string {
  return stripBullets(value)
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Removes list markers, which are layout rather than content.
 *
 * Slides put "•" or "–" at the start of every line, and a model quoting two
 * lines drops them — so "limited to head • Vision, hearing" on the slide
 * never matched "limited to head Vision, hearing" in the excerpt, and a card
 * quoting the slide exactly was thrown away. That was most of the
 * rejections measured on a real deck. PDF extraction also leaves glyphs from
 * the Private Use Area (icon-font arrows and bullets) that no model reproduces.
 */
function stripBullets(value: string): string {
  return value
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/(^|\n)[ \t]*(?:[•◦▪▫‣⁃●○■□►▸➢✓*]|[-–—](?=\s))[ \t]*/g, "$1")
    .replace(/[ \t]+[•◦▪▫‣⁃●○■□►▸➢][ \t]+/g, " ");
}

/** Every piece of text a card may legitimately quote from a slide. */
function searchableText(slide: SourceSlide): string {
  return normalizeForMatch(
    [
      slide.title ?? "",
      slide.rawText,
      slide.speakerNotes ?? "",
      slide.tables
        .flatMap((t) => t.rows.flatMap((row) => row))
        .join(" "),
    ].join(" "),
  );
}

/**
 * Splits an excerpt on ellipses into the fragments that must each be verbatim.
 *
 * Models mark truncation with "..." or "…" ("Release is triggered by...").
 * Treating those as literal characters rejects a genuinely verbatim quote, so
 * they are treated as gaps instead. Each fragment is still matched exactly.
 */
function excerptFragments(excerpt: string): string[] {
  // Line and sentence breaks are gaps too. A model quoting three bullets in
  // order, skipping the sub-bullet between them, has done exactly what "..."
  // permits — it just did not write the dots. Each piece is still matched
  // verbatim and in order, so nothing that is not on the slide gets through.
  return stripBullets(excerpt)
    // A spaced dash or bullet mid-line is where the model joined two slide
    // lines ("bony labyrinth – Filled with endolymph").
    .split(/\n+|(?<=[.;!?])\s+(?=\S)|\s+[–—•]\s+/)
    .flatMap((line) => normalizeForMatch(line).split(/\s*(?:\.{3,}|\u2026)\s*/))
    .map((fragment) => fragment.replace(/[.;:,]+$/, "").trim())
    .filter(Boolean);
}

/**
 * True when every fragment of the excerpt occurs in the slide, in order.
 *
 * Requiring order as well as presence is what keeps this a real check: a card
 * cannot pass by stitching together words scattered across the slide, and any
 * fragment the slide does not contain still fails outright.
 */
export function excerptAppearsIn(excerpt: string, slide: SourceSlide): boolean {
  const fragments = excerptFragments(excerpt);
  if (fragments.length === 0) return false;

  const haystack = searchableText(slide);
  let cursor = 0;

  for (const fragment of fragments) {
    const found = haystack.indexOf(fragment, cursor);
    if (found === -1) return false;
    cursor = found + fragment.length;
  }

  return true;
}

/**
 * Resolves a citation to a slide, tolerating the shapes models actually emit.
 *
 * An integration card spans concepts, so the model sometimes cites several
 * slides ("S2, S3") or decorates the token ("[S2]"). Any S-token that resolves
 * is enough to proceed: the excerpt check below is the real gate, and it
 * re-points the card at whichever slide actually contains the quote.
 */
function resolveCitation(
  citation: string | undefined,
  byToken: Map<string, SourceSlide>,
): SourceSlide | undefined {
  const raw = citation?.trim().toLowerCase() ?? "";
  if (!raw) return undefined;

  const exact = byToken.get(raw);
  if (exact) return exact;

  for (const token of raw.match(/s\d+/g) ?? []) {
    const slide = byToken.get(token);
    if (slide) return slide;
  }

  return undefined;
}

export function validateCards(
  cards: GeneratedCard[],
  slides: SourceSlide[],
  options?: { existingQuestions?: Iterable<string> },
): ValidationResult {
  const byToken = new Map(
    slides.map((slide) => [citationToken(slide).toLowerCase(), slide]),
  );

  const seen = new Set(
    [...(options?.existingQuestions ?? [])].map(normalizeForMatch),
  );

  const accepted: ValidatedCard[] = [];
  const rejected: Rejection[] = [];

  for (const card of cards) {
    if (!card.question?.trim() || !card.directAnswer?.trim()) {
      rejected.push({
        card,
        reason: "empty_content",
        detail: "Question or answer was empty.",
      });
      continue;
    }

    const cited = resolveCitation(card.slideCitation, byToken);
    if (!cited) {
      rejected.push({
        card,
        reason: "unknown_citation",
        detail: `Cited "${card.slideCitation}", which is not a slide in this batch.`,
      });
      continue;
    }

    let slide = cited;
    let repairedFrom: string | undefined;

    if (!excerptAppearsIn(card.sourceExcerpt, slide)) {
      // The excerpt may be genuine but attributed to the wrong slide. Repairing
      // keeps a good card and still leaves provenance exact; only a card whose
      // excerpt exists on NO slide is treated as fabricated.
      const actual = slides.find((candidate) =>
        excerptAppearsIn(card.sourceExcerpt, candidate),
      );

      if (!actual) {
        rejected.push({
          card,
          reason: "excerpt_not_in_source",
          detail: `Excerpt does not appear on ${card.slideCitation} or any other slide in this batch.`,
        });
        continue;
      }

      slide = actual;
      repairedFrom = card.slideCitation;
    }

    const key = normalizeForMatch(card.question);
    if (seen.has(key)) {
      rejected.push({
        card,
        reason: "duplicate",
        detail: "A card with this question already exists.",
      });
      continue;
    }
    seen.add(key);

    accepted.push({ card, slide, repairedFrom });
  }

  return { accepted, rejected };
}
