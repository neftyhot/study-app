import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";

import type { SourceFile } from "@/db/schema";

import { resolveUnder } from "./safe-path";

export { isSafeStoredPath, UnsafePathError } from "./safe-path";

const EXTENSIONS: Record<string, SourceFile["fileType"]> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  rtf: "rtf",
  csv: "csv",
  png: "image",
  jpg: "image",
  jpeg: "image",
};

/** MVP extractors cover these; the rest are rejected at upload time. */
export const SUPPORTED_TYPES: SourceFile["fileType"][] = [
  "pdf",
  "pptx",
  "docx",
  "txt",
  "md",
  "rtf",
  "csv",
  "pasted",
];

/**
 * Uploads live outside the bundle at a path chosen at runtime, so the
 * turbopackIgnore hints below keep the build from tracing the whole project.
 */
export function uploadsRoot() {
  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.UPLOADS_DIR ?? "./data/uploads",
  );
}

export function detectFileType(filename: string): SourceFile["fileType"] | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[ext] ?? null;
}

/**
 * Writes an upload under `uploads/{examId}/{fileId}.{ext}` and returns its
 * path plus a content hash, which lets re-ingestion skip unchanged files.
 */
export async function storeUpload(
  examId: string,
  fileId: string,
  filename: string,
  data: Buffer,
) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "bin";
  const dir = absolutePathFor(examId);
  await mkdir(dir, { recursive: true });

  const absolutePath = join(/* turbopackIgnore: true */ dir, `${fileId}.${ext}`);
  await writeFile(absolutePath, data);

  return {
    absolutePath,
    /** Stored relative to the uploads root so the root stays relocatable. */
    rawPath: storedPath(examId, `${fileId}.${ext}`),
    checksum: createHash("sha256").update(data).digest("hex"),
  };
}

/**
 * A path under the uploads root, as it is stored in the database.
 *
 * Always `/`-separated, whatever the platform: rows travel between machines
 * in backups, and `abc\file.pdf` written on Windows would be one literal
 * file name on a Mac.
 */
export function storedPath(...parts: string[]) {
  return posix.join(...parts);
}

/**
 * The file on disk for a stored path. `\` is read as a separator too, so a
 * path from any platform opens on every other; nothing this app names
 * contains one. Throws UnsafePathError for anything that would leave the
 * uploads root — `..`, an absolute path, a drive letter.
 */
export function absolutePathFor(rawPath: string) {
  return resolveUnder(/* turbopackIgnore: true */ uploadsRoot(), rawPath);
}
