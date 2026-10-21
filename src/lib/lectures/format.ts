/**
 * Turning a stored transcript into things a person reads: timestamps, the
 * export files, and the notes a deck is given.
 *
 * Pure and free of `server-only`: the transcript page uses it in the browser
 * for copy and export, the "Add to deck" action uses it on the server.
 */
import type { TranscriptSegment } from "@/db/schema";

/** `4:07`, or `1:04:07` from the first hour on. */
export function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

/** `52 min`, `1 hr 4 min`, or `40 sec` for a clip. */
export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} hr ${rest} min` : `${minutes / 60} hr`;
}

/** SubRip's own clock: `01:04:07,250`. */
function srtClock(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(
    Math.floor(ms / 1000) % 60,
  )},${pad(ms % 1000, 3)}`;
}

export function toSrt(segments: TranscriptSegment[]) {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${srtClock(segment.start)} --> ${srtClock(segment.end)}\n${segment.text}\n`,
    )
    .join("\n");
}

/** One line per segment, each led by when it was said. */
export function toTimestampedText(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`)
    .join("\n");
}

/** How much of a lecture one section of deck notes covers. */
export const DECK_SECTION_SECONDS = 300;

/**
 * The transcript as Markdown notes for a deck: a heading every five minutes,
 * so a card made from it cites "12:30 – 17:30" of the lecture rather than
 * "section 1" of an hour of talking. A section runs on to the end of its
 * sentence instead of stopping mid-thought.
 */
export function toDeckNotes(
  title: string,
  segments: TranscriptSegment[],
  fullText = "",
) {
  if (segments.length === 0) return fullText.trim() ? `# ${title}\n\n${fullText.trim()}\n` : "";

  const sections: { start: number; end: number; text: string }[] = [];
  let current: { start: number; end: number; text: string } | null = null;

  for (const segment of segments) {
    const full =
      current !== null &&
      segment.start - current.start >= DECK_SECTION_SECONDS &&
      /[.?!]["')\]]?$/.test(current.text);

    if (current === null || full) {
      current = { start: segment.start, end: segment.end, text: segment.text };
      sections.push(current);
    } else {
      current.text = `${current.text} ${segment.text}`;
      current.end = segment.end;
    }
  }

  const body = sections
    .map(
      (section) =>
        `## ${formatTimestamp(section.start)} – ${formatTimestamp(section.end)}\n\n${section.text}`,
    )
    .join("\n\n");

  return `# ${title}\n\n${body}\n`;
}
