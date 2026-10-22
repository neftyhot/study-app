/**
 * DOCX extraction (PRD §1): mammoth's Node build turns the file into HTML,
 * and the shared core (packages/core/src/ingest/docx.ts) splits it into
 * sections, the same way the iOS app does.
 */
import mammoth from "mammoth";

import { STYLE_MAP, docxHtmlToResult } from "@megan/core/ingest/docx";
import type { ExtractionResult } from "@megan/core/ingest/types";

import { loadZipWithinLimits } from "./zip-limits";

export { parseBlocks, sectionize } from "@megan/core/ingest/docx";

export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  // mammoth unpacks the whole archive itself, so its size is checked first.
  await loadZipWithinLimits(buffer);

  const { value: html, messages } = await mammoth.convertToHtml(
    { buffer },
    { styleMap: STYLE_MAP },
  );

  return docxHtmlToResult(
    html,
    messages.filter((message) => message.type === "error").map((message) => message.message),
  );
}
