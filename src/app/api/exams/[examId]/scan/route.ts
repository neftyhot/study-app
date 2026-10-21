/**
 * Photos of notes into cards for a deck. The window only calls this after the
 * student has seen the estimate and ticked the consent box; the body is the
 * photos as a form, one `images` entry each.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { exams } from "@/db/schema";
import { getProvider, LlmError } from "@/lib/llm";
import {
  MAX_SCAN_IMAGE_BYTES,
  MAX_SCAN_IMAGES,
  SCAN_IMAGE_TYPES,
  saveScanCards,
  scanImage,
} from "@/lib/scan/scan";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/exams/[examId]/scan">,
) {
  const { examId } = await ctx.params;
  if (!db.select({ id: exams.id }).from(exams).where(eq(exams.id, examId)).get()) {
    return Response.json({ error: "Exam not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Those photos didn't arrive. Try again." }, { status: 400 });
  }
  const files = form.getAll("images").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return Response.json({ error: "Choose at least one photo." }, { status: 400 });
  if (files.length > MAX_SCAN_IMAGES) {
    return Response.json({ error: `Scan up to ${MAX_SCAN_IMAGES} photos at a time.` }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider(undefined, "interactive");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  let added = 0;
  const failed: { name: string; error: string }[] = [];
  for (const file of files) {
    if (!(SCAN_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      failed.push({ name: file.name, error: "Not a JPEG, PNG or WebP photo." });
      continue;
    }
    if (file.size > MAX_SCAN_IMAGE_BYTES) {
      failed.push({ name: file.name, error: "That photo is too large." });
      continue;
    }
    try {
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      const cards = await scanImage(provider, { mimeType: file.type, data });
      if (cards.length === 0) {
        failed.push({ name: file.name, error: "No readable notes in this photo." });
        continue;
      }
      added += saveScanCards(db, examId, cards);
    } catch (error) {
      const message = error instanceof LlmError || error instanceof Error ? error.message : String(error);
      failed.push({ name: file.name, error: message });
      // A model that can't see pictures will refuse every photo the same way.
      if (error instanceof LlmError && /reads text|can't read photos/.test(message)) break;
    }
  }

  if (added > 0) {
    revalidatePath(`/exams/${examId}`);
    revalidatePath(`/exams/${examId}/cards`);
  }
  return Response.json({ added, failed });
}
