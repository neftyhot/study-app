/** A slideshow's original file, for the slide drawer's page to read. */
import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sourceFiles } from "@/db/schema";
import { absolutePathFor } from "@/lib/ingest/storage";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/decks/[fileId]/pptx">,
) {
  const { fileId } = await ctx.params;
  const file = db.select().from(sourceFiles).where(eq(sourceFiles.id, fileId)).get();
  if (!file || file.fileType !== "pptx") {
    return Response.json({ error: "No such slideshow." }, { status: 404 });
  }
  try {
    const data = await readFile(absolutePathFor(file.rawPath));
    return new Response(data as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "The slideshow file is missing." }, { status: 404 });
  }
}
