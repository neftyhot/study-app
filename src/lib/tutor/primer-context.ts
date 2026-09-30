import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db/client";
import { primerGuides, primerSections, primerTopics } from "@/db/schema";
import { loadPrimerSlides, slideKey } from "@/lib/primer";
import { exampleView, type CitedSentence } from "@/lib/primer/types";

/**
 * How much of a study-guide topic goes with a question, in characters. The
 * local model reads 8k tokens in all, so it gets a shorter excerpt.
 */
const BUDGET: Record<string, number> = { local: 6_000 };
const DEFAULT_BUDGET = 30_000;

function sentences(list: CitedSentence[]) {
  return list.map((sentence) => sentence.text.trim()).filter(Boolean).join(" ");
}

function renderSection(section: typeof primerSections.$inferSelect, current: boolean) {
  const parts = [`### ${section.conceptName}${current ? " (the concept the student asked from)" : ""}`];
  const definition = sentences(section.definition);
  if (definition) parts.push(definition);
  const breakdown = sentences(section.breakdown);
  if (breakdown) parts.push(breakdown);
  const example = sentences(section.example);
  if (example) parts.push(`Example 1: ${example}`);

  const offset = section.example.length > 0 ? 2 : 1;
  (section.extraExamples ?? []).forEach((extra, i) => {
    const { text, calculations } = exampleView(extra);
    parts.push(`Example ${i + offset}: ${text}`);
    if (calculations.length > 0) {
      parts.push(
        "Calculations shown beside it:\n" +
          calculations
            .map((step, j) => `${j + 1}. ${step.label}: ${step.expression} = ${step.result}`)
            .join("\n"),
      );
    }
  });

  const counter = section.counterExample;
  if (counter) {
    parts.push(
      `What this isn't: misconception: ${counter.misconception} Incorrect application: ${counter.incorrectApplication} Why it's flawed: ${counter.whyFlawed}`,
    );
  }
  return parts.join("\n");
}

/**
 * What the student is reading in the study guide, for the tutor: the whole
 * topic the concept sits in (every concept, example, calculation and
 * counter-example written so far), then the lecture slides the concept cites.
 *
 * Null when the section is gone or belongs to another deck.
 */
export function primerTopicContext(
  database: Db,
  examId: string,
  sectionId: string,
  providerName: string,
): { text: string; conceptName: string; topicTitle: string | null } | null {
  const section = database
    .select()
    .from(primerSections)
    .where(eq(primerSections.id, sectionId))
    .get();
  if (!section) return null;

  const guide = database
    .select({ examId: primerGuides.examId })
    .from(primerGuides)
    .where(eq(primerGuides.id, section.guideId))
    .get();
  if (!guide || guide.examId !== examId) return null;

  const topic = section.topicId
    ? database.select().from(primerTopics).where(eq(primerTopics.id, section.topicId)).get()
    : undefined;

  const siblings = database
    .select()
    .from(primerSections)
    .where(
      and(
        eq(primerSections.guideId, section.guideId),
        section.topicId ? eq(primerSections.topicId, section.topicId) : isNull(primerSections.topicId),
      ),
    )
    .orderBy(asc(primerSections.orderIndex))
    .all();

  const cited = new Set(
    [...section.definition, ...section.breakdown, ...section.example]
      .filter((s) => s.source_document_index !== null && s.source_slide_number !== null)
      .map((s) => slideKey(s.source_document_index!, s.source_slide_number!)),
  );
  const slides = loadPrimerSlides(database, examId)
    .filter((slide) => cited.has(slideKey(slide.documentIndex, slide.slideNumber)))
    .map((slide) => `[Lecture ${slide.documentIndex}, slide ${slide.slideNumber}]\n${slide.text}`);

  const budget = BUDGET[providerName] ?? DEFAULT_BUDGET;
  const current = renderSection(section, true);
  const slideText = slides.length
    ? `## Lecture slides "${section.conceptName}" cites\n\n${slides.join("\n\n")}`
    : "";

  // The concept asked from and its slides come first, so a small budget
  // still has them; the rest of the topic fills what is left.
  const header = `## Study guide topic the student is reading: ${topic?.title ?? "Concepts"}${topic?.intro ? `\n${topic.intro}` : ""}`;
  const others = siblings.filter((s) => s.id !== section.id).map((s) => renderSection(s, false));

  let text = [header, current, slideText].filter(Boolean).join("\n\n");
  for (const other of others) {
    if (text.length + other.length + 2 > budget) break;
    text += `\n\n${other}`;
  }
  if (text.length > budget) text = `${text.slice(0, budget)}…`;

  return { text, conceptName: section.conceptName, topicTitle: topic?.title ?? null };
}
