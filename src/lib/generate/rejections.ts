/**
 * Rejected cards, explained to the student.
 *
 * "excerpt_not_in_source" means nothing to someone studying. What they need
 * to see is the card that was thrown away and one sentence on why — which is
 * also what shows the check is doing something rather than silently losing
 * cards.
 */
import type { SourceSlide } from "@/db/schema";

import { citationToken } from "./prompts";
import type { Rejection, RejectionReason } from "./validate";

export type RejectionView = {
  reason: RejectionReason;
  question: string;
  answer: string;
  /** What the model offered as proof, verbatim. */
  excerpt: string;
  /** "page 12 of Chapter 16.pdf", when the citation resolved. */
  where: string | null;
  /** One plain sentence. */
  explanation: string;
};

type FileInfo = { filename: string; fileType: string };

export function describeRejection(
  rejection: Rejection,
  batch: SourceSlide[],
  files: Map<string, FileInfo>,
): RejectionView {
  const { card } = rejection;
  const cited = batch.find(
    (slide) =>
      citationToken(slide).toLowerCase() ===
      card.slideCitation?.trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  const file = cited ? files.get(cited.sourceFileId) : undefined;
  const where =
    cited && file
      ? `${file.fileType === "pptx" ? "slide" : "page"} ${cited.index} of ${readableName(file.filename)}`
      : null;

  return {
    reason: rejection.reason,
    question: card.question ?? "",
    answer: card.directAnswer ?? "",
    excerpt: card.sourceExcerpt ?? "",
    where,
    explanation: explain(rejection.reason, where, card.slideCitation),
  };
}

function explain(
  reason: RejectionReason,
  where: string | null,
  citation: string | undefined,
): string {
  switch (reason) {
    case "excerpt_not_in_source":
      return `The quote it gave as proof is not word-for-word on ${where ?? "the page it cited"} or any page it was reading, so the answer could not be checked against your material and the card was discarded.`;
    case "unknown_citation":
      return `It cited "${citation ?? "nothing"}", which is not one of the pages it was given, so there was nothing to check the answer against.`;
    case "duplicate":
      return "Your deck already has a card asking exactly this question, so the copy was skipped.";
    case "empty_content":
      return "The question or the answer came back blank.";
  }
}

/** A short heading for each reason, for grouping in the panel. */
export const REJECTION_HEADINGS: Record<RejectionReason, string> = {
  excerpt_not_in_source: "Quote not found in your material",
  unknown_citation: "Cited a page it was not given",
  duplicate: "Already in your deck",
  empty_content: "Blank card",
};

/** "Chapter+16+Sense+Organs.pdf" as a person would write it. */
function readableName(filename: string): string {
  return filename.replace(/\+/g, " ").replace(/\.(pdf|pptx|docx|txt|md)$/i, "");
}
