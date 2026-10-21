/**
 * Opens a `.meganstudy` file as a new deck.
 *
 * The body is the file's text. The window reads the file — whether the
 * student picked it or the operating system opened the app with it — so the
 * server is never handed a path to read.
 */
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { SHARE_MAX_BYTES, ShareFileError, importShareFile } from "@/lib/share/meganstudy";

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > SHARE_MAX_BYTES) {
    return Response.json({ error: "That file is too large to be a deck." }, { status: 413 });
  }
  const raw = await request.text();

  try {
    const result = importShareFile(db, raw);
    revalidatePath("/", "layout");
    return Response.json(result);
  } catch (error) {
    if (error instanceof ShareFileError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
