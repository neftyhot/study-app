/**
 * The picture a drill was built on.
 *
 * Served from the drill rather than the slide, because a drill outlives its
 * source: deleting the file it came from clears the provenance link, and the
 * boxes a student drew should not stop working when it does.
 */
import { readFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { diagramOcclusions } from "@/db/schema";
import { absolutePathFor } from "@/lib/ingest/storage";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/drills/[drillId]/image">,
) {
  const { drillId } = await ctx.params;

  const drill = db
    .select()
    .from(diagramOcclusions)
    .where(eq(diagramOcclusions.id, drillId))
    .get();

  if (!drill) {
    return Response.json({ error: "No such drill" }, { status: 404 });
  }

  try {
    const data = await readFile(absolutePathFor(drill.imagePath));
    return new Response(data as BodyInit, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json(
      { error: "The picture for this drill is missing from disk." },
      { status: 404 },
    );
  }
}
