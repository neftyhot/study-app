/**
 * A lecture's audio, for the player on its transcript page.
 *
 * Answers Range requests: without them the browser cannot seek, and jumping
 * to the sentence that was clicked is the reason the audio is kept at all.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getLecture } from "@/lib/lectures";
import { lectureAudioPath } from "@/lib/lectures/storage";

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes. */
function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;

  let start: number;
  let end: number;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/lectures/[id]/audio">,
) {
  const { id } = await ctx.params;

  const lecture = getLecture(id);
  if (!lecture?.audioPath) {
    return Response.json({ error: "No audio for this lecture" }, { status: 404 });
  }

  let file: string;
  let size: number;
  try {
    file = lectureAudioPath(lecture.audioPath);
    size = (await stat(file)).size;
  } catch {
    return Response.json({ error: "The audio file is missing" }, { status: 404 });
  }

  const headers = {
    "content-type": "audio/mp4",
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
  };

  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { ...headers, "content-length": String(size) },
    });
  }

  const range = parseRange(rangeHeader, size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${size}` },
    });
  }

  return new Response(
    Readable.toWeb(createReadStream(file, range)) as ReadableStream,
    {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(range.end - range.start + 1),
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
      },
    },
  );
}
