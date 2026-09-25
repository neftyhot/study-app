/**
 * Serving a card's attached image.
 *
 * Read through the card rather than by path, so a URL cannot be pointed at an
 * arbitrary file under the uploads root.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { flashcards } from "@/db/schema";
import { absolutePathFor, isSafeStoredPath } from "@/lib/ingest/storage";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/cards/[cardId]/image">,
) {
  const { cardId } = await ctx.params;
  const side = new URL(request.url).searchParams.get("side") === "back" ? "back" : "front";

  const card = db
    .select()
    .from(flashcards)
    .where(eq(flashcards.id, cardId))
    .get();

  const path = side === "back" ? card?.backImagePath : card?.frontImagePath;
  if (!path) {
    return Response.json({ error: "No image on that card." }, { status: 404 });
  }

  // A card's image path came from the card editor; one that leaves the
  // uploads root is refused before it is anywhere near the disk.
  if (!isSafeStoredPath(path)) {
    return Response.json({ error: "That image path is not allowed." }, { status: 403 });
  }

  try {
    const data = await readFile(absolutePathFor(path));
    return new Response(data as BodyInit, {
      headers: {
        "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "That image is missing from disk." }, { status: 404 });
  }
}
