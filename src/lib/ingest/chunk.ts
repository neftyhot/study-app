/**
 * Cutting long sections down to about a slide's worth of material.
 *
 * Generation asks for cards per section, so a section is the unit of
 * attention: a slide deck of 40 slides gets 40 sections' worth of cards. A
 * lecture transcript has no slides and often no blank lines, so it used to
 * arrive as one section — an hour of lecture treated like one slide, and
 * given one slide's share of cards. Three transcripts, three sections, a
 * dozen cards.
 *
 * So any section longer than `MAX_WORDS` is split into pieces of about
 * `TARGET_WORDS`: roughly two minutes of speech, which holds about as many
 * testable points as a typical slide. Cuts fall at paragraph breaks, then
 * line breaks, then sentence ends — never mid-sentence — so a card's quote
 * lands whole inside one piece.
 */
import { normalizeText, type ExtractedUnit } from "./types";

export const TARGET_WORDS = 250;
export const MAX_WORDS = 400;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Breaks text into the smallest pieces it can be cut between. */
function atoms(text: string): { text: string; joiner: string }[] {
  const result: { text: string; joiner: string }[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    const lines = paragraph.split("\n");
    lines.forEach((line, lineIndex) => {
      const joiner = lineIndex === lines.length - 1 ? "\n\n" : "\n";
      // A long line — the usual shape of a transcript — is cut at sentences.
      if (wordCount(line) > TARGET_WORDS) {
        const sentences = line.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [line];
        sentences.forEach((sentence, i) =>
          result.push({ text: sentence.trimEnd(), joiner: i === sentences.length - 1 ? joiner : " " }),
        );
      } else {
        result.push({ text: line, joiner });
      }
    });
  }

  return result.filter((atom) => atom.text.trim());
}

/** Splits one long body into pieces of about `TARGET_WORDS`. */
export function splitText(text: string): string[] {
  if (wordCount(text) <= MAX_WORDS) return [text];

  const pieces: string[] = [];
  let current = "";
  let words = 0;

  for (const atom of atoms(text)) {
    const size = wordCount(atom.text);
    if (words > 0 && words + size > TARGET_WORDS) {
      pieces.push(current);
      current = "";
      words = 0;
    }
    current += atom.text + atom.joiner;
    words += size;
  }
  if (current.trim()) pieces.push(current);

  // A short tail reads better as the end of the piece before it.
  if (pieces.length > 1 && wordCount(pieces.at(-1)!) < TARGET_WORDS / 3) {
    const tail = pieces.pop()!;
    pieces[pieces.length - 1] += tail;
  }

  return pieces.map((piece) => normalizeText(piece));
}

/**
 * Every unit, with the long ones split and all renumbered from 1.
 *
 * A split section keeps its heading on every piece, marked "(2 of 4)", so a
 * card from the third piece still says which part of the notes it is from.
 * Tables and the image count stay with the first piece.
 */
export function splitLongUnits(units: ExtractedUnit[]): ExtractedUnit[] {
  const result: ExtractedUnit[] = [];

  for (const unit of units) {
    const pieces = splitText(unit.rawText);
    pieces.forEach((rawText, i) => {
      result.push({
        ...unit,
        index: result.length + 1,
        title:
          pieces.length === 1
            ? unit.title
            : `${unit.title ?? "Part"} (${i + 1} of ${pieces.length})`,
        rawText,
        tables: i === 0 ? unit.tables : [],
        imageCount: i === 0 ? unit.imageCount : 0,
      });
    });
  }

  return result;
}
