/**
 * Transcript export: a GET so it can be a plain link the browser downloads,
 * like the deck export.
 */
import { fileSlug } from "@/lib/export/slug";
import { getLecture } from "@/lib/lectures";
import { toSrt, toTimestampedText } from "@/lib/lectures/format";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/lectures/[id]/export">,
) {
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") ?? "txt";

  const lecture = getLecture(id);
  if (!lecture) {
    return Response.json({ error: "Lecture not found" }, { status: 404 });
  }

  let body: string;
  let extension = "txt";
  switch (format) {
    case "txt":
      body = `${lecture.title}\n\n${lecture.fullText}\n`;
      break;
    case "timestamps":
      body = `${lecture.title}\n\n${toTimestampedText(lecture.segments)}\n`;
      break;
    case "srt":
      body = toSrt(lecture.segments);
      extension = "srt";
      break;
    default:
      return Response.json({ error: `Unknown format "${format}"` }, { status: 400 });
  }

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${fileSlug(lecture.title, "lecture")}.${extension}"`,
    },
  });
}
