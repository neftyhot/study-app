import "server-only";

/**
 * PowerPoint slides as they actually look.
 *
 * A PPTX is a zip of XML, not pictures. The desktop app draws it itself: its
 * own server serves a page that lays each slide out in HTML and SVG, and a
 * hidden window photographs one slide at a time (electron/slide-drawer.cjs,
 * src/app/api/decks). That needs no presentation program, asks for no
 * permission and opens no folder picker, so it works the same everywhere.
 *
 * Where that is unavailable (a plain `next dev` server) or fails on a deck,
 * LibreOffice, if installed, converts the deck to a PDF whose pages stand in
 * for the slides. Failing both, the viewer shows each slide's text and its
 * largest picture, as before. None of this uses AI.
 */
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { and, asc, eq, like } from "drizzle-orm";

import type { Db } from "@/db/client";
import { sourceFiles, sourceSlides } from "@/db/schema";

import { absolutePathFor, storedPath } from "./storage";

const run = promisify(execFile);

const CONVERT_TIMEOUT_MS = 180_000;

/** The file name a whole drawn slide is cached under. */
export const WHOLE_SLIDE = ".slide.png";

declare global {
  /** Set by the desktop app (electron/main.cjs): one PNG per slide, in order. */
  var __studyAppDrawSlides: ((pageUrl: string) => Promise<Uint8Array[]>) | undefined;
}

type DeckFile = Pick<
  typeof sourceFiles.$inferSelect,
  "id" | "examId" | "rawPath"
>;

/** How a deck's slides can be shown whole, if at all. */
export type DeckPictures =
  | { kind: "drawn" }
  | { kind: "pdf"; pdf: Buffer };

export function wholeSlidePath(examId: string, slideId: string) {
  return storedPath("rendered", examId, `${slideId}${WHOLE_SLIDE}`);
}

function drawnMarkerPath(file: Pick<DeckFile, "id" | "examId">) {
  return storedPath("rendered", file.examId, `${file.id}.drawn`);
}

function deckPdfPath(file: Pick<DeckFile, "id" | "examId">) {
  return storedPath("rendered", file.examId, `${file.id}.pdf`);
}

/** Decks nothing could draw this session, so each page does not retry. */
const failed = new Set<string>();
const inFlight = new Map<string, Promise<DeckPictures | null>>();

/**
 * Makes sure the deck's slides can be shown whole, drawing them the first
 * time. Null when neither way works, or when the result has a different
 * number of slides (hidden ones left out, say) and so would put the wrong
 * picture on a slide.
 */
export async function deckPictures(
  db: Db,
  file: DeckFile,
): Promise<DeckPictures | null> {
  const cached = await readCached(file);
  if (cached) return cached;
  if (failed.has(file.id)) return null;

  const existing = inFlight.get(file.id);
  if (existing) return existing;

  const work = (async (): Promise<DeckPictures | null> => {
    if (await drawInApp(db, file)) return { kind: "drawn" };
    const pdf = await convertWithLibreOffice(db, file);
    if (pdf) return { kind: "pdf", pdf };
    failed.add(file.id);
    return null;
  })();

  inFlight.set(file.id, work);
  try {
    return await work;
  } finally {
    inFlight.delete(file.id);
  }
}

/** The picture of one whole slide, or null when the deck cannot be drawn. */
export async function wholeSlidePicture(
  db: Db,
  file: DeckFile,
  slide: { id: string; index: number },
  rasterizePdfPage: (pdf: Buffer, page: number) => Promise<Buffer>,
): Promise<Buffer | null> {
  const deck = await deckPictures(db, file);
  if (!deck) return null;
  if (deck.kind === "pdf") return rasterizePdfPage(deck.pdf, slide.index);
  try {
    return await readFile(absolutePathFor(wholeSlidePath(file.examId, slide.id)));
  } catch {
    return null;
  }
}

/**
 * Drops every old drawing of the deck (the file was re-read) and draws it
 * again, so a changed slideshow never shows last week's slides.
 */
export async function refreshDeckPictures(db: Db, file: DeckFile): Promise<void> {
  failed.delete(file.id);
  await rm(absolutePathFor(drawnMarkerPath(file)), { force: true });
  await rm(absolutePathFor(deckPdfPath(file)), { force: true });
  for (const slide of slidesOf(db, file.id)) {
    await rm(absolutePathFor(wholeSlidePath(file.examId, slide.id)), { force: true });
  }
  db.update(sourceSlides)
    .set({ imagePath: null })
    .where(
      and(
        eq(sourceSlides.sourceFileId, file.id),
        like(sourceSlides.imagePath, `%${WHOLE_SLIDE}`),
      ),
    )
    .run();
  await deckPictures(db, file);
}

async function readCached(file: DeckFile): Promise<DeckPictures | null> {
  try {
    await access(absolutePathFor(drawnMarkerPath(file)));
    return { kind: "drawn" };
  } catch {
    // Not drawn in the app yet.
  }
  try {
    return { kind: "pdf", pdf: await readFile(absolutePathFor(deckPdfPath(file))) };
  } catch {
    return null;
  }
}

function slidesOf(db: Db, fileId: string) {
  return db
    .select({ id: sourceSlides.id, index: sourceSlides.index })
    .from(sourceSlides)
    .where(eq(sourceSlides.sourceFileId, fileId))
    .orderBy(asc(sourceSlides.index))
    .all();
}

async function drawInApp(db: Db, file: DeckFile): Promise<boolean> {
  const draw = globalThis.__studyAppDrawSlides;
  const port = process.env.PORT;
  if (!draw || !port) return false;

  try {
    const pictures = await draw(
      `http://127.0.0.1:${port}/api/decks/${encodeURIComponent(file.id)}/draw`,
    );
    const slides = slidesOf(db, file.id);
    if (pictures.length === 0 || pictures.length !== slides.length) return false;

    for (const slide of slides) {
      const picture = pictures[slide.index - 1];
      if (!picture) return false;
      const path = absolutePathFor(wholeSlidePath(file.examId, slide.id));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, picture);
    }
    await writeFile(absolutePathFor(drawnMarkerPath(file)), String(slides.length));
    return true;
  } catch {
    return false;
  }
}

async function convertWithLibreOffice(db: Db, file: DeckFile): Promise<Buffer | null> {
  const soffice = await findLibreOffice();
  if (!soffice) return null;

  const work = await mkdtemp(join(tmpdir(), "megan-slides-"));
  try {
    const input = join(work, "deck.pptx");
    await writeFile(input, await readFile(absolutePathFor(file.rawPath)));
    await run(
      soffice,
      ["--headless", "--convert-to", "pdf", "--outdir", work, input],
      { timeout: CONVERT_TIMEOUT_MS, windowsHide: true },
    );
    const pdf = await readFile(join(work, "deck.pdf"));
    if (pdf.byteLength === 0) return null;
    if ((await pageCount(pdf)) !== slidesOf(db, file.id).length) return null;

    const cached = absolutePathFor(deckPdfPath(file));
    await mkdir(dirname(cached), { recursive: true });
    await writeFile(cached, pdf);
    return pdf;
  } catch {
    return null;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function findLibreOffice(): Promise<string | null> {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
            "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
          ]
        : ["/usr/bin/soffice", "/usr/local/bin/soffice", "/usr/bin/libreoffice"];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

async function pageCount(pdf: Buffer): Promise<number> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(new Uint8Array(pdf));
    return document.numPages;
  } catch {
    return -1;
  }
}
