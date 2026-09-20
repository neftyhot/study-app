import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { SourceFile } from "@/db/schema";

const EXTENSIONS: Record<string, SourceFile["fileType"]> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
  png: "image",
  jpg: "image",
  jpeg: "image",
};

/** MVP extractors cover these; the rest are rejected at upload time. */
export const SUPPORTED_TYPES: SourceFile["fileType"][] = [
  "pdf",
  "pptx",
  "docx",
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
  const dir = join(/* turbopackIgnore: true */ uploadsRoot(), examId);
  await mkdir(dir, { recursive: true });

  const absolutePath = join(/* turbopackIgnore: true */ dir, `${fileId}.${ext}`);
  await writeFile(absolutePath, data);

  return {
    absolutePath,
    /** Stored relative to the uploads root so the root stays relocatable. */
    rawPath: join(/* turbopackIgnore: true */ examId, `${fileId}.${ext}`),
    checksum: createHash("sha256").update(data).digest("hex"),
  };
}

export function absolutePathFor(rawPath: string) {
  return join(/* turbopackIgnore: true */ uploadsRoot(), rawPath);
}
