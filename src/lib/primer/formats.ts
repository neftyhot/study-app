/**
 * The study guide's depths and formats, with the words the page shows for
 * them. Kept free of server imports so the format picker can use it.
 */
import type { PrimerDepth, PrimerFormat } from "@/db/schema";

/**
 * The most concepts one topic may hold at each depth. Seventy points across
 * seven topics is a lot to face, so a shorter guide keeps each topic's most
 * exam-relevant concepts rather than adding topics to fit the rest.
 */
export const TOPIC_CAP: Record<PrimerDepth, number> = {
  summary: 5,
  balanced: 10,
  foundational: 25,
};

export const PRIMER_DEPTHS: { id: PrimerDepth; label: string; blurb: string }[] = [
  {
    id: "summary",
    label: "Summary",
    blurb: `The key takeaways, nothing more. Up to ${TOPIC_CAP.summary} points per topic.`,
  },
  {
    id: "balanced",
    label: "Balanced",
    blurb: `A textbook walkthrough of each concept. Up to ${TOPIC_CAP.balanced} points per topic.`,
  },
  {
    id: "foundational",
    label: "First Principles (Foundational)",
    blurb: `Starts from zero: plain words, analogies, every step spelled out. Up to ${TOPIC_CAP.foundational} points per topic.`,
  },
];

export const PRIMER_FORMATS: { id: PrimerFormat; label: string; blurb: string }[] = [
  {
    id: "explained",
    label: "Explained",
    blurb: "Short paragraphs: what it is, how it works, and an example.",
  },
  {
    id: "bullets",
    label: "Key facts",
    blurb: "Bullet points of the facts you need to know, no paragraphs.",
  },
  {
    id: "qa",
    label: "Q&A self-test",
    blurb: "Questions to quiz yourself on, with the answers hidden until you check.",
  },
  {
    id: "compare",
    label: "Compare & contrast",
    blurb: "Each idea set against the ones it is most often confused with.",
  },
];

export function isPrimerDepth(value: unknown): value is PrimerDepth {
  return PRIMER_DEPTHS.some((depth) => depth.id === value);
}

export function isPrimerFormat(value: unknown): value is PrimerFormat {
  return PRIMER_FORMATS.some((format) => format.id === value);
}
