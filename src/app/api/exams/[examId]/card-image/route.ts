/**
 * An image attached to a hand-written card.
 *
 * Stored next to the deck's uploads rather than inlined into the row: a
 * screenshot pasted onto a card is a file, and a megabyte of base64 in every
 * query that touches that card is a cost paid forever.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { NextRequest } from "next/server";

import { absolutePathFor } from "@/lib/ingest/storage";

const MAX_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exams/[examId]/card-image">,
) {
  const { examId } = await ctx.params;

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "No image was uploaded." }, { status: 400 });
  }

  const extension = EXTENSIONS[file.type];
  if (!extension) {
    return Response.json(
      { error: `${file.type || "That file"} is not an image this app can show.` },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "That image is larger than 8 MB. Crop it, or export it smaller." },
      { status: 413 },
    );
  }

  const path = join("cards", examId, `${randomUUID()}.${extension}`);
  const absolute = absolutePathFor(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from(await file.arrayBuffer()));

  return Response.json({ path });
}
