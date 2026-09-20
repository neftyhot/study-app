/**
 * Splits a study guide into discrete objectives.
 *
 * Deterministic structure-based parsing only. Guides that resist it (prose
 * paragraphs, inconsistent numbering) are a Phase 2 concern — an LLM pass can
 * be layered on top of the same output contract without changing callers.
 */
import { normalizeText } from "./types";

export type ParsedObjective = {
  orderIndex: number;
  /** The guide's own label, e.g. "7" or "A". Null when unlabeled. */
  label: string | null;
  promptText: string;
};

/** "7.", "7)", "Q7.", "(7)", "-", "*", "•" at the start of a line. */
const NUMBERED = /^\(?(?:Q(?:uestion)?\s*)?(\d{1,3}|[a-zA-Z])[.):]\s+(.*)$/;
const BULLETED = /^[-*•·]\s+(.*)$/;

/**
 * Headings we should not mistake for objectives.
 *
 * Covers both bare headings ("Objectives:", "Chapter 4") and qualified ones
 * ("Exam 2 Study Guide", "Week 3 Learning Objectives"), which is the common
 * real-world shape — a guide's own title would otherwise parse as objective 1.
 */
const HEADING =
  /^(?:(?:exam|chapter|unit|week|lecture|module)\s*\d*\s*)?(?:study\s+guide|learning\s+objectives?|objectives?|topics?|outline|review\s+sheet)\s*[:.]?$/i;

/** Bare section markers: "Exam 2", "Chapter 4", "Unit 3". */
const SECTION_HEADING =
  /^(?:exam|chapter|unit|week|lecture|module|part)\s+\d+\s*[:.]?$/i;

export function parseStudyGuide(text: string): ParsedObjective[] {
  const lines = normalizeText(text).split("\n");
  const objectives: ParsedObjective[] = [];

  let current: { label: string | null; parts: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const promptText = normalizeText(current.parts.join(" "));
    if (promptText) {
      objectives.push({
        orderIndex: objectives.length,
        label: current.label,
        promptText,
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (!line || HEADING.test(line) || SECTION_HEADING.test(line)) {
      flush();
      continue;
    }

    const numbered = line.match(NUMBERED);
    if (numbered) {
      flush();
      current = { label: numbered[1], parts: [numbered[2]] };
      continue;
    }

    const bulleted = line.match(BULLETED);
    if (bulleted) {
      flush();
      current = { label: null, parts: [bulleted[1]] };
      continue;
    }

    if (current) {
      // A wrapped continuation of the objective above.
      current.parts.push(line);
    } else {
      // Unstructured guide: treat each standalone line as its own objective.
      current = { label: null, parts: [line] };
      flush();
    }
  }

  flush();
  return objectives;
}
