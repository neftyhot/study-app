/**
 * Course admin is not course content.
 *
 * Lecture decks often open with announcements, due dates, office hours and
 * grading policy, and a syllabus pasted in is nothing else. Left alone, the
 * model dutifully turns them into cards ("When is Quiz 2 due?"). With the
 * toggle on — the default — both prompts say to leave them out.
 */
export const SKIP_LOGISTICS_RULE = `IGNORE COURSE LOGISTICS
Make nothing from announcements or course administration: due dates,
deadlines, exam or quiz dates and times, room numbers, office hours,
instructor or TA contact details, grading weights and policies, attendance or
late-work rules, reading assignments, "reminders", "housekeeping" and
"agenda" slides, or a syllabus's schedule. Skip such slides, and skip such
lines on a slide that also teaches something, even when the material states
them plainly. Subject matter on the same slides still counts.`;

/** An old client that sends nothing gets the default, on. */
export function readSkipLogistics(value: unknown): boolean {
  return value !== false;
}
