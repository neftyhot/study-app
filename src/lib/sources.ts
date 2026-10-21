/**
 * The "how did you hear about us" answers. Kept apart from the funnel so the
 * setup screen, which runs in the browser, can list them without the database.
 */
export const SOURCES = ["poster", "friend", "professor", "social", "other"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  poster: "A poster",
  friend: "A friend",
  professor: "A professor",
  social: "Social media",
  other: "Somewhere else",
};

export function isSource(value: unknown): value is Source {
  return SOURCES.includes(value as Source);
}
