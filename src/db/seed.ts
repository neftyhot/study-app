/**
 * Minimal development seed: one course with one upcoming exam.
 * Idempotent — re-running leaves existing rows untouched.
 */
import { eq } from "drizzle-orm";

import { createClient } from "./client";
import { courses, exams } from "./schema";

const COURSE_TITLE = "Human Physiology";
const EXAM_TITLE = "Exam 2 — Endocrine System";

const db = createClient();

async function main() {
  const existing = db
    .select()
    .from(courses)
    .where(eq(courses.title, COURSE_TITLE))
    .get();

  const course =
    existing ??
    db
      .insert(courses)
      .values({ title: COURSE_TITLE, term: "Fall 2026" })
      .returning()
      .get();

  const existingExam = db
    .select()
    .from(exams)
    .where(eq(exams.title, EXAM_TITLE))
    .get();

  const exam =
    existingExam ??
    db
      .insert(exams)
      .values({
        courseId: course.id,
        title: EXAM_TITLE,
        date: "2026-10-15",
        scopeMode: "objectives",
      })
      .returning()
      .get();

  console.log(`Seeded course ${course.id} / exam ${exam.id}`);
}

main();
