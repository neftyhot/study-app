/** What the home screen's drop zone does with a filename before anything is uploaded. */

export type QuickRole = "slides" | "study_guide";

export const QUICK_ACCEPT = ".pdf,.pptx,.docx";

/** A file called "study guide" or "review sheet" is almost certainly one. */
export function guessRole(filename: string): QuickRole {
  return /study[\s_-]*guide|review[\s_-]*sheet|objectives/i.test(filename)
    ? "study_guide"
    : "slides";
}

/** "Lecture 3 - Cell Biology.pdf" → "Lecture 3 - Cell Biology". */
export function deckNameFrom(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}

export function isAccepted(filename: string): boolean {
  return /\.(pdf|pptx|docx)$/i.test(filename);
}
