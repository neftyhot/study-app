/** The library: courses and the decks in them, with what is due today. */
import type { SqlDriver } from "@megan/core/platform/types";
import { todayIso } from "@megan/core/srs/schedule";

export type DeckSummary = {
  examId: string;
  title: string;
  cardCount: number;
  dueCount: number;
  newCount: number;
  starredCount: number;
  hasGuide: boolean;
};

export type CourseSummary = {
  courseId: string;
  title: string;
  term: string | null;
  decks: DeckSummary[];
};

type Row = {
  course_id: string;
  course_title: string;
  term: string | null;
  exam_id: string | null;
  exam_title: string | null;
  card_count: number | null;
  due_count: number | null;
  new_count: number | null;
  starred_count: number | null;
  guide_count: number | null;
};

export async function listCourses(db: SqlDriver, today = todayIso()): Promise<CourseSummary[]> {
  const rows = await db.all<Row>(
    `SELECT c.id AS course_id, c.title AS course_title, c.term, e.id AS exam_id, e.title AS exam_title,
       (SELECT count(*) FROM flashcards f WHERE f.exam_id = e.id AND f.excluded = 0 AND f.deleted_at IS NULL) AS card_count,
       (SELECT count(*) FROM flashcards f JOIN study_progress p ON p.flashcard_id = f.id
          WHERE f.exam_id = e.id AND f.excluded = 0 AND f.deleted_at IS NULL
            AND p.next_review_due IS NOT NULL AND p.next_review_due <= ?) AS due_count,
       (SELECT count(*) FROM flashcards f LEFT JOIN study_progress p ON p.flashcard_id = f.id
          WHERE f.exam_id = e.id AND f.excluded = 0 AND f.deleted_at IS NULL
            AND (p.id IS NULL OR p.state = 'unstudied')) AS new_count,
       (SELECT count(*) FROM flashcards f WHERE f.exam_id = e.id AND f.starred = 1 AND f.deleted_at IS NULL) AS starred_count,
       (SELECT count(*) FROM primer_guides g WHERE g.exam_id = e.id) AS guide_count
     FROM courses c
     LEFT JOIN exams e ON e.course_id = c.id AND e.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
     ORDER BY c.created_at DESC, c.title ASC, e.created_at ASC`,
    [today],
  );

  const courses = new Map<string, CourseSummary>();
  for (const row of rows) {
    let course = courses.get(row.course_id);
    if (!course) {
      course = { courseId: row.course_id, title: row.course_title, term: row.term, decks: [] };
      courses.set(row.course_id, course);
    }
    if (row.exam_id) {
      course.decks.push({
        examId: row.exam_id,
        title: row.exam_title ?? "Untitled deck",
        cardCount: row.card_count ?? 0,
        dueCount: row.due_count ?? 0,
        newCount: row.new_count ?? 0,
        starredCount: row.starred_count ?? 0,
        hasGuide: (row.guide_count ?? 0) > 0,
      });
    }
  }
  // A course with no decks left is only clutter on a phone.
  return [...courses.values()].filter((course) => course.decks.length > 0);
}

export async function loadDeck(db: SqlDriver, examId: string): Promise<{ title: string; course: string } | null> {
  const [row] = await db.all<{ title: string; course: string }>(
    "SELECT e.title, c.title AS course FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?",
    [examId],
  );
  return row ?? null;
}

/** Cards due today or earlier, across every deck — the reminder's number. */
export async function countAllDue(db: SqlDriver, today = todayIso()): Promise<number> {
  const [row] = await db.all<{ n: number }>(
    `SELECT count(*) AS n FROM study_progress p JOIN flashcards f ON f.id = p.flashcard_id
     WHERE f.excluded = 0 AND f.deleted_at IS NULL AND p.next_review_due IS NOT NULL AND p.next_review_due <= ?`,
    [today],
  );
  return row?.n ?? 0;
}

/** Cards that will be due on or before `day`, for reminders scheduled ahead. */
export async function countDueBy(db: SqlDriver, day: string): Promise<number> {
  return countAllDue(db, day);
}

/**
 * Removes a deck and everything in it. The schema cascades from the exam to
 * its cards, rubrics, progress and guide; the course goes too once empty.
 */
export async function deleteDeck(db: SqlDriver, examId: string): Promise<void> {
  await db.transaction(async () => {
    const [row] = await db.all<{ course_id: string }>("SELECT course_id FROM exams WHERE id = ?", [examId]);
    await db.run("DELETE FROM exams WHERE id = ?", [examId]);
    if (row) {
      const [left] = await db.all<{ n: number }>("SELECT count(*) AS n FROM exams WHERE course_id = ?", [row.course_id]);
      if ((left?.n ?? 0) === 0) await db.run("DELETE FROM courses WHERE id = ?", [row.course_id]);
    }
  });
}
