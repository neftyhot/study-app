/**
 * PDF extraction via `unpdf` (a serverless-friendly pdf.js build).
 *
 * Text only — diagram and image-label extraction needs the vision pass, which
 * is out of MVP scope. Pages that come back empty are flagged as likely-scanned
 * so the student knows the pipeline cannot see them (PRD §3).
 */
import { extractText, getDocumentProxy } from "unpdf";

import {
  classifyLegibility,
  normalizeText,
  type ExtractedUnit,
  type ExtractionResult,
  type ExtractionWarning,
} from "./types";

export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: pages } = await extractText(pdf, { mergePages: false });

  const warnings: ExtractionWarning[] = [];

  if (pages.length === 0) {
    return {
      units: [],
      warnings: [
        { index: null, code: "no_units", message: "PDF contains no pages." },
      ],
    };
  }

  const units: ExtractedUnit[] = pages.map((pageText, position) => {
    const index = position + 1; // 1-based, matching the reader's page number.
    const rawText = normalizeText(pageText ?? "");

    // Slide-style PDFs usually lead with the slide title on its own line.
    const [firstLine, ...rest] = rawText.split("\n");
    const looksLikeTitle =
      firstLine !== undefined && firstLine.length > 0 && firstLine.length <= 120;

    return {
      index,
      title: looksLikeTitle ? firstLine : null,
      rawText: looksLikeTitle ? rest.join("\n").trim() : rawText,
      speakerNotes: null, // PDFs have no notes concept.
      tables: [], // Table reconstruction from PDF text needs the vision pass.
      // unpdf's text API does not report images; a text-free page is the
      // signal that matters here, and classifyLegibility catches it as "empty".
      imageCount: 0,
    };
  });

  for (const unit of units) {
    if (classifyLegibility(unit) !== "ok") {
      warnings.push({
        index: unit.index,
        code: "unreadable_unit",
        message: `Page ${unit.index} has no extractable text; it is likely a scan or an image-only page.`,
      });
    }
  }

  return { units, warnings };
}
