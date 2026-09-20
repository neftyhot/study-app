/**
 * Rich Text Format extraction (PRD §1).
 *
 * RTF is a control-word format, not a markup one, so there is no tree to walk:
 * the text is whatever survives once the control words and the groups that
 * exist only to describe fonts, colours and styles are removed. Once it is
 * plain text it chunks exactly like a .txt file.
 */
import { extractPlainText } from "./text";
import type { ExtractionResult } from "./types";

/** Groups whose contents are metadata, never body text. */
const SKIPPED_DESTINATIONS =
  /\{\\\*?\\(?:fonttbl|colortbl|stylesheet|info|generator|pict|object|themedata|colorschememapping|latentstyles|datastore|xmlnstbl)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gi;

export function rtfToText(rtf: string): string {
  let text = rtf.replace(SKIPPED_DESTINATIONS, "");

  text = text
    // Paragraph and line breaks are the only formatting that survives.
    .replace(/\\par[d]?\b ?/g, "\n")
    .replace(/\\line\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\cell\b ?/g, "\t")
    .replace(/\\row\b ?/g, "\n")
    // \'hh is a byte in the document's code page; assume Latin-1.
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    // \uN is a Unicode code point, followed by a fallback character to drop.
    .replace(/\\u(-?\d+)\??/g, (_, code: string) =>
      String.fromCharCode(((Number(code) % 65536) + 65536) % 65536),
    )
    // Literal braces are stashed as sentinels: the brace-stripping pass below
    // cannot tell an escaped `\{` from a group delimiter otherwise.
    .replace(/\\\\/g, "\u0000")
    .replace(/\\\{/g, "\u0001")
    .replace(/\\\}/g, "\u0002")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\u0000/g, "\\")
    .replace(/\u0001/g, "{")
    .replace(/\u0002/g, "}");

  return text;
}

export async function extractRtf(buffer: Buffer): Promise<ExtractionResult> {
  return extractPlainText(rtfToText(buffer.toString("utf8")));
}
