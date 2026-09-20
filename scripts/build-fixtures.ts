/**
 * Regenerates the ingestion test fixtures. Run with `npm run fixtures`.
 *
 * The fixtures are built with third-party writers (pptxgenjs, pdf-lib) rather
 * than hand-written XML on purpose: a fixture written to match our own parser's
 * assumptions would test nothing.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

const OUT_DIR = join(process.cwd(), "src/lib/ingest/__fixtures__");

/** 12 slides, so slide10 vs. slide2 filename-sort bugs actually surface. */
const SLIDE_COUNT = 12;

async function buildPptx() {
  const pptx = new PptxGenJS();

  let tableSlide: ReturnType<PptxGenJS["addSlide"]> | undefined;

  for (let n = 1; n <= SLIDE_COUNT; n++) {
    const slide = pptx.addSlide();
    if (n === 5) tableSlide = slide;

    slide.addText(`Slide ${n} Title`, {
      placeholder: "title",
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 1,
      fontSize: 28,
    });

    slide.addText(
      [
        { text: `Body line one for slide ${n}`, options: { breakLine: true } },
        { text: `Body line two for slide ${n}`, options: { breakLine: true } },
      ],
      { x: 0.5, y: 1.5, w: 9, h: 2, fontSize: 16 },
    );

    slide.addNotes(`Speaker notes for slide ${n}.`);
  }

  // Slide 5 also carries a table, to prove table cells are captured
  // and not duplicated into rawText.
  if (!tableSlide) throw new Error("expected a slide 5 to attach the table to");

  tableSlide.addText("Hormone Comparison", {
    x: 0.5,
    y: 3.4,
    w: 9,
    h: 0.5,
    fontSize: 14,
  });
  tableSlide.addTable(
    [
      ["Hormone", "Origin", "Action"],
      ["ADH", "Posterior pituitary", "Water reabsorption"],
      ["Aldosterone", "Adrenal cortex", "Sodium retention"],
    ].map((row) => row.map((text) => ({ text }))),
    { x: 0.5, y: 4, w: 9 },
  );

  const data = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  writeFileSync(join(OUT_DIR, "sample-deck.pptx"), data);
  console.log(`Wrote sample-deck.pptx (${SLIDE_COUNT} slides)`);
}

async function buildPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let n = 1; n <= 3; n++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Page ${n} Heading`, { x: 50, y: 720, size: 22, font });
    page.drawText(`Content for page ${n}.`, { x: 50, y: 680, size: 12, font });
  }

  // A deliberately text-free page, to exercise the legibility flag.
  pdf.addPage([612, 792]);

  writeFileSync(join(OUT_DIR, "sample-notes.pdf"), await pdf.save());
  console.log("Wrote sample-notes.pdf (4 pages, last one blank)");
}

/** A numbered study guide, for the objective-parsing path. */
async function buildStudyGuidePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);

  const lines = [
    "Exam 2 Study Guide",
    "1. Describe where ADH is produced and released.",
    "2. Explain the triggers for aldosterone secretion.",
    "3. List the target tissues of insulin and their receptors.",
    "4. Compare the feedback loops regulating cortisol and thyroid hormone.",
  ];

  let y = 720;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 28;
  }

  writeFileSync(join(OUT_DIR, "study-guide.pdf"), await pdf.save());
  console.log("Wrote study-guide.pdf (4 numbered objectives)");
}

async function main() {
  await buildPptx();
  await buildPdf();
  await buildStudyGuidePdf();
}

main();
