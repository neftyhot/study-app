import "server-only";

/**
 * Turning a source page into a picture.
 *
 * Rendered on demand and cached, never in bulk: a page comes out around
 * 850 KB, so rasterizing a 300-page deck up front would cost a quarter of a
 * gigabyte to produce images almost none of which would ever be looked at.
 * The first request for a page pays about two seconds; every later one is a
 * file read.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { eq } from "drizzle-orm";
import JSZip from "jszip";

import type { Db } from "@/db/client";
import { sourceFiles, sourceSlides } from "@/db/schema";
import { absolutePathFor, storedPath } from "@/lib/ingest/storage";

/** Big enough to read a small label, small enough to send over localhost. */
export const RENDER_SCALE = 1.6;

export class RenderError extends Error {}

/**
 * Renders in flight, keyed by slide.
 *
 * Two study tabs opening the same diagram would otherwise rasterize the same
 * page twice and race each other writing the file.
 */
const inFlight = new Map<string, Promise<string>>();

export type SlideImage = { path: string; data: Buffer };

export async function slideImage(db: Db, slideId: string): Promise<SlideImage> {
  const row = db
    .select({ slide: sourceSlides, file: sourceFiles })
    .from(sourceSlides)
    .innerJoin(sourceFiles, eq(sourceSlides.sourceFileId, sourceFiles.id))
    .where(eq(sourceSlides.id, slideId))
    .get();

  if (!row) throw new RenderError("That page is not in this library.");

  const { slide, file } = row;

  if (slide.imagePath) {
    try {
      return { path: slide.imagePath, data: await readFile(absolutePathFor(slide.imagePath)) };
    } catch {
      // The cache file was moved or deleted; fall through and rebuild it.
    }
  }

  const existing = inFlight.get(slideId);
  if (existing) {
    const path = await existing;
    return { path, data: await readFile(absolutePathFor(path)) };
  }

  const work = (async () => {
    const source = await readFile(absolutePathFor(file.rawPath));
    const image =
      file.fileType === "pdf"
        ? await renderPdfPage(source, slide.index)
        : file.fileType === "pptx"
          ? await extractPptxImage(source, slide.index)
          : file.fileType === "image"
            ? source
            : null;

    if (!image) {
      throw new RenderError(
        `A ${file.fileType.toUpperCase()} has no page to draw on. Diagram drills work on PDFs, PowerPoint slides and images.`,
      );
    }

    const path = storedPath("rendered", file.examId, `${slide.id}.png`);
    const absolute = absolutePathFor(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, image);

    db.update(sourceSlides)
      .set({ imagePath: path, hasDiagram: true })
      .where(eq(sourceSlides.id, slide.id))
      .run();

    return path;
  })();

  inFlight.set(slideId, work);
  try {
    const path = await work;
    return { path, data: await readFile(absolutePathFor(path)) };
  } finally {
    inFlight.delete(slideId);
  }
}

async function renderPdfPage(source: Buffer, pageNumber: number): Promise<Buffer> {
  const { renderPageAsImage } = await import("unpdf");

  const png = await renderPageAsImage(new Uint8Array(source), pageNumber, {
    scale: RENDER_SCALE,
    // unpdf will not guess at a canvas in Node; the Skia binding is passed in
    // explicitly so the failure mode is a missing dependency, not a blank page.
    canvasImport: () => import("@napi-rs/canvas"),
  });

  return Buffer.from(png);
}

/**
 * The biggest picture on a PowerPoint slide.
 *
 * PPTX has no page to rasterize, but it does carry its images as files. The
 * largest one on the slide is the diagram in practically every deck; logos and
 * bullet glyphs are the small ones.
 */
async function extractPptxImage(
  source: Buffer,
  slideNumber: number,
): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(source);

  const rels = zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`);
  if (!rels) return null;

  const xml = await rels.async("string");
  const targets = [...xml.matchAll(/Target="([^"]*media\/[^"]+)"/g)].map((m) =>
    m[1].replace(/^\.\.\//, "ppt/"),
  );

  let best: { data: Buffer; size: number } | null = null;
  for (const target of targets) {
    const entry = zip.file(target);
    if (!entry) continue;
    if (!/\.(png|jpe?g|gif|bmp)$/i.test(target)) continue;

    const data = Buffer.from(await entry.async("nodebuffer"));
    if (!best || data.byteLength > best.size) {
      best = { data, size: data.byteLength };
    }
  }

  return best?.data ?? null;
}
