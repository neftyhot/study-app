/**
 * Which units a run will actually read.
 *
 * Pure arithmetic over the page numbers the student sees, shared by the panel
 * that shows the estimate and the tests that check it. The server does the
 * real filtering against the database; this is the honest approximation the
 * UI can make from bounds and counts alone.
 */

export type SourceOption = {
  id: string;
  filename: string;
  fileType: string;
  /** Units with readable text — fewer than the span when pages were blank. */
  units: number;
  firstIndex: number;
  lastIndex: number;
};

export type FileChoice = {
  included: boolean;
  /** False when the student narrowed this file to a range. */
  whole: boolean;
  from: number;
  to: number;
};

export function defaultChoices(
  sources: SourceOption[],
): Record<string, FileChoice> {
  return Object.fromEntries(
    sources.map((source) => [
      source.id,
      {
        included: true,
        whole: true,
        from: source.firstIndex,
        to: source.lastIndex,
      },
    ]),
  );
}

/**
 * How many readable units a range covers.
 *
 * Unreadable pages are scattered through a file rather than gathered at one
 * end, so this scales the range by the share of the file that had text
 * instead of pretending every page in it will be usable.
 */
export function unitsInRange(source: SourceOption, choice?: FileChoice): number {
  if (!choice) return source.units;
  if (!choice.included) return 0;
  if (choice.whole) return source.units;

  const span = source.lastIndex - source.firstIndex + 1;
  if (span <= 0) return 0;

  const overlap =
    Math.min(choice.to, source.lastIndex) -
    Math.max(choice.from, source.firstIndex) +
    1;
  if (overlap <= 0) return 0;

  return Math.round(overlap * (source.units / span));
}

export function selectedUnits(
  sources: SourceOption[],
  choices: Record<string, FileChoice>,
): number {
  return sources.reduce(
    (total, source) => total + unitsInRange(source, choices[source.id]),
    0,
  );
}
